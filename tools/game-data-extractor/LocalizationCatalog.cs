using System.Text.RegularExpressions;

internal sealed partial class LocalizationCatalog
{
    private readonly IReadOnlyDictionary<string, string> values;

    internal LocalizationCatalog(string contents)
    {
        var parsed = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var line in contents.Split('\n'))
        {
            var separator = line.IndexOf('=');
            if (separator <= 0) continue;

            var key = line[..separator].Trim();
            var value = line[(separator + 1)..].TrimEnd('\r');
            parsed[key] = value;
            var qualifier = key.IndexOf(',');
            if (qualifier > 0)
            {
                parsed.TryAdd(key[..qualifier], value);
            }
        }
        values = parsed;
    }

    internal string? Resolve(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return null;
        if (!value.StartsWith('@')) return Clean(value);

        return values.TryGetValue(value[1..], out var localized)
            ? Clean(localized)
            : null;
    }

    internal static bool IsPlaceholder(string? value) =>
        string.IsNullOrWhiteSpace(value)
        || value.Contains("PLACEHOLDER", StringComparison.OrdinalIgnoreCase)
        || value.Contains("UNINITIALIZED", StringComparison.OrdinalIgnoreCase);

    private static string? Clean(string value)
    {
        if (IsPlaceholder(value)) return null;

        var cleaned = value
            .Replace(@"\n", " ", StringComparison.Ordinal)
            .Replace(@"\r", " ", StringComparison.Ordinal)
            .Replace(@"\t", " ", StringComparison.Ordinal);
        cleaned = AnyMarkup().Replace(cleaned, string.Empty);
        cleaned = ReputationMarker().Replace(cleaned, string.Empty);
        cleaned = BlueprintMarker().Replace(cleaned, string.Empty);
        cleaned = MissionToken().Replace(
            cleaned,
            match => $"[{match.Groups["name"].Value.Split('|').First()}]");
        cleaned = Regex.Replace(cleaned, @"\s+", " ").Trim();
        return string.IsNullOrWhiteSpace(cleaned) ? null : cleaned;
    }

    [GeneratedRegex(@"<[^>]+>")]
    private static partial Regex AnyMarkup();

    [GeneratedRegex(@"\[\s*\d+\s+Rep\s*\]", RegexOptions.IgnoreCase)]
    private static partial Regex ReputationMarker();

    [GeneratedRegex(@"\[BP\]\*?", RegexOptions.IgnoreCase)]
    private static partial Regex BlueprintMarker();

    [GeneratedRegex(@"~mission\((?<name>[^)]+)\)", RegexOptions.IgnoreCase)]
    private static partial Regex MissionToken();
}
