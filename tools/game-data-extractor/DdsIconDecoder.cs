using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;

internal static class DdsIconDecoder
{
    private const int DdsDataOffset = 128;

    internal static byte[] DecodeToPng(ReadOnlySpan<byte> dds)
    {
        if (dds.Length < DdsDataOffset
            || dds[0] != (byte)'D'
            || dds[1] != (byte)'D'
            || dds[2] != (byte)'S'
            || dds[3] != (byte)' ')
        {
            throw new InvalidDataException("The packaged item icon is not a DDS image.");
        }

        var height = BinaryPrimitives.ReadInt32LittleEndian(dds[12..16]);
        var width = BinaryPrimitives.ReadInt32LittleEndian(dds[16..20]);
        if (width is <= 0 or > 4096 || height is <= 0 or > 4096)
        {
            throw new InvalidDataException("The packaged item icon has invalid dimensions.");
        }

        var format = Encoding.ASCII.GetString(dds[84..88]);
        var blockSize = format == "DXT1" ? 8 : 16;
        if (format is not ("DXT1" or "DXT3" or "DXT5"))
        {
            throw new NotSupportedException($"The packaged item icon uses unsupported DDS format {format}.");
        }

        var blockColumns = (width + 3) / 4;
        var blockRows = (height + 3) / 4;
        var requiredBytes = DdsDataOffset + blockColumns * blockRows * blockSize;
        if (dds.Length < requiredBytes)
        {
            throw new InvalidDataException("The packaged item icon is truncated.");
        }

        var pixels = new byte[width * height * 4];
        var offset = DdsDataOffset;
        for (var blockY = 0; blockY < blockRows; blockY++)
        {
            for (var blockX = 0; blockX < blockColumns; blockX++)
            {
                DecodeBlock(
                    dds.Slice(offset, blockSize),
                    format,
                    pixels,
                    width,
                    height,
                    blockX * 4,
                    blockY * 4);
                offset += blockSize;
            }
        }

        return EncodePng(width, height, pixels);
    }

    private static void DecodeBlock(
        ReadOnlySpan<byte> block,
        string format,
        Span<byte> pixels,
        int width,
        int height,
        int startX,
        int startY)
    {
        Span<byte> alpha = stackalloc byte[16];
        var colorOffset = 0;
        var transparentBc1 = false;

        switch (format)
        {
            case "DXT1":
                alpha.Fill(255);
                transparentBc1 = true;
                break;
            case "DXT3":
                colorOffset = 8;
                for (var index = 0; index < 16; index++)
                {
                    var packed = block[index / 2];
                    var value = (index & 1) == 0 ? packed & 0x0F : packed >> 4;
                    alpha[index] = (byte)(value * 17);
                }
                break;
            case "DXT5":
                colorOffset = 8;
                DecodeDxt5Alpha(block[..8], alpha);
                break;
        }

        var color0 = BinaryPrimitives.ReadUInt16LittleEndian(block[colorOffset..(colorOffset + 2)]);
        var color1 = BinaryPrimitives.ReadUInt16LittleEndian(
            block[(colorOffset + 2)..(colorOffset + 4)]);
        var colors = BuildColorPalette(color0, color1, transparentBc1);
        var colorBits = BinaryPrimitives.ReadUInt32LittleEndian(
            block[(colorOffset + 4)..(colorOffset + 8)]);

        for (var index = 0; index < 16; index++)
        {
            var x = startX + index % 4;
            var y = startY + index / 4;
            if (x >= width || y >= height) continue;

            var color = colors[(int)((colorBits >> (index * 2)) & 0x03)];
            var pixelOffset = (y * width + x) * 4;
            pixels[pixelOffset] = color.R;
            pixels[pixelOffset + 1] = color.G;
            pixels[pixelOffset + 2] = color.B;
            pixels[pixelOffset + 3] = color.A == 0 ? (byte)0 : alpha[index];
        }
    }

    private static void DecodeDxt5Alpha(ReadOnlySpan<byte> block, Span<byte> alpha)
    {
        Span<byte> palette = stackalloc byte[8];
        palette[0] = block[0];
        palette[1] = block[1];
        if (palette[0] > palette[1])
        {
            for (var index = 1; index <= 6; index++)
            {
                palette[index + 1] = (byte)(
                    ((7 - index) * palette[0] + index * palette[1]) / 7);
            }
        }
        else
        {
            for (var index = 1; index <= 4; index++)
            {
                palette[index + 1] = (byte)(
                    ((5 - index) * palette[0] + index * palette[1]) / 5);
            }
            palette[6] = 0;
            palette[7] = 255;
        }

        ulong bits = 0;
        for (var index = 0; index < 6; index++)
        {
            bits |= (ulong)block[index + 2] << (index * 8);
        }
        for (var index = 0; index < 16; index++)
        {
            alpha[index] = palette[(int)((bits >> (index * 3)) & 0x07)];
        }
    }

    private static Rgba[] BuildColorPalette(ushort packed0, ushort packed1, bool transparentBc1)
    {
        var color0 = ExpandRgb565(packed0);
        var color1 = ExpandRgb565(packed1);
        var colors = new Rgba[4];
        colors[0] = color0;
        colors[1] = color1;

        if (transparentBc1 && packed0 <= packed1)
        {
            colors[2] = Mix(color0, color1, 1, 1, 2);
            colors[3] = new Rgba(0, 0, 0, 0);
        }
        else
        {
            colors[2] = Mix(color0, color1, 2, 1, 3);
            colors[3] = Mix(color0, color1, 1, 2, 3);
        }
        return colors;
    }

    private static Rgba ExpandRgb565(ushort value) =>
        new(
            (byte)(((value >> 11) & 0x1F) * 255 / 31),
            (byte)(((value >> 5) & 0x3F) * 255 / 63),
            (byte)((value & 0x1F) * 255 / 31),
            255);

    private static Rgba Mix(Rgba left, Rgba right, int leftWeight, int rightWeight, int divisor) =>
        new(
            (byte)((left.R * leftWeight + right.R * rightWeight) / divisor),
            (byte)((left.G * leftWeight + right.G * rightWeight) / divisor),
            (byte)((left.B * leftWeight + right.B * rightWeight) / divisor),
            255);

    private static byte[] EncodePng(int width, int height, ReadOnlySpan<byte> pixels)
    {
        using var output = new MemoryStream();
        output.Write([137, 80, 78, 71, 13, 10, 26, 10]);

        Span<byte> header = stackalloc byte[13];
        BinaryPrimitives.WriteInt32BigEndian(header[..4], width);
        BinaryPrimitives.WriteInt32BigEndian(header[4..8], height);
        header[8] = 8;
        header[9] = 6;
        WriteChunk(output, "IHDR", header);

        using var raw = new MemoryStream();
        for (var y = 0; y < height; y++)
        {
            raw.WriteByte(0);
            raw.Write(pixels.Slice(y * width * 4, width * 4));
        }
        raw.Position = 0;

        using var compressed = new MemoryStream();
        using (var zlib = new ZLibStream(compressed, CompressionLevel.SmallestSize, true))
        {
            raw.CopyTo(zlib);
        }
        WriteChunk(output, "IDAT", compressed.ToArray());
        WriteChunk(output, "IEND", []);
        return output.ToArray();
    }

    private static void WriteChunk(Stream stream, string type, ReadOnlySpan<byte> data)
    {
        Span<byte> length = stackalloc byte[4];
        BinaryPrimitives.WriteInt32BigEndian(length, data.Length);
        stream.Write(length);

        var typeBytes = Encoding.ASCII.GetBytes(type);
        stream.Write(typeBytes);
        stream.Write(data);

        var crc = ComputeCrc32(typeBytes, data);
        Span<byte> crcBytes = stackalloc byte[4];
        BinaryPrimitives.WriteUInt32BigEndian(crcBytes, crc);
        stream.Write(crcBytes);
    }

    private static uint ComputeCrc32(ReadOnlySpan<byte> type, ReadOnlySpan<byte> data)
    {
        var crc = uint.MaxValue;
        foreach (var value in type) crc = UpdateCrc32(crc, value);
        foreach (var value in data) crc = UpdateCrc32(crc, value);
        return ~crc;
    }

    private static uint UpdateCrc32(uint crc, byte value)
    {
        crc ^= value;
        for (var bit = 0; bit < 8; bit++)
        {
            crc = (crc >> 1) ^ ((crc & 1) == 0 ? 0 : 0xEDB88320u);
        }
        return crc;
    }

    private readonly record struct Rgba(byte R, byte G, byte B, byte A);
}
