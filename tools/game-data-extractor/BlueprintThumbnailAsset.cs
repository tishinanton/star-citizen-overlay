using System.Xml;

internal static class BlueprintThumbnailAssetResolver
{
    private static readonly IReadOnlyDictionary<string, string> SupportedExtensions =
        new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase)
        {
            [".cgf"] = "cgf",
            [".cga"] = "cga",
            [".skin"] = "skin",
            [".chr"] = "chr"
        };

    internal static GameBlueprintRenderAsset? Resolve(XmlElement entity)
    {
        return entity
            .SelectNodes(".//@*")!
            .OfType<XmlAttribute>()
            .Select(attribute => NormalizePath(attribute.Value))
            .Where(path => path is not null)
            .Cast<string>()
            .Select(path =>
            {
                var extension = Path.GetExtension(path);
                return SupportedExtensions.TryGetValue(extension, out var format)
                    ? new GameBlueprintRenderAsset(path, format)
                    : null;
            })
            .Where(asset => asset is not null)
            .Cast<GameBlueprintRenderAsset>()
            .OrderBy(asset => AssetRank(asset.Format))
            .ThenBy(asset => asset.Path, StringComparer.OrdinalIgnoreCase)
            .FirstOrDefault();
    }

    private static string? NormalizePath(string value)
    {
        var path = value.Trim().Replace('\\', '/').TrimStart('/');
        if (path.Length is 0 or > 500
            || path.Split('/').Any(segment => segment is "" or "." or "..")
            || !path.StartsWith("Objects/", StringComparison.OrdinalIgnoreCase))
        {
            return null;
        }
        return path;
    }

    private static int AssetRank(string format) =>
        format switch
        {
            "cgf" => 0,
            "cga" => 1,
            "skin" => 2,
            "chr" => 3,
            _ => int.MaxValue
        };
}
