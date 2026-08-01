using System.Globalization;
using System.Text.RegularExpressions;
using System.Xml;
using unforge;

internal static partial class MiningExtractor
{
    private const string MineableEntityPrefix = "libs/foundry/records/entities/mineable/";
    private const string ProviderPresetPrefix = "libs/foundry/records/harvestable/providerpresets/";
    private const string StarMapPrefix = "libs/foundry/records/starmap/";
    private const string ProviderNamePrefix = "HPP_";
    private const int MinimumEntityCount = 20;
    private const int MinimumMaterialCount = 10;
    private const int MinimumProviderCount = 30;
    private const int MaximumCatalogRecordCount = 5000;

    internal static MiningExtractorPayload Extract(string archivePath, DataForge dataForge)
    {
        var localization = new LocalizationCatalog(GameArchive.ReadEnglishLocalization(archivePath));
        var gameVersion = GameArchive.ReadGameVersion(archivePath);
        var warnings = new List<string>();
        var structIndexByName = BuildStructIndex(dataForge);
        var materials = new Dictionary<Guid, MaterialAccumulator>();

        var entities = ReadEntities(dataForge, localization, materials, warnings);
        if (entities.Count is < MinimumEntityCount or > MaximumCatalogRecordCount)
        {
            throw new InvalidDataException(
                $"Found {entities.Count} mineable entity records in Game2.dcb, expected between " +
                $"{MinimumEntityCount} and {MaximumCatalogRecordCount}.");
        }
        EnsureNoDuplicates(entities.Select(entity => entity.Id), "mineable entity");

        var materialRecords = FinalizeMaterials(materials, warnings);
        if (materialRecords.Count is < MinimumMaterialCount or > MaximumCatalogRecordCount)
        {
            throw new InvalidDataException(
                $"Resolved {materialRecords.Count} mineable material (ResourceType) records from " +
                $"Game2.dcb, expected between {MinimumMaterialCount} and {MaximumCatalogRecordCount}.");
        }
        EnsureNoDuplicates(materialRecords.Select(material => material.Id), "mining material");

        var entityById = entities.ToDictionary(entity => Guid.Parse(entity.Id));
        var materialById = materialRecords.ToDictionary(material => Guid.Parse(material.Id));
        var starMapObjectsByName = ReadStarMapObjectIndex(dataForge, warnings);
        var clusters = new Dictionary<Guid, GameMiningCluster>();
        var harvestablePresetCache = new Dictionary<Guid, Guid?>();
        var unresolvedProviderLocations = new List<string>();

        var providers = new List<GameMiningProvider>();
        var locationProviderIds = new Dictionary<Guid, List<string>>();

        foreach (var path in dataForge.PathToRecordMap.Keys
                     .Where(path => path.StartsWith(
                         ProviderPresetPrefix,
                         StringComparison.OrdinalIgnoreCase))
                     .Order(StringComparer.OrdinalIgnoreCase))
        {
            var root = dataForge.ReadRecordByPathAsXml(path);
            if (root is null)
            {
                warnings.Add($"Provider preset record could not be read: {path}");
                continue;
            }

            var provider = ParseProvider(
                root,
                dataForge,
                structIndexByName,
                entityById,
                materialById,
                harvestablePresetCache,
                clusters,
                starMapObjectsByName,
                unresolvedProviderLocations,
                warnings);
            if (provider is null) continue;

            providers.Add(provider);
            if (provider.LocationId is not null)
            {
                var locationGuid = Guid.Parse(provider.LocationId);
                if (!locationProviderIds.TryGetValue(locationGuid, out var list))
                {
                    list = [];
                    locationProviderIds[locationGuid] = list;
                }
                list.Add(provider.Id);
            }
        }

        if (providers.Count is < MinimumProviderCount or > MaximumCatalogRecordCount)
        {
            throw new InvalidDataException(
                $"Found {providers.Count} harvestable provider preset records in Game2.dcb, expected " +
                $"between {MinimumProviderCount} and {MaximumCatalogRecordCount}.");
        }
        EnsureNoDuplicates(providers.Select(provider => provider.Id), "harvestable provider preset");

        if (unresolvedProviderLocations.Count > 0)
        {
            warnings.Add(
                "No StarMapObject location could be matched (by the HPP_<code> naming convention) for " +
                $"{unresolvedProviderLocations.Count} provider preset(s); these are not tied to a single " +
                "celestial body in Game2.dcb (e.g. asteroid belts, Lagrange points, event spawns) and are " +
                $"included without a location: {string.Join(", ", unresolvedProviderLocations.Order(StringComparer.OrdinalIgnoreCase))}.");
        }

        var locations = ReadLocations(dataForge, localization, locationProviderIds, warnings);
        EnsureNoDuplicates(locations.Select(location => location.Id), "mining location");

        warnings.Add(
            "Named cave POI tier placement (poor/medium/rich) is defined in socpak/prefab data outside " +
            "Game2.dcb and could not be resolved from local DataForge extraction; it is intentionally " +
            "omitted from this payload rather than fabricated.");

        return new MiningExtractorPayload(
            1,
            gameVersion,
            materialRecords,
            entities,
            locations,
            providers.OrderBy(provider => provider.Key, StringComparer.OrdinalIgnoreCase).ToArray(),
            clusters.Values.OrderBy(cluster => cluster.Key, StringComparer.OrdinalIgnoreCase).ToArray(),
            warnings);
    }

    private static void EnsureNoDuplicates(IEnumerable<string> ids, string label)
    {
        var duplicate = ids
            .GroupBy(id => id, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault(group => group.Count() > 1);
        if (duplicate is not null)
        {
            throw new InvalidDataException($"Duplicate {label} identifier found: {duplicate.Key}");
        }
    }

    private static Dictionary<string, int> BuildStructIndex(DataForge dataForge)
    {
        var index = new Dictionary<string, int>(StringComparer.Ordinal);
        for (var i = 0; i < dataForge.StructDefinitionCount; i++)
        {
            var name = dataForge.ReadStructDefinitionAtIndex(i).Name;
            index.TryAdd(name, i);
        }
        return index;
    }

    private static XmlElement? ResolveReference(Guid id, DataForge dataForge)
    {
        try
        {
            return dataForge.ReadRecordByReferenceAsXml(new XmlDocument(), id);
        }
        catch (FileNotFoundException)
        {
            return null;
        }
    }

    private static XmlElement? ResolveReference(string? reference, DataForge dataForge) =>
        Guid.TryParse(reference, out var id) ? ResolveReference(id, dataForge) : null;

    [GeneratedRegex(@"^(?<name>\w+)\[(?<index>[0-9A-Fa-f]+)\]$")]
    private static partial Regex WeakPointerPattern();

    private static XmlElement? ResolveWeakPointer(
        string? pointerText,
        DataForge dataForge,
        IReadOnlyDictionary<string, int> structIndexByName)
    {
        if (string.IsNullOrWhiteSpace(pointerText)) return null;
        var match = WeakPointerPattern().Match(pointerText);
        if (!match.Success) return null;
        if (!structIndexByName.TryGetValue(match.Groups["name"].Value, out var structIndex)) return null;
        if (!uint.TryParse(
                match.Groups["index"].Value,
                NumberStyles.HexNumber,
                CultureInfo.InvariantCulture,
                out var variantIndex))
        {
            return null;
        }

        var document = new XmlDocument();
        var element = document.CreateElement(match.Groups["name"].Value);
        return dataForge.ReadStructAtIndexAsXml(element, (uint)structIndex, variantIndex);
    }

    private static string LocalName(XmlElement root)
    {
        var dot = root.Name.IndexOf('.');
        return dot >= 0 ? root.Name[(dot + 1)..] : root.Name;
    }

    private static double ParseDouble(string value) =>
        double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) ? parsed : 0;

    private static double? ParseNullableDouble(string value) =>
        double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) ? parsed : null;

    private static string Slugify(string value)
    {
        var spaced = SlugBoundary().Replace(value.Replace('_', '-'), "$1-$2");
        return Regex.Replace(spaced, @"[^a-zA-Z0-9]+", "-").Trim('-').ToLowerInvariant();
    }

    [GeneratedRegex(@"([a-z0-9])([A-Z])")]
    private static partial Regex SlugBoundary();

    private sealed class MaterialAccumulator
    {
        public required string Id { get; init; }
        public required string Key { get; init; }
        public required string Slug { get; init; }
        public required string Name { get; init; }
        public double? DensityGramsPerCubicCentimeter { get; init; }
        public GameMiningQualityDistribution? DefaultQuality { get; init; }
        public IReadOnlyList<GameMiningQualityLocationOverride> QualityLocationOverrides { get; init; } = [];
        public IReadOnlyList<GameMiningQuantizationBand> QuantizationBands { get; init; } = [];
        public double? Instability { get; set; }
        public double? Resistance { get; set; }
        public bool Conflict { get; set; }
    }

    private static IReadOnlyList<GameMiningEntity> ReadEntities(
        DataForge dataForge,
        LocalizationCatalog localization,
        Dictionary<Guid, MaterialAccumulator> materials,
        List<string> warnings)
    {
        var entities = new List<GameMiningEntity>();
        var conflictedMaterials = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var path in dataForge.PathToRecordMap.Keys
                     .Where(path => path.StartsWith(
                         MineableEntityPrefix,
                         StringComparison.OrdinalIgnoreCase))
                     .Order(StringComparer.OrdinalIgnoreCase))
        {
            var root = dataForge.ReadRecordByPathAsXml(path);
            if (root is null)
            {
                warnings.Add($"Mineable entity record could not be read: {path}");
                continue;
            }

            var mineableParams = root
                .GetElementsByTagName("MineableParams")
                .OfType<XmlElement>()
                .FirstOrDefault();
            if (mineableParams is null) continue;

            var signatures = root
                .GetElementsByTagName("Single")
                .OfType<XmlElement>()
                .Select(node => node.GetAttribute("value"))
                .Select(value =>
                    int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
                        ? parsed
                        : 0)
                .Where(value => value > 0)
                .ToArray();
            if (signatures.Length != 1) continue;

            var method = ClassifyMethod(path);
            if (method is null) continue;

            if (!Guid.TryParse(root.GetAttribute("__ref"), out var entityId))
            {
                warnings.Add($"Mineable entity record has no valid identifier: {path}");
                continue;
            }

            var composition = ResolveComposition(
                mineableParams.GetAttribute("composition"),
                dataForge,
                localization,
                materials,
                conflictedMaterials,
                warnings);

            entities.Add(new GameMiningEntity(
                entityId.ToString(),
                path,
                LocalName(root),
                signatures[0],
                method,
                composition?.CompositionId,
                composition?.DepositName,
                composition?.MinimumDistinctElements,
                composition?.Parts ?? []));
        }

        foreach (var materialId in conflictedMaterials)
        {
            if (materials.TryGetValue(Guid.Parse(materialId), out var accumulator))
            {
                accumulator.Conflict = true;
            }
        }

        return entities;
    }

    private static string? ClassifyMethod(string recordPath)
    {
        var filename = Path.GetFileNameWithoutExtension(recordPath).ToLowerInvariant();

        var shipMatch = ShipEntityPattern().Match(filename);
        if (shipMatch.Success && !shipMatch.Groups["key"].Value.Equals("template", StringComparison.Ordinal))
        {
            return "Ship";
        }

        var fpsMatch = FpsEntityPattern().Match(filename);
        if (fpsMatch.Success && !fpsMatch.Groups["key"].Value.Equals("template", StringComparison.Ordinal))
        {
            return "FPS";
        }

        var groundMatch = GroundVehicleEntityPattern().Match(filename);
        if (groundMatch.Success && !groundMatch.Groups["key"].Value.Equals("template", StringComparison.Ordinal))
        {
            return "Ground Vehicle";
        }

        return null;
    }

    [GeneratedRegex(
        @"^mineablerock_(?:asteroid|surface)(?:common|uncommon|rare|epic|legendary)_(?<key>[a-z0-9]+)(?:_rcd_(?:large|small))?$")]
    private static partial Regex ShipEntityPattern();

    [GeneratedRegex(@"^mineablerock_fps_(?<key>[a-z0-9]+)(?:_(?:large|small|pure_small))?$")]
    private static partial Regex FpsEntityPattern();

    [GeneratedRegex(@"^mineablerock_groundvehicle_(?<key>[a-z0-9]+)(?:_(?:large|small))?$")]
    private static partial Regex GroundVehicleEntityPattern();

    private sealed record CompositionResult(
        string CompositionId,
        string? DepositName,
        int? MinimumDistinctElements,
        IReadOnlyList<GameMiningCompositionPart> Parts);

    private static CompositionResult? ResolveComposition(
        string? compositionRef,
        DataForge dataForge,
        LocalizationCatalog localization,
        Dictionary<Guid, MaterialAccumulator> materials,
        HashSet<string> conflictedMaterials,
        List<string> warnings)
    {
        if (!Guid.TryParse(compositionRef, out var compositionId)) return null;
        var composition = ResolveReference(compositionId, dataForge);
        if (composition is null)
        {
            warnings.Add($"Mineable composition {compositionId} could not be resolved.");
            return null;
        }

        var minimumDistinctElements = int.TryParse(
            composition.GetAttribute("minimumDistinctElements"),
            NumberStyles.Integer,
            CultureInfo.InvariantCulture,
            out var parsedMinimum)
            ? parsedMinimum
            : (int?)null;
        var depositName = localization.Resolve(composition.GetAttribute("depositName"));

        var parts = new List<GameMiningCompositionPart>();
        foreach (var part in composition
                     .GetElementsByTagName("MineableCompositionPart")
                     .OfType<XmlElement>())
        {
            if (!Guid.TryParse(part.GetAttribute("mineableElement"), out var elementId)) continue;
            var element = ResolveReference(elementId, dataForge);
            if (element is null)
            {
                warnings.Add($"Mineable element {elementId} could not be resolved.");
                continue;
            }

            if (!Guid.TryParse(element.GetAttribute("resourceType"), out var resourceTypeId)) continue;

            var instability = ParseNullableDouble(element.GetAttribute("elementInstability"));
            var resistance = ParseNullableDouble(element.GetAttribute("elementResistance"));

            var accumulator = GetOrCreateMaterial(
                resourceTypeId,
                dataForge,
                localization,
                materials,
                warnings);
            if (accumulator is null) continue;

            ApplyMaterialCharacteristics(
                accumulator,
                instability,
                resistance,
                conflictedMaterials);

            parts.Add(new GameMiningCompositionPart(
                resourceTypeId.ToString(),
                ParseDouble(part.GetAttribute("minPercentage")),
                ParseDouble(part.GetAttribute("maxPercentage")),
                ParseDouble(part.GetAttribute("probability")),
                ParseDouble(part.GetAttribute("curveExponent")),
                ParseDouble(part.GetAttribute("qualityScale")),
                instability,
                resistance));
        }

        return new CompositionResult(compositionId.ToString(), depositName, minimumDistinctElements, parts);
    }

    private static void ApplyMaterialCharacteristics(
        MaterialAccumulator accumulator,
        double? instability,
        double? resistance,
        HashSet<string> conflictedMaterials)
    {
        if (accumulator.Instability is null && accumulator.Resistance is null)
        {
            accumulator.Instability = instability;
            accumulator.Resistance = resistance;
            return;
        }

        const double epsilon = 1e-6;
        var instabilityMatches = NullableApproximatelyEqual(accumulator.Instability, instability, epsilon);
        var resistanceMatches = NullableApproximatelyEqual(accumulator.Resistance, resistance, epsilon);
        if (!instabilityMatches || !resistanceMatches)
        {
            conflictedMaterials.Add(accumulator.Id);
        }
    }

    private static bool NullableApproximatelyEqual(double? left, double? right, double epsilon)
    {
        if (left is null || right is null) return left is null && right is null;
        return Math.Abs(left.Value - right.Value) <= epsilon;
    }

    private static MaterialAccumulator? GetOrCreateMaterial(
        Guid resourceTypeId,
        DataForge dataForge,
        LocalizationCatalog localization,
        Dictionary<Guid, MaterialAccumulator> materials,
        List<string> warnings)
    {
        if (materials.TryGetValue(resourceTypeId, out var existing)) return existing;

        var root = ResolveReference(resourceTypeId, dataForge);
        if (root is null)
        {
            warnings.Add($"ResourceType {resourceTypeId} could not be resolved.");
            return null;
        }

        var key = LocalName(root);
        var name = localization.Resolve(root.GetAttribute("displayName")) ?? key;
        var density = root
            .GetElementsByTagName("GramsPerCubicCentimeter")
            .OfType<XmlElement>()
            .FirstOrDefault();
        var densityValue = density is null
            ? null
            : ParseNullableDouble(density.GetAttribute("gramsPerCubicCentimeter"));
        if (density is null)
        {
            warnings.Add($"Material '{key}' has a density unit that is not GramsPerCubicCentimeter; density is omitted.");
        }

        var craftingData = root
            .GetElementsByTagName("ResourceTypeCraftingData")
            .OfType<XmlElement>()
            .FirstOrDefault();

        GameMiningQualityDistribution? defaultQuality = null;
        var overrides = new List<GameMiningQualityLocationOverride>();
        var bands = new List<GameMiningQuantizationBand>();

        if (craftingData is not null)
        {
            var distributionRef = craftingData
                .GetElementsByTagName("CraftingQualityDistribution_RecordRef")
                .OfType<XmlElement>()
                .FirstOrDefault()
                ?.GetAttribute("qualityDistributionRecord");
            var distributionRecord = ResolveReference(distributionRef, dataForge);
            defaultQuality = distributionRecord is null
                ? null
                : ReadQualityDistribution(
                    distributionRecord
                        .GetElementsByTagName("CraftingQualityDistributionNormal")
                        .OfType<XmlElement>()
                        .FirstOrDefault());
            if (distributionRecord is not null && defaultQuality is null)
            {
                warnings.Add($"Material '{key}' quality distribution record had no readable distribution.");
            }

            var overrideRef = craftingData
                .GetElementsByTagName("CraftingQualityLocationOverride_RecordRef")
                .OfType<XmlElement>()
                .FirstOrDefault()
                ?.GetAttribute("locationOverrideRecord");
            var overrideRecord = ResolveReference(overrideRef, dataForge);
            if (overrideRecord is not null)
            {
                foreach (var entry in overrideRecord
                             .GetElementsByTagName("CraftingQualityLocationOverrideEntry")
                             .OfType<XmlElement>())
                {
                    if (!Guid.TryParse(entry.GetAttribute("location"), out var locationId)) continue;
                    var distribution = ReadQualityDistribution(
                        entry
                            .GetElementsByTagName("CraftingQualityDistributionNormal")
                            .OfType<XmlElement>()
                            .FirstOrDefault());
                    if (distribution is null) continue;

                    var locationRoot = ResolveReference(locationId, dataForge);
                    var locationName = locationRoot is null
                        ? null
                        : localization.Resolve(locationRoot.GetAttribute("name")) ?? LocalName(locationRoot);
                    overrides.Add(new GameMiningQualityLocationOverride(
                        locationId.ToString(),
                        locationName,
                        distribution));
                }
            }

            var quantizationRef = craftingData
                .GetElementsByTagName("CraftingQualityQuantization_RecordRef")
                .OfType<XmlElement>()
                .FirstOrDefault()
                ?.GetAttribute("qualityQuantizationRecord");
            var quantizationRecord = ResolveReference(quantizationRef, dataForge);
            if (quantizationRecord is not null)
            {
                foreach (var band in quantizationRecord
                             .GetElementsByTagName("CraftingQualityQuantizationBand")
                             .OfType<XmlElement>())
                {
                    bands.Add(new GameMiningQuantizationBand(
                        ParseDouble(band.GetAttribute("start")),
                        ParseDouble(band.GetAttribute("end")),
                        ParseDouble(band.GetAttribute("mappedValue"))));
                }
            }
        }
        else
        {
            warnings.Add($"Material '{key}' has no ResourceTypeCraftingData; quality data is omitted.");
        }

        var accumulator = new MaterialAccumulator
        {
            Id = resourceTypeId.ToString(),
            Key = key,
            Slug = Slugify(key),
            Name = name,
            DensityGramsPerCubicCentimeter = densityValue,
            DefaultQuality = defaultQuality,
            QualityLocationOverrides = overrides
                .OrderBy(entry => entry.LocationName, StringComparer.OrdinalIgnoreCase)
                .ToArray(),
            QuantizationBands = bands.OrderBy(band => band.Start).ToArray(),
        };
        materials[resourceTypeId] = accumulator;
        return accumulator;
    }

    private static GameMiningQualityDistribution? ReadQualityDistribution(XmlElement? element) =>
        element is null
            ? null
            : new GameMiningQualityDistribution(
                ParseDouble(element.GetAttribute("min")),
                ParseDouble(element.GetAttribute("max")),
                ParseDouble(element.GetAttribute("mean")),
                ParseDouble(element.GetAttribute("stddev")));

    private static IReadOnlyList<GameMiningMaterial> FinalizeMaterials(
        Dictionary<Guid, MaterialAccumulator> materials,
        List<string> warnings)
    {
        var conflicted = materials.Values.Where(material => material.Conflict).ToArray();
        if (conflicted.Length > 0)
        {
            warnings.Add(
                "Materials with inconsistent instability/resistance values across mineable entities were " +
                "left unset at the material level (see each entity's composition parts instead): " +
                $"{string.Join(", ", conflicted.Select(material => material.Key).OrderBy(key => key, StringComparer.OrdinalIgnoreCase))}.");
        }

        return materials.Values
            .Select(material => new GameMiningMaterial(
                material.Id,
                material.Key,
                material.Slug,
                material.Name,
                material.DensityGramsPerCubicCentimeter,
                material.Conflict ? null : material.Instability,
                material.Conflict ? null : material.Resistance,
                material.DefaultQuality,
                material.QualityLocationOverrides,
                material.QuantizationBands))
            .OrderBy(material => material.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(material => material.Id, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static Dictionary<string, Guid> ReadStarMapObjectIndex(DataForge dataForge, List<string> warnings)
    {
        var index = new Dictionary<string, Guid>(StringComparer.OrdinalIgnoreCase);
        foreach (var path in dataForge.PathToRecordMap.Keys
                     .Where(p => p.StartsWith(StarMapPrefix, StringComparison.OrdinalIgnoreCase)))
        {
            var root = dataForge.ReadRecordByPathAsXml(path);
            if (root is null
                || !root.Name.StartsWith("StarMapObject.", StringComparison.OrdinalIgnoreCase)
                || !Guid.TryParse(root.GetAttribute("__ref"), out var id))
            {
                continue;
            }

            var name = LocalName(root);
            if (!index.TryAdd(name, id))
            {
                warnings.Add($"Multiple StarMapObject records share the local name '{name}'; using the first found.");
            }
        }

        if (index.Count == 0)
        {
            throw new InvalidDataException("No StarMapObject records were found in Game2.dcb.");
        }
        return index;
    }

    private static Guid? ResolveHarvestableEntity(
        Guid harvestablePresetId,
        DataForge dataForge,
        Dictionary<Guid, Guid?> cache,
        List<string> warnings)
    {
        if (cache.TryGetValue(harvestablePresetId, out var cached)) return cached;

        var preset = ResolveReference(harvestablePresetId, dataForge);
        if (preset is null)
        {
            warnings.Add($"HarvestablePreset {harvestablePresetId} could not be resolved.");
            cache[harvestablePresetId] = null;
            return null;
        }

        if (!Guid.TryParse(preset.GetAttribute("entityClass"), out var entityClassId))
        {
            warnings.Add($"HarvestablePreset {harvestablePresetId} has no entityClass reference.");
            cache[harvestablePresetId] = null;
            return null;
        }

        cache[harvestablePresetId] = entityClassId;
        return entityClassId;
    }

    private static GameMiningCluster? ResolveCluster(Guid clusterId, DataForge dataForge, List<string> warnings)
    {
        var root = ResolveReference(clusterId, dataForge);
        if (root is null)
        {
            warnings.Add($"HarvestableClusterPreset {clusterId} could not be resolved.");
            return null;
        }

        var buckets = root
            .GetElementsByTagName("HarvestableClusterParams")
            .OfType<XmlElement>()
            .Select(bucket => new GameMiningClusterBucket(
                ParseDouble(bucket.GetAttribute("relativeProbability")),
                ParseDouble(bucket.GetAttribute("minSize")),
                ParseDouble(bucket.GetAttribute("maxSize")),
                ParseDouble(bucket.GetAttribute("minProximity")),
                ParseDouble(bucket.GetAttribute("maxProximity"))))
            .ToArray();
        if (buckets.Length == 0)
        {
            warnings.Add($"HarvestableClusterPreset {clusterId} has no cluster variation buckets.");
        }

        return new GameMiningCluster(
            clusterId.ToString(),
            LocalName(root),
            ParseDouble(root.GetAttribute("probabilityOfClustering")) / 100.0,
            buckets);
    }

    private static IReadOnlyList<GameMiningContributionMaterial> BuildContributionMaterials(
        GameMiningEntity entity,
        IReadOnlyDictionary<Guid, GameMiningMaterial> materialById,
        string? locationId)
    {
        var results = new List<GameMiningContributionMaterial>();
        foreach (var part in entity.Composition)
        {
            if (!Guid.TryParse(part.MaterialId, out var materialGuid)
                || !materialById.TryGetValue(materialGuid, out var material))
            {
                continue;
            }

            var overrideEntry = locationId is not null
                ? material.QualityLocationOverrides.FirstOrDefault(entry =>
                    string.Equals(entry.LocationId, locationId, StringComparison.OrdinalIgnoreCase))
                : null;
            var effective = overrideEntry?.Distribution ?? material.DefaultQuality;
            if (effective is null) continue;

            var reachable = material.QuantizationBands
                .Where(band => band.Start <= effective.Max && band.End >= effective.Min)
                .Select(band => band.MappedValue)
                .Distinct()
                .OrderBy(value => value)
                .ToArray();

            results.Add(new GameMiningContributionMaterial(
                material.Id,
                effective,
                overrideEntry is not null,
                reachable));
        }
        return results;
    }

    private static GameMiningProvider? ParseProvider(
        XmlElement root,
        DataForge dataForge,
        IReadOnlyDictionary<string, int> structIndexByName,
        IReadOnlyDictionary<Guid, GameMiningEntity> entityById,
        IReadOnlyDictionary<Guid, GameMiningMaterial> materialById,
        Dictionary<Guid, Guid?> harvestablePresetCache,
        Dictionary<Guid, GameMiningCluster> clusters,
        IReadOnlyDictionary<string, Guid> starMapObjectsByName,
        List<string> unresolvedProviderLocations,
        List<string> warnings)
    {
        if (!Guid.TryParse(root.GetAttribute("__ref"), out var providerId))
        {
            warnings.Add($"Provider preset record has no valid identifier: {root.GetAttribute("__path")}");
            return null;
        }

        var key = LocalName(root);
        var code = key.StartsWith(ProviderNamePrefix, StringComparison.OrdinalIgnoreCase)
            ? key[ProviderNamePrefix.Length..]
            : key;
        string? locationId = null;
        string? locationName = null;
        if (starMapObjectsByName.TryGetValue(code, out var matchedLocation))
        {
            locationId = matchedLocation.ToString();
            locationName = LocalName(ResolveReference(matchedLocation, dataForge) ?? root);
        }
        else
        {
            unresolvedProviderLocations.Add(key);
        }

        var groups = new List<GameMiningProviderGroup>();
        var unmappedHarvestables = 0;
        foreach (var groupElement in root
                     .GetElementsByTagName("HarvestableElementGroup")
                     .OfType<XmlElement>())
        {
            var elements = (groupElement.SelectNodes("./harvestables/HarvestableElement")
                    ?? groupElement.OwnerDocument.CreateElement("empty").ChildNodes)
                .OfType<XmlElement>()
                .ToArray();
            var totalWeight = elements.Sum(element => ParseDouble(element.GetAttribute("relativeProbability")));
            if (totalWeight <= 0 && elements.Length > 0)
            {
                warnings.Add(
                    $"Provider '{key}' group '{groupElement.GetAttribute("groupName")}' has zero total " +
                    "relative weight across its elements; relative probabilities are set to 0.");
            }

            var contributions = new List<GameMiningContribution>();
            foreach (var element in elements)
            {
                if (!Guid.TryParse(element.GetAttribute("harvestable"), out var harvestableId)) continue;

                var entityGuid = ResolveHarvestableEntity(harvestableId, dataForge, harvestablePresetCache, warnings);
                if (entityGuid is null || !entityById.TryGetValue(entityGuid.Value, out var entity))
                {
                    unmappedHarvestables++;
                    continue;
                }

                var weight = ParseDouble(element.GetAttribute("relativeProbability"));
                var relativeProbability = totalWeight > 0 ? weight / totalWeight : 0;

                Guid? clusterId = null;
                if (Guid.TryParse(element.GetAttribute("clustering"), out var parsedClusterId))
                {
                    clusterId = parsedClusterId;
                    if (!clusters.ContainsKey(parsedClusterId))
                    {
                        var cluster = ResolveCluster(parsedClusterId, dataForge, warnings);
                        if (cluster is not null) clusters[parsedClusterId] = cluster;
                    }
                }

                contributions.Add(new GameMiningContribution(
                    harvestableId.ToString(),
                    entity.Id,
                    relativeProbability,
                    clusterId?.ToString(),
                    BuildContributionMaterials(entity, materialById, locationId)));
            }

            groups.Add(new GameMiningProviderGroup(
                groupElement.GetAttribute("groupName"),
                ParseDouble(groupElement.GetAttribute("groupProbability")) / 100.0,
                contributions));
        }

        if (unmappedHarvestables > 0)
        {
            warnings.Add(
                $"Provider '{key}' has {unmappedHarvestables} harvestable element(s) that do not resolve to " +
                "a classified mineable rock entity (non-mining harvestables sharing the same provider " +
                "mechanism, e.g. ship-wreck salvage debris or flora); " +
                "their contributions are omitted.");
        }

        var areas = new List<GameMiningArea>();
        foreach (var areaElement in root.GetElementsByTagName("HarvestableAreaPreset").OfType<XmlElement>())
        {
            var exceptions = new List<GameMiningAreaException>();
            var modifiers = areaElement.SelectNodes("./modifiers/HarvestableElementModifier")
                ?.OfType<XmlElement>() ?? [];
            foreach (var modifier in modifiers)
            {
                var pointerText = (modifier.SelectSingleNode("./harvestableElement") as XmlElement)
                    ?.GetAttribute("value");
                var resolved = ResolveWeakPointer(pointerText, dataForge, structIndexByName);
                var harvestableGuid = resolved?.GetAttribute("harvestable");
                if (string.IsNullOrWhiteSpace(harvestableGuid))
                {
                    warnings.Add(
                        $"Provider '{key}' area '{areaElement.GetAttribute("debugGroupName")}' has an " +
                        $"unresolved harvestable element modifier pointer: {pointerText}");
                    continue;
                }

                exceptions.Add(new GameMiningAreaException(
                    harvestableGuid,
                    ParseDouble(modifier.GetAttribute("harvestableModifier"))));
            }

            areas.Add(new GameMiningArea(
                areaElement.GetAttribute("debugGroupName"),
                ParseDouble(areaElement.GetAttribute("globalModifier")),
                exceptions));
        }

        return new GameMiningProvider(providerId.ToString(), key, locationId, locationName, groups, areas);
    }

    private static string? NullIfEmpty(string? value) => string.IsNullOrWhiteSpace(value) ? null : value;

    private static IReadOnlyList<GameMiningLocation> ReadLocations(
        DataForge dataForge,
        LocalizationCatalog localization,
        IReadOnlyDictionary<Guid, List<string>> locationProviderIds,
        List<string> warnings)
    {
        var locations = new List<GameMiningLocation>();
        foreach (var (locationId, providerIds) in locationProviderIds)
        {
            var root = ResolveReference(locationId, dataForge);
            if (root is null)
            {
                warnings.Add($"StarMapObject location {locationId} could not be resolved.");
                continue;
            }

            var name = localization.Resolve(root.GetAttribute("name")) ?? LocalName(root);
            var type = NullIfEmpty(root.GetAttribute("navIcon")) ?? "Unknown";

            string? parentId = null;
            string? parentName = null;
            string? system = null;
            var current = root;
            var depth = 0;
            while (depth < 10)
            {
                if (!Guid.TryParse(current.GetAttribute("parent"), out var parentGuid))
                {
                    system = localization.Resolve(current.GetAttribute("name")) ?? LocalName(current);
                    break;
                }

                var parentRoot = ResolveReference(parentGuid, dataForge);
                if (parentRoot is null)
                {
                    warnings.Add($"Parent StarMapObject {parentGuid} for location '{name}' could not be resolved.");
                    break;
                }

                if (depth == 0)
                {
                    parentId = parentGuid.ToString();
                    parentName = localization.Resolve(parentRoot.GetAttribute("name")) ?? LocalName(parentRoot);
                }

                current = parentRoot;
                depth++;
            }

            if (depth >= 10)
            {
                warnings.Add($"Location '{name}' parent chain exceeded the maximum walk depth; system may be incomplete.");
            }

            locations.Add(new GameMiningLocation(
                locationId.ToString(),
                name,
                parentId,
                parentName,
                system,
                type,
                providerIds.OrderBy(id => id, StringComparer.OrdinalIgnoreCase).ToArray()));
        }

        return locations
            .OrderBy(location => location.System, StringComparer.OrdinalIgnoreCase)
            .ThenBy(location => location.Name, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }
}

