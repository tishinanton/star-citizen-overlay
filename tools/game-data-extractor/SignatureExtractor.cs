using System.Globalization;
using System.Xml;
using unforge;

internal static class SignatureExtractor
{
    internal static SignatureExtractorPayload Extract(DataForge dataForge)
    {
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
            if (root is null) continue;

            var mineable = root
                .GetElementsByTagName("MineableParams")
                .OfType<XmlElement>()
                .FirstOrDefault();
            var signatures = root
                .GetElementsByTagName("Single")
                .OfType<XmlElement>()
                .Select(node => node.GetAttribute("value"))
                .Select(value =>
                    int.TryParse(
                        value,
                        NumberStyles.Integer,
                        CultureInfo.InvariantCulture,
                        out var parsed)
                        ? parsed
                        : 0)
                .Where(value => value > 0)
                .ToArray();

            if (mineable is null || signatures.Length != 1) continue;

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

        return new SignatureExtractorPayload(1, records);

        string? ResolvePath(string reference) =>
            Guid.TryParse(reference, out var guid)
            && dataForge.ReferenceToRecordMap.TryGetValue(guid, out var recordIndex)
            && pathsByRecordIndex.TryGetValue(recordIndex, out var path)
                ? path
                : null;
    }
}
