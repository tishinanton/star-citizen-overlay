using System.Text.Json;
using System.Xml;
using ICSharpCode.SharpZipLib.Zip;
using unforge;

if (args.Length is < 1 or > 2)
{
    Console.Error.WriteLine(
        "Usage: Rockfall.GameDataExtractor <Data.p4k|Game2.dcb> [signatures|blueprints]");
    return 2;
}

var inputPath = Path.GetFullPath(args[0]);
var mode = args.Length == 2 ? args[1].ToLowerInvariant() : "signatures";
if (!File.Exists(inputPath))
{
    Console.Error.WriteLine($"Game data file does not exist: {inputPath}");
    return 2;
}
if (mode is not ("signatures" or "blueprints"))
{
    Console.Error.WriteLine($"Unsupported extraction mode: {mode}");
    return 2;
}
if (mode == "blueprints"
    && !Path.GetExtension(inputPath).Equals(".p4k", StringComparison.OrdinalIgnoreCase))
{
    Console.Error.WriteLine("Blueprint extraction requires the Star Citizen Data.p4k archive.");
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
    if (mode == "blueprints")
    {
        var payload = BlueprintExtractor.Extract(inputPath, dataForge);
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
