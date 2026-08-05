using System.Text.Json;
using System.Xml;
using ICSharpCode.SharpZipLib.Zip;
using unforge;

if (args.Length is < 1 or > 3)
{
    Console.Error.WriteLine(
        "Usage: Rockfall.GameDataExtractor <Data.p4k|Game2.dcb> " +
        "[signatures|blueprints|factions|mining] [game|global-ini]");
    return 2;
}

var inputPath = Path.GetFullPath(args[0]);
var mode = args.Length >= 2 ? args[1].ToLowerInvariant() : "signatures";
var localizationSource = args.Length == 3 ? args[2].ToLowerInvariant() : "game";
if (!File.Exists(inputPath))
{
    Console.Error.WriteLine($"Game data file does not exist: {inputPath}");
    return 2;
}
if (mode is not ("signatures" or "blueprints" or "factions" or "mining"))
{
    Console.Error.WriteLine($"Unsupported extraction mode: {mode}");
    return 2;
}
if (localizationSource is not ("game" or "global-ini"))
{
    Console.Error.WriteLine($"Unsupported localization source: {localizationSource}");
    return 2;
}
if (mode is "blueprints" or "factions" or "mining"
    && !Path.GetExtension(inputPath).Equals(".p4k", StringComparison.OrdinalIgnoreCase))
{
    Console.Error.WriteLine($"{mode} extraction requires the Star Citizen Data.p4k archive.");
    return 2;
}

var temporaryDcbPath = Path.GetExtension(inputPath).Equals(".p4k", StringComparison.OrdinalIgnoreCase)
    ? Path.Combine(Path.GetTempPath(), $"rockfall-{Guid.NewGuid():N}-Game2.dcb")
    : null;

try
{
    if (temporaryDcbPath is not null)
    {
        GameArchive.ExtractGameDatabase(inputPath, temporaryDcbPath);
    }

    using var stream = File.OpenRead(temporaryDcbPath ?? inputPath);
    using var dataForge = new DataForge(stream);
    if (mode == "mining")
    {
        var payload = MiningExtractor.Extract(inputPath, dataForge, localizationSource);
        Console.WriteLine(
            JsonSerializer.Serialize(payload, ExtractorJsonContext.Default.MiningExtractorPayload));
    }
    else if (mode == "factions")
    {
        var payload = FactionExtractor.Extract(inputPath, dataForge, localizationSource);
        Console.WriteLine(
            JsonSerializer.Serialize(payload, ExtractorJsonContext.Default.FactionExtractorPayload));
    }
    else if (mode == "blueprints")
    {
        var payload = BlueprintExtractor.Extract(inputPath, dataForge, localizationSource);
        Console.WriteLine(
            JsonSerializer.Serialize(payload, ExtractorJsonContext.Default.BlueprintExtractorPayload));
    }
    else
    {
        var payload = SignatureExtractor.Extract(dataForge);
        Console.WriteLine(
            JsonSerializer.Serialize(payload, ExtractorJsonContext.Default.SignatureExtractorPayload));
    }
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
