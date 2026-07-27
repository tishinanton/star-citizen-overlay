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

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    WriteIndented = false)]
[JsonSerializable(typeof(SignatureExtractorPayload))]
[JsonSerializable(typeof(BlueprintExtractorPayload))]
internal sealed partial class ExtractorJsonContext : JsonSerializerContext;
