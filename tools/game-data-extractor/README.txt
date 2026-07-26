Rockfall Game Data Extractor

This helper reads Data/Game2.dcb from a local Star Citizen Data.p4k archive and
prints mineable entity signature records as JSON. It does not read game memory,
modify game files, or connect to the running game.

The DataForge parser in Vendor/Unforge is derived from dolkensp/unp4k commit
b492ab14d26280c6ec91c4365ff0faf5f3e24a6b under the MIT License. See
LICENSE.unp4k.txt.

SharpZipLibP4k 1.4.2 is consumed from NuGet under the MIT License:
https://www.nuget.org/packages/SharpZipLibP4k/1.4.2

ZstdSharp.Port 0.8.1 is consumed transitively under the MIT License:
https://www.nuget.org/packages/ZstdSharp.Port/0.8.1
