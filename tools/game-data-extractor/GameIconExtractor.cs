using ICSharpCode.SharpZipLib.Zip;

internal sealed record IconExtractionResult(
    IReadOnlyDictionary<string, string> Icons,
    IReadOnlyList<string> Warnings);

internal static class GameIconExtractor
{
    private const int MaxIconBytes = 4 * 1024 * 1024;

    internal static IconExtractionResult Extract(
        string archivePath,
        IEnumerable<string> requestedPaths)
    {
        var archivePaths = requestedPaths
            .Where(path => !string.IsNullOrWhiteSpace(path))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToDictionary(ToArchivePath, NormalizeKey, StringComparer.OrdinalIgnoreCase);
        if (archivePaths.Count == 0)
        {
            return new IconExtractionResult(
                new Dictionary<string, string>(),
                Array.Empty<string>());
        }

        var icons = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        var warnings = new List<string>();
        using var archiveStream = File.OpenRead(archivePath);
        using var archive = new ZipFile(archiveStream);
        foreach (var entry in archive.Cast<ZipEntry>())
        {
            if (!archivePaths.TryGetValue(NormalizeArchivePath(entry.Name), out var imageKey))
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
                var png = DdsIconDecoder.DecodeToPng(data);
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

        foreach (var imageKey in archivePaths.Values.Where(key => !icons.ContainsKey(key)))
        {
            warnings.Add($"{imageKey}: packaged icon asset not found");
        }
        return new IconExtractionResult(icons, warnings);
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
}
