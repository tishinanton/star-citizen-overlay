# Crafting blueprint and quality research

This report records the crafting and blueprint findings from a focused
investigation of the installed Star Citizen client data. It is intentionally
separate from implementation work: several experimental UI and extractor
changes were used to inspect the data, but those changes are not required to
merge with this document.

## Scope and provenance

The primary evidence came from the local Windows LIVE installation:

| Property                           | Value            |
| ---------------------------------- | ---------------- |
| Branch                             | `sc-alpha-4.9.0` |
| Version                            | `4.9.188.23497`  |
| Requested P4 changelist            | `12344265`       |
| Client build                       | `12344265`       |
| `Data.p4k` bytes                   | `161492045824`   |
| DataForge records scanned          | `61526`          |
| Blueprint catalog outputs retained | `1591`           |

The running game log and `build_manifest.id` reported the same build as the
archive. The installation had no loose `Game2.dcb`, blueprint, crafting, or
hotfix record overriding `Data.p4k`. The only loose game data was localization.

The investigation used:

1. `Data.p4k` central-directory inspection;
2. extraction of `Data/Game2.dcb`;
3. complete DataForge record scans and GUID reverse-reference scans;
4. English localization;
5. selected archive assets and referenced records;
6. printable strings and type/function names embedded in
   `Bin64/StarCitizen.exe`;
7. the running client's `Game.log`; and
8. direct comparison with the in-game crafting interface.

Static client data was inspected only. No process memory, input automation,
injection, or account credentials were used.

## Executive summary

- The archive has rich, structured crafting data: outputs, ingredients, slot
  names, minimum quality, quality distributions, quality quantization, declared
  gameplay-property modifiers, default ownership, reward pools, and mission
  links.
- Output entity records provide useful item characteristics including
  description, manufacturer, size, subtype, mass, integrity, ammunition,
  projectile damage and speed, shields, armor resistance, temperature limits,
  quantum fuel use, mining beam values, signatures, power, and heat fields.
- The blueprint's
  `CraftingCostContext_ResultGameplayPropertyModifiers` node is the only
  DataForge relationship assigning a crafted gameplay property to a recipe
  slot.
- `CraftingGameplayPropertyDef` contains display metadata, units, display
  transforms, and conditional names. It does **not** contain a path to the
  runtime item component or field.
- A full reverse-reference scan found no second DataForge resolver joining a
  blueprint, material, output item, and gameplay property.
- The executable contains a hard-coded set of gameplay-property record names
  and runtime structures such as `SGameplayPropertyModifierStorage` and
  `SCraftedItemPersistentData`. The property GUIDs themselves are not embedded
  as strings in the executable.
- The executable explicitly reports that duplicate crafting data properties for
  a resource use only the first occurrence. The surrounding validation strings
  concern resource quality data; this does not by itself prove how duplicate
  recipe-slot GPP declarations are combined.
- Archive declarations do not always match observable crafting behavior.
  Specifically, M7A and Lightstrike I ship-gun blueprints declare Damage
  modifiers that did not change the crafted result in live tests. The same
  Damage property does change Impact Force for the Demeco FPS weapon.
- Therefore Rockfall can safely expose **declared archive modifiers**, but
  should not describe every declaration as a confirmed runtime enhancement
  without either broader validation or an authoritative runtime resolver.

## Blueprint record structure

Creation blueprints follow this path:

```text
CraftingBlueprintRecord
  blueprint/CraftingBlueprint
    processSpecificData/CraftingProcess_Creation@entityClass
    tiers/CraftingBlueprintTier
      recipe/CraftingRecipe
        costs/CraftingRecipeCosts
          craftTime
          mandatoryCost
            CraftingCost_Select
              nameInfo
              options
                CraftingCost_Select
                  context
                  nameInfo
                  options
                    CraftingCost_Resource
                    CraftingCost_Item
```

The root selection typically represents all required aspects. Each nested
selection names one slot such as Frame, Emitter, Barrel, Lenses, Wiring, or
Insulative Liner. A leaf provides either a `ResourceType` reference or an output
entity-class reference, its quantity, and `minQuality`.

The investigated build contained approximately 1,598 blueprint records. The
typed scan found 1,597 `CraftingBlueprint` elements; after unresolved or removed
output records were rejected, the usable creation catalog contained 1,591
outputs.

## Blueprint catalog coverage

The complete 1,591-output extraction produced:

| Field availability                            |         Outputs |
| --------------------------------------------- | --------------: |
| Localized descriptions                        |           1,586 |
| Manufacturer                                  |           1,555 |
| Mass                                          |           1,591 |
| Integrity/health                              |             462 |
| At least one category-specific characteristic |           1,340 |
| Loadout icons packaged and decoded            | 27 unique icons |

The remaining outputs still retain identity, type, grade, recipe, and access
data even when a category-specific stat cannot be resolved.

## Output entity characteristics

Blueprint output IDs resolve to `EntityClassDefinition` records. Common joins
used during the investigation were:

| Information                           | Main record/component                                 |
| ------------------------------------- | ----------------------------------------------------- |
| Name, type, size, grade, manufacturer | `AttachDef`, `SCItemPurchasableParams`                |
| Description and icon                  | `Localization`, `EntityUIDisplayParams`               |
| Mass                                  | `SEntityRigidPhysicsControllerParams`                 |
| Integrity                             | `SHealthComponentParams`                              |
| Projectile damage and speed           | `SAmmoContainerComponentParams` → `AmmoParams`        |
| Fire mode and rate                    | `SCItemWeaponComponentParams` fire actions            |
| Energy-weapon regeneration            | `SWeaponRegenConsumerParams`                          |
| Shield capacity and regeneration      | `SCItemShieldGeneratorParams`                         |
| Quantum fuel requirement              | `SCItemQuantumDriveParams`                            |
| Armor mitigation                      | `SCItemSuitArmorParams` → damage-resistance macro     |
| Temperature limits                    | `TemperatureResistance`                               |
| Mining beam values                    | `SWeaponActionFireBeamParams`, mining components      |
| Signatures                            | signature system params, `IRSignature`, `EMSignature` |
| Power/coolant                         | `ItemResourceComponentParams` state deltas            |

These are base item values. A crafted instance can carry additional persistent
modifier storage at runtime.

## Quality inputs

### Global defaults

`CraftingGlobalParams.CraftingGlobalParams` declares:

| Field                           | Value |
| ------------------------------- | ----: |
| `defaultCompositionQuality`     |   500 |
| `refiningQualityUnitMultiplier` |     2 |

### Minimum-quality declarations

Across 4,261 parsed requirement options:

| `minQuality` | Occurrences |
| -----------: | ----------: |
|            0 |       2,873 |
|            1 |       1,374 |
|          500 |           9 |
|          600 |           1 |
|          700 |           1 |
|          800 |           2 |
|          900 |           1 |

### Resource quality

`ResourceTypeCraftingData` can reference:

- `CraftingQualityDistributionRecord`;
- `CraftingQualityLocationOverrideRecord`; and
- `CraftingQualityQuantizationRecord`.

These records determine the quality supplied by a material. They do not select
which output property a recipe modifies.

Example FPS-mineable distribution:

```text
min=201, max=1000, mean=201, stddev=298
```

Hadanite and Dolivine use distinct quantization tables even though they share
that distribution:

| Raw band | Hadanite mapped Q | Dolivine mapped Q |
| -------- | ----------------: | ----------------: |
| 0–399    |               274 |               304 |
| 400–599  |               526 |               577 |
| 600–699  |               665 |               621 |
| 700–799  |               762 |               743 |
| 800–899  |               867 |               886 |
| 900–949  |               916 |               901 |
| 950–998  |               959 |               957 |
| 999–1000 |              1000 |              1000 |

## Declared gameplay-property modifiers

A recipe slot declares effects through:

```xml
<CraftingCostContext_ResultGameplayPropertyModifiers>
  <gameplayPropertyModifiers>
    <CraftingGameplayPropertyModifiers_List>
      <gameplayPropertyModifiers>
        <CraftingGameplayPropertyModifierCommon
          gameplayPropertyRecord="...">
          <valueRanges>
            <CraftingGameplayPropertyModifierValueRange_Linear
              startQuality="0"
              endQuality="1000"
              modifierAtStart="0.95"
              modifierAtEnd="1.05" />
          </valueRanges>
        </CraftingGameplayPropertyModifierCommon>
      </gameplayPropertyModifiers>
    </CraftingGameplayPropertyModifiers_List>
  </gameplayPropertyModifiers>
</CraftingCostContext_ResultGameplayPropertyModifiers>
```

The scan found modifier contexts on 1,540 of 1,597 blueprint elements, covering
3,699 named slots and 6,524 quality ranges.

The dominant declared property applications were:

| Property                          | Modifier ranges |
| --------------------------------- | --------------: |
| Armor maximum temperature         |             896 |
| Armor minimum temperature         |             896 |
| Armor damage mitigation           |             868 |
| Integrity                         |             799 |
| Power generation                  |             598 |
| Weapon damage                     |             473 |
| Coolant generation                |             300 |
| Shield maximum health             |             248 |
| Recoil smoothness                 |             245 |
| Recoil handling                   |             245 |
| Recoil kick                       |             245 |
| Weapon fire rate                  |             133 |
| Radar minimum aim-assist distance |             120 |
| Radar maximum aim-assist distance |             120 |
| Quantum speed                     |             114 |
| Quantum fuel requirement          |             114 |
| Tractor full-strength distance    |              24 |
| Tractor maximum distance          |              24 |
| Hull-scraping radius              |              15 |
| Hull-scraping speed               |              15 |
| Tractor force                     |              12 |
| Tractor maximum volume            |              12 |
| Hull-scraping efficiency          |               5 |
| Armor radiation dissipation       |               3 |

Most multiplier curves cross the unmodified factor `1.0` near quality 500.
`LinearIntegerAdditive` ranges are also present, notably for power-generation
pips.

## Gameplay-property definitions

Each modifier points to a `CraftingGameplayPropertyDef`. These records provide:

- localization key for the stat name;
- unit format;
- optional display transformations; and
- optional name overrides conditioned by item type/subtype.

They do not provide a runtime field path.

For example, `GPP_Weapon_Damage` is:

```xml
<CraftingGameplayPropertyDef.GPP_Weapon_Damage
  propertyName="@StatName_GPP_Weapon_Damage"
  unitFormat="@StatUnits_Percent"
  __ref="cfc129ce-488a-46f2-92f7-9272cd0cfdfb"
  __path="libs/foundry/records/crafting/craftedproperties/gpp_weapon_damage.xml"
  __team="CGP2">
  <nameOverrides>
    <CraftingPropertyNameOverride
      propertyName="@StatName_GPP_Weapon_Damage_Override_Laser">
      <condition>
        <CraftingPropertyNameOverrideCondition_ItemType>
          <matchItemTypes>
            <Enum value="WeaponMining" />
          </matchItemTypes>
        </CraftingPropertyNameOverrideCondition_ItemType>
      </condition>
    </CraftingPropertyNameOverride>
  </nameOverrides>
</CraftingGameplayPropertyDef.GPP_Weapon_Damage>
```

English localization resolves the generic name to **Impact Force** and the
`WeaponMining` override to **Laser Power**.

## GUID-only reverse-reference result

The GUID `cfc129ce-488a-46f2-92f7-9272cd0cfdfb` was scanned without using the
record name:

| Result                                | Count |
| ------------------------------------- | ----: |
| DataForge records containing the GUID |   288 |
| Exact GUID-valued attributes          |   466 |
| Blueprint records                     |   287 |
| Non-blueprint records                 |     1 |

The only non-blueprint occurrence is the definition's own `__ref`:

```text
libs/foundry/records/crafting/craftedproperties/gpp_weapon_damage.xml
```

No item entity, ammunition record, material/resource record, UI record, or
other DataForge system points to this GUID.

The executable contains the stable record name
`CraftingGameplayPropertyDef.GPP_Weapon_Damage`, but not the GUID string. No
archive entry filename contains the GUID. Direct scans of the raw DCB found no
ASCII or direct 16-byte GUID representation because DataForge stores references
through its indexed tables.

## Executable/runtime evidence

Printable type, function, field, validation, and binding strings in the exact
matching game executable revealed:

- `Crafting::SGameplayPropertyModifierStorage`;
- `Crafting::SCraftedItemPersistentData`;
- `Crafting.PersistentItemData`;
- `SCEvt_CraftedItem_StatsChanged`;
- a UI `craftedStat` binding with `baseValue`, `newValue`, `deltaValue`,
  `comparisonState`, and `IsHighlighted`;
- `Crafting::CCrafterUIProviderComponent`;
- `Crafting::SSuppliesManifest`;
- `CraftingSystem.cpp`;
- a hard-coded list of known `CraftingGameplayPropertyDef.GPP_*` record names;
  and
- the validation message:

> Duplicate crafting data property for resource ..., only the first one will
> be read. Please choose the correct one and remove all of the others.

This establishes that the runtime stores resolved modifiers on crafted
instances. The validation message appears alongside resource quality
distribution/override validation, so its scope should not be extended to
duplicate blueprint GPP slots without more evidence. The executable does not
expose the complete runtime property-to-component mapping as DataForge records.

## Blueprint Library service

Opening the crafting UI reused:

```text
sc.external.services.blueprint_library.v1.BlueprintLibraryService
```

Executable symbols identify the operation as `QueryBlueprintEntries`. Entry
fields and local functions concern library ownership/availability, tier, uses,
timestamps, and resource metadata. No evidence was found that this service
returns recipe gameplay-property mappings.

The client also has `g_crafting.useDataCoreBlueprintLibrary`, described as using
all DataCore blueprint records and bypassing the Blueprint Library Service.
This further separates blueprint ownership from local recipe definitions.

## Case study: M7A Cannon

Archive identity:

| Field             | Value                                  |
| ----------------- | -------------------------------------- |
| Blueprint         | `BP_CRAFT_BEHR_LaserCannon_S5`         |
| Blueprint GUID    | `aa1cb1df-fe5c-4067-8396-ef117e8e3c3d` |
| Output            | `BEHR_LaserCannon_S5`                  |
| Output GUID       | `b94c54b2-a70e-4f41-bc02-ed76be87e493` |
| Base fire rate    | 100 RPM                                |
| Base integrity    | 2,500                                  |
| Projectile damage | 921.78 energy                          |

Recipe declarations:

| Slot/material               | Declared property     | Curve         |
| --------------------------- | --------------------- | ------------- |
| Frame / 3.74 SCU Agricium   | Integrity             | ×0.90 → ×1.10 |
| Emitter / 75 Hadanite       | Damage / Impact Force | ×0.95 → ×1.05 |
| Aperture Iris / 75 Dolivine | Damage / Impact Force | ×0.95 → ×1.05 |

Observed in the live crafting UI:

- Fire Rate and Integrity are displayed as item statistics.
- Agricium changes Integrity.
- Adding materials changed the displayed Fire Rate, but Hadanite was not tested
  in isolation during this investigation.
- Dolivine did not change Impact Force or Fire Rate when tested independently.

No M7A Fire Rate modifier exists in the blueprint record. No second M7A
enhancement resolver was found in the archive. Hadanite is the remaining
candidate for the observed Fire Rate change, but that attribution is an
inference from the isolated Dolivine result rather than a completed isolated
Hadanite test.

## Case study: Lightstrike I Cannon

Archive identity:

| Field             | Value                                  |
| ----------------- | -------------------------------------- |
| Blueprint         | `BP_CRAFT_ESPR_LaserCannon_S1`         |
| Blueprint GUID    | `78b1bf49-bdd8-48e9-9cbe-1faeb95f24d5` |
| Output            | `ESPR_LaserCannon_S1`                  |
| Output GUID       | `0cced6b1-acfd-4c55-96cc-d0503638b9ad` |
| Base fire rate    | 250 RPM                                |
| Base integrity    | 550                                    |
| Projectile damage | 49.248 energy                          |

Its recipe is structurally the same as M7A:

| Slot/material              | Declared property     | Curve         |
| -------------------------- | --------------------- | ------------- |
| Frame / 0.36 SCU Agricium  | Integrity             | ×0.90 → ×1.10 |
| Emitter / 7 Hadanite       | Damage / Impact Force | ×0.95 → ×1.05 |
| Aperture Iris / 7 Dolivine | Damage / Impact Force | ×0.95 → ×1.05 |

Observed in the live crafting UI:

- Fire Rate and Integrity are displayed.
- Only Agricium changed the result, through Integrity.
- Hadanite and Dolivine did not change the result.

Again, no Fire Rate modifier or separate override record exists in the archive.

## Case study: Demeco LMG

`BP_CRAFT_klwe_lmg_energy_01` is an FPS `WeaponPersonal` output:

| Slot/material     | Declared property                     |
| ----------------- | ------------------------------------- |
| Frame / Corundum  | Recoil smoothness, handling, and kick |
| Wiring / Copper   | Fire Rate                             |
| Lenses / Hadanite | Damage / Impact Force                 |

The in-game check confirmed that Hadanite changes Impact Force for Demeco.
Therefore `GPP_Weapon_Damage` is not globally inert; applicability differs by
runtime item domain.

## What is reliable

The archive is authoritative for:

- blueprint and output identity;
- recipe topology, slots, ingredients, quantities, and minimum quality;
- quality distributions and quantization;
- the gameplay property a designer declared on a slot;
- modifier curves;
- property display metadata;
- base item/component stats;
- default blueprint selection;
- blueprint reward pools and linked missions; and
- static reverse references.

The archive alone was **not** sufficient to prove:

- that a declared property is applied to a given output domain at runtime;
- the final value shown by `CrafterUIProvider`;
- server-side corrections not represented in the client records;
- the quality of the player's selected inventory stack; or
- the resulting persistent modifiers on a crafted instance.

## Product guidance

Until the runtime applicability map is independently established for every
item domain:

1. Treat recipe GPPs as **declared effects**, not guaranteed enhancements.
2. Keep base item statistics separate from material changes. A statistic shown
   by the game UI is not necessarily changed by the selected material.
3. Show source/provenance and preserve the exact GPP key and curve.
4. Do not infer a Fire Rate modifier merely because Fire Rate appears in the
   crafting statistics panel.
5. Suppress or explicitly mark declarations contradicted by repeated live tests.
6. Validate by item domain (`WeaponPersonal`, `WeaponGun`, armor, shield,
   quantum drive, and so on), not by material name. Hadanite changes different
   outputs differently because the effect is authored on the recipe slot.
7. Keep unknown and contradictory data visible to diagnostics rather than
   silently inventing a fallback mapping.

## Cache behavior

Blueprint extraction is expensive because it traverses the archive, DataForge
records, localization, references, missions, and icons. The local catalog is
cached in:

```text
%APPDATA%\rockfall\blueprints.json
```

The cache is keyed by a schema version, archive byte-length/modified-time
fingerprint, and channel. A compatible cache loaded in approximately 55–62 ms
during this investigation.

Schema upgrades should not leave the page in its initial loading state while a
full extraction runs. A safer migration behavior is:

1. parse the prior compatible identity/recipe fields;
2. display the retained catalog immediately as cached/stale;
3. leave new fields empty rather than fabricating them; and
4. refresh explicitly or in the background, then atomically replace the cache.

## Public corroboration

The local findings agree with public reverse-engineering work:

- [StarCitizenWiki/scunpacked-data](https://github.com/StarCitizenWiki/scunpacked-data)
  publishes normalized 4.9 blueprint records, including the same M7A and Demeco
  declarations.
- [octfx/ScDataDumper](https://github.com/octfx/ScDataDumper) parses modifier
  contexts from the same recursive crafting-cost tree.
- [VeeLume/sc-holotable](https://github.com/VeeLume/sc-holotable) documents
  that GPP definitions are display-only and that the GPP-to-runtime-stat field
  mapping is not present in the P4K. Its product-stat layer uses a curated
  record-name mapping and warns on schema drift.
- [diogotr7/StarBreaker](https://github.com/diogotr7/StarBreaker) provides
  another modern DataCore extraction/query implementation.

Public implementations generally interpolate linear ranges as:

```text
t = clamp((quality - startQuality) / (endQuality - startQuality), 0, 1)
factor = modifierAtStart + t * (modifierAtEnd - modifierAtStart)
```

Public implementations combine multiple recipe slots affecting one GPP by
summing their deltas from 1.0. The local executable's resource duplicate
validation is not enough to confirm or reject that behavior for blueprint
slots.

## Reproduction checklist

To repeat the investigation on another build:

1. record `build_manifest.id`, `Data.p4k` size, modified time, and game log
   build;
2. extract and parse `Data/Game2.dcb`;
3. enumerate all crafting blueprint records;
4. walk the complete recursive cost tree;
5. resolve every ingredient, GPP, quality, output, manufacturer, ammo, and
   mission reference;
6. build a reverse-reference graph for each questioned GUID;
7. scan by GUID alone as well as by stable record name;
8. inspect the output entity's base stat components;
9. compare the same isolated material slot in the live crafting UI; and
10. document archive declarations and observed runtime behavior separately.

Counts and relationships in this report are build-specific. CIG can change
records, runtime mappings, UI behavior, and server behavior in any patch.
