using ICSharpCode.SharpZipLib.Zip;

internal sealed record IconExtractionResult(
    IReadOnlyDictionary<string, string> Icons,
    IReadOnlyList<string> Warnings);

internal static class GameIconExtractor
{
    private const int MaxIconBytes = 4 * 1024 * 1024;

    internal static IconExtractionResult Extract(
        string archivePath,
        IEnumerable<string> requestedPaths,
        IEnumerable<string>? optionalPaths = null)
    {
        var requiredArchivePaths = requestedPaths
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToDictionary(ToArchivePath, NormalizeKey, StringComparer.OrdinalIgnoreCase);
        var archivePaths = new Dictionary<string, string>(
            requiredArchivePaths,
            StringComparer.OrdinalIgnoreCase);
        foreach (var path in optionalPaths ?? Array.Empty<string>())
        {
            if (string.IsNullOrWhiteSpace(path)) continue;
            archivePaths.TryAdd(ToArchivePath(path), NormalizeKey(path));
        }
        var baseArchivePaths = new HashSet<string>(
            archivePaths.Keys,
            StringComparer.OrdinalIgnoreCase);
        foreach (var entry in archivePaths.ToArray())
        {
            for (var segment = 1; segment <= 12; segment++)
            {
                archivePaths.TryAdd($"{entry.Key}.{segment}", entry.Value);
            }
        }
        if (archivePaths.Count == 0)
        {
            return new IconExtractionResult(
                new Dictionary<string, string>(),
                Array.Empty<string>());
        }

        var icons = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var warnings = new List<string>();
        var iconParts = new Dictionary<string, IconParts>(StringComparer.OrdinalIgnoreCase);
        using var archiveStream = File.OpenRead(archivePath);
        using var archive = new ZipFile(archiveStream);
        foreach (var entry in archive.Cast<ZipEntry>())
        {
            var archiveEntryPath = NormalizeArchivePath(entry.Name);
            if (!archivePaths.TryGetValue(archiveEntryPath, out var imageKey))
            {
                continue;
            }

            try
            {
                if (entry.Size is <= 0 or > MaxIconBytes)
                {
                    throw new InvalidDataException(
                        $"The packaged item icon has unsupported size {entry.Size} bytes.");
                }
                using var input = archive.GetInputStream(entry);
                var data = new byte[(int)entry.Size];
                input.ReadExactly(data);
                if (!iconParts.TryGetValue(imageKey, out var parts))
                {
                    parts = new IconParts();
                    iconParts[imageKey] = parts;
                }
                if (baseArchivePaths.Contains(archiveEntryPath))
                {
                    parts.Base = data;
                }
                else
                {
                    parts.Segments.Add(data);
                }
            }
            catch (Exception error) when (
                error is IOException
                    or InvalidDataException
                    or NotSupportedException)
            {
                warnings.Add($"{imageKey}: {error.Message}");
            }
        }
        foreach (var (imageKey, parts) in iconParts)
        {
            if (parts.Base is null) continue;
            try
            {
                var png = DecodeIcon(parts);
                icons[imageKey] = $"data:image/png;base64,{Convert.ToBase64String(png)}";
            }
            catch (Exception error) when (
                error is IOException
                    or InvalidDataException
                    or NotSupportedException)
            {
                warnings.Add($"{imageKey}: {error.Message}");
            }
        }

        foreach (var imageKey in requiredArchivePaths.Values.Where(key => !icons.ContainsKey(key)))
        {
            warnings.Add($"{imageKey}: packaged icon asset not found");
        }
        return new IconExtractionResult(icons, warnings);
    }

    private static byte[] DecodeIcon(IconParts parts)
    {
        var baseData = parts.Base
            ?? throw new InvalidDataException("The packaged item icon is missing its DDS header.");
        try
        {
            return DdsIconDecoder.DecodeToPng(baseData);
        }
        catch (InvalidDataException) when (parts.Segments.Count > 0)
        {
            foreach (var segment in parts.Segments.OrderByDescending(segment => segment.Length))
            {
                var reconstructed = new byte[128 + segment.Length];
                baseData.AsSpan(0, Math.Min(baseData.Length, 128)).CopyTo(reconstructed);
                segment.CopyTo(reconstructed, 128);
                try
                {
                    return DdsIconDecoder.DecodeToPng(reconstructed);
                }
                catch (InvalidDataException)
                {
                    // Try the next mip segment.
                }
            }
            throw new InvalidDataException("The packaged split item icon has no decodable mip level.");
        }
    }

    internal static string NormalizeKey(string path) =>
        path.Replace('\\', '/').TrimStart('/').ToLowerInvariant();

    private static string ToArchivePath(string path)
    {
        var normalized = path.Replace('/', '\\').TrimStart('\\');
        var extension = Path.GetExtension(normalized);
        if (extension.Equals(".tif", StringComparison.OrdinalIgnoreCase))
        {
            normalized = normalized[..^extension.Length] + ".dds";
        }
        return NormalizeArchivePath($@"Data\{normalized}");
    }

    private static string NormalizeArchivePath(string path) =>
        path.Replace('/', '\\').TrimStart('\\').ToLowerInvariant();

    private sealed class IconParts
    {
        internal byte[]? Base { get; set; }
        internal List<byte[]> Segments { get; } = [];
    }
}
