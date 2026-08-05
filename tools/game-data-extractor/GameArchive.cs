using System.Text;
using System.Text.Json;
using ICSharpCode.SharpZipLib.Core;
using ICSharpCode.SharpZipLib.Zip;

internal static class GameArchive
{
    private const long MaxThumbnailAssetBytes = 128L * 1024 * 1024;

    internal static void ExtractGameDatabase(string archivePath, string outputPath)
    {
        using var archiveStream = File.OpenRead(archivePath);
        using var archive = new ZipFile(archiveStream);
        var entry = archive
            .Cast<ZipEntry>()
            .FirstOrDefault(candidate =>
                candidate.Name.EndsWith("Game2.dcb", StringComparison.OrdinalIgnoreCase));

        if (entry is null)
        {
            throw new InvalidDataException("Data/Game2.dcb was not found in the selected archive.");
        }

        using var input = archive.GetInputStream(entry);
        using var output = File.Create(outputPath);
        StreamUtils.Copy(input, output, new byte[81920]);
    }

    internal static string ReadEnglishLocalization(string archivePath, string source)
    {
        if (source == "global-ini")
        {
            var loosePath = Path.Combine(
                Path.GetDirectoryName(archivePath) ?? string.Empty,
                "Data",
                "Localization",
                "english",
                "global.ini");
            if (!File.Exists(loosePath))
            {
                throw new InvalidDataException(
                    $"The selected global.ini localization file was not found: {loosePath}");
            }

            using var stream = new FileStream(
                loosePath,
                FileMode.Open,
                FileAccess.Read,
                FileShare.ReadWrite);
            using var reader = new StreamReader(stream, Encoding.UTF8, true);
            return reader.ReadToEnd();
        }

        using var archiveStream = File.OpenRead(archivePath);
        using var archive = new ZipFile(archiveStream);
        var entry = archive
            .Cast<ZipEntry>()
            .FirstOrDefault(candidate =>
                candidate.Name.Replace('/', '\\').EndsWith(
                    @"Data\Localization\english\global.ini",
                    StringComparison.OrdinalIgnoreCase));
        if (entry is null)
        {
            throw new InvalidDataException(
                "The English Star Citizen localization pack was not found.");
        }

        using var input = archive.GetInputStream(entry);
        using var archiveReader = new StreamReader(input, Encoding.UTF8, true);
        return archiveReader.ReadToEnd();
    }

    internal static string ReadGameVersion(string archivePath)
    {
        var channel = Path.GetFileName(Path.GetDirectoryName(archivePath)) ?? "Game";
        var manifestPath = Path.Combine(
            Path.GetDirectoryName(archivePath) ?? string.Empty,
            "build_manifest.id");
        if (!File.Exists(manifestPath)) return channel;

        try
        {
            using var document = JsonDocument.Parse(File.ReadAllText(manifestPath));
            var data = document.RootElement.GetProperty("Data");
            var version = data.GetProperty("Version").GetString();
            return string.IsNullOrWhiteSpace(version) ? channel : $"{version}-{channel}";
        }
        catch (Exception error) when (
            error is IOException
                or UnauthorizedAccessException
                or JsonException
                or KeyNotFoundException)
        {
            return channel;
        }
    }

    internal static GameThumbnailAssetExtraction ExtractThumbnailAsset(
            string archivePath,
            string requestedPath,
            string outputDirectory)
        {
            var assetPath = NormalizeAssetPath(requestedPath);
            var extension = Path.GetExtension(assetPath);
            if (!extension.Equals(".cgf", StringComparison.OrdinalIgnoreCase)
                && !extension.Equals(".cga", StringComparison.OrdinalIgnoreCase))
            {
                throw new NotSupportedException(
                    $"Thumbnail geometry format {extension} is not supported.");
            }

            var requested = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
            {
                $"data/{assetPath}"
            };
            var companionExtension = extension + "m";
            requested.Add($"data/{Path.ChangeExtension(assetPath, companionExtension)}");

            Directory.CreateDirectory(outputDirectory);
            var outputRoot = Path.GetFullPath(outputDirectory);
            var extracted = new List<string>();
            using var archiveStream = File.OpenRead(archivePath);
            using var archive = new ZipFile(archiveStream);
            foreach (var entry in archive.Cast<ZipEntry>())
            {
                var normalizedEntry = entry.Name.Replace('\\', '/').TrimStart('/');
                if (!requested.Contains(normalizedEntry)) continue;
                if (entry.Size is <= 0 or > MaxThumbnailAssetBytes)
                {
                    throw new InvalidDataException(
                        $"Thumbnail geometry asset has unsupported size {entry.Size} bytes.");
                }

                var fileName = Path.GetFileName(normalizedEntry);
                var outputPath = Path.GetFullPath(Path.Combine(outputRoot, fileName));
                if (!string.Equals(
                        Path.GetDirectoryName(outputPath),
                        outputRoot.TrimEnd(Path.DirectorySeparatorChar),
                        StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidDataException("Thumbnail geometry output path is invalid.");
                }
                using var input = archive.GetInputStream(entry);
                using var output = File.Create(outputPath);
                StreamUtils.Copy(input, output, new byte[81920]);
                extracted.Add(fileName);
            }

            var assetFileName = Path.GetFileName(assetPath);
            if (!extracted.Contains(assetFileName, StringComparer.OrdinalIgnoreCase))
            {
                throw new FileNotFoundException(
                    $"Thumbnail geometry asset was not found in Data.p4k: {assetPath}");
            }
            return new GameThumbnailAssetExtraction(1, assetFileName, extracted);
    }

    private static string NormalizeAssetPath(string value)
        {
            var path = value.Trim().Replace('\\', '/').TrimStart('/');
            if (path.Length is 0 or > 500
                || path.Split('/').Any(segment => segment is "" or "." or "..")
                || !path.StartsWith("Objects/", StringComparison.OrdinalIgnoreCase))
            {
                throw new InvalidDataException("Thumbnail geometry asset path is invalid.");
            }
            return path;
    }
}
