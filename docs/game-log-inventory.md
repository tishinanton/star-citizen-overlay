# Star Citizen game-log inventory

This document describes the information observed in a local Star Citizen LIVE
channel's `Game.log` and retained `logbackups\*.log` files. It distinguishes
between data present in the raw logs and the much smaller subset that Rockfall
currently parses.

## Inventory snapshot

The counts below are a point-in-time sample from one Windows LIVE installation.
No raw log files or player-specific values are included in this repository.

| Property | Value |
| --- | ---: |
| Snapshot date | August 1, 2026 |
| Active log files | 1 |
| Retained backup logs | 58 |
| Total files | 59 |
| Total size | 105.59 MiB |
| Total lines | 509,421 |
| Timestamped lines | 500,725 |
| Lines without a leading timestamp | 8,696 |
| Earliest timestamp | `2026-06-30T16:08:41.332Z` |
| Latest timestamp | `2026-08-01T11:36:53.228Z` |
| Distinct angle-bracket event labels | 356 |
| `[Notice]` records | 254,998 |
| `[Error]` records | 87,634 |

The archive spans multiple game sessions and client builds. The active log at
the time of the snapshot reported the `sc-alpha-4.9.0` branch and client version
`4.9.188.23497`.

## File and record formats

Star Citizen writes the active channel log to `Game.log` and moves older logs
into `logbackups` as `.log` files. Observed records use several shapes:

```text
<timestamp> [Notice] <EventName> message [Team][Subsystem]
<timestamp> [Error] <EventName> message [Team][Subsystem]
<timestamp> [Component] message
<timestamp> plain startup or runtime message
continuation line
```

`Notice` and `Error` are the only top-level structured severities observed in
this snapshot. Component prefixes such as `Trace`, `CVARS`, `STAMINA`, `VK`,
`PSOCacheGen`, and `CIG` are diagnostic channels rather than severities.

An event label is not a stable public API. Labels, payloads, teams, and
subsystems can change between game patches.

## Information families observed

The 356 concrete event labels group into the following information families.

| Family | Information visible in the raw logs |
| --- | --- |
| Startup, build, and configuration | Executable and install paths, branch, build and file versions, changelist, build date, environment, startup arguments, `user.cfg` legacy arguments, CVars, and initialization state |
| System and hardware | Windows version, CPU model and count, physical memory, process memory, system uptime, display resolution, keyboard and mouse details |
| Graphics, VFX, audio, and haptics | GPU adapters and memory, drivers, Vulkan layers and API version, shader and PSO caches, renderer state, particle limits, VFX, Wwise audio, and haptic initialization |
| Account, login, and identity | Authentication flow, numeric account ID, character handle, character state, token refresh, login queues, and login completion |
| Sessions and matchmaking | Local and environment session identifiers, shard identifiers and state, PU joins, lobby and squad state, invitations, matchmaking, and player join or leave events |
| Network and backend services | Service endpoints, gRPC channels, sockets, gateways, connection and disconnection flow, routing, replication, WebRTC, push services, and backend failures |
| Security and anti-cheat | Easy Anti-Cheat login and status, discipline-service sessions, authentication expiry, and security diagnostics |
| World, entities, and persistence | Entity creation and removal, object loading, entity streaming, context establishment, replication, persistence, shard seeding, solar-system registration, zones, rooms, and instancing |
| Player and actor state | Actor placement and physics, stamina, depressurization, suffocation, death state, corpse item recovery, and zone transitions |
| Ships and vehicles | Vehicle lists and spawning, loadouts, ASOP requests, entitlements, insurance, storage, landing gear, docking tubes, freight platforms, and fatal-collision details |
| Navigation and travel | Starmap route calculation, selected quantum targets, quantum fuel requests, quantum arrival, docking, landing areas, ATC, transit, and solar-system hierarchy |
| Inventory, items, and equipment | Inventory queries, locations and containers, item moves, quick equip, attachments, item ports, loadouts, external inventories, and item recovery |
| Cargo and freight | Cargo grids, freight elevators, warehouses, commodity containers, autoloading, cargo box sizes, and quantities |
| Shops and economy | Shop and kiosk identifiers, shop locations, item or resource identifiers, item names, buy and sell requests, quantities, client prices, per-unit prices, and transaction modes |
| Missions and objectives | Mission and objective identifiers, active-objective updates, display text, markers, mission sharing, participant changes, completion type, completion reason, and mission notifications |
| Notifications and communications | HUD notifications, comms notifications, audio comms, social subscriptions, friends, parties, chat lobbies, presence, and RTC state |
| Combat, weapons, and physics | Weapon and ammunition state, detection, actor physics, collisions, vehicle collision positions and velocities, and combat-related notifications |
| Harvestables and mining | Harvestable slot-host and metadata initialization plus mining-related notification text; no reliable live scanner reading stream was observed |
| Salvage, repair, and refuelling | Salvage and repair ammunition state, salvage mission objectives, repair diagnostics, fuel tanks, and refuelling activity |
| Blueprints | Blueprint-service channel activity and canonical `Received Blueprint` notifications containing a blueprint name and timestamp |
| AI, animation, and environment | Subsumption, AI diagnostics, Mannequin animation, room systems, physics, terrain, zones, weather-related surfaces, and environment state |
| UI and input | Building Blocks and HUD activity, inventory and shop UI state, action handlers, frontend configuration, input state, and error popups |
| Telemetry and diagnostics | Trace and analytics services, performance metrics, loading diagnostics, validation failures, timeouts, assertions, and other engine errors |

## What Rockfall currently parses

Rockfall deliberately consumes only two authoritative record types:

1. `AccountLoginCharacterStatus_Character` identifies the current profile by
   numeric account ID and character handle.
2. `SHUDEvent_OnNotification` is accepted only when its payload is the canonical
   `Added notification "Received Blueprint: ..."` receipt.

The parser extracts or derives:

- account ID and character handle;
- blueprint display name and normalized name;
- acquisition timestamp;
- first and last observed timestamps for duplicate receipts;
- active identity and account-scoped receipt profiles;
- scanned and skipped file counts;
- assigned and unassigned receipt counts;
- earliest and latest timestamps present in scanned files; and
- unresolved receipt names when a log name cannot be matched uniquely to the
  extracted blueprint catalog.

The snapshot contained 86 identity records for one account profile and 50
authoritative blueprint receipts. Those receipts represented 48 distinct
blueprint names, including two duplicate observations, with no unassigned
receipts.

`src\main\blueprint-log.ts` owns record parsing, historical scans, deduplication,
and live-file monitoring. `src\main\blueprint-ownership.ts` matches parsed
receipts to the local catalog and exposes ownership status to the application.
All other raw event families are currently ignored by Rockfall.

## Important limitations

- The logs represent what this local client observed, not authoritative
  server-side account state.
- Deleted, expired, rotated-away, or other-machine logs leave gaps in history.
- A missing event does not prove that an account action or game state never
  occurred.
- Many records are internal diagnostics, repeated errors, or implementation
  details rather than reliable gameplay events.
- No crafting event was observed in this snapshot.
- Mining-related records exposed harvestable internals and notification text,
  not dependable live scanner signatures, composition, mass, resistance,
  fracture progress, or other mining telemetry.
- Event names and payload formats can change without notice in any game patch.

## Privacy and handling

Raw logs can contain account and character identifiers, session and shard IDs,
service endpoints, machine specifications, installation paths, player and
mission identifiers, ship and item identifiers, locations, coordinates,
transaction quantities, and prices.

Do not commit or publish raw logs. Diagnostics derived from them should remove
or aggregate identifying values, local paths, session tokens, endpoints, and
gameplay transaction details.
