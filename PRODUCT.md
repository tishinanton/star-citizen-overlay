# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Star Citizen players using Windows who mine, plan crafting, manage blueprint
ownership, or compare faction progression. They need to identify promising
rocks quickly, inspect crafting and unlock requirements, and compare reputation
thresholds without switching among several disconnected tools.

## Product Purpose

Rockfall is a lightweight desktop field console with a click-through,
always-on-top in-game overlay. It unifies mining signatures and site
intelligence, blueprint requirements and ownership, faction reputation data,
global controls, and optional remote access.

Success means the relevant rock, signature, composition, crafting path,
ownership state, or reputation requirement can be recognized at a glance,
configured without friction, and consulted without interfering with game
input.

## Positioning

Rockfall turns the player's installed Star Citizen data into an explicit field
console and click-through overlay. It keeps the origin of every result visible,
prefers authoritative local records, and labels cached, Wiki-enriched, or
fallback data instead of presenting mixed sources as equally certain.

## Operating Context

- The Windows desktop control surface is used beside Star Citizen; the overlay
  remains always on top and normally click-through.
- Local `Data.p4k` records supply mining, blueprint, faction, and related static
  game data. Local game logs supply blueprint receipt and account evidence.
- Global keyboard shortcuts control overlay visibility, selection, placement,
  compact mode, and spotlight behavior without requiring game focus to move.
- Optional Rockfall Cloud sync preserves account-scoped blueprint ownership.
- Optional LAN control lets a paired local device operate the overlay without
  making remote control a requirement for the desktop product.
- Cached data keeps useful workflows available when extraction or network
  enrichment is unavailable.

## Capabilities and Constraints

- Mining covers material signatures, multi-rock cluster signatures, ranked
  sites, spawn probabilities, quality targets, rock presets, and ordered
  composition entries.
- Blueprint workflows cover outputs, ingredients, categories, unlock missions,
  default availability, and ownership derived from local logs or explicit
  manual marks.
- Faction workflows expose shipped reputation tracks, standings, thresholds,
  drift, perks, and gates; Rockfall does not claim to read the player's live
  reputation.
- Installed game data is static client data. Rockfall does not read game
  memory, inject code, automate input, or expose server-only state.
- Source provenance, loading failures, incomplete joins, and fallback states
  must remain explicit. Missing game relationships are not fabricated.
- Overlay interaction must preserve game focus and input under normal use.
- Configuration is explicit, reversible, and durable across restarts.

## Brand Commitments

The product name is **Rockfall**. Its voice is direct, technical, and
plainspoken. It should feel like dependable field equipment: industrial,
rugged, legible, and purpose-built rather than decorative or administrative.

## Evidence on Hand

- `docs/game-data/README.md` documents the installed archive extraction path,
  supported DataForge records, validation snapshots, and known local-data
  limits.
- `README.md` documents the shipped mining, blueprint, faction, overlay, cloud,
  LAN, shortcut, and update workflows.
- The repository includes deterministic extractor fixtures and automated tests
  for static data, provenance, caching, ownership, overlay commands, and
  location scoring.
- Released Windows installers and updater metadata are published through the
  repository's GitHub releases.
- No customer testimonials, usage benchmarks, press claims, or commercial
  adoption evidence are currently on hand; future surfaces must not fabricate
  them.

## Product Principles

1. Prefer authoritative installed data and identify every fallback.
2. Preserve game focus while keeping field information immediately available.
3. Expose consequential state and uncertainty instead of hiding or guessing.
4. Keep mining, crafting, ownership, and faction workflows coherent as one
   product.
5. Make local-first operation complete; cloud and LAN features remain optional.

## Accessibility & Inclusion

Maintain readable contrast, keyboard-operable controls, clear non-color state
cues, scalable application and overlay text, and reduced-motion behavior where
motion is used.
