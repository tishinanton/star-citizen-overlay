# Rockfall

Rockfall is a Windows desktop companion for Star Citizen mining. It combines a
web-based control console with a transparent, click-through, always-on-top
overlay.

The first workflow lets a player select up to four mining targets and see:

- each target's base electromagnetic scanner signature;
- cluster signatures from one through eight rocks;
- the mining method reported for the material;
- a compact or full readout that stays out of game input.

Cluster values are deterministic:

```text
cluster signature = base signature × rock count
```

## Current data sources

Rockfall loads live signature values from the community-maintained
[Star Citizen Wiki API](https://api.star-citizen.wiki/). A successful response
is cached locally. If both the API and cache are unavailable, the app clearly
labels and uses a small bundled fallback set so the overlay remains usable.

The UEX API is useful for prices, routes, locations, and refinery planning, but
it does not expose scanner signatures.

Complete endpoint inventories:

- [UEX Corp API 2.0](docs/api/uex/README.md)
- [Star Citizen Wiki API](docs/api/star-citizen-wiki/README.md)

## Controls

The control window supports material search and mining-method filters, overlay
position, opacity, font size, cluster range, compact mode, visibility, and data
refresh. Font size ranges from 80% to 160%; the native overlay resizes with the
readout so larger text remains fully visible. Changes are persisted in
Electron's per-user application data directory. Selected ores stay pinned above
filtered results, and **Clear overlay** removes every target at once.

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

## Windows behavior

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
- npm 10 or later.

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
npm run build
```

Create the Windows NSIS installer:

```powershell
npm run build:win
```

Installer output is written below `dist\`.

Local builds are not publisher-signed, so Windows SmartScreen can warn when the
installer is shared. A public release should configure an Authenticode
certificate through electron-builder's standard `CSC_*` environment variables.

## Architecture

Rockfall uses Electron, React, TypeScript, and electron-vite.

- `src\main` owns native windows, global shortcuts, settings persistence, API
  access, caching, and overlay placement.
- `src\preload` exposes a narrow typed IPC bridge; renderer code has no Node.js
  access.
- `src\renderer` renders both the control console and overlay from the same
  React entry point.
- `src\shared` contains IPC contracts and pure signature calculations.

The overlay never calls an external API directly. Requests run in the Electron
main process, where response shape and signature values are validated before
they reach the renderer.

## Scope and limitations

- The API supplies reference data, not live telemetry from a running game.
- Signature accuracy follows the currently selected Star Citizen Wiki
  game-data version.
- Rockfall does not read game memory, inject code, automate input, or interact
  with Star Citizen's process.
