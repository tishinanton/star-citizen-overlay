using System.Globalization;
using System.Text.RegularExpressions;
using System.Xml;
using unforge;

internal static partial class FactionExtractor
{
    private const string FactionReputationPrefix =
        "libs/foundry/records/factions/factionreputation/";
    private const int MinimumFactionCount = 30;

    internal static FactionExtractorPayload Extract(string archivePath, DataForge dataForge)
    {
        var localization = new LocalizationCatalog(
            GameArchive.ReadEnglishLocalization(archivePath));
        var warnings = new List<string>();
        var factions = new List<GameFactionRecord>();

        foreach (var path in dataForge.PathToRecordMap.Keys
                     .Where(path => path.StartsWith(
                         FactionReputationPrefix,
                         StringComparison.OrdinalIgnoreCase))
                     .Order(StringComparer.OrdinalIgnoreCase))
        {
            var root = dataForge.ReadRecordByPathAsXml(path);
            if (root is null)
            {
                warnings.Add($"Faction record could not be read: {path}");
                continue;
            }

            var faction = ParseFaction(root, dataForge, localization, warnings);
            if (faction is not null) factions.Add(faction);
        }

        if (factions.Count < MinimumFactionCount)
        {
            throw new InvalidDataException(
                $"Only {factions.Count} faction reputation records were found in Game2.dcb.");
        }

        return new FactionExtractorPayload(
            1,
            GameArchive.ReadGameVersion(archivePath),
            factions
                .OrderBy(faction => faction.Name, StringComparer.OrdinalIgnoreCase)
                .ThenBy(faction => faction.Id, StringComparer.OrdinalIgnoreCase)
                .ToArray(),
            warnings);
    }

    private static GameFactionRecord? ParseFaction(
        XmlElement root,
        DataForge dataForge,
        LocalizationCatalog localization,
        List<string> warnings)
    {
        if (!Guid.TryParse(root.GetAttribute("__ref"), out var factionId))
        {
            warnings.Add($"Faction record has no valid identifier: {root.GetAttribute("__path")}");
            return null;
        }

        var key = root.Name.Replace("FactionReputation.", string.Empty);
        var fallbackName = HumanizeIdentifier(
            key
                .Replace("FactionReputation_Lawful_", string.Empty)
                .Replace("FactionReputation_Unlawful_", string.Empty)
                .Replace("FactionReputation_", string.Empty));
        var name = localization.Resolve(root.GetAttribute("displayName")) ?? fallbackName;
        var lawfulValue = ReadDynamicProperty(root, "entityLawful");
        var alignment = lawfulValue switch
        {
            "1" or "true" or "True" => "lawful",
            "0" or "false" or "False" => "unlawful",
            _ => "unknown"
        };
        var scopes = ReadScopes(root, dataForge, localization, warnings);

        return new GameFactionRecord(
            factionId.ToString(),
            key,
            name,
            ResolveDynamicProperty(root, "entityDescription", localization),
            alignment,
            IsTrue(root.GetAttribute("isNPC")),
            IsTrue(root.GetAttribute("hideInDelpihApp"))
                || IsTrue(root.GetAttribute("hideInDelphiApp")),
            ResolveDynamicProperty(root, "entityHeadquarters", localization),
            ResolveDynamicProperty(root, "entityFocus", localization),
            scopes.Count,
            scopes.Sum(scope => scope.Standings.Count),
            scopes);
    }

    private static IReadOnlyList<GameReputationScope> ReadScopes(
        XmlElement faction,
        DataForge dataForge,
        LocalizationCatalog localization,
        List<string> warnings)
    {
        if (!Guid.TryParse(faction.GetAttribute("reputationContextPropertiesUI"), out var contextId))
        {
            return [];
        }

        var context = ReadReference(contextId, dataForge);
        if (context is null)
        {
            warnings.Add($"Reputation context is unavailable for {faction.Name}.");
            return [];
        }

        var scopeIds = context
            .SelectNodes("./primaryScopeContext | ./scopeContextList/*")!
            .OfType<XmlElement>()
            .Select(element => element.GetAttribute("scope"))
            .Where(value => Guid.TryParse(value, out _))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .Select(Guid.Parse);
        var scopes = new List<GameReputationScope>();
        foreach (var scopeId in scopeIds)
        {
            var scope = ReadReference(scopeId, dataForge);
            if (scope is null)
            {
                warnings.Add($"Reputation scope {scopeId} is unavailable for {faction.Name}.");
                continue;
            }

            var parsed = ParseScope(scope, dataForge, localization, warnings);
            if (parsed is not null) scopes.Add(parsed);
        }

        return scopes;
    }

    private static GameReputationScope? ParseScope(
        XmlElement root,
        DataForge dataForge,
        LocalizationCatalog localization,
        List<string> warnings)
    {
        if (!Guid.TryParse(root.GetAttribute("__ref"), out var scopeId)) return null;
        var standingMap = root.SelectSingleNode("./standingMap") as XmlElement;
        if (standingMap is null) return null;

        var standings = new List<GameReputationStanding>();
        foreach (var reference in standingMap
                     .SelectNodes("./standings/Reference")!
                     .OfType<XmlElement>())
        {
            if (!Guid.TryParse(reference.GetAttribute("value"), out var standingId)) continue;
            var standing = ReadReference(standingId, dataForge);
            if (standing is null)
            {
                warnings.Add($"Reputation standing {standingId} is unavailable for {root.Name}.");
                continue;
            }

            var parsed = ParseStanding(standing, localization);
            if (parsed is not null) standings.Add(parsed);
        }

        if (standings.Count == 0) return null;
        var scopeName = NullIfEmpty(root.GetAttribute("scopeName"))
            ?? root.Name.Replace("SReputationScopeParams.", string.Empty);
        return new GameReputationScope(
            scopeId.ToString(),
            localization.Resolve(root.GetAttribute("displayName"))
                ?? HumanizeIdentifier(scopeName),
            localization.Resolve(root.GetAttribute("description")),
            ParseDouble(standingMap.GetAttribute("initialReputation")) ?? 0,
            ParseDouble(standingMap.GetAttribute("reputationCeiling")) ?? 0,
            standings
                .OrderBy(standing => standing.MinReputation)
                .ThenBy(standing => standing.Name, StringComparer.OrdinalIgnoreCase)
                .ToArray());
    }

    private static GameReputationStanding? ParseStanding(
        XmlElement root,
        LocalizationCatalog localization)
    {
        var displayName = root.GetAttribute("displayName");
        if (LocalizationCatalog.IsPlaceholder(displayName)
            || !Guid.TryParse(root.GetAttribute("__ref"), out var standingId))
        {
            return null;
        }

        var internalName = NullIfEmpty(root.GetAttribute("name"))
            ?? root.Name.Replace("SReputationStandingParams.", string.Empty);
        return new GameReputationStanding(
            standingId.ToString(),
            localization.Resolve(displayName) ?? HumanizeIdentifier(internalName),
            ParseDouble(root.GetAttribute("minReputation")) ?? 0,
            ParseDouble(root.GetAttribute("driftReputation")) ?? 0,
            ParseDouble(root.GetAttribute("driftTimeHours")) ?? 0,
            IsTrue(root.GetAttribute("gated")),
            localization.Resolve(root.GetAttribute("perkDescription")));
    }

    private static string? ResolveDynamicProperty(
        XmlElement root,
        string propertyName,
        LocalizationCatalog localization) =>
        localization.Resolve(ReadDynamicProperty(root, propertyName));

    private static string? ReadDynamicProperty(XmlElement root, string propertyName)
    {
        var property = root
            .GetElementsByTagName("SReputationContextBBPropertyParams")
            .OfType<XmlElement>()
            .FirstOrDefault(element =>
                element.GetAttribute("name").Equals(
                    propertyName,
                    StringComparison.OrdinalIgnoreCase));
        return (property?.SelectSingleNode("./dynamicProperty/*") as XmlElement)
            ?.GetAttribute("value");
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
}
