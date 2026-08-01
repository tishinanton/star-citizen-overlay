using System.Text.Json.Serialization;

internal sealed record SignatureExtractorPayload(
    int SchemaVersion,
    IReadOnlyList<SignatureRecord> Records);

internal sealed record SignatureRecord(
    string RecordPath,
    string EntityName,
    string? CompositionPath,
    string? GlobalParamsPath,
    int Signature);

internal sealed record BlueprintExtractorPayload(
    int SchemaVersion,
    string GameVersion,
    IReadOnlyList<GameBlueprintRecord> Blueprints,
    IReadOnlyDictionary<string, string> Icons,
    IReadOnlyList<string> Warnings);

internal sealed record GameBlueprintRecord(
    string Id,
    string Key,
    string OutputName,
    string OutputClass,
    string OutputType,
    string OutputTypeLabel,
    string? OutputGrade,
    int CraftTimeSeconds,
    string CraftTimeLabel,
    bool AvailableByDefault,
    int IngredientCount,
    int UnlockingMissionCount,
    IReadOnlyList<GameBlueprintIngredient> Ingredients,
    IReadOnlyList<GameBlueprintRequirementGroup> RequirementGroups,
    IReadOnlyList<GameBlueprintMission> UnlockingMissions,
    string GameVersion,
    string? ImageKey,
    string? WebUrl);

internal sealed record GameBlueprintIngredient(
    string Name,
    string Kind,
    double? Quantity,
    double? QuantityScu,
    string? WebUrl);

internal sealed record GameBlueprintRequirementIngredient(
    string Name,
    string Kind,
    double? Quantity,
    double? QuantityScu,
    string? WebUrl,
    double? MinQuality);

internal sealed record GameBlueprintRequirementGroup(
    string Key,
    string Name,
    int RequiredCount,
    IReadOnlyList<GameBlueprintRequirementIngredient> Ingredients);

internal sealed record GameBlueprintMission(
    string Id,
    string Title,
    string? MissionType,
    string? ContractType,
    string? Provider,
    string? MinimumReputation,
    bool ReputationVaries,
    IReadOnlyList<string> StarSystems,
    double? Chance,
    string? WebUrl);

internal sealed record FactionExtractorPayload(
    int SchemaVersion,
    string GameVersion,
    IReadOnlyList<GameFactionRecord> Factions,
    IReadOnlyList<string> Warnings);

internal sealed record GameFactionRecord(
    string Id,
    string Key,
    string Name,
    string? Description,
    string Alignment,
    bool IsNpc,
    bool Hidden,
    string? Headquarters,
    string? Focus,
    int ScopeCount,
    int StandingCount,
    IReadOnlyList<GameReputationScope> Scopes);

internal sealed record GameReputationScope(
    string Id,
    string Name,
    string? Description,
    double InitialReputation,
    double ReputationCeiling,
    IReadOnlyList<GameReputationStanding> Standings);

internal sealed record GameReputationStanding(
    string Id,
    string Name,
    double MinReputation,
    double DriftReputation,
    double DriftTimeHours,
    bool Gated,
    string? PerkDescription);

internal sealed record MiningExtractorPayload(
    int SchemaVersion,
    string GameVersion,
    IReadOnlyList<GameMiningMaterial> Materials,
    IReadOnlyList<GameMiningEntity> Entities,
    IReadOnlyList<GameMiningLocation> Locations,
    IReadOnlyList<GameMiningProvider> Providers,
    IReadOnlyList<GameMiningCluster> Clusters,
    IReadOnlyList<string> Warnings);

internal sealed record GameMiningMaterial(
    string Id,
    string Key,
    string Slug,
    string Name,
    double? DensityGramsPerCubicCentimeter,
    double? Instability,
    double? Resistance,
    GameMiningQualityDistribution? DefaultQuality,
    IReadOnlyList<GameMiningQualityLocationOverride> QualityLocationOverrides,
    IReadOnlyList<GameMiningQuantizationBand> QuantizationBands);

internal sealed record GameMiningQualityDistribution(
    double Min,
    double Max,
    double Mean,
    double StdDev);

internal sealed record GameMiningQualityLocationOverride(
    string LocationId,
    string? LocationName,
    GameMiningQualityDistribution Distribution);

internal sealed record GameMiningQuantizationBand(
    double Start,
    double End,
    double MappedValue);

internal sealed record GameMiningEntity(
    string Id,
    string Path,
    string Key,
    int Signature,
    string Method,
    string? CompositionId,
    string? DepositName,
    int? MinimumDistinctElements,
    IReadOnlyList<GameMiningCompositionPart> Composition);

internal sealed record GameMiningCompositionPart(
    string MaterialId,
    double MinPercentage,
    double MaxPercentage,
    double Probability,
    double CurveExponent,
    double QualityScale,
    double? Instability,
    double? Resistance);

internal sealed record GameMiningLocation(
    string Id,
    string Name,
    string? ParentId,
    string? ParentName,
    string? System,
    string Type,
    IReadOnlyList<string> ProviderIds);

internal sealed record GameMiningProvider(
    string Id,
    string Key,
    string? LocationId,
    string? LocationName,
    IReadOnlyList<GameMiningProviderGroup> Groups,
    IReadOnlyList<GameMiningArea> Areas);

internal sealed record GameMiningProviderGroup(
    string GroupName,
    double GroupProbability,
    IReadOnlyList<GameMiningContribution> Contributions);

internal sealed record GameMiningContribution(
    string HarvestablePresetId,
    string EntityId,
    double RelativeProbability,
    string? ClusterId,
    IReadOnlyList<GameMiningContributionMaterial> Materials);

internal sealed record GameMiningContributionMaterial(
    string MaterialId,
    GameMiningQualityDistribution EffectiveQuality,
    bool UsedLocationOverride,
    IReadOnlyList<double> ReachableQuantizedValues);

internal sealed record GameMiningArea(
    string DebugName,
    double GlobalModifier,
    IReadOnlyList<GameMiningAreaException> Exceptions);

internal sealed record GameMiningAreaException(
    string HarvestablePresetId,
    double Modifier);

internal sealed record GameMiningCluster(
    string Id,
    string Key,
    double Probability,
    IReadOnlyList<GameMiningClusterBucket> Buckets);

internal sealed record GameMiningClusterBucket(
    double Probability,
    double MinSize,
    double MaxSize,
    double MinProximity,
    double MaxProximity);

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    WriteIndented = false)]
[JsonSerializable(typeof(SignatureExtractorPayload))]
[JsonSerializable(typeof(BlueprintExtractorPayload))]
[JsonSerializable(typeof(FactionExtractorPayload))]
[JsonSerializable(typeof(MiningExtractorPayload))]
internal sealed partial class ExtractorJsonContext : JsonSerializerContext;
