Rockfall Game Data Extractor

This helper reads structured records from Data/Game2.dcb in a local Star Citizen
Data.p4k archive. Its default `signatures` mode prints current mineable scanner
signatures. `blueprints` mode prints localized crafting recipes, output items,
default availability, reward missions, and allowlisted loadout icons converted
from packaged DDS files to PNG data URLs. `factions` mode prints localized
faction profiles and their linked reputation scopes, standing thresholds,
drift, perks, and gate flags.

Usage:

Rockfall.GameDataExtractor <Data.p4k|Game2.dcb> [signatures|blueprints|factions]

Blueprint and faction modes require Data.p4k. They read the adjacent English
localization pack when available and otherwise read that allowlisted file from
the archive. The helper does not read game memory, modify game files, connect
to the running game, or redistribute extracted assets.

The DataForge parser in Vendor/Unforge is derived from dolkensp/unp4k commit
b492ab14d26280c6ec91c4365ff0faf5f3e24a6b under the MIT License. See
LICENSE.unp4k.txt.

SharpZipLibP4k 1.4.2 is consumed from NuGet under the MIT License:
https://www.nuget.org/packages/SharpZipLibP4k/1.4.2

ZstdSharp.Port 0.8.1 is consumed transitively under the MIT License:
https://www.nuget.org/packages/ZstdSharp.Port/0.8.1
