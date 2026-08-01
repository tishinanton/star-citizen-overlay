Rockfall Game Data Extractor

This helper reads structured records from Data/Game2.dcb in a local Star Citizen
Data.p4k archive. Its default `signatures` mode prints current mineable scanner
signatures. `blueprints` mode prints localized crafting recipes, output items,
default availability, reward missions, and allowlisted loadout icons converted
from packaged DDS files to PNG data URLs. `factions` mode prints localized
faction profiles and their linked reputation scopes, standing thresholds,
drift, perks, and gate flags. `mining` mode prints the complete installed
mining catalog: materials, mineable entity variants, harvest locations,
provider probability groups/contributions, quality quantization, and cluster
presets (see below).

Usage:

Rockfall.GameDataExtractor <Data.p4k|Game2.dcb> [signatures|blueprints|factions|mining]

Blueprint, faction, and mining modes require Data.p4k. They read the adjacent
English localization pack when available and otherwise read that allowlisted
file from the archive. The helper does not read game memory, modify game
files, connect to the running game, or redistribute extracted assets.

Mining mode (MiningExtractor.cs)

Reads the full material/entity/location/provider/cluster chain directly from
Game2.dcb:

- Materials: one entry per distinct `ResourceType` reachable from a mineable
  entity's composition, with its English display name, a stable kebab-case
  slug, density (when the game defines a `GramsPerCubicCentimeter` density
  unit), per-material instability/resistance (only when consistent across
  every entity that uses the material - otherwise omitted with a bundled
  warning, since the true values remain visible per composition part), its
  default `CraftingQualityDistributionRecord`, any per-location quality
  overrides, and its `CraftingQualityQuantizationRecord` bands.
- Entities: every `libs/foundry/records/entities/mineable/` record, classified
  Ship / Ground Vehicle / FPS using the same filename patterns as
  `signatures` mode, with its composition parts (material, min/max
  percentage, probability, curveExponent, qualityScale, and the part's own
  instability/resistance).
- Locations: `StarMapObject` records that a provider preset resolves to (see
  below), with localized name, immediate parent, topmost system ancestor, and
  `navIcon` as a human-readable type (Moon/Planet/Default/etc).
- Providers: every `HarvestableProviderPreset`, with its element groups
  (`groupName`, `groupProbability` normalized 0..1), each group's
  contributions (`relativeProbability` normalized as element weight / sum of
  sibling weights in that group - not a flat /100), the resolved mineable
  entity, its cluster preset reference, and per-composition-part effective
  quality (using a matching location override and applying that part's
  qualityScale) plus the distinct, sorted quantized values reachable within
  that quality range. Any
  `<areas>` global/per-element modifiers are captured as area exceptions,
  resolved through the manual weak-pointer struct lookup described below.
- Clusters: `HarvestableClusterPreset` records (probability plus size/
  proximity variation buckets).

Provider -> location linking: Game2.dcb has no direct reference from a
`HarvestableProviderPreset` to its owning `StarMapObject`. The link is a
naming convention confirmed against the installed archive: stripping the
`HPP_` prefix from a provider's local record name and matching it
(case-insensitively) against `StarMapObject` local names resolves the large
majority of providers (including every planet/moon-tied provider). If that
direct match fails, the extractor retries by stripping one leading
`<segment>_` at a time (e.g. provider code `Nyx_GlaciemRing` ->
`GlaciemRing`) for providers whose code embeds a system-name segment the
`StarMapObject`'s own local name omits; remainders shorter than 4 characters
are never attempted, to avoid matching short/generic tokens (e.g. the
single-letter Lagrange point codes). This fallback is bounded to a small,
self-validated count of known cases and always emits a warning naming the
provider it resolved. Providers that still do not resolve are generic
deep-space/asteroid-belt presets, multi-system Lagrange-point presets, and
named system-wide belts/fields that are not tied to a single celestial body
in Game2.dcb; these are still included, with `locationId` left null and a
single bundled warning listing them, rather than fabricated or dropped.

Weak-pointer resolution: some struct fields (single-value `varWeakPointer`,
used for provider area element pointers) are only exposed by the vendored
Unforge parser as unresolved `"{StructName}[{VariantIndex}]"` text. The
extractor resolves these manually by indexing every struct definition by name
and calling the struct's own `ReadStructAtIndexAsXml` with the parsed variant
index.

Named cave POI tiers (poor/medium/rich placement for named cave points of
interest) live in socpak/prefab data outside Game2.dcb and are intentionally
not extracted; `mining` mode always emits one warning noting this rather than
fabricating a placement.

The DataForge parser in Vendor/Unforge is derived from dolkensp/unp4k commit
b492ab14d26280c6ec91c4365ff0faf5f3e24a6b under the MIT License. See
LICENSE.unp4k.txt.

SharpZipLibP4k 1.4.2 is consumed from NuGet under the MIT License:
https://www.nuget.org/packages/SharpZipLibP4k/1.4.2

ZstdSharp.Port 0.8.1 is consumed transitively under the MIT License:
https://www.nuget.org/packages/ZstdSharp.Port/0.8.1
