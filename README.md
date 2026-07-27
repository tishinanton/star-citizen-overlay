# Rockfall

Rockfall is a Windows desktop field companion for Star Citizen. It combines a
web-based control console with a transparent, click-through, always-on-top
mining overlay and a blueprint reference workspace.

The first workflow lets a player select up to four mining targets and see:

- each target's base electromagnetic scanner signature;
- cluster signatures from one through eight rocks;
- the mining method reported for the material;
- the five best reported mining sites for a high-quality find;
- each selected target's highest-ranked site directly in the game overlay;
- a compact or full readout that stays out of game input.

Cluster values are deterministic:

```text
cluster signature = base signature × rock count
```

The **Blueprints** tab provides a searchable, item-category-filterable list of
every blueprint reported for the current game-data version. Selecting an output
opens its crafting requirements, quantities, craft time, access state, and the
missions that can unlock it. Collection filters separate blueprints confirmed
as owned from mission-mapped blueprints that remain obtainable.

## Current data sources

Rockfall reads base signatures from the installed Star Citizen `Data.p4k`.
It automatically detects common LIVE/PTU installation paths, or **Game files**
can select a custom archive. A bundled read-only extractor opens
`Data\Game2.dcb` and reads current mineable signatures, crafting blueprints,
output items, resource requirements, reward pools, and mission contracts. It
also resolves names through `Data\Localization\english\global.ini`. The
extractor does not modify game files or interact with the running game.

The community-maintained [Star Citizen Wiki API](https://api.star-citizen.wiki/)
still supplies commodity names and mining-quality distributions. Extracted
results are cached by game-archive version. If local extraction is unavailable,
Rockfall falls back to Wiki, cached, and finally bundled signatures in that
order. Any material can also use a locally persisted manual signature correction.
Corrected values are marked with `*` in the control window and overlay, and can
be reset to the current source value at any time.

The blueprint workspace depends only on installed game files. Derived records
are cached against the selected archive fingerprint for faster subsequent
loads. When an output entity references a packaged loadout icon, Rockfall
extracts its 64×64 DDS asset and converts it to a local PNG preview. This build
exposes 27 distinct icons across 853 blueprint outputs; most ship components do
not ship with a pre-rendered item image, so those outputs retain the standard
equipment glyph.

Blueprint ownership is tracked separately from the static catalog. Rockfall
scans the selected channel's `Game.log` and retained `logbackups\*.log` files
for the canonical `Received Blueprint` notification, then monitors `Game.log`
for new receipts while it runs. Unique name matches are marked owned
automatically and stored per game channel and account. Ambiguous names are
listed for manual review instead of being guessed, and any blueprint can be
marked owned manually from its detail pane. Log history proves recorded
receipts but cannot guarantee that an unmarked blueprint is absent from the
server-side account.

The **Sites** action loads the selected material's detailed deposit data and
ranks up to five distinct locations by the estimated chance of a 50% or higher
quality roll. The estimate combines the reported spawn-group probability,
relative deposit probability, quality distribution, and any boosted area
modifier. Location results are cached separately and identify when cached data
is being shown.

The UEX API is useful for prices, routes, locations, and refinery planning, but
it does not expose scanner signatures.

Complete endpoint inventories:

- [Installed Star Citizen game-data inventory](docs/game-data/README.md)
- [UEX Corp API 2.0](docs/api/uex/README.md)
- [Star Citizen Wiki API](docs/api/star-citizen-wiki/README.md)

## Controls

The control window has dedicated **Mining** and **Blueprints** tabs. Mining
supports material search and mining-method filters, overlay position, opacity,
font size, cluster range, compact mode, visibility, game-data selection, and
data refresh. Each material row also exposes a contextual signature correction
editor; cluster values recalculate from the corrected base immediately. Font
size ranges from 80% to 160%; the native overlay resizes with the readout so
larger text remains fully visible. Changes are persisted in Electron's per-user
application data directory. Selected ores stay pinned above filtered results,
**Sites** opens the ranked mining-location flyout, and **Clear overlay** removes
every target at once.

Blueprint controls keep every item category visible in a wrapping filter row,
alongside independent Collection and Access filters. **Owned** shows default,
log-confirmed, and manually marked blueprints; **Obtainable** shows unowned
mission-mapped blueprints. **Logs** performs a full history rescan. The detail
pane identifies the ownership source and exposes **Mark owned** or **Clear
manual mark** when a manual correction is applicable.

Drag the overlay's cyan header to place it anywhere on screen. The header
captures the mouse for dragging; the remaining overlay area stays click-through.
The custom position is persisted, and selecting a corner in the control app
resets it.

Global shortcuts remain active while Star Citizen has focus:

| Shortcut               | Action                             |
| ---------------------- | ---------------------------------- |
| `Ctrl` + `Shift` + `M` | Show or hide the overlay           |
| `Ctrl` + `Shift` + `N` | Spotlight the next selected target |
| `Ctrl` + `Shift` + `A` | Return to all selected targets     |
| `Ctrl` + `Shift` + `C` | Toggle compact layout              |

Click any binding in **Global controls** and press a replacement key
combination. Function keys can be used alone; regular keys require Ctrl, Alt,
or Shift. The app reports when another program has already claimed a shortcut.

Installed builds check GitHub Releases for updates at startup and every four
hours. New versions download in the background; the control window reports
progress and offers a restart action when installation is ready. A downloaded
update is also installed when the app exits normally.

## Windows behavior

Closing the control window hides Rockfall in the Windows notification area
instead of exiting. Click the tray icon to reopen the console, or choose
**Quit Rockfall** from its context menu to exit. The overlay and global
shortcuts remain active while the console is hidden.

The overlay window is:

- transparent and frameless;
- always on top;
- hidden from the taskbar;
- non-focusable and configured to ignore mouse input;
- placed in a selected corner of the primary display.

Use Star Citizen in **Borderless** or **Windowed** mode. Windows does not
guarantee that desktop overlays can appear over an exclusive-fullscreen DirectX
surface.

## Development

Requirements:

- Windows 10 or later;
- Node.js 22 or later;
- npm 10 or later;
- .NET 8 SDK or later for development and Windows packaging.

Install and start:

```powershell
npm install
npm run dev
```

Quality checks:

```powershell
npm test
npm run typecheck
npm run lint
npm run build:extractor
npm run build
```

Create the Windows NSIS installer:

```powershell
npm run build:win
```

Installer output is written below `dist\`.

Publish a new version and its auto-update metadata to GitHub Releases:

```powershell
npm version patch
git push --follow-tags
$env:GH_TOKEN = (gh auth token)
npm run release:win
```

Use `minor` or `major` instead of `patch` when appropriate. The publish command
uploads the NSIS installer, its blockmap, and `latest.yml`; all three release
assets must remain available for automatic updates.

Local builds are not publisher-signed, so Windows SmartScreen can warn when the
installer is shared. A public release should configure an Authenticode
certificate through electron-builder's standard `CSC_*` environment variables.

## Architecture

Rockfall uses Electron, React, TypeScript, and electron-vite.

- `src\main` owns native windows, tray lifecycle, global shortcuts, settings
  persistence, local game-data extraction, API access, caching, overlay
  placement, and application updates.
- `src\preload` exposes a narrow typed IPC bridge; renderer code has no Node.js
  access.
- `src\renderer` renders both the control console and overlay from the same
  React entry point.
- `src\shared` contains IPC contracts and pure signature calculations.
- `tools\game-data-extractor` contains the bundled, read-only P4K/DataForge
  helper used by Windows builds.

The overlay never reads game files or calls an external API directly. Both
operations run in the Electron main process, where extractor and API response
shapes are validated before values reach the renderer.

## Scope and limitations

- Game resources supply static reference data, not live telemetry from a
  running game.
- Blueprint log monitoring records receipts present on this Windows
  installation; deleted, rotated-away, or other-machine logs cannot reconstruct
  a complete historical account snapshot.
- Signature accuracy follows the selected installed Star Citizen channel.
- Rockfall does not read game memory, inject code, automate input, or interact
  with Star Citizen's process.
