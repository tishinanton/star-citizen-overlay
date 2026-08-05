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

    internal static BlueprintExtractorPayload Extract(
        string archivePath,
        DataForge dataForge,
        string localizationSource)
    {
        var localization = new LocalizationCatalog(
            GameArchive.ReadEnglishLocalization(archivePath, localizationSource));
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

        var sharedIconBlueprints = ApplySharedBlueprintIcons(blueprints);
        var fallbackIcons = sharedIconBlueprints
            .Where(blueprint => blueprint.ImageKey is null)
            .Select(blueprint => (
                Blueprint: blueprint,
                ImageKey: ResolveFallbackImageKey(blueprint)))
            .Where(entry => entry.ImageKey is not null)
            .ToDictionary(
                entry => entry.Blueprint.Id,
                entry => entry.ImageKey!,
                StringComparer.OrdinalIgnoreCase);
        imagePaths.UnionWith(sharedIconBlueprints
            .Select(blueprint => blueprint.ImageKey)
            .OfType<string>());
        var iconResult = GameIconExtractor.Extract(
            archivePath,
            imagePaths,
            fallbackIcons.Values);
        warnings.AddRange(iconResult.Warnings);
        var sortedBlueprints = sharedIconBlueprints
            .Select(blueprint =>
                blueprint.ImageKey is null
                && fallbackIcons.TryGetValue(blueprint.Id, out var fallbackImageKey)
                && iconResult.Icons.ContainsKey(fallbackImageKey)
                    ? blueprint with { ImageKey = fallbackImageKey }
                    : blueprint)
            .OrderBy(blueprint => blueprint.OutputName, StringComparer.OrdinalIgnoreCase)
            .ThenBy(blueprint => blueprint.OutputTypeLabel, StringComparer.OrdinalIgnoreCase)
            .ThenBy(blueprint => blueprint.Id, StringComparer.OrdinalIgnoreCase)
            .ToArray();

        return new BlueprintExtractorPayload(
            9,
            gameVersion,
            sortedBlueprints,
            iconResult.Icons,
            warnings);
    }

    private static IReadOnlyList<GameBlueprintRecord> ApplySharedBlueprintIcons(
        IReadOnlyList<GameBlueprintRecord> blueprints)
    {
        var imageKeyByClass = blueprints
            .Where(blueprint => blueprint.ImageKey is not null)
            .GroupBy(blueprint => blueprint.OutputClass, StringComparer.OrdinalIgnoreCase)
            .ToDictionary(
                group => group.Key,
                group => group.First().ImageKey!,
                StringComparer.OrdinalIgnoreCase);
        return blueprints
            .Select(blueprint =>
            {
                if (blueprint.ImageKey is not null)
                {
                    return blueprint;
                }
                var baseClass = blueprint.OutputType switch
                {
                    "WeaponPersonal" => CosmeticClassSuffix().Replace(
                        blueprint.OutputClass,
                        string.Empty),
                    "WeaponAttachment" => MagazineClassSuffix().Replace(
                        blueprint.OutputClass,
                        string.Empty),
                    _ => blueprint.OutputClass
                };
                return imageKeyByClass.TryGetValue(baseClass, out var imageKey)
                    ? blueprint with { ImageKey = imageKey }
                    : blueprint;
            })
            .ToArray();
    }

    private static string? ResolveFallbackImageKey(GameBlueprintRecord blueprint) =>
        blueprint.OutputType switch
        {
            "WeaponGun" =>
                $"ui/mobiglas/assets/tif/dumpersdepot_items/{blueprint.OutputClass}.tif",
            "WeaponPersonal" =>
                $"ui/mobiglas/assets/tif/cubbyblast_items/{blueprint.OutputClass}.tif",
            "TractorBeam" or "SalvageHead" =>
                "ui/mobiglas/assets/tif/dumpersdepot_items/greycat_industrial_suregrip_tractor.tif",
            _ => null
        };

    private static string? ResolveArmorIconKey(
        string type,
        string? subtype)
    {
        if (type != "Char_Armor_Helmet") return null;
        return subtype?.ToLowerInvariant() switch
        {
            "light" => "ui/textures/ea/loadouticons/light_armour_64.tif",
            "medium" => "ui/textures/ea/loadouticons/medium_armour_64.tif",
            "heavy" => "ui/textures/ea/loadouticons/heavy_armour_64.tif",
            _ => null
        };
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
            output.Description,
            output.Manufacturer,
            output.Stats,
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
        imageKey ??= ResolveArmorIconKey(type, attach?.GetAttribute("SubType"));
        var description = localization.Resolve(attachLocalization?.GetAttribute("Description"))
            ?? localization.Resolve(display?.GetAttribute("displayDescription"));
        var manufacturer = ResolveManufacturer(attach, dataForge, localization);
        var stats = BuildOutputStats(root, attach, dataForge);

        return new ItemMetadata(
            name,
            itemClass,
            type,
            typeLabel,
            NullIfEmpty(attach?.GetAttribute("Grade")),
            imageKey,
            description,
            manufacturer,
            stats);
    }

    private static string? ResolveManufacturer(
        XmlElement? attach,
        DataForge dataForge,
        LocalizationCatalog localization)
    {
        if (attach is null
            || !Guid.TryParse(attach.GetAttribute("Manufacturer"), out var manufacturerId))
        {
            return null;
        }

        var manufacturer = ReadReference(manufacturerId, dataForge);
        var manufacturerLocalization = manufacturer?
            .GetElementsByTagName("Localization")
            .OfType<XmlElement>()
            .FirstOrDefault();
        return localization.Resolve(manufacturerLocalization?.GetAttribute("Name"))
            ?? NullIfEmpty(manufacturer?.GetAttribute("Code"));
    }

    private static IReadOnlyList<GameBlueprintStat> BuildOutputStats(
        XmlElement root,
        XmlElement? attach,
        DataForge dataForge)
    {
        var stats = new List<GameBlueprintStat>();
        var type = attach?.GetAttribute("Type") ?? "Unknown";
        var size = ParseDouble(attach?.GetAttribute("Size") ?? string.Empty);
        var mass = ReadElementAttribute(root, "SEntityRigidPhysicsControllerParams", "Mass");
        var health = ReadElementAttribute(root, "SHealthComponentParams", "Health");
        var powerUnits = ReadElementAttribute(root, "SPowerSegmentResourceUnit", "units");
        AddSizeStat(stats, size);

        switch (type)
        {
            case "Char_Armor_Arms":
            case "Char_Armor_Torso":
            case "Char_Armor_Legs":
            case "Char_Armor_Helmet":
            case "Char_Armor_Undersuit":
            case "Char_Clothing_Torso_0":
            case "Char_Clothing_Torso_1":
            case "Char_Clothing_Legs":
            case "Char_Clothing_Feet":
                AddArmorStats(stats, root, dataForge);
                AddStorageStat(stats, root, dataForge);
                AddMassStat(stats, mass);
                break;
            case "Char_Armor_Backpack":
                AddStorageStat(stats, root, dataForge);
                AddMassStat(stats, mass);
                break;
            case "WeaponPersonal":
            case "WeaponGun":
            case "WeaponAttachment":
                AddWeaponStats(stats, root, type, dataForge);
                AddMassStat(stats, mass);
                break;
            case "Shield":
                AddStat(
                    stats,
                    "shield-capacity",
                    "Shield capacity",
                    FormatWithUnit(
                        ReadElementAttribute(root, "SCItemShieldGeneratorParams", "MaxShieldHealth"),
                        "HP"));
                AddStat(
                    stats,
                    "shield-regeneration",
                    "Regeneration",
                    FormatWithUnit(
                        ReadElementAttribute(root, "SCItemShieldGeneratorParams", "MaxShieldRegen"),
                        "HP/s"));
                AddStat(
                    stats,
                    "damaged-delay",
                    "Damaged delay",
                    FormatWithUnit(
                        ReadElementAttribute(root, "SCItemShieldGeneratorParams", "DamagedRegenDelay"),
                        "s"));
                AddPowerStat(stats, powerUnits, "Power demand");
                AddMassStat(stats, mass);
                break;
            case "Cooler":
                AddStat(
                    stats,
                    "cooling-rate",
                    "Cooling rate",
                    FormatWithUnit(
                        ReadElementAttribute(
                            root,
                            "CoolingEqualizationRateAtTemperatureDifference",
                            "coolingEqualizationRate"),
                        "units/s"));
                AddPowerStat(stats, powerUnits, "Power demand");
                AddHealthStat(stats, health);
                AddMassStat(stats, mass);
                break;
            case "PowerPlant":
                AddPowerStat(stats, powerUnits, "Power output");
                AddStat(
                    stats,
                    "overheat-temperature",
                    "Overheat temperature",
                    FormatWithUnit(
                        ReadElementAttribute(root, "itemResourceParams", "overheatTemperature"),
                        "K"));
                AddHealthStat(stats, health);
                AddMassStat(stats, mass);
                break;
            case "QuantumDrive":
                AddStat(
                    stats,
                    "quantum-speed",
                    "Quantum speed",
                    FormatSpeed(
                        ReadElementAttribute(root, "splineJumpParams", "driveSpeed")));
                AddStat(
                    stats,
                    "spool-time",
                    "Spool time",
                    FormatWithUnit(
                        ReadElementAttribute(root, "splineJumpParams", "spoolUpTime"),
                        "s"));
                AddStat(
                    stats,
                    "cooldown",
                    "Cooldown",
                    FormatWithUnit(
                        ReadElementAttribute(root, "splineJumpParams", "cooldownTime"),
                        "s"));
                AddMassStat(stats, mass);
                break;
            case "Radar":
                AddStat(
                    stats,
                    "sensitivity",
                    "Sensitivity",
                    FormatPercent(
                        ReadElementAttribute(root, "SCItemRadarSignatureDetection", "sensitivity")));
                AddStat(
                    stats,
                    "piercing",
                    "Signal piercing",
                    FormatPercent(
                        ReadElementAttribute(root, "SCItemRadarSignatureDetection", "piercing")));
                AddPowerStat(stats, powerUnits, "Power demand");
                AddMassStat(stats, mass);
                break;
            case "WeaponMining":
                AddStat(
                    stats,
                    "effective-range",
                    "Effective range",
                    FormatWithUnit(
                        ReadElementAttribute(root, "SWeaponActionFireBeamParams", "fullDamageRange"),
                        "m"));
                AddStat(
                    stats,
                    "maximum-range",
                    "Maximum range",
                    FormatWithUnit(
                        ReadElementAttribute(root, "SWeaponActionFireBeamParams", "zeroDamageRange"),
                        "m"));
                var miningPower = ReadBeamPower(root, "ElectricArc");
                var minimumThrottle = ReadElementAttribute(
                    root,
                    "SEntityComponentMiningLaserParams",
                    "throttleMinimum");
                AddStat(
                    stats,
                    "mining-laser-power",
                    "Mining laser power",
                    miningPower is null
                        ? null
                        : $"{FormatNumber(miningPower * (minimumThrottle ?? 1))} - {FormatNumber(miningPower)}");
                AddStat(
                    stats,
                    "extraction-laser-power",
                    "Extraction laser power",
                    FormatNumber(ReadBeamPower(root, "Extraction")));
                var moduleSlots = root
                    .GetElementsByTagName("SItemPortDef")
                    .OfType<XmlElement>()
                    .Count(element => element
                        .GetAttribute("PortTags")
                        .Split(' ', StringSplitOptions.RemoveEmptyEntries)
                        .Contains("miningConsumable", StringComparer.OrdinalIgnoreCase));
                AddStat(
                    stats,
                    "module-slots",
                    "Module slots",
                    moduleSlots > 0 ? moduleSlots.ToString(CultureInfo.InvariantCulture) : null);
                AddHealthStat(stats, health);
                AddMassStat(stats, mass);
                break;
            case "TractorBeam":
            case "SalvageHead":
                AddTractorStats(stats, root);
                AddMassStat(stats, mass);
                break;
            case "SalvageModifier":
                AddStat(
                    stats,
                    "salvage-speed",
                    "Speed multiplier",
                    FormatMultiplier(
                        ReadElementAttribute(root, "salvageModifier", "salvageSpeedMultiplier")));
                AddStat(
                    stats,
                    "radius-multiplier",
                    "Radius multiplier",
                    FormatMultiplier(
                        ReadElementAttribute(root, "salvageModifier", "radiusMultiplier")));
                AddStat(
                    stats,
                    "extraction-efficiency",
                    "Extraction efficiency",
                    FormatPercent(
                        ReadElementAttribute(root, "salvageModifier", "extractionEfficiency")));
                AddMassStat(stats, mass);
                break;
            case "DockingCollar":
                AddStat(
                    stats,
                    "capture-radius",
                    "Capture radius",
                    FormatWithUnit(
                        ReadElementAttribute(root, "SCItemDockingTubeParams", "CaptureRadius"),
                        "m"));
                AddHealthStat(stats, health);
                AddMassStat(stats, mass);
                break;
            default:
                AddStorageStat(stats, root, dataForge);
                AddHealthStat(stats, health);
                AddMassStat(stats, mass);
                break;
        }

        return stats.Take(16).ToArray();
    }

    private static double? ReadBeamPower(
        XmlElement root,
        string hitType)
    {
        var action = root
            .GetElementsByTagName("SWeaponActionFireBeamParams")
            .OfType<XmlElement>()
            .FirstOrDefault(element => element
                .GetAttribute("hitType")
                .Equals(hitType, StringComparison.OrdinalIgnoreCase));
        var damage = action?
            .SelectSingleNode("./damagePerSecond/DamageInfo") as XmlElement;
        if (damage is null) return null;

        return new[]
        {
            "DamagePhysical",
            "DamageEnergy",
            "DamageDistortion",
            "DamageThermal",
            "DamageBiochemical",
            "DamageStun"
        }.Sum(attribute => ParseDouble(damage.GetAttribute(attribute)) ?? 0);
    }

    private static void AddArmorStats(
        ICollection<GameBlueprintStat> stats,
        XmlElement root,
        DataForge dataForge)
    {
        var resistance = ReadReferencedRecord(root, "damageResistance", dataForge);
        var physicalMultiplier = resistance is null
            ? null
            : ReadElementAttribute(resistance, "PhysicalResistance", "Multiplier");
        AddStat(
            stats,
            "physical-protection",
            "Physical protection",
            physicalMultiplier is null ? null : FormatPercent(1 - physicalMultiplier));

        var temperature = root
            .GetElementsByTagName("TemperatureResistance")
            .OfType<XmlElement>()
            .FirstOrDefault();
        var minimumTemperature = ParseDouble(temperature?.GetAttribute("MinResistance") ?? string.Empty);
        var maximumTemperature = ParseDouble(temperature?.GetAttribute("MaxResistance") ?? string.Empty);
        AddStat(
            stats,
            "temperature-range",
            "Temperature range",
            minimumTemperature is null || maximumTemperature is null
                ? null
                : $"{FormatNumber(minimumTemperature.Value)} to {FormatNumber(maximumTemperature.Value)} °C");

        AddStat(
            stats,
            "radiation-capacity",
            "Radiation capacity",
            FormatNumber(
                ReadElementAttribute(root, "RadiationResistance", "MaximumRadiationCapacity")));
    }

    private static void AddWeaponStats(
        ICollection<GameBlueprintStat> stats,
        XmlElement root,
        string type,
        DataForge dataForge)
    {
        var ammoContainer = type == "WeaponPersonal"
            ? ReadReferencedRecord(root, "ammoContainerRecord", dataForge)
            : null;
        var ammo = ReadReferencedRecord(ammoContainer ?? root, "ammoParamsRecord", dataForge)
            ?? ReadReferencedRecord(root, "ammoParamsRecord", dataForge);
        var damage = ammo?
            .SelectSingleNode(".//damage/DamageInfo") as XmlElement;
        if (damage is not null)
        {
            var damageTypes = new[]
            {
                ("DamagePhysical", "physical"),
                ("DamageEnergy", "energy"),
                ("DamageDistortion", "distortion"),
                ("DamageThermal", "thermal"),
                ("DamageBiochemical", "biochemical"),
                ("DamageStun", "stun")
            };
            var values = damageTypes
                .Select(entry => (
                    entry.Item2,
                    Value: ParseDouble(damage.GetAttribute(entry.Item1)) ?? 0))
                .Where(entry => entry.Value > 0)
                .ToArray();
            var damageValue = values.Length switch
            {
                0 => null,
                1 => $"{FormatNumber(values[0].Value)} {values[0].Item1}",
                _ => $"{FormatNumber(values.Sum(entry => entry.Value))} total"
            };
            AddStat(stats, "damage-per-shot", "Damage / shot", damageValue);
        }

        var fireRate = root
            .SelectNodes("//*[@fireRate]")!
            .OfType<XmlElement>()
            .Select(element => ParseDouble(element.GetAttribute("fireRate")))
            .Where(value => value is > 0)
            .Max();
        AddStat(stats, "fire-rate", "Fire rate", FormatWithUnit(fireRate, "rpm"));
        AddStat(
            stats,
            "projectile-speed",
            "Projectile speed",
            FormatWithUnit(ParseDouble(ammo?.GetAttribute("speed") ?? string.Empty), "m/s"));

        var capacity = ReadElementAttribute(ammoContainer ?? root, "SAmmoContainerComponentParams", "maxAmmoCount");
        if (capacity is null or <= 0)
        {
            capacity = ReadElementAttribute(root, "SWeaponRegenConsumerParams", "maxAmmoLoad");
        }
        var capacityLabel = type switch
        {
            "WeaponAttachment" => "Capacity",
            "WeaponGun" => "Ammo pool",
            _ => "Magazine"
        };
        AddStat(stats, "capacity", capacityLabel, FormatNumber(capacity));
    }

    private static void AddTractorStats(
        ICollection<GameBlueprintStat> stats,
        XmlElement root)
    {
        AddStat(
            stats,
            "maximum-force",
            "Maximum force",
            FormatWithUnit(
                ReadElementAttribute(root, "SWeaponActionFireTractorBeamParams", "maxForce"),
                "N"));
        AddStat(
            stats,
            "maximum-angle",
            "Maximum angle",
            FormatAngle(
                ReadElementAttribute(root, "SWeaponActionFireTractorBeamParams", "maxAngle")));
        AddStat(
            stats,
            "maximum-range",
            "Maximum range",
            FormatWithUnit(
                ReadElementAttribute(root, "SWeaponActionFireTractorBeamParams", "maxDistance"),
                "m"));
        AddStat(
            stats,
            "full-strength-range",
            "Full-strength range",
            FormatWithUnit(
                ReadElementAttribute(root, "SWeaponActionFireTractorBeamParams", "fullStrengthDistance"),
                "m"));
    }

    private static void AddStorageStat(
        ICollection<GameBlueprintStat> stats,
        XmlElement root,
        DataForge dataForge)
    {
        var storage = ReadElementAttribute(root, "SMicroCargoUnit", "microSCU");
        if (storage is null or <= 1)
        {
            var container = ReadReferencedRecord(root, "containerParams", dataForge);
            storage = container is null
                ? storage
                : ReadElementAttribute(container, "SMicroCargoUnit", "microSCU");
        }
        AddStat(stats, "storage", "Storage", FormatWithUnit(storage, "µSCU"));
    }

    private static void AddSizeStat(
        ICollection<GameBlueprintStat> stats,
        double? size) =>
        AddStat(stats, "size", "Size", size is null ? null : $"S{FormatNumber(size)}");

    private static void AddMassStat(
        ICollection<GameBlueprintStat> stats,
        double? mass) =>
        AddStat(stats, "mass", "Mass", FormatWithUnit(mass, "kg"));

    private static void AddHealthStat(
        ICollection<GameBlueprintStat> stats,
        double? health) =>
        AddStat(stats, "health", "Durability", FormatWithUnit(health, "HP"));

    private static void AddPowerStat(
        ICollection<GameBlueprintStat> stats,
        double? power,
        string label) =>
        AddStat(stats, "power", label, FormatWithUnit(power, "units"));

    private static void AddStat(
        ICollection<GameBlueprintStat> stats,
        string key,
        string label,
        string? value)
    {
        if (string.IsNullOrWhiteSpace(value)
            || stats.Any(stat => stat.Key.Equals(key, StringComparison.OrdinalIgnoreCase)))
        {
            return;
        }
        stats.Add(new GameBlueprintStat(key, label, value));
    }

    private static XmlElement? ReadReferencedRecord(
        XmlElement root,
        string attributeName,
        DataForge dataForge)
    {
        var source = root
            .SelectNodes($"//*[@{attributeName}]")!
            .OfType<XmlElement>()
            .FirstOrDefault(element =>
                Guid.TryParse(element.GetAttribute(attributeName), out _));
        return source is not null
            && Guid.TryParse(source.GetAttribute(attributeName), out var referenceId)
                ? ReadReference(referenceId, dataForge)
                : null;
    }

    private static double? ReadElementAttribute(
        XmlElement root,
        string elementName,
        string attributeName) =>
        root
            .GetElementsByTagName(elementName)
            .OfType<XmlElement>()
            .Select(element => ParseDouble(element.GetAttribute(attributeName)))
            .FirstOrDefault(value => value is not null);

    private static string? FormatNumber(double? value) =>
        value is null
            ? null
            : value.Value.ToString("#,##0.##", CultureInfo.InvariantCulture);

    private static string? FormatWithUnit(double? value, string unit) =>
        value is null ? null : $"{FormatNumber(value)} {unit}";

    private static string? FormatPercent(double? ratio) =>
        ratio is null ? null : $"{FormatNumber(ratio.Value * 100)}%";

    private static string? FormatMultiplier(double? multiplier) =>
        multiplier is null ? null : $"{FormatNumber(multiplier)}×";

    private static string? FormatAngle(double? angle) =>
        angle is null ? null : $"{FormatNumber(angle)}°";

    private static string? FormatSpeed(double? metersPerSecond) =>
        metersPerSecond is null
            ? null
            : metersPerSecond >= 1000
                ? $"{FormatNumber(metersPerSecond.Value / 1000)} km/s"
                : $"{FormatNumber(metersPerSecond)} m/s";

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

    [GeneratedRegex(
        @"_(?:black|white|tan|gold|green|red|blue|imp|cen|collector)\d+$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex CosmeticClassSuffix();

    [GeneratedRegex(
        @"_mag(?:azine)?(?:_[a-z0-9]+)?$",
        RegexOptions.IgnoreCase | RegexOptions.CultureInvariant)]
    private static partial Regex MagazineClassSuffix();

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
        string? ImageKey,
        string? Description,
        string? Manufacturer,
        IReadOnlyList<GameBlueprintStat> Stats);

}
