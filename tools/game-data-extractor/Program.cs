using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Xml;
using ICSharpCode.SharpZipLib.Core;
using ICSharpCode.SharpZipLib.Zip;
using unforge;

if (args.Length != 1)
{
    Console.Error.WriteLine("Usage: Rockfall.GameDataExtractor <Data.p4k|Game2.dcb>");
    return 2;
}

var inputPath = Path.GetFullPath(args[0]);
if (!File.Exists(inputPath))
{
    Console.Error.WriteLine($"Game data file does not exist: {inputPath}");
    return 2;
}

var temporaryDcbPath = Path.GetExtension(inputPath).Equals(".p4k", StringComparison.OrdinalIgnoreCase)
    ? Path.Combine(Path.GetTempPath(), $"rockfall-{Guid.NewGuid():N}-Game2.dcb")
    : null;

try
{
    if (temporaryDcbPath is not null)
    {
        ExtractGameDatabase(inputPath, temporaryDcbPath);
    }

    var payload = ExtractSignatures(temporaryDcbPath ?? inputPath);
    Console.WriteLine(JsonSerializer.Serialize(payload, ExtractorJsonContext.Default.ExtractorPayload));
    return 0;
}
catch (Exception error) when (
    error is IOException
        or InvalidDataException
        or UnauthorizedAccessException
        or XmlException
        or NotSupportedException
        or ZipException)
{
    Console.Error.WriteLine(error.Message);
    return 1;
}
finally
{
    if (temporaryDcbPath is not null)
    {
        File.Delete(temporaryDcbPath);
    }
}

static void ExtractGameDatabase(string archivePath, string outputPath)
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

static ExtractorPayload ExtractSignatures(string databasePath)
{
    using var stream = File.OpenRead(databasePath);
    using var dataForge = new DataForge(stream);
    var pathsByRecordIndex = dataForge.PathToRecordMap.ToDictionary(
        entry => entry.Value,
        entry => entry.Key);
    var records = new List<SignatureRecord>();

    foreach (var path in dataForge.PathToRecordMap.Keys
                 .Where(path =>
                     path.StartsWith(
                         "libs/foundry/records/entities/mineable/",
                         StringComparison.OrdinalIgnoreCase))
                 .Order(StringComparer.OrdinalIgnoreCase))
    {
        var root = dataForge.ReadRecordByPathAsXml(path);
        if (root is null)
        {
            continue;
        }

        var mineable = root
            .GetElementsByTagName("MineableParams")
            .OfType<XmlElement>()
            .FirstOrDefault();
        var signatures = root
            .GetElementsByTagName("Single")
            .OfType<XmlElement>()
            .Select(node => node.GetAttribute("value"))
            .Select(value =>
                int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
                    ? parsed
                    : 0)
            .Where(value => value > 0)
            .ToArray();

        if (mineable is null || signatures.Length != 1)
        {
            continue;
        }

        records.Add(
            new SignatureRecord(
                path,
                root.Name,
                ResolvePath(mineable.GetAttribute("composition")),
                ResolvePath(mineable.GetAttribute("globalParams")),
                signatures[0]));
    }

    if (records.Count == 0)
    {
        throw new InvalidDataException("No mineable signatures were found in Game2.dcb.");
    }

    return new ExtractorPayload(1, records);

    string? ResolvePath(string reference)
    {
        return Guid.TryParse(reference, out var guid)
               && dataForge.ReferenceToRecordMap.TryGetValue(guid, out var recordIndex)
               && pathsByRecordIndex.TryGetValue(recordIndex, out var path)
            ? path
            : null;
    }
}

internal sealed record ExtractorPayload(int SchemaVersion, IReadOnlyList<SignatureRecord> Records);

internal sealed record SignatureRecord(
    string RecordPath,
    string EntityName,
    string? CompositionPath,
    string? GlobalParamsPath,
    int Signature);

[JsonSourceGenerationOptions(
    PropertyNamingPolicy = JsonKnownNamingPolicy.CamelCase,
    WriteIndented = false)]
[JsonSerializable(typeof(ExtractorPayload))]
internal sealed partial class ExtractorJsonContext : JsonSerializerContext;
