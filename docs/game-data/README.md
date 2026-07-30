# Star Citizen local game-data inventory

This document describes the data Rockfall can read from a local Star Citizen
installation using the same method as the mining-signature importer:

1. open `Data.p4k` as a P4K/ZIP archive with
   [SharpZipLibP4k](https://www.nuget.org/packages/SharpZipLibP4k/);
2. extract `Data\Game2.dcb`;
3. parse the DataForge database with the vendored
   [unp4k](https://github.com/dolkensp/unp4k) reader; and
4. select records by path before materializing their typed XML-like trees.

This is static client data. The method does not read game memory, connect to a
running client, inject code, automate input, or expose server-only state.

## Inventory snapshot

Counts below were measured from the installed Windows LIVE channel, not copied
from an external API.

| Build property                  | Value                                           |
| ------------------------------- | ----------------------------------------------- |
| Game branch                     | `sc-alpha-4.9.0`                                |
| Game version                    | `4.9.187.47267`                                 |
| Requested P4 changelist         | `12302499`                                      |
| Build date                      | July 23, 2026                                   |
| Archive modified                | July 24, 2026                                   |
| Archive size                    | 147.29 GiB                                      |
| Files in archive                | 1,364,115                                       |
| Total unpacked payload          | 233.13 GiB                                      |
| Zstandard entries               | 1,235,990 files / 208.78 GiB unpacked           |
| Stored entries                  | 128,125 files / 24.34 GiB                       |
| Encrypted entries in this build | 0                                               |
| `Game2.dcb`                     | 315.2 MiB unpacked / 28.3 MiB packed, Zstandard |
| DataForge format                | version 8                                       |
| DataForge records               | 61,641                                          |
| DataForge top-level categories  | 248                                             |
| DataForge struct definitions    | 6,685                                           |
| DataForge property definitions  | 23,722                                          |
| DataForge enum definitions      | 772                                             |

These numbers are a versioned snapshot. CIG can add, rename, move, or remove
records and file formats in any patch.

## What the method can access

| Layer                                               | Available data                                                                                               | Current decoder support                                          |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- |
| P4K central directory                               | Every path, extension, packed/unpacked size, compression method, and encryption flag                         | Yes                                                              |
| P4K file payloads                                   | Raw bytes for any archive entry                                                                              | Yes; add a path allowlist before extraction                      |
| DataForge database                                  | Record paths, GUIDs, owning teams, root schemas, properties, arrays, references, pointers, enums, and values | Yes                                                              |
| DataForge reference graph                           | Record-to-record links such as entity to component, commodity, manufacturer, loadout, location, or UI record | Yes                                                              |
| Localization                                        | Language packs and `@localization_key` values                                                                | English key resolution is used by the blueprint extractor        |
| CryXML files                                        | Compiled XML under `Data\Libs`, `Data\Scripts`, materials, audio, and other systems                          | Raw bytes only; a CryXML decoder must be added                   |
| Geometry, textures, audio, animation, UI, and video | All packaged client assets                                                                                   | Raw bytes; BC1/BC2/BC3 DDS loadout icons can be converted to PNG |

The bundled helper uses `Game2.dcb` for structured records, reads the English
localization pack, and allowlists referenced loadout icons. Rockfall does not
unpack the whole archive: this build expands to more than 233 GiB.

## Archive-level data

### Major paths

| Archive path                    |     Files | Unpacked GiB | Contents                                                                                                               |
| ------------------------------- | --------: | -----------: | ---------------------------------------------------------------------------------------------------------------------- |
| `Data\Objects`                  | 1,055,784 |       168.20 | Characters, ships, buildings, planets, props, weapons, VFX geometry, and streamed mesh payloads                        |
| `Data\Textures`                 |    83,241 |        29.16 | World, vehicle, character, planet, decal, VFX, sky, and branding textures                                              |
| `Data\Sounds`                   |   118,219 |        10.73 | Wwise media and sound banks                                                                                            |
| `Data\UI`                       |    16,303 |        10.33 | UI textures, video, starmap, kiosks, mobiGlas, HUD, fonts, and legacy Scaleform assets                                 |
| `Data\ObjectContainers`         |     9,729 |         4.68 | PU locations, ships, vehicles, Arena Commander, and instanced world containers                                         |
| `Data\Animations`               |    60,124 |         3.08 | Character, object, ship, weapon, Mannequin, blend-space, and dialogue animation data                                   |
| `Data\Prefabs`                  |       513 |         0.58 | PU and environment prefabs                                                                                             |
| `Data\Materials`                |     6,137 |         0.36 | Materials, decals, and material layers                                                                                 |
| `Data\Game2.dcb`                |         1 |         0.31 | Structured DataForge gameplay database                                                                                 |
| `Engine\EngineAssets`           |     1,234 |         0.28 | Shared engine textures and support assets                                                                              |
| `Data\Libs`                     |     8,465 |         0.16 | Audio configuration, Subsumption, particles, object presets, damage maps, ecosystems, and other compiled configuration |
| `Data\Localization`             |        37 |         0.10 | English, French, German, Chinese, Japanese, Korean, Italian, Portuguese, and Spanish resources                         |
| `Data\Scripts`                  |     4,251 |         0.02 | Entity, AI, loadout, shop-inventory, network, physics, effects, and test configuration                                 |
| `Engine\ShaderCache_Vulkan.pak` |         1 |         3.11 | Vulkan shader cache                                                                                                    |
| `Engine\ShaderCache_D3D11.pak`  |         1 |         1.85 | Direct3D shader cache                                                                                                  |
| `Engine\PSOCache.pso`           |         1 |         0.12 | Pipeline-state cache                                                                                                   |

Notable structured non-DataForge directories include:

- `Data\Scripts\Loadouts`: 3,612 static loadout files;
- `Data\Scripts\ShopInventories`: 120 static shop-inventory files;
- `Data\Libs\GameAudio`: 2,343 audio configuration files;
- `Data\Libs\Subsumption`: 4,143 AI/Subsumption files;
- `Data\Libs\ObjectPresets`: 590 object-preset files; and
- `Data\Libs\Particles`: 849 particle definitions.

### File-format families

| Family            | Extensions and measured counts                                                             | Fetchable information                                                            |
| ----------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------- |
| Static geometry   | `.cgf` 323,311; `.cgfm` 323,001                                                            | Render meshes, LODs, collision/mesh payloads                                     |
| Animated geometry | `.cga` 44,435; `.cgam` 44,005                                                              | Animated objects, ships, cloth, and mechanical geometry                          |
| Character meshes  | `.skin` and `.skinm` 19,902 each; `.chr` 561; `.cdf` 1,682; `.chrparams` 4,037             | Skeletons, skinned meshes, character definitions, and skeleton parameters        |
| Materials         | `.mtl` 25,806; `.meshsetup` 5,151                                                          | Material assignments and mesh setup                                              |
| Textures          | `.dds` 46,398; `.1`-`.8` and `.a`-`.8a` streamed mip chunks; `.r16`, `.r8`, `.raw`, `.dst` | Surface maps, masks, displacement, planet terrain, UI, and streamed texture mips |
| Audio             | `.wem` 115,882; `.bnk` 2,337; `.ogg` 3                                                     | Wwise encoded media, banks, and jukebox tracks                                   |
| Animation         | `.caf` 53,781; `.dba` 546; `.adb` 1,604; `.animevents` 1,790; `.bspace` 1,021; `.aim` 551  | Clips, databases, Mannequin definitions, events, blend spaces, and aim poses     |
| Object containers | `.socpak` 9,614; `.pak` 5                                                                  | World, ship, vehicle, level, and engine package content                          |
| UI and video      | `.bk2` 222; `.usm` 1; `.swf` 331; `.gfx` 276; `.svg` 3,894; `.png` 10; `.ttf` 22           | In-world video, cinematics, fonts, icons, and legacy UI                          |
| World volumes     | `.cigvoxel` 27; `.cigvoxelheader` 27; `.vvg` 152                                           | Gas-cloud and vehicle/derelict voxel data                                        |
| Character DNA     | `.dna` 30; `.riglogic` 77; `.chf` 35; `.topology` 13                                       | Facial DNA, rig logic, customizer presets, and topology                          |
| Structured/config | `.dcb` 1; `.xml` 13,176; `.json` 127; `.ini` 11; `.cfg` 54; `.txt` 119; `.set` 2           | Gameplay database, CryXML/configuration, localization, and engine settings       |

## Structured DataForge data

`Game2.dcb` is the most useful source for application features because records
retain a typed schema. The current database uses:

- scalar floats, doubles, booleans, signed/unsigned integers, GUIDs, strings,
  localization keys, and enums;
- nested classes and simple/class/complex arrays;
- weak/strong pointers and GUID references to other records; and
- 21,476 attribute properties, 2,031 complex arrays, 208 class arrays, and 7
  simple arrays.

References must be resolved through the DataForge reference map. A localized
field generally contains a key, not display-ready text, so it must be joined
with the chosen `Data\Localization\<language>\global.ini`.

### High-value data families

| Domain                                   | Main record paths                                                                                                                                                                 | Data available                                                                                                                                                                                                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Entities, items, ships, and vehicles     | `entities` (26,717), including `scitem` (23,957), `spaceships` (1,058), `groundvehicles` (40), `commodities` (135), `mineable` (269), `radarscanning` (33), and `salvagable` (29) | Display/localization references, manufacturer, geometry, physics, mass, health, damage, inventory, cargo, item ports, loadouts, resource networks, power, radar signatures, scanning, thrusters, IFCS, quantum drive, shields, weapons, interactions, audio, and UI components |
| Mining                                   | `mining` (307), `miningaudioparams` (3), mineable entities (269)                                                                                                                  | 46 mineable elements; 249 compositions; resource links; instability; resistance; optimal-window shape; explosion and clustering factors; composition probabilities and percentage ranges; mining mode/global parameters; laser damage; radar signatures                        |
| Harvesting and spawn providers           | `harvestable` (899)                                                                                                                                                               | 571 presets, 49 provider presets, 28 clustering presets, 168 slot presets, respawn/despawn behavior, scale ranges, location areas, and entity/composition links                                                                                                                |
| Crafting and refining                    | `crafting` (1,874), `refiningprocess` (9)                                                                                                                                         | 1,598 blueprints, rewards and pools, categories, ingredients/outputs through nested blueprint data, quality distributions, crafted properties, process name, speed, and quality enums                                                                                          |
| Inventory, cargo, shops, and loadouts    | `inventorycontainers` (585), `cargomanifest` (82), `loadoutkits` (398), `franchises` (36), plus `Data\Scripts\ShopInventories`                                                    | Container dimensions/types, exclusions, cargo-manifest composition, ship/armor/ground-vehicle inventories, loadout assortments, shop brands, and static shop inventory definitions                                                                                             |
| Loot and rewards                         | `lootgeneration` (528), `contractawardconfig`, `awardservice`                                                                                                                     | Loot archetypes, loot tables, filters, secondary choices, reward weighting, and award identifiers                                                                                                                                                                              |
| Starmap and solar systems                | `starmap` (2,071), `ssolarsystem` (3), `level` (46), `jumppoints` (4)                                                                                                             | Names/descriptions, parent hierarchy, affiliation, jurisdiction, object type, size, map geometry/materials, scannability, quantum data, galactic positions, amenities, jump parameters, and level records                                                                      |
| World and environment                    | `environments` (24), `roomsystem` (220), `planetdaynighttemperatureparams` (35), object containers and prefabs                                                                    | Asteroid-field compositions, atmosphere/radiation/gas/electrical/fire state templates, pressure/temperature/humidity behavior, planet cycles, rooms, world containers, and environment assets                                                                                  |
| Missions and contracts                   | `missionbroker` (2,584), `missiondata` (2,470), `contracts` (647), `missiongiver` (23), `missionscenarios` (18), `missiontype` (41)                                               | Titles/descriptions, giver, type, rewards, buy-in, sharing, player/instance limits, deadlines, cooldowns, reputation gates/rewards, tags, objectives, flow, mission locations/items/organizations, generators, and scenarios                                                   |
| Characters and actors                    | `actor` (2,496), `character` (510), health/status/stamina/movement categories                                                                                                     | Character identity and gender, combat style, names, actor entity classes, stance dimensions/speeds, health/body mappings, status effects, stamina, G-force, locomotion, camera/view limits, and equipment components                                                           |
| AI and combat                            | `aiprofile` (175), `aiwavecollection` (184), `tacticalquery` (273), `formation`, `closecombat`, `ammoparams` (239), weapon procedural categories                                  | Skills, motives, targetability, fire discipline, waves, tactical queries, formations, melee/takedowns, ammunition physics/damage/radar data, recoil, clips, misfires, and procedural weapon animation                                                                          |
| Factions, reputation, and law            | `factions` (135), `reputation` (530), `lawsystem` (248), `jurisdictions` within law data                                                                                          | Allies/enemies, default reactions, policing behavior, reputation contexts/scopes/tiers/drift/rewards/perks, infractions, triggers, security clearances, security networks, and jurisdictions                                                                                   |
| Communication and narrative              | communication categories, `commsnotifications` (792), `conversation` (46), dialogue banks/contexts, voice records                                                                 | Communication concepts/names/channels, notification stages, conversations, dialogue realms/contexts, voice bundles/singles, comms effects, and localized text/audio references                                                                                                 |
| UI, HUD, and mobiGlas                    | `ui` (5,823), `rastar` (22), `hints` (669), HUD/input/marker categories                                                                                                           | 3,825 Building Blocks canvases, styles, timelines, scene graphs, static variables, mobiGlas apps, maps, kiosks, entrances, markers, radar displays, hints, prompts, fonts, icons, and sound tags                                                                               |
| Audio and music                          | `audio` (670), `foley` (149), `musiclogic` (95), Wwise files                                                                                                                      | Audio event/tag configuration, RTPC subscribers, ship computers, breaths, foley, vibrations, environmental/planet audio, music switches, banks, and encoded media                                                                                                              |
| Rendering, camera, VFX, and presentation | `cameras` (421), `dynamiccameraeffects`, `dynamiclightingrig`, `rendererpresets`, `vfx`, `tintpalettes` (2,341), materials/textures                                               | Camera and lens settings, shakes, lighting rigs, shield/VFX settings, tint trees, geometry, materials, textures, particle definitions, and video                                                                                                                               |
| Player, social, and global systems       | player, chat, friend/group, notifications, trade, entitlements, persistence, analytics, global parameter records                                                                  | Static rules and configuration for player state, groups, chat, calls, trade, entitlements, logout/persistence, tutorials, interaction, cargo loading, shops, quantum drive, tractor/healing/salvage beams, and telemetry events                                                |

### Representative typed fields

- `EntityClassDefinition`: category, icon, density class, tags, static display
  data, and a polymorphic component array.
- `MineableElement`: resource reference, instability, resistance, optimal-window
  midpoint/randomness/thinness, explosion multiplier, and cluster factor.
- `MineableComposition`: localized deposit name, minimum distinct elements, and
  composition parts.
- `HarvestablePreset`: entity class, behavior, transforms, sub-configuration,
  respawn time, and special-harvestable string.
- `StarMapObject`: localized name/description/callouts, affiliation,
  jurisdiction, parent, type, radar data, size, visibility, orbit, map assets,
  quantum data, location data, and amenities.
- `MissionBrokerEntry`: title, HUD title, description, giver, type, reward,
  buy-in, prerequisites, reputation, dates, deadlines, sharing, instance/player
  limits, cooldowns, prison/criminal behavior, tags, objectives, and mission
  flow.
- `Faction`: localized identity, allies/enemies, reaction, faction type,
  policing/legal behavior, and reputation reference.
- `SReputationStandingParams`: localized tier, minimum/drift reputation,
  drift time, icon, perk description, and gating.
- `AmmoParams`: category, size, lifetime, speed, hit points, impulse, resource,
  conversion, effects, projectile, physics, geometry, radar, and display name.
- `BuildingBlocks_Canvas`: dimensions, coordinate mode, styles, scenes,
  libraries, operations, static variables, preview scenes, sounds, and
  collision behavior.

## What Rockfall currently reads

Mining signature extraction remains intentionally narrow:

```text
Data.p4k
  -> Data/Game2.dcb
  -> libs/foundry/records/entities/mineable/*.xml
  -> MineableParams + SSCSignatureSystemParams
```

From 269 records in the `entities\mineable` path, 260 contain the expected
mineable/signature shape. Rockfall then selects current canonical ship, FPS,
and ground-vehicle definitions, producing 38 signature/method variants for 37
material keys in this build. Commodity names and location metadata are still
joined from the Star Citizen Wiki API.

Blueprint extraction follows a second local-only path:

```text
Data.p4k
  -> Data/Game2.dcb
  -> crafting blueprints + default selection
  -> output entities + resource and item requirements
  -> blueprint reward pools + contract generators/templates
  -> Data/Localization/english/global.ini
  -> referenced Data/UI loadout icon DDS files
```

The measured LIVE build contains 1,598 blueprint records. Six reference removed
output entities, leaving 1,591 complete entries, matching the previous API
catalog count. Local extraction resolves 25 resource types, 297 item-cost
occurrences, eight default blueprints, and mission links for 660 released
blueprints.
Output entities reference 27 distinct browser-convertible loadout icons used by
853 entries.

Faction reputation extraction follows a third DataForge path:

```text
Data.p4k
  -> Data/Game2.dcb
  -> libs/foundry/records/factions/factionreputation/*
  -> reputation contexts + primary/additional scopes
  -> standing maps
  -> Data/Localization/english/global.ini
```

The measured build produces 38 factions, 100 scopes, and 638 standings. The
parser retains faction identity/profile fields, alignment and visibility flags,
scope thresholds, standing drift/gates, and localized perk descriptions.

These icons are UI silhouettes, not universal item renders. Most ship
components expose geometry and material assets but no pre-rendered preview;
rendering those models would require CGF/CGA and material decoders plus a
renderer, so Rockfall uses its normal equipment glyph for those records.

The implementation lives in:

- [`tools\game-data-extractor`](../../tools/game-data-extractor/);
- [`src\main\game-data.ts`](../../src/main/game-data.ts);
- [`src\main\blueprint-data.ts`](../../src/main/blueprint-data.ts); and
- [`src\main\mining-data.ts`](../../src/main/mining-data.ts);
- [`src\main\faction-data.ts`](../../src/main/faction-data.ts); and
- [`src\main\static-data-publication.ts`](../../src/main/static-data-publication.ts).

### Static publication boundary

Admin publication reuses the validated loader outputs above; it does not
reimplement DataForge joins in the API. Schema-v1 resources are exactly
`signatures`, `blueprints`, and `faction-reputation`. Canonical JSON is
deterministically gzipped. Blueprint records reference logical
`blueprint-icons/<png-sha256>.png` keys, while raw PNG files are separate
`assets/blueprint-icons/<png-sha256>.png` ZIP entries. Base64 cache images,
extractor warnings, local paths, Wiki locations, ownership state, and logs are
excluded.

Publication metadata maps `build_manifest.id` deliberately: manifest `gameBuild`
and the blueprint/faction resource `gameVersion` use
`<Data.Version>-<selected channel>`, while manifest `gameVersion` uses
`Data.Branch`. Data.p4k contributes only its byte length and modification time,
never its local path.

The current catalogs contain 38 signatures, 1,591 blueprints, and 38 factions.
Their 27 static non-interlaced 64x64 PNGs total 21,056 bytes, range from 473 to
1,258 bytes, and contain no APNG animation chunk. These are observations, not
future maxima. Publication allows the validated cache ceiling of 200 icons and
enforces every PNG chunk CRC and complete IDAT zlib stream, 204 ZIP entries,
128 KiB per raw PNG, and 32 MiB aggregate PNG bytes.
The shared desktop/API schema-v1 caps are 128 signatures, 2,500 blueprints, and
100 factions. Aggregate resource payloads are capped at 48 MiB compressed and
128 MiB uncompressed.

## Data that this method cannot provide

Local client resources do **not** provide authoritative live state:

- rocks, deposits, ships, NPCs, or players currently spawned near the user;
- the user's position, scan contacts, inventory, wallet, reputation, missions,
  refinery jobs, entitlements, or account data;
- current server population, shard state, dynamic events, or mission instances;
- live shop prices, stock, demand, commodity routes, refinery bonuses, or
  economy state;
- server-side spawn rolls, actual deposit quality, depletion, or respawn state;
- unpublished server logic or data not shipped to the client; or
- guaranteed stable schemas across patches.

Static records can describe possible locations, probabilities, templates, and
rules. They cannot say what the server instantiated for a player.

Rockfall's blueprint collection uses a separate, read-only source: `Game.log`
and retained `logbackups\*.log` receipt notifications. Those files can confirm
blueprints received on this installation, but they do not turn the static
archive into authoritative account state and cannot recover deleted or
never-local log history.

## Adding another extractor

1. Identify the narrowest DataForge path prefix or P4K entry allowlist.
2. Read `Game2.dcb` once and filter `PathToRecordMap` before decoding records.
3. Validate the DataForge schema version and every field used by the feature.
4. Resolve GUID references through `ReferenceToRecordMap`.
5. Resolve `varLocale` keys through the selected localization pack.
6. Preserve method/context distinctions when one resource has multiple values.
7. Cache against the `Data.p4k` size and modification time.
8. Fail explicitly on conflicting or incomplete records and retain the current
   archive-derived cache fallback.
9. Never redistribute extracted game assets. Store only the minimal derived
   facts needed by the application.

## Complete archive extension inventory

The numeric suffixes such as `.dds.1` through `.dds.8` and `.dds.a` through
`.dds.8a` are streamed texture chunks; they appear as the final archive
extension.

| Extension         |   Files | Unpacked GiB |
| ----------------- | ------: | -----------: |
| `.1`              |  39,018 |        0.034 |
| `.1a`             |   7,336 |        0.004 |
| `.2`              |  39,016 |        0.136 |
| `.2a`             |   7,336 |        0.015 |
| `.3`              |  38,689 |        0.528 |
| `.3a`             |   7,331 |        0.058 |
| `.4`              |  37,986 |        2.028 |
| `.4a`             |   7,248 |        0.228 |
| `.5`              |  36,112 |        7.406 |
| `.5a`             |   7,030 |        0.878 |
| `.6`              |  30,907 |       23.935 |
| `.6a`             |   6,249 |        3.104 |
| `.7`              |  20,908 |        59.59 |
| `.7a`             |   4,670 |        9.141 |
| `.8`              |     948 |       11.133 |
| `.8a`             |     220 |        1.719 |
| `.a`              |   7,338 |        0.002 |
| `.adb`            |   1,604 |        0.034 |
| `.aim`            |     551 |        0.034 |
| `.animevents`     |   1,790 |        0.006 |
| `.bk2`            |     222 |        3.955 |
| `.bnk`            |   2,337 |        0.109 |
| `.bspace`         |   1,021 |        0.002 |
| `.caf`            |  53,781 |        2.514 |
| `.cax`            |       4 |        0.027 |
| `.cdf`            |   1,682 |        0.011 |
| `.cfg`            |      54 |            0 |
| `.cga`            |  44,435 |        4.682 |
| `.cgam`           |  44,005 |       12.294 |
| `.cgf`            | 323,311 |       14.274 |
| `.cgfm`           | 323,001 |       35.431 |
| `.chf`            |      35 |            0 |
| `.chr`            |     561 |        0.004 |
| `.chrparams`      |   4,037 |        0.003 |
| `.cigvoxel`       |      27 |         0.41 |
| `.cigvoxelheader` |      27 |            0 |
| `.comb`           |      85 |            0 |
| `.dat`            |       6 |        0.001 |
| `.dba`            |     546 |        0.431 |
| `.dcb`            |       1 |        0.308 |
| `.dds`            |  46,398 |         6.51 |
| `.dm`             |      35 |        0.001 |
| `.dna`            |      30 |        0.132 |
| `.dpl`            |       1 |        0.008 |
| `.dst`            |     141 |        0.144 |
| `.eco`            |     131 |            0 |
| `.gfx`            |     276 |        0.088 |
| `.img`            |       2 |        0.037 |
| `.ini`            |      11 |         0.03 |
| `.json`           |     127 |        0.001 |
| `.lut`            |       1 |            0 |
| `.meshsetup`      |   5,151 |        0.039 |
| `.mtl`            |  25,806 |        0.168 |
| `.obj`            |      12 |        0.419 |
| `.ogg`            |       3 |        0.007 |
| `.opr`            |     590 |        0.031 |
| `.pak`            |       5 |        4.963 |
| `.png`            |      10 |        0.005 |
| `.pso`            |       1 |        0.123 |
| `.r16`            |     172 |        1.088 |
| `.r8`             |     129 |        0.126 |
| `.raw`            |       6 |        0.003 |
| `.riglogic`       |      77 |        0.016 |
| `.set`            |       2 |            0 |
| `.skin`           |  19,902 |        0.129 |
| `.skinm`          |  19,902 |        8.131 |
| `.slug`           |     524 |        0.002 |
| `.socpak`         |   9,614 |        4.684 |
| `.svg`            |   3,894 |        0.023 |
| `.swf`            |     331 |        0.147 |
| `.topology`       |      13 |        0.004 |
| `.ttf`            |      22 |        0.001 |
| `.txt`            |     119 |        0.038 |
| `.usm`            |       1 |        0.099 |
| `.veg`            |       1 |            0 |
| `.vvg`            |     152 |         0.12 |
| `.wem`            | 115,882 |       10.625 |
| `.xml`            |  13,176 |        0.723 |

## Complete DataForge category inventory

Categories are the first path component below
`libs/foundry/records/`. A few legacy records live directly in that directory,
so their filename appears as the category.

| DataForge category                           | Records | Primary root schema                          |
| -------------------------------------------- | ------: | -------------------------------------------- |
| `actor`                                      |   2,496 | `EntityClassDefinition`                      |
| `actorabilitycomponent`                      |       9 | `PlayerLimitationsProfile`                   |
| `actorduckingparams`                         |       1 | `ActorDuckingParams`                         |
| `actorenvironmentcomponent`                  |       1 | `ActorEnvironmentComponent`                  |
| `actorgforcecomponent`                       |       3 | `ActorGForceComponent`                       |
| `actorhealthcomponent`                       |      45 | `HealthTemplate`                             |
| `actormovementsetsconfig`                    |       1 | `ActorMovementSetsConfig`                    |
| `actorproceduralrecoil`                      |      60 | `ActorProceduralRecoilConfig`                |
| `actorstaminacomponent`                      |       2 | `ActorStaminaComponent`                      |
| `actorstatuscomponent`                       |      27 | `ActorStatusComponent`                       |
| `actorviewlimitpresetdatabase`               |       1 | `ActorViewLimitPresetDatabase`               |
| `ads`                                        |       1 | `SeatAdsDef`                                 |
| `aianimationdata`                            |       9 | `AIMeleeCombatConfig`                        |
| `aifiredisciplinesettings`                   |       1 | `AIFireDisciplineSettings`                   |
| `aiglobalsettings`                           |       2 | `AIFireDisciplineSettings`                   |
| `aimotive`                                   |       8 | `AIMotiveList`                               |
| `aiprofile`                                  |     175 | `SkillDefinitions`                           |
| `aitargetablesettings`                       |       1 | `AITargetableSettings`                       |
| `aiwavecollection`                           |     184 | `AIWaveCollection`                           |
| `ammobox`                                    |       3 | `EntityClassDefinition`                      |
| `ammoparams`                                 |     239 | `AmmoParams`                                 |
| `analytics`                                  |       1 | `SAnalyticsEventDatabase`                    |
| `announcer`                                  |      15 | `Announcer`                                  |
| `areaservices`                               |       2 | `AreaServices`                               |
| `assistshipincombat_mmh.xml`                 |       1 | `MissionModuleHierarchy`                     |
| `audio`                                      |     670 | `GPUParticleAudio`                           |
| `awardservice`                               |       1 | `AwardService_Config`                        |
| `cameras`                                    |     421 | `Camera`                                     |
| `capacitorassignment`                        |      16 | `CapacitorAssignmentInputOutputDef`          |
| `cargomanifest`                              |      82 | `CargoManifest`                              |
| `character`                                  |     510 | `Character`                                  |
| `characternamedata`                          |      43 | `CharacterRandomNameParams`                  |
| `characterserializationpresets`              |      20 | `CharacterSerializationSettingsPreset`       |
| `chatchannelfilters`                         |       3 | `ChatChannelFilterRecord`                    |
| `chatcommandfastaccess`                      |       2 | `ChatCommandFastAccess`                      |
| `chatemoterecord`                            |       1 | `ChatEmoteRecord`                            |
| `chatfilteroptions`                          |       1 | `ChatFilterOptions`                          |
| `chatmanager`                                |       1 | `ChatManagerGlobalParams`                    |
| `closecombat`                                |       6 | `TakeDownConfig`                             |
| `commodityconfiguration`                     |       3 | `CommodityDamageConfiguration`               |
| `commsnotifications`                         |     792 | `CommsNotification`                          |
| `commsnotificationstages`                    |       7 | `EntityClassDefinition`                      |
| `communicationatlconfig`                     |       1 | `CommunicationATLConfig`                     |
| `communicationchannelname`                   |      41 | `CommunicationChannelName`                   |
| `communicationconfig`                        |     153 | `CommunicationConfig`                        |
| `communicationname`                          |   1,690 | `CommunicationName`                          |
| `communicationsystem`                        |       2 | `CommunicationAutoMannequinTagsConfig`       |
| `communicationvariableconfig`                |       1 | `CommunicationVariableConfig`                |
| `consumabletypesdatabase`                    |       1 | `ConsumableTypeDatabase`                     |
| `contextualcommunicationconfig`              |       1 | `ContextualCommunicationConfig`              |
| `contractawardconfig`                        |       1 | `ItemAwardWeightingsRecord`                  |
| `contracts`                                  |     647 | `ContractTemplate`                           |
| `conversation`                               |      46 | `Conversation`                               |
| `conversationbank`                           |       8 | `ConversationBank`                           |
| `crafting`                                   |   1,874 | `CraftingBlueprintRecord`                    |
| `creatures`                                  |      18 | `EntityClassDefinition`                      |
| `crewmanifest`                               |      57 | `CrewManifest`                               |
| `curves`                                     |      32 | `SBezierCurveRecord`                         |
| `damage`                                     |      19 | `DamageResistanceMacro`                      |
| `densityclasses`                             |      33 | `SEntityDensityClass`                        |
| `dev`                                        |       1 | `EntityClassDefinition`                      |
| `devowners`                                  |      23 | `DevOwner`                                   |
| `dialoguecontentbank`                        |      15 | `DialogueContentBank`                        |
| `dialoguecontext`                            |     173 | `DialogueContext`                            |
| `dialoguecontextbank`                        |     363 | `DialogueContextBank`                        |
| `dialoguerealm`                              |      13 | `DialogueRealm`                              |
| `dynamiccameraeffects`                       |      18 | `DynamicCameraEffects`                       |
| `dynamiclightingrig`                         |       8 | `SCDynamicLightingRigGlobalParams`           |
| `elevatorbase_teleportnode.xml`              |       1 | `EntityClassDefinition`                      |
| `emotions`                                   |       1 | `EmotionList`                                |
| `entities`                                   |  26,717 | `EntityClassDefinition`                      |
| `entitlementpolicies`                        |      17 | `DefaultEntitlementRecord`                   |
| `entityaudiocontrollerrtpcsubscriberlistdef` |       1 | `EntityAudioControllerRtpcSubscriberListDef` |
| `environments`                               |      24 | `AsteroidFieldComposition`                   |
| `evagraph`                                   |       1 | `EVAGraph`                                   |
| `explosiveordnance`                          |       1 | `ExplosiveOrdnancePingGlobalParams`          |
| `factions`                                   |     135 | `Faction`                                    |
| `factions_legacy`                            |      27 | `Faction_LEGACY`                             |
| `fidgetconfig`                               |       1 | `FidgetConfig`                               |
| `foley`                                      |     149 | `FoleyDefinition`                            |
| `forcefeedback.forcefeedbackeffects.xml`     |       1 | `ForceFeedback`                              |
| `formation`                                  |      11 | `Formation`                                  |
| `fovaspectratiorangetables`                  |       2 | `ActorFOVViewParams`                         |
| `fps_headbob-headshake.xml`                  |       1 | `SHeadOverlayOffset`                         |
| `franchises`                                 |      36 | `ShopFranchise`                              |
| `friendmanager`                              |       1 | `FriendManagerGlobalParams`                  |
| `fuelparams`                                 |       1 | `SCItemSuitFuelParams`                       |
| `gamemode`                                   |      54 | `GameMode`                                   |
| `gamemodule`                                 |       3 | `GameModule`                                 |
| `genericmobiterminals`                       |       9 | `EntityClassDefinition`                      |
| `globalarmarkerparams`                       |       1 | `ARMarkerGlobalParams`                       |
| `globalcargoloadingparams`                   |       1 | `GlobalCargoLoadingParams`                   |
| `globalcommsnotificationparams`              |       1 | `CommsNotificationsGlobalParams`             |
| `globalcuttableshapeparams`                  |       1 | `SGlobalCuttableShapeParams`                 |
| `globalinteractionparams`                    |       2 | `CarryableInteractionsMetadataConfigDef`     |
| `globalinventoryparams`                      |      15 | `InteractionPointTemplate`                   |
| `globallogoutparams`                         |       1 | `SDCLogoutBehaviourDef`                      |
| `globalquantumdriveparams`                   |       1 | `QuantumDriveGlobalParams`                   |
| `globalshopparams`                           |       4 | `GlobalShopBuyingParams`                     |
| `globaltutorialparams`                       |       1 | `GlobalTutorialParams`                       |
| `gpuparticleaudio`                           |       1 | `GPUParticleAudio`                           |
| `grips`                                      |       4 | `Grip`                                       |
| `handholdgripdatabase`                       |       1 | `HandholdGripDatabase`                       |
| `hardwaremouse`                              |       1 | `HardwareMouseParams`                        |
| `harvestable`                                |     899 | `HarvestablePreset`                          |
| `hazardawarenessparams`                      |       1 | `HazardAwarenessParams`                      |
| `hints`                                      |     669 | `HintTriggerData`                            |
| `hudparams`                                  |       8 | `SProjectedHudParams`                        |
| `ic_ter_shopping_craftitemcanvas.xml`        |       1 | `BuildingBlocks_Canvas`                      |
| `ifcs`                                       |       7 | `ESPParams`                                  |
| `initialdamageoverrides`                     |       5 | `InitialDamageOverride`                      |
| `inputpromptconfig`                          |       5 | `InputPromptConfig`                          |
| `instancebroker.xml`                         |       1 | `EntityClassDefinition`                      |
| `instancedinterior`                          |      85 | `EntityClassDefinition`                      |
| `instancestreaminghelper.xml`                |       1 | `EntityClassDefinition`                      |
| `interactionconditions`                      |     102 | `InteractionConditionPreset`                 |
| `intoxication`                               |      11 | `IntoxicationWheeledModifierParams`          |
| `inventorycontainers`                        |     585 | `InventoryContainer`                         |
| `item`                                       |       2 | `AnimatedHelmetParams`                       |
| `itemporttagsdictionary`                     |       1 | `ItemPortTagsDictionary`                     |
| `itemresourcenetwork`                        |       1 | `ItemResourceNetworkGlobal`                  |
| `journalentry`                               |     200 | `JournalEntry`                               |
| `journalentrytype`                           |       4 | `JournalEntryType`                           |
| `jumppoints`                                 |       4 | `GlobalJumpDriveParams`                      |
| `kaboos_derelictships.xml`                   |       1 | `StarMapObject`                              |
| `landingpadsize`                             |       6 | `LandingPadSize`                             |
| `lawsystem`                                  |     248 | `SecurityNetworkManifest`                    |
| `leangraph`                                  |       2 | `LeanGraph`                                  |
| `level`                                      |      46 | `Level`                                      |
| `lightamplification_aegs.xml`                |       1 | `SCItemLightAmplification`                   |
| `lightamplification_anvl.xml`                |       1 | `SCItemLightAmplification`                   |
| `lightamplification_argo.xml`                |       1 | `SCItemLightAmplification`                   |
| `lightamplification_banu.xml`                |       1 | `SCItemLightAmplification`                   |
| `lightamplification_cnou.xml`                |       1 | `SCItemLightAmplification`                   |
| `lightamplification_crus.xml`                |       1 | `SCItemLightAmplification`                   |
| `lightamplification_drak.xml`                |       1 | `SCItemLightAmplification`                   |
| `lightamplification_espr.xml`                |       1 | `SCItemLightAmplification`                   |
| `lightamplification_gama.xml`                |       1 | `SCItemLightAmplification`                   |
| `lightamplification_grey.xml`                |       1 | `SCItemLightAmplification`                   |
| `lightamplification_krig.xml`                |       1 | `SCItemLightAmplification`                   |
| `lightamplification_misc.xml`                |       1 | `SCItemLightAmplification`                   |
| `lightamplification_mrai.xml`                |       1 | `SCItemLightAmplification`                   |
| `lightamplification_orig.xml`                |       1 | `SCItemLightAmplification`                   |
| `lightamplification_rsi.xml`                 |       1 | `SCItemLightAmplification`                   |
| `lightamplification_vncl.xml`                |       1 | `SCItemLightAmplification`                   |
| `lightamplification_xnaa.xml`                |       1 | `SCItemLightAmplification`                   |
| `loadoutkits`                                |     398 | `SLoadoutAssortment`                         |
| `longtermpersistence`                        |       1 | `LongTermPersistenceGlobalParams`            |
| `lootgeneration`                             |     528 | `LootArchetype`                              |
| `megamap`                                    |     162 | `MegaMap`                                    |
| `mining`                                     |     307 | `MineableComposition`                        |
| `miningaudioparams`                          |       3 | `MiningAudioParams`                          |
| `missionbroker`                              |   2,584 | `MissionBrokerEntry`                         |
| `missiondata`                                |   2,470 | `MissionLocationTemplate`                    |
| `missionfailureconditions`                   |       1 | `MissionFailConditionsList`                  |
| `missiongiver`                               |      23 | `MissionGiver`                               |
| `missionscenarios`                           |      18 | `MissionScenario`                            |
| `missiontype`                                |      41 | `MissionType`                                |
| `motionstatemachine`                         |       3 | `MotionGraph`                                |
| `moveviewrestrictionpenalties`               |      10 | `ArmorMoveViewRestrictions`                  |
| `musiclogic`                                 |      95 | `MusicLogicSwitchValue`                      |
| `personalinnerthoughtrules`                  |       2 | `PersonalInnerThoughtActionRulePreset`       |
| `planetdaynighttemperatureparams`            |      35 | `PlanetDayNightTemperatureTemplate`          |
| `player`                                     |       1 | `EntityClassDefinition`                      |
| `playeranimatedinteractiontemplates`         |      20 | `PlayerAnimatedInteractionTemplate`          |
| `playerchoicemenuitems`                      |       1 | `PlayerChoiceMenuItems`                      |
| `playerchoicemenutypes`                      |       6 | `PlayerChoiceMenuType`                       |
| `playerdockcontextcomponent`                 |       3 | `GameNotificationDockItemParams`             |
| `playergroupmanager`                         |       1 | `PlayerGroupManagerGlobalParams`             |
| `playernotificationsystem`                   |      13 | `NotificationDef`                            |
| `playerspeedthrottle`                        |       1 | `LocalPlayerSpeedThrottleComponent`          |
| `playertoplayercommscallglobalparams`        |       1 | `PlayerToPlayerCommsCallGlobalParams`        |
| `playertrade`                                |       1 | `PlayerTradeGlobalParams`                    |
| `posturedatabase`                            |       1 | `PostureDatabase`                            |
| `procbreathing`                              |       6 | `ProcBreathingCurveDatabase`                 |
| `proceduralaimrigrecord`                     |       2 | `ProceduralAimRigRecord`                     |
| `proceduralanimations`                       |      16 | `ProceduralAnimation`                        |
| `procedurallandingsetup`                     |       2 | `ProceduralLandingSetup`                     |
| `procedurallayout`                           |       3 | `ProceduralLayoutGraph`                      |
| `prop`                                       |       5 | `EntityClassDefinition`                      |
| `qteconfigs`                                 |       2 | `QTERequestConfig`                           |
| `radarsystem`                                |      82 | `ScanDisplayInstanceParams`                  |
| `rastar`                                     |      22 | `BuildingBlocks_Canvas`                      |
| `refinerynotificationconfiguration`          |       1 | `RefineryNotificationConfiguration`          |
| `refiningprocess`                            |       9 | `RefiningProcess`                            |
| `rendererpresets`                            |       8 | `CameraLensParams`                           |
| `rentalnotificationparams`                   |       1 | `RentalNotificationParams`                   |
| `reputation`                                 |     530 | `SReputationStandingParams`                  |
| `reputationvaluesettings`                    |       1 | `ReputationValueSettings`                    |
| `resourcetypedatabase`                       |       1 | `ResourceTypeDatabase`                       |
| `roomsystem`                                 |     220 | `AtmosphereStateTemplate`                    |
| `rsi_polaris_kaboos_exterior.xml`            |       1 | `EntityClassDefinition`                      |
| `scandisplayinstanceparams`                  |       1 | `ScanDisplayInstanceParams`                  |
| `scarryableikinteractionlist`                |       6 | `SCarryableIKInteractionList`                |
| `scitemcommscomponentsetup`                  |      11 | `SCItemCommsComponentSetup`                  |
| `scitemdisplayscreenpreset`                  |       7 | `SCItemDisplayScreenPreset`                  |
| `scitemmanufacturer`                         |   1,152 | `SCItemManufacturer`                         |
| `scuttableshapedefinition`                   |       1 | `SCuttableShapeDefinition`                   |
| `seatcdikconfigs`                            |       1 | `SeatUserActorCDIKRecord`                    |
| `servicebeacon`                              |      15 | `ContractTemplate`                           |
| `sgeometryviewdistanceratiocategories`       |       1 | `SGeometryViewDistanceRatioCategories`       |
| `sglobalchargedrainbeamparams`               |       1 | `SGlobalChargeDrainBeamParams`               |
| `sglobalcrosshairparams`                     |       1 | `SGlobalCrosshairParams`                     |
| `sglobalelectronparams`                      |       1 | `SGlobalElectronParams`                      |
| `sglobalhealingbeamparams`                   |       1 | `SGlobalHealingBeamParams`                   |
| `sglobalhitbehaviorparams`                   |       1 | `SGlobalHitBehaviorParams`                   |
| `sglobalsalvagerepairbeamparams`             |       1 | `SGlobalSalvageRepairBeamParams`             |
| `sglobaltractorbeamparams`                   |       1 | `SGlobalTractorBeamParams`                   |
| `sloadoutassortment`                         |       1 | `SLoadoutAssortment`                         |
| `soo2_instancetransitionplatform.xml`        |       1 | `MissionLocationTemplate`                    |
| `soo2_intro.xml`                             |       1 | `ContractTemplate`                           |
| `soo2_test.xml`                              |       1 | `SOCInstanceRulesConfig`                     |
| `specialeventdatabase`                       |      32 | `SpecialEventManufacturer`                   |
| `squantumdriveeffecttagstemplate`            |       2 | `SQuantumDriveEffectTemplate`                |
| `sreputationglobalcontextbbparams`           |       1 | `SReputationGlobalContextBBParams`           |
| `ssolarsystem`                               |       3 | `SSolarSystem`                               |
| `starmap`                                    |   2,071 | `StarMapObject`                              |
| `starmapamenitytypes`                        |       1 | `StarMapAmenityTypes`                        |
| `tacticalquery`                              |     273 | `TacticalQuery`                              |
| `tagdatabase`                                |       1 | `TagDatabase`                                |
| `targetselector`                             |       5 | `STargetableItemTypesRecord`                 |
| `tintpalettes`                               |   2,341 | `TintPaletteTree`                            |
| `trackview`                                  |       7 | `CameraTransitionInterpolationCurveRecord`   |
| `transitsystem`                              |     127 | `EntityClassDefinition`                      |
| `transponder`                                |       3 | `EntityClassDefinition`                      |
| `transportsystem`                            |      51 | `EntityClassDefinition`                      |
| `traversalcostconfig`                        |      13 | `TraversalCostConfig`                        |
| `turret`                                     |       3 | `STurretESP`                                 |
| `ui`                                         |   5,823 | `BuildingBlocks_Canvas`                      |
| `unifiedshakeparams`                         |       1 | `SUnifiedShakeParamsRecord`                  |
| `unittest.unittesta.xml`                     |       1 | `UnitTest`                                   |
| `unittest.unittestb.xml`                     |       1 | `UnitTest`                                   |
| `vehicle`                                    |      75 | `VehicleRole`                                |
| `vehiclecombat`                              |       6 | `SVehicleAiDamageModifiers`                  |
| `vehiclesalvageglobalparams`                 |       1 | `VehicleSalvageGlobalParams`                 |
| `vendingmachine_2.xml`                       |       1 | `EntityClassDefinition`                      |
| `vfx`                                        |      16 | `ShieldTypeParams`                           |
| `vibrations`                                 |       4 | `SVibrationDef`                              |
| `videocommschannels`                         |      38 | `CommsChannelDef`                            |
| `voicebundle`                                |      60 | `VoiceBundle`                                |
| `voicechannelsettingsrecord`                 |       4 | `VoiceChannelSettingsRecord`                 |
| `voicesingle`                                |     143 | `VoiceSingle`                                |
| `weaponarmodifiers`                          |       1 | `WeaponARModifier`                           |
| `weaponmisfiredef`                           |       5 | `WeaponMisfireDef`                           |
| `weaponproceduralanimation`                  |      56 | `WeaponProceduralAnimation`                  |
| `weaponproceduralclip`                       |     285 | `WeaponProceduralClip`                       |
| `weaponproceduralrecoil`                     |      90 | `WeaponProceduralRecoilConfigDef`            |
| `zerogtraversalgraph`                        |       1 | `ZeroGTraversalGraph`                        |

## Sources

- Installed `LIVE\build_manifest.id` and `LIVE\Data.p4k`, inventoried locally.
- [unp4k file-format overview](https://github.com/dolkensp/unp4k#file-format-overview).
- [SharpZipLibP4k](https://github.com/diogotr7/SharpZipLibP4k/tree/cig-p4k).
- Rockfall's vendored parser attribution:
  [`tools\game-data-extractor\README.txt`](../../tools/game-data-extractor/README.txt).
