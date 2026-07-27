---
name: Rockfall
description: A rugged field instrument for Star Citizen mining signatures.
colors:
  background: 'oklch(0.105 0.012 220)'
  surface-low: 'oklch(0.14 0.016 220)'
  surface: 'oklch(0.18 0.02 220)'
  surface-high: 'oklch(0.23 0.028 215)'
  surface-selected: 'oklch(0.25 0.065 210)'
  edge: 'oklch(0.34 0.036 215)'
  edge-strong: 'oklch(0.48 0.07 210)'
  edge-overlay: 'oklch(0.68 0.105 202 / 0.78)'
  ink: 'oklch(0.95 0.018 205)'
  ink-soft: 'oklch(0.82 0.04 205)'
  muted: 'oklch(0.68 0.045 215)'
  accent: 'oklch(0.76 0.13 205)'
  accent-bright: 'oklch(0.87 0.11 195)'
  accent-soft: 'oklch(0.29 0.075 215)'
  success: 'oklch(0.78 0.13 195)'
  warning: 'oklch(0.79 0.15 68)'
  danger: 'oklch(0.68 0.17 25)'
  danger-surface: 'oklch(0.2 0.055 25)'
  danger-ink: 'oklch(0.89 0.04 25)'
  focus: 'oklch(0.86 0.12 195)'
  kbd-bg: 'oklch(0.09 0.01 220)'
  preview-bg: 'oklch(0.075 0.012 220)'
  overlay-bg: 'oklch(0.105 0.018 220)'
  overlay-header: 'oklch(0.16 0.03 215)'
  overlay-cell: 'oklch(0.14 0.025 215)'
typography:
  display:
    fontFamily: 'Bahnschrift, "Segoe UI Variable", "Segoe UI", sans-serif'
    fontSize: '17px'
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: '-0.01em'
  body:
    fontFamily: 'Bahnschrift, "Segoe UI Variable", "Segoe UI", sans-serif'
    fontSize: '12px'
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 'normal'
  label:
    fontFamily: 'Bahnschrift, "Segoe UI Variable", "Segoe UI", sans-serif'
    fontSize: '10px'
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: '0.015em'
rounded:
  hairline: '1px'
  xs: '2px'
  sm: '3px'
  md: '6px'
spacing:
  xs: '4px'
  sm: '8px'
  md: '12px'
  lg: '16px'
  xl: '24px'
components:
  button-primary:
    backgroundColor: '{colors.accent}'
    textColor: '{colors.background}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
    padding: '8px 12px'
  button-secondary:
    backgroundColor: '{colors.surface}'
    textColor: '{colors.ink-soft}'
    typography: '{typography.label}'
    rounded: '{rounded.sm}'
    padding: '8px 12px'
  overlay-panel:
    backgroundColor: '{colors.background}'
    textColor: '{colors.ink}'
    rounded: '{rounded.md}'
    padding: '12px'
---

# Design System: Rockfall

## 1. Overview

**Creative North Star: "A repair-bay instrument panel under dim cockpit
light"**

Rockfall combines the compressed, task-specific clarity of Star Citizen ship
MFDs with the operational confidence of NASA mission control and the tactile
directness of an Elgato Stream Deck. It feels like equipment issued for a job:
dense where comparison matters, quiet everywhere else, and immediately legible
in peripheral vision.

The control app uses responsive feedback and short state transitions without
page choreography. The overlay is more disciplined: motion only confirms
visibility, selection, loading, or a changed value. The system explicitly
rejects the generic business-dashboard styling of Salesforce dashboards.

**Key Characteristics:**

- Compact, instrument-like information hierarchy
- Strong alignment and tabular numeric rhythm
- Blue-black instrument surfaces with scanner-cyan signal color
- Familiar controls with immediate keyboard and pointer feedback

## 2. Colors

Blue-black neutrals form the working equipment. Scanner cyan carries the
Star Citizen-inspired HUD language without reproducing the game's interface.

### Primary

- **Scanner Cyan** (`oklch(0.76 0.13 205)`): Active selections, range thumbs,
  and consequential overlay state.
- **Bright Scan Cyan** (`oklch(0.87 0.11 195)`): Signature emphasis and
  high-priority icon ink on dark surfaces.
- **Deep HUD Cyan** (`oklch(0.29 0.075 215)`): Selected-control fills that
  support light text.

### Secondary

- **Telemetry Cyan** (`oklch(0.78 0.13 195)`): Registered shortcuts and
  live-data state only.
- **Alert Amber** (`oklch(0.79 0.15 68)`): Cached or bundled-data state only.
- **Conflict Red** (`oklch(0.68 0.17 25)`): Errors and shortcut conflicts only.

### Neutral

- **Cockpit Black** (`oklch(0.105 0.012 220)`): Application canvas.
- **Blue-Black Low** (`oklch(0.14 0.016 220)`): Toolbars, search fields, and
  secondary regions.
- **Blue-Black Surface** (`oklch(0.18 0.02 220)`): Controls and content planes.
- **Raised Blue-Black** (`oklch(0.23 0.028 215)`): Hover and active-neutral
  states.
- **Machined Edge** (`oklch(0.34 0.036 215)`): One-pixel boundaries and
  dividers.
- **Instrument Ink** (`oklch(0.95 0.018 205)`): Primary labels and values.
- **Soft Ink** (`oklch(0.82 0.04 205)`): Secondary labels.
- **Muted Ink** (`oklch(0.68 0.045 215)`): Metadata and helper text.
- **Overlay Field** (`oklch(0.105 0.018 220)`): Translucent HUD backdrop.
- **Overlay Header** (`oklch(0.16 0.03 215)`): Translucent HUD title strip.
- **Overlay Cell** (`oklch(0.14 0.025 215)`): Translucent cluster-value cells.

### Named Rules

**The Signal Rule.** Scanner Cyan marks active data and focus. It never becomes
an ambient page wash.

**The State Colors Are Literal Rule.** Cyan means live or registered, amber
means cached or fallback, and red means failure. They never decorate.

**The Cockpit Contrast Rule.** Overlay data must remain distinct over dark game
scenes and bright planetary surfaces.

## 3. Typography

- **Display Font:** Bahnschrift (with Segoe UI Variable and Segoe UI fallback)
- **Body Font:** Bahnschrift (with Segoe UI Variable and Segoe UI fallback)
- **Label/Mono Font:** Bahnschrift with tabular numerals

**Character:** One technical Windows-native sans keeps the tool coherent and
fast. Compact labels feel engineered without turning the interface into a
terminal.

### Hierarchy

- **Headline** (650, 17px, 1.15): Pane titles and the application identity.
- **Title** (600–650, 12–14px, 1.2): Materials, control groups, and overlay
  targets.
- **Body** (400, 12px, 1.45): Functional supporting copy, capped near 65
  characters where prose appears.
- **Label** (400, 9–10px, 0.015em): Metadata, filters, methods, and shortcuts.
- **Signature** (650, 21px, tabular): Base scan values.
- **Cluster Value** (600, 13px, tabular): Multi-rock signatures.

### Named Rules

**The Stable Digits Rule.** Every signature and cluster count uses tabular
numerals. Numeric changes never shift adjacent content.

**The Labels Stay Familiar Rule.** Compact text is allowed; invented
abbreviations and stylized sci-fi glyph alphabets are forbidden.

## 4. Elevation

The system is flat. Depth comes from tonal surfaces, translucent layer
differences, crisp one-pixel boundaries, and temporary focus treatment. The
game overlay uses no outer shadow so it obscures as little of the game as
possible.

### Shadow Vocabulary

- **Text separation** (`0 1px 2px` against Cockpit Black): Overlay text only,
  preserving legibility while the backdrop remains translucent.
- **Focus ring** (two-stage background gap plus Scanner Cyan): Keyboard focus
  and no other state.

### Named Rules

**The Bolted-Down Rule.** Resting app controls do not float. If an ordinary
panel appears to hover, the elevation is wrong.

## 5. Components

Components use standard interaction models and an industrial visual cadence.
Every control defines hover, focus, active, disabled, loading, and error states
where those states apply.

### Buttons

- **Shape:** Tight machined corners (3px radius).
- **Primary:** Scanner Cyan with Cockpit Black, compact 8px × 12px padding.
- **Secondary:** Blue-Black Surface with Soft Ink and a one-pixel Machined Edge.
- **Hover / Focus:** One tonal step brighter on hover; the shared two-stage
  focus ring on keyboard focus.
- **Disabled:** Reduced opacity with the pointer affordance removed.

### Chips

- **Style:** Compact blue-black segmented controls with no free-floating pills.
- **State:** The selected segment uses Raised Blue-Black and Instrument Ink;
  inactive segments remain transparent with Muted Ink.

### Cards / Containers

- **Corner Style:** 6px for grouped instruments; 3px for controls.
- **Background:** Blue-Black Low or Blue-Black Surface according to hierarchy.
- **Shadow Strategy:** Flat throughout; overlay text gets a small legibility
  shadow, not the panel.
- **Border:** Full one-pixel Machined Edge. Colored side stripes are forbidden.
- **Internal Padding:** 12–16px for control groups and 8–12px for data rows.

### Inputs / Fields

- **Style:** Dark blue-black fill, one-pixel edge, 3px corners, and explicit text
  labels.
- **Focus:** Scanner Cyan border and low-chroma focus halo.
- **Error / Disabled:** Conflict Red is reserved for a real error; disabled
  controls reduce opacity without losing their label.
- **Shortcut Capture:** A binding becomes a focused cyan capture field. Global
  hooks are temporarily released until a valid replacement is recorded or the
  user presses Escape.

### Navigation

- **Style:** A compact tab rail beneath the persistent header switches between
  Mining and Blueprints. The active task uses a two-pixel Scanner Cyan
  indicator; inactive tasks remain neutral. Overlay controls stay available in
  the header across both workspaces.

### Signature Board

- **Structure:** Instrument header, one to four target rows, base signature,
  cluster strip, and source footer.
- **Behavior:** Compact mode removes secondary metadata. Spotlight mode displays
  one selected target while preserving all selections. A shaped transparent
  native drag-handle window tracks the visible header; the rest of the overlay
  remains genuinely click-through. Text scales from 80% to 160%, with the native
  overlay and drag target resized from measured content so no readout is clipped.
  Dragged coordinates persist until the user selects a named screen corner.
- **Surface:** Content-fit translucent Overlay Field at a 58% default backdrop
  opacity. Header and value cells honor the same control; text stays fully
  opaque. No backdrop blur, panel shadow, or glass treatment.

### Blueprint Workbench

- **Structure:** Search plus independent collection and access filters above a
  dense output list, paired with a persistent detail pane for requirements and
  missions.
- **Behavior:** Opening the workspace extracts or restores an archive-fingerprinted
  local catalog. Selection reads detail from that catalog without a network
  request. Catalog and detail identify installed versus cached game data.
  Default and uniquely matched local log receipts are marked owned
  automatically; ambiguous receipts remain explicit for manual review. The
  detail header contains the reversible manual ownership action and identifies
  default, log, or manual provenance.
- **Surface:** Flat split panes with aligned table rows, full one-pixel
  boundaries, tabular quantities, and no ornamental blueprint cards. A packaged
  64×64 loadout icon appears when the output entity provides one; the equipment
  glyph remains the explicit fallback.

## 6. Do's and Don'ts

### Do:

- **Do** make base and cluster signatures scannable as one aligned numeric
  sequence.
- **Do** use short 150ms state transitions with exponential ease-out.
- **Do** preserve clear silhouettes and contrast over variable game imagery.
- **Do** keep native input behavior and recognizable keyboard focus.
- **Do** use full one-pixel borders when a region needs a boundary.

### Don't:

- **Don't** use generic business-dashboard styling, ornamental KPI cards, or
  office analytics conventions.
- **Don't** resemble Salesforce dashboards.
- **Don't** reproduce decorative Star Citizen HUD noise at the expense of
  legibility.
- **Don't** drift back to magenta, purple, or mineral-rose accents; the product
  uses scanner cyan and alert amber.
- **Don't** use colored side-stripe borders, gradient text, glassmorphism, or
  nested cards.
- **Don't** animate layout properties or add entrance choreography.
