using System.Text;
using System.Text.Json;
using ICSharpCode.SharpZipLib.Core;
using ICSharpCode.SharpZipLib.Zip;

internal static class GameArchive
{
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

    internal static string ReadEnglishLocalization(string archivePath)
    {
        var loosePath = Path.Combine(
            Path.GetDirectoryName(archivePath) ?? string.Empty,
            "Data",
            "Localization",
            "english",
            "global.ini");
        if (File.Exists(loosePath))
        {
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
}
