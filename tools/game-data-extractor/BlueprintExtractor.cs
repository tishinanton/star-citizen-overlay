using System.Globalization;
using System.Text.RegularExpressions;
using System.Xml;
using unforge;

internal static partial class BlueprintExtractor
{
    private const string BlueprintPrefix =
        "libs/foundry/records/crafting/blueprints/crafting/";
    private const string BlueprintPoolPrefix =
        "libs/foundry/records/crafting/blueprintrewards/";
    private const string ContractGeneratorPrefix =
        "libs/foundry/records/contracts/contractgenerator/";
    private const string SolarSystemPrefix =
        "libs/foundry/records/ssolarsystem/";
    private const string CraftingGlobalParamsPath =
        "libs/foundry/records/crafting/globalparams/craftingglobalparams.xml";
    private const int MinimumBlueprintCount = 1500;

    internal static BlueprintExtractorPayload Extract(string archivePath, DataForge dataForge)
    {
        var localization = new LocalizationCatalog(
            GameArchive.ReadEnglishLocalization(archivePath));
        var gameVersion = GameArchive.ReadGameVersion(archivePath);
        var warnings = new List<string>();
        var defaults = ReadDefaultBlueprints(dataForge);
        var pools = ReadBlueprintPools(dataForge);
        var solarSystems = ReadSolarSystems(dataForge);
        var missions = ReadBlueprintMissions(
            dataForge,
            pools,
            solarSystems,
            localization);
        var blueprints = new List<GameBlueprintRecord>();
        var imagePaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var path in dataForge.PathToRecordMap.Keys
                     .Where(path => path.StartsWith(
                         BlueprintPrefix,
                         StringComparison.OrdinalIgnoreCase))
                     .Order(StringComparer.OrdinalIgnoreCase))
        {
            var root = dataForge.ReadRecordByPathAsXml(path);
            if (root is null) continue;

            var blueprint = ParseBlueprint(
                root,
                dataForge,
                localization,
                gameVersion,
                defaults,
                missions,
                warnings);
            if (blueprint is null) continue;

            blueprints.Add(blueprint);
            if (blueprint.ImageKey is not null) imagePaths.Add(blueprint.ImageKey);
        }

        if (blueprints.Count < MinimumBlueprintCount)
        {
            throw new InvalidDataException(
                $"Only {blueprints.Count} complete blueprint records were found in Game2.dcb.");
        }

        var iconResult = GameIconExtractor.Extract(archivePath, imagePaths);
        warnings.AddRange(iconResult.Warnings);
        var sortedBlueprints = blueprints
            .OrderBy(blueprint => blueprint.OutputName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(blueprint => blueprint.OutputTypeLabel, StringComparer.OrdinalIgnoreCase)
            .ThenBy(blueprint => blueprint.Id, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return new BlueprintExtractorPayload(
            3,
            gameVersion,
            sortedBlueprints,
            iconResult.Icons,
            warnings);
    }

    private static HashSet<Guid> ReadDefaultBlueprints(DataForge dataForge)
    {
        var defaults = new HashSet<Guid>();
        if (!dataForge.PathToRecordMap.ContainsKey(CraftingGlobalParamsPath)) return defaults;

        var root = dataForge.ReadRecordByPathAsXml(CraftingGlobalParamsPath);
        var selection = root?.SelectSingleNode("//defaultBlueprintSelection");
        if (selection is null) return defaults;

        foreach (var reference in selection
                     .SelectNodes(".//blueprintRecords/Reference")!
                     .OfType<XmlElement>())
        {
            if (Guid.TryParse(reference.GetAttribute("value"), out var guid))
            {
                defaults.Add(guid);
            }
        }
        return defaults;
    }

    private static IReadOnlyDictionary<Guid, BlueprintPool> ReadBlueprintPools(
        DataForge dataForge)
    {
        var pools = new Dictionary<Guid, BlueprintPool>();
        foreach (var path in dataForge.PathToRecordMap.Keys.Where(path =>
                     path.StartsWith(BlueprintPoolPrefix, StringComparison.OrdinalIgnoreCase)))
        {
            var root = dataForge.ReadRecordByPathAsXml(path);
            if (root is null
                || !Guid.TryParse(root.GetAttribute("__ref"), out var poolId))
            {
                continue;
            }

            var rewards = root
                .GetElementsByTagName("BlueprintReward")
                .OfType<XmlElement>()
                .Select(reward =>
                    Guid.TryParse(reward.GetAttribute("blueprintRecord"), out var blueprintId)
                        ? new BlueprintPoolReward(
                            blueprintId,
                            Math.Max(ParseDouble(reward.GetAttribute("weight")) ?? 1, 0))
                        : null)
                .Where(reward => reward is not null)
                .Cast<BlueprintPoolReward>()
                .GroupBy(reward => reward.BlueprintId)
                .Select(group => new BlueprintPoolReward(
                    group.Key,
                    group.Sum(reward => reward.Weight)))
                .ToArray();
            if (rewards.Length == 0) continue;

            pools[poolId] = new BlueprintPool(
                HumanizeIdentifier(
                    root.Name
                        .Replace("BlueprintPoolRecord.", string.Empty)
                        .Replace("BP_REWARDS_", string.Empty)),
                rewards);
        }
        return pools;
    }

    private static IReadOnlyDictionary<Guid, IReadOnlyList<GameBlueprintMission>>
        ReadBlueprintMissions(
            DataForge dataForge,
            IReadOnlyDictionary<Guid, BlueprintPool> pools,
            IReadOnlyDictionary<string, string> solarSystems,
            LocalizationCatalog localization)
    {
        var missions = new Dictionary<Guid, Dictionary<string, GameBlueprintMission>>();
        foreach (var path in dataForge.PathToRecordMap.Keys.Where(path =>
                     path.StartsWith(ContractGeneratorPrefix, StringComparison.OrdinalIgnoreCase)))
        {
            var root = dataForge.ReadRecordByPathAsXml(path);
            if (root is null) continue;

            foreach (var reward in root
                         .GetElementsByTagName("BlueprintRewards")
                         .OfType<XmlElement>())
            {
                if (!Guid.TryParse(reward.GetAttribute("blueprintPool"), out var poolId)
                    || !pools.TryGetValue(poolId, out var pool))
                {
                    continue;
                }

                var contract = FindContractAncestor(reward);
                if (contract is null
                    || IsTrue(contract.GetAttribute("notForRelease"))
                    || IsTrue(contract.GetAttribute("workInProgress"))
                    || IsTrue(root.GetAttribute("notForRelease"))
                    || IsTrue(root.GetAttribute("workInProgress")))
                {
                    continue;
                }

                var debugName = contract.GetAttribute("debugName");
                var missionId = contract.GetAttribute("id");
                if (string.IsNullOrWhiteSpace(missionId))
                {
                    missionId = $"{path}:{debugName}";
                }
                var template = ReadTemplate(contract, dataForge);
                var title = ResolveMissionTitle(
                    contract,
                    template,
                    localization,
                    debugName,
                    pool.Name);
                var missionType = ResolveMissionType(
                    contract,
                    template,
                    dataForge,
                    localization);
                var contractType = template is null
                    ? null
                    : HumanizeIdentifier(
                        template.Name.Replace("ContractTemplate.", string.Empty));
                var provider = ResolveMissionProvider(contract, dataForge, localization);
                var minimumReputation = ResolveMinimumReputation(
                    contract,
                    dataForge,
                    localization);
                var starSystems = ResolveMissionSystems(
                    contract,
                    template,
                    dataForge,
                    solarSystems);
                var poolChance = Math.Clamp(
                    ParseDouble(reward.GetAttribute("chance")) ?? 1,
                    0,
                    1);
                var totalWeight = pool.Rewards.Sum(entry => entry.Weight);

                foreach (var poolReward in pool.Rewards)
                {
                    if (!missions.TryGetValue(
                            poolReward.BlueprintId,
                            out var blueprintMissions))
                    {
                        blueprintMissions = new Dictionary<string, GameBlueprintMission>(
                            StringComparer.OrdinalIgnoreCase);
                        missions[poolReward.BlueprintId] = blueprintMissions;
                    }
                    var chance = totalWeight > 0
                        ? poolChance * poolReward.Weight / totalWeight
                        : 0;
                    var mission = new GameBlueprintMission(
                        missionId,
                        title,
                        missionType,
                        contractType,
                        provider,
                        minimumReputation,
                        false,
                        starSystems,
                        chance,
                        BuildMissionWebUrl(missionId));
                    var missionKey = string.Join(
                        '\u001f',
                        title,
                        missionType,
                        contractType,
                        provider,
                        chance.ToString("F8", CultureInfo.InvariantCulture));
                    if (blueprintMissions.TryGetValue(missionKey, out var existing))
                    {
                        var reputationVaries = existing.ReputationVaries
                            || !string.Equals(
                                existing.MinimumReputation,
                                minimumReputation,
                                StringComparison.Ordinal);
                        blueprintMissions[missionKey] = existing with
                        {
                            MinimumReputation = reputationVaries
                                ? null
                                : existing.MinimumReputation,
                            ReputationVaries = reputationVaries,
                            StarSystems = existing.StarSystems
                                .Concat(starSystems)
                                .Distinct(StringComparer.OrdinalIgnoreCase)
                                .Order(StringComparer.OrdinalIgnoreCase)
                                .ToArray()
                        };
                    }
                    else
                    {
                        blueprintMissions[missionKey] = mission;
                    }
                }
            }
        }

        return missions.ToDictionary(
            entry => entry.Key,
            entry => (IReadOnlyList<GameBlueprintMission>)entry.Value.Values
                .OrderBy(mission => mission.Title, StringComparer.OrdinalIgnoreCase)
                .ToArray());
    }

    private static GameBlueprintRecord? ParseBlueprint(
        XmlElement root,
        DataForge dataForge,
        LocalizationCatalog localization,
        string gameVersion,
        IReadOnlySet<Guid> defaults,
        IReadOnlyDictionary<Guid, IReadOnlyList<GameBlueprintMission>> missions,
        ICollection<string> warnings)
    {
        if (!Guid.TryParse(root.GetAttribute("__ref"), out var blueprintId))
        {
            warnings.Add($"{root.Name}: blueprint identifier is missing");
            return null;
        }

        var creation = root
            .GetElementsByTagName("CraftingProcess_Creation")
            .OfType<XmlElement>()
            .FirstOrDefault();
        if (creation is null
            || !Guid.TryParse(creation.GetAttribute("entityClass"), out var outputId))
        {
            warnings.Add($"{root.Name}: crafted output is missing");
            return null;
        }

        var output = ReadItemMetadata(outputId, dataForge, localization);
        if (output is null)
        {
            warnings.Add($"{root.Name}: crafted output record {outputId} could not be resolved");
            return null;
        }

        var requirementGroups = ParseRequirements(root, dataForge, localization);
        var ingredients = requirementGroups
            .SelectMany(group => group.Ingredients)
            .Select(ingredient => new GameBlueprintIngredient(
                ingredient.Name,
                ingredient.Kind,
                ingredient.Quantity,
                ingredient.QuantityScu,
                null))
            .ToArray();
        var craftTimeSeconds = ParseCraftTimeSeconds(root);
        var unlockingMissions = missions.GetValueOrDefault(blueprintId)
            ?? Array.Empty<GameBlueprintMission>();
        var key = root.Name.Replace("CraftingBlueprintRecord.", string.Empty);

        return new GameBlueprintRecord(
            blueprintId.ToString(),
            key,
            output.Name,
            output.Class,
            output.Type,
            output.TypeLabel,
            output.Grade,
            craftTimeSeconds,
            FormatDuration(craftTimeSeconds),
            defaults.Contains(blueprintId),
            requirementGroups.Sum(group => group.RequiredCount),
            unlockingMissions.Count,
            ingredients,
            requirementGroups,
            unlockingMissions,
            gameVersion,
            output.ImageKey,
            null);
    }

    private static IReadOnlyList<GameBlueprintRequirementGroup> ParseRequirements(
        XmlElement root,
        DataForge dataForge,
        LocalizationCatalog localization)
    {
        var groups = new List<GameBlueprintRequirementGroup>();
        var groupIndex = 0;
        foreach (var selection in root
                     .GetElementsByTagName("CraftingCost_Select")
                     .OfType<XmlElement>())
        {
            var options = selection.ChildNodes
                .OfType<XmlElement>()
                .FirstOrDefault(child => child.Name == "options");
            if (options is null) continue;

            var parsedIngredients = options.ChildNodes
                .OfType<XmlElement>()
                .Select(option => ParseRequirement(option, dataForge, localization))
                .Where(ingredient => ingredient is not null)
                .Cast<GameBlueprintRequirementIngredient>()
                .ToArray();
            if (parsedIngredients.Length == 0) continue;

            groupIndex++;
            var nameInfo = selection.ChildNodes
                .OfType<XmlElement>()
                .FirstOrDefault(child => child.Name == "nameInfo");
            var debugName = nameInfo?.GetAttribute("debugName");
            var displayName = localization.Resolve(nameInfo?.GetAttribute("displayName"));
            var name = displayName
                ?? (string.IsNullOrWhiteSpace(debugName)
                    ? $"Requirement {groupIndex}"
                    : HumanizeIdentifier(debugName));
            var requiredCount = ParseInt(selection.GetAttribute("count")) ?? 1;

            groups.Add(
                new GameBlueprintRequirementGroup(
                    string.IsNullOrWhiteSpace(debugName)
                        ? $"requirement-{groupIndex}"
                        : debugName,
                    name,
                    Math.Max(requiredCount, 1),
                    parsedIngredients));
        }
        return groups;
    }

    private static GameBlueprintRequirementIngredient? ParseRequirement(
        XmlElement option,
        DataForge dataForge,
        LocalizationCatalog localization)
    {
        var minQuality = ParseDouble(option.GetAttribute("minQuality"));
        var quantityMultiplier = option
            .GetElementsByTagName("CraftingCostContext_QuantityMultiplier")
            .OfType<XmlElement>()
            .Select(context => ParseDouble(context.GetAttribute("multiplier")))
            .FirstOrDefault(value => value is not null)
            ?? 1;
        if (option.Name == "CraftingCost_Resource"
            && Guid.TryParse(option.GetAttribute("resource"), out var resourceId))
        {
            var resource = ReadReference(resourceId, dataForge);
            if (resource is null) return null;

            var name = localization.Resolve(resource.GetAttribute("displayName"))
                ?? HumanizeIdentifier(resource.Name.Replace("ResourceType.", string.Empty));
            var quantity = option
                .GetElementsByTagName("SStandardCargoUnit")
                .OfType<XmlElement>()
                .Select(unit => ParseDouble(unit.GetAttribute("standardCargoUnits")))
                .FirstOrDefault(value => value is not null);
            return new GameBlueprintRequirementIngredient(
                name,
                "resource",
                null,
                quantity * quantityMultiplier,
                null,
                minQuality);
        }

        if (option.Name == "CraftingCost_Item"
            && Guid.TryParse(option.GetAttribute("entityClass"), out var itemId))
        {
            var item = ReadItemMetadata(itemId, dataForge, localization);
            if (item is null) return null;

            return new GameBlueprintRequirementIngredient(
                item.Name,
                "item",
                (ParseDouble(option.GetAttribute("quantity")) ?? 1) * quantityMultiplier,
                null,
                null,
                minQuality);
        }
        return null;
    }

    private static ItemMetadata? ReadItemMetadata(
        Guid itemId,
        DataForge dataForge,
        LocalizationCatalog localization)
    {
        var root = ReadReference(itemId, dataForge);
        if (root is null) return null;

        var attach = root
            .GetElementsByTagName("AttachDef")
            .OfType<XmlElement>()
            .FirstOrDefault();
        var attachLocalization = attach?
            .GetElementsByTagName("Localization")
            .OfType<XmlElement>()
            .FirstOrDefault();
        var purchasable = root
            .GetElementsByTagName("SCItemPurchasableParams")
            .OfType<XmlElement>()
            .FirstOrDefault();
        var display = root
            .GetElementsByTagName("EntityUIDisplayParams")
            .OfType<XmlElement>()
            .FirstOrDefault();
        var itemClass = root.Name.Contains('.')
            ? root.Name[(root.Name.IndexOf('.') + 1)..]
            : root.Name;
        var name = localization.Resolve(attachLocalization?.GetAttribute("Name"))
            ?? localization.Resolve(purchasable?.GetAttribute("displayName"))
            ?? localization.Resolve(display?.GetAttribute("displayName"))
            ?? HumanizeIdentifier(itemClass);
        var type = attach?.GetAttribute("Type");
        if (string.IsNullOrWhiteSpace(type)) type = "Unknown";
        var typeLabel = localization.Resolve(purchasable?.GetAttribute("displayType"))
            ?? HumanizeIdentifier(type);
        var icon = display?.GetAttribute("displayIcon");
        var imageKey = string.IsNullOrWhiteSpace(icon)
            || icon.Equals("Default.bmp", StringComparison.OrdinalIgnoreCase)
            ? null
            : GameIconExtractor.NormalizeKey(icon);

        return new ItemMetadata(
            name,
            itemClass,
            type,
            typeLabel,
            NullIfEmpty(attach?.GetAttribute("Grade")),
            imageKey);
    }

    private static XmlElement? ReadReference(Guid id, DataForge dataForge)
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

    private static XmlElement? ReadTemplate(XmlElement contract, DataForge dataForge) =>
        Guid.TryParse(contract.GetAttribute("template"), out var templateId)
            ? ReadReference(templateId, dataForge)
            : null;

    private static XmlElement? FindContractAncestor(XmlElement reward)
    {
        XmlNode? node = reward;
        while (node is not null)
        {
            if (node is XmlElement element && element.HasAttribute("debugName"))
            {
                return element;
            }
            node = node.ParentNode;
        }
        return null;
    }

    private static IReadOnlyDictionary<string, string> ReadSolarSystems(DataForge dataForge)
    {
        var systems = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var path in dataForge.PathToRecordMap.Keys.Where(path =>
                     path.StartsWith(SolarSystemPrefix, StringComparison.OrdinalIgnoreCase)))
        {
            var root = dataForge.ReadRecordByPathAsXml(path);
            var name = NullIfEmpty(root?.GetAttribute("Name"));
            if (name is not null) systems[name] = name;
        }
        return systems;
    }

    private static string ResolveMissionTitle(
        XmlElement contract,
        XmlElement? template,
        LocalizationCatalog localization,
        string debugName,
        string poolName)
    {
        var candidates = new List<string?>();
        candidates.AddRange(
            contract
                .SelectNodes(".//ContractStringParam[@param='Title']")!
                .OfType<XmlElement>()
                .Select(node => node.GetAttribute("value")));
        candidates.Add(
            contract
                .GetElementsByTagName("overrideMissionDetailsDisplayInfo")
                .OfType<XmlElement>()
                .Select(node => node.GetAttribute("titleOverride"))
                .FirstOrDefault());
        if (template is not null)
        {
            candidates.AddRange(
                template
                    .SelectNodes(".//ContractStringParam[@param='Title']")!
                    .OfType<XmlElement>()
                    .Select(node => node.GetAttribute("value")));
            candidates.Add(
                template
                    .GetElementsByTagName("overrideMissionDetailsDisplayInfo")
                    .OfType<XmlElement>()
                    .Select(node => node.GetAttribute("titleOverride"))
                    .FirstOrDefault());
        }

        foreach (var candidate in candidates)
        {
            var title = localization.Resolve(candidate);
            if (title is not null) return title;
        }
        return string.IsNullOrWhiteSpace(debugName)
            ? poolName
            : HumanizeIdentifier(debugName);
    }

    private static string? ResolveMissionType(
        XmlElement contract,
        XmlElement? template,
        DataForge dataForge,
        LocalizationCatalog localization)
    {
        foreach (var source in new XmlElement?[] { contract, template }.OfType<XmlElement>())
        {
            var displayInfo = source
                .GetElementsByTagName("ContractDisplayInfo")
                .OfType<XmlElement>()
                .FirstOrDefault();
            if (displayInfo is null
                || !Guid.TryParse(displayInfo.GetAttribute("type"), out var typeId))
            {
                continue;
            }

            var missionType = ReadReference(typeId, dataForge);
            if (missionType is null) continue;
            return localization.Resolve(missionType.GetAttribute("LocalisedTypeName"))
                ?? HumanizeIdentifier(
                    missionType.Name.Replace("MissionType.", string.Empty));
        }
        return null;
    }

    private static string? ResolveMissionProvider(
        XmlElement contract,
        DataForge dataForge,
        LocalizationCatalog localization)
    {
        foreach (var result in contract
                     .GetElementsByTagName("contractResultReputationAmounts")
                     .OfType<XmlElement>())
        {
            if (!Guid.TryParse(result.GetAttribute("factionReputation"), out var factionId))
            {
                continue;
            }

            var faction = ReadReference(factionId, dataForge);
            if (faction is null) continue;
            var provider = localization.Resolve(faction.GetAttribute("displayName"));
            if (provider is not null) return provider;

            var identifier = faction.Name.Replace("FactionReputation.", string.Empty);
            foreach (var prefix in new[]
                     {
                         "FactionReputation_Lawful_",
                         "FactionReputation_Unlawful_",
                         "FactionReputation_"
                     })
            {
                if (identifier.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                {
                    identifier = identifier[prefix.Length..];
                    break;
                }
            }
            return HumanizeIdentifier(identifier);
        }
        return null;
    }

    private static string? ResolveMinimumReputation(
        XmlElement contract,
        DataForge dataForge,
        LocalizationCatalog localization)
    {
        if (!Guid.TryParse(contract.GetAttribute("minStanding"), out var standingId))
        {
            return null;
        }

        var standing = ReadReference(standingId, dataForge);
        if (standing is null
            || (ParseDouble(standing.GetAttribute("minReputation")) ?? 0) <= 0)
        {
            return null;
        }

        var name = NullIfEmpty(standing.GetAttribute("name"));
        return localization.Resolve(standing.GetAttribute("displayName"))
            ?? (name is null ? null : HumanizeIdentifier(name));
    }

    private static IReadOnlyList<string> ResolveMissionSystems(
        XmlElement contract,
        XmlElement? template,
        DataForge dataForge,
        IReadOnlyDictionary<string, string> solarSystems)
    {
        var matches = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var source in new XmlElement?[] { contract, template }.OfType<XmlElement>())
        {
            foreach (var location in source
                         .GetElementsByTagName("MissionPropertyValue_Location")
                         .OfType<XmlElement>())
            {
                foreach (var reference in location
                             .GetElementsByTagName("Reference")
                             .OfType<XmlElement>())
                {
                    if (!Guid.TryParse(reference.GetAttribute("value"), out var tagId)) continue;
                    var tag = ReadReference(tagId, dataForge);
                    var tagName = NullIfEmpty(tag?.GetAttribute("tagName"));
                    if (tagName is null) continue;
                    foreach (var system in solarSystems)
                    {
                        if (MatchesSolarSystemTag(tagName, system.Key))
                        {
                            matches.Add(system.Value);
                        }
                    }
                }
            }
        }
        return matches.Order(StringComparer.OrdinalIgnoreCase).ToArray();
    }

    private static bool MatchesSolarSystemTag(string tagName, string systemName)
    {
        if (tagName.Equals(systemName, StringComparison.OrdinalIgnoreCase)) return true;
        if (!tagName.StartsWith(systemName, StringComparison.OrdinalIgnoreCase)) return false;

        var suffix = tagName[systemName.Length..].TrimStart('_', '-', ' ');
        return suffix.Length > 0 && suffix.All(char.IsDigit);
    }

    private static string? BuildMissionWebUrl(string missionId) =>
        Guid.TryParse(missionId, out _)
            ? $"https://api.star-citizen.wiki/missions/{missionId}"
            : null;

    private static int ParseCraftTimeSeconds(XmlElement root)
    {
        var time = root
            .GetElementsByTagName("TimeValue_Partitioned")
            .OfType<XmlElement>()
            .FirstOrDefault();
        if (time is null) return 0;

        return (ParseInt(time.GetAttribute("days")) ?? 0) * 86400
            + (ParseInt(time.GetAttribute("hours")) ?? 0) * 3600
            + (ParseInt(time.GetAttribute("minutes")) ?? 0) * 60
            + (ParseInt(time.GetAttribute("seconds")) ?? 0);
    }

    private static string FormatDuration(int seconds)
    {
        if (seconds == 0) return "Instant";
        if (seconds < 60) return $"{seconds} second{(seconds == 1 ? string.Empty : "s")}";

        var minutes = seconds / 60;
        var remainder = seconds % 60;
        return remainder == 0
            ? $"{minutes} minute{(minutes == 1 ? string.Empty : "s")}"
            : $"{minutes} min {remainder} sec";
    }

    private static string HumanizeIdentifier(string value)
    {
        var spaced = CamelCaseBoundary().Replace(value.Replace('_', ' '), "$1 $2");
        return string.Join(
            " ",
            spaced
                .Split(' ', StringSplitOptions.RemoveEmptyEntries)
                .Select(word =>
                    word.Length <= 4 && word.All(character =>
                        char.IsUpper(character) || char.IsDigit(character))
                        ? word
                        : char.ToUpperInvariant(word[0]) + word[1..].ToLowerInvariant()));
    }

    private static int? ParseInt(string value) =>
        int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;

    private static double? ParseDouble(string value) =>
        double.TryParse(value, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : null;

    private static string? NullIfEmpty(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value;

    private static bool IsTrue(string value) =>
        value == "1" || bool.TryParse(value, out var parsed) && parsed;

    [GeneratedRegex(@"([a-z0-9])([A-Z])")]
    private static partial Regex CamelCaseBoundary();

    private sealed record BlueprintPool(
        string Name,
        IReadOnlyList<BlueprintPoolReward> Rewards);

    private sealed record BlueprintPoolReward(Guid BlueprintId, double Weight);

    private sealed record ItemMetadata(
        string Name,
        string Class,
        string Type,
        string TypeLabel,
        string? Grade,
        string? ImageKey);
}
