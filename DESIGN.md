---
name: Rockfall
description: A rugged field instrument for Star Citizen mining signatures.
colors:
  background: 'oklch(0.08 0.016 222)'
  surface-low: 'oklch(0.145 0.025 218)'
  surface: 'oklch(0.2 0.035 215)'
  surface-high: 'oklch(0.28 0.047 210)'
  surface-selected: 'oklch(0.28 0.07 190)'
  edge: 'oklch(0.38 0.065 215)'
  edge-strong: 'oklch(0.64 0.12 215)'
  edge-overlay: 'oklch(0.78 0.12 210 / 0.9)'
  ink: 'oklch(0.96 0.025 205)'
  ink-soft: 'oklch(0.86 0.05 210)'
  muted: 'oklch(0.67 0.07 215)'
  accent: 'oklch(0.73 0.16 235)'
  accent-bright: 'oklch(0.91 0.08 210)'
  accent-soft: 'oklch(0.28 0.08 220)'
  success: 'oklch(0.79 0.16 175)'
  warning: 'oklch(0.79 0.15 68)'
  danger: 'oklch(0.68 0.17 25)'
  danger-surface: 'oklch(0.2 0.055 25)'
  danger-ink: 'oklch(0.89 0.04 25)'
  focus: 'oklch(0.86 0.12 210)'
  kbd-bg: 'oklch(0.085 0.012 220)'
  preview-bg: 'oklch(0.075 0.014 220)'
  overlay-bg: 'oklch(0.1 0.025 220)'
  overlay-header: 'oklch(0.19 0.05 215)'
  overlay-cell: 'oklch(0.17 0.04 216)'
typography:
  display:
    fontFamily: 'Bahnschrift, "Segoe UI Variable", "Segoe UI", sans-serif'
    fontSize: '1.214rem'
    fontWeight: 650
    lineHeight: 1.15
    letterSpacing: '-0.01em'
  body:
    fontFamily: 'Bahnschrift, "Segoe UI Variable", "Segoe UI", sans-serif'
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: 'normal'
  label:
    fontFamily: 'Bahnschrift, "Segoe UI Variable", "Segoe UI", sans-serif'
    fontSize: '1rem'
    fontWeight: 400
    lineHeight: 1.2
    letterSpacing: '0.015em'
  signature:
    fontFamily: 'Bahnschrift, "Segoe UI Variable", "Segoe UI", sans-serif'
    fontSize: '1.5rem'
    fontWeight: 650
    lineHeight: 1.15
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

**Creative North Star: "A mobiGlas survey console floating under dim cockpit
light"**

Rockfall adopts the floating shell, cyan edge light, condensed telemetry, and
rounded segmented controls of Star Citizen's mobiGlas while remaining a
purpose-built mining instrument. It feels native beside the game rather than
like a conventional desktop dashboard: dense where comparison matters, quiet
everywhere else, and immediately legible in peripheral vision.

The control app uses responsive feedback and short state transitions without
page choreography. The overlay is more disciplined: motion only confirms
visibility, selection, loading, or a changed value. The system explicitly
rejects the generic business-dashboard styling of Salesforce dashboards.

**Key Characteristics:**

- Split utility bar, twin working frames, and a centered capsule navigation dock
- Layered translucent blue-black modules with curved, illuminated boundaries
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

- **Headline** (650, 17px at default, 1.15): Pane titles and the application
  identity.
- **Title** (600–650, 14–17px at default, 1.2): Materials, control groups, and
  overlay targets.
- **Body** (400, 14px at default, 1.45): Functional supporting copy, capped near 65
  characters where prose appears.
- **Label** (400, 14px minimum, 0.015em): Metadata, filters, methods, and
  shortcuts.
- **Signature** (650, 21px at default, tabular): Base scan values.
- **Cluster Value** (600, 14px minimum, tabular): Multi-rock signatures.

### Named Rules

**The Stable Digits Rule.** Every signature and cluster count uses tabular
numerals. Numeric changes never shift adjacent content.

**The Labels Stay Familiar Rule.** Compact text is allowed; invented
abbreviations and stylized sci-fi glyph alphabets are forbidden.

**The Readable Floor Rule.** No rendered text drops below the saved application
font size. The default is 14px, and the Settings workspace scales the hierarchy
up to 20px while preserving relative emphasis.

## 4. Elevation

The desktop system uses layered translucent shells, inset highlights, and
restrained offset shadows to reproduce the depth of a projected mobiGlas
interface. The game overlay keeps the same illuminated boundaries with a
tighter shadow so it remains readable without becoming a floating card.

### Shadow Vocabulary

- **Text separation** (`0 1px 2px` against Cockpit Black): Overlay text only,
  preserving legibility while the backdrop remains translucent.
- **Focus ring** (two-stage background gap plus Scanner Cyan): Keyboard focus
  and no other state.

### Named Rules

**The Projected-Shell Rule.** Major frames may float; content inside them stays
anchored to aligned rails and bounded modules.

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

- **Style:** A centered capsule dock along the bottom switches between Mining,
  Blueprints, Factions, and Settings. Each workspace uses an icon and familiar
  label; the selected task receives a bright outline and green-cyan underline.
  Overlay visibility stays available in the split utility bar; its preview and
  configuration live in Settings.

### Mining Workspace

- **Structure:** Three persistent columns follow the decision path: Ore,
  Location, and Composition. Selecting an ore updates the ranked locations;
  selecting a location updates its rock presets and composition entries.
- **Behavior:** Ore browsing remains separate from overlay targeting. Search,
  method filters, quality target, favorites, source provenance, probabilities,
  and quantized outcomes remain available without inline table expansion.
  Overlay actions occupy a compact right edge on ore and location rows. The
  expected one to three rock presets use a sticky segmented selector, with one
  preset disclosed at a time. Each composition entry leads with its share range
  and exposes the probability of every reachable quantized quality; internal
  scale and curve parameters stay out of the player-facing surface.
- **Surface:** Three bounded instrument panes sit in visible gutters, with
  numbered headers and progressively quieter cyan-tinted surfaces. Scanner Cyan
  identifies the current selection and overlay state; information density
  increases from left to right as the user's question becomes specific.

### Signature Board

- **Structure:** Instrument header, selected target rows, base signature,
  cluster strip, and source footer.
- **Behavior:** Compact mode removes secondary metadata. Spotlight mode displays
  one selected target while preserving all selections. Each target shows its
  saved favorite mining site when available and otherwise falls back to the
  highest-ranked site. A shaped transparent native drag-handle window tracks
  the visible header; the rest of the overlay remains genuinely click-through.
  Overlay emphasis scales from 80% to 160% without dropping labels below the
  saved application font size. The native overlay and drag target resize from
  measured content so no readout is clipped. Dragged coordinates persist until
  the user selects a named screen corner.
- **Surface:** Content-fit translucent Overlay Field at a 58% default backdrop
  opacity. Header and value cells honor the same control; text stays fully
  opaque. No backdrop blur, panel shadow, or glass treatment.

### Blueprint Workbench

- **Structure:** Search plus an always-visible, wrapping item-category filter
  row and independent collection and access filters above a dense output list,
  paired with a persistent detail pane for requirements and missions.
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

### Faction Directory

- **Structure:** Search and alignment filters sit above a dense faction roster,
  paired with a persistent detail pane containing profile metadata and one
  requirements table per linked reputation track.
- **Behavior:** Opening the workspace extracts or restores an
  archive-fingerprinted local catalog. Arrow keys move through the roster.
  Named standings expose their minimum reputation, drift cadence, perks, and
  gate flag without presenting the user's live reputation as local data.
- **Surface:** Flat split panes reuse the blueprint workbench's row density and
  source states. Rank thresholds use tabular numerals, track tables remain
  horizontally readable at large text sizes, and alignment is always labeled
  rather than communicated by color alone.

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
- **Don't** use colored side-stripe borders, gradient text, or generic frosted
  dashboard cards; translucency must belong to the projected HUD shell.
- **Don't** animate layout properties or add entrance choreography.
