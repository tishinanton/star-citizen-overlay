# Star Citizen Wiki API

This reference inventories every operation in the live
[OpenAPI document](https://api.star-citizen.wiki/api/openapi) on 2026-07-23.
The service is community-maintained and is not an official Cloud Imperium Games
or RSI API.

## What the API is for

The API exposes structured data assembled by the Star Citizen Wiki project:

- game commodities, mining deposits, signatures, locations, items, vehicles,
  missions, blueprints, manufacturers, factions, and game versions;
- RSI Ship Matrix, starmap, Comm-Link, image, Galactapedia, and crowdfunding
  data;
- localized resources, current filter facets, version-specific game data, and
  change history;
- unified search and a small authenticated user/image-similarity surface.

For Rockfall, this API supplies commodity metadata, locations, and a fallback
signature source. Primary base signatures come from the user's installed game
resources. Neither source is a live game scanner or can report rocks currently
near a player.

## Connection and conventions

| Concern            | Published behavior                                                                                                                                                                                                     |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Base URL           | `https://api.star-citizen.wiki`                                                                                                                                                                                        |
| API prefix         | `/api`                                                                                                                                                                                                                 |
| Format             | JSON, except `GET /api/openapi`, which returns OpenAPI YAML.                                                                                                                                                           |
| Published API spec | OpenAPI `3.0.0`. The apparent v1/v2 documentation pages currently resolve to the same live contract. Use the unversioned `/api/...` routes unless the project publishes a new versioning policy.                       |
| Game-data version  | Most game-data operations accept `version=<game version code>`. Omission uses `GET /api/game-versions/default`.                                                                                                        |
| Pagination         | Paginated operations accept `page[number]` and `page[size]`; maximum page size is 200. Responses include `data`, `links`, and `meta`.                                                                                  |
| Filters            | `filter[field]=value`; comma-separated values are supported only where the operation documents them.                                                                                                                   |
| Sorting            | `sort=field` for ascending and `sort=-field` for descending.                                                                                                                                                           |
| Includes           | `include=relationship,relationship` embeds supported relationships.                                                                                                                                                    |
| Filter facets      | A companion `/filters` operation returns the current valid values/counts for many list resources.                                                                                                                      |
| Localization       | Detail routes for items/categories and Galactapedia, plus some legacy searches, accept `locale`. English, German, and Simplified Chinese are advertised; not every record is guaranteed to have every translation.     |
| Authentication     | All documented operations are public except `GET /api/user` and `GET /api/comm-link-images/{image}/similar`. Those use a Sanctum bearer token. No public token-registration or API-key acquisition flow is documented. |
| Rate limits        | Unified search: 60 requests/minute/IP. Reverse-image operations: 10 requests/minute. No general limit or cache TTL is published in the spec.                                                                           |
| Common errors      | Operation-specific `401`, `404`, `422`, `429`, and `501`. Do not assume one custom error envelope.                                                                                                                     |

### Notation

- **P**: paginated with `page[number]` and `page[size]`.
- **V**: accepts a game-data `version`.
- **Deprecated**: still published, but clients should use the indicated filtered
  GET operation.
- Every operation is public unless its authentication requirement is stated.

## Complete operation inventory

### Blueprints

| Method and path                   | Purpose and important inputs                                                                                                                                                                                         |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/blueprints`             | **P, V.** Lists crafting blueprints. Filters include query, output UUID/name/class/type, default state, ingredient UUID, and resource UUID. Sorts include craft time, ingredient count, and unlocking-mission count. |
| `GET /api/blueprints/filters`     | **V.** Returns current output-type, ingredient-UUID, and resource-UUID facets.                                                                                                                                       |
| `GET /api/blueprints/{blueprint}` | **V.** Returns one blueprint by UUID with requirement groups/tree, tiers, modifiers, aspects, output, ingredients, dismantle returns, craft time, and unlocking missions.                                            |

### Commodities, mining, and deposits

| Method and path                    | Purpose and important inputs                                                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/commodities`             | **P, V.** Lists commodities/resources. Filters: `used`, `system`, `type`, `rarity`, `kind`, `group`, `refined_version`, `location`, `query`, `ship`, `ground_vehicle`, `fps`, `harvestable`, `salvage`, and `mineable`. Sorts include key, name, rarity, density, instability, resistance, and signature. Summaries include signature, mining methods/flags, systems, locations, and refined counterpart. |
| `GET /api/commodities/filters`     | **V.** Returns commodity facets for system, location type, rarity, kind, refined version, group, and location. The normal commodity filters can narrow the facets.                                                                                                                                                                                                                                        |
| `GET /api/commodities/{commodity}` | **V.** Looks up a commodity by UUID or slug. `include=blueprints,items`. Returns complete resource/deposit data, location/system groups, probability and quality ranges, materials, area modifiers, raw/refined versions, signatures, and clustering definitions.                                                                                                                                         |

#### Signature fields used by Rockfall

The commodity resources expose:

- the commodity-level electromagnetic scanner `signature`;
- per-deposit/resource signature data in commodity detail;
- clustering definitions with `key`, `min_size`, `max_size`,
  `min_proximity`, `max_proximity`, `probability`,
  `probability_percent`, and variation parameters.

Rockfall requests this list for commodity metadata and API fallback values:

```text
GET /api/commodities?filter[mineable]=true&filter[kind]=mineable&page[size]=200
```

When installed game extraction is unavailable, Rockfall keeps records with a
positive numeric `signature`. It caches mapped results and calculates
`signature × rock count` locally. The API does not observe or count a player's
nearby cluster.

### Factions

| Method and path               | Purpose and important inputs                                                                                                                                                                            |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/factions`           | **P.** Lists factions. Filters: `faction_type`, `has_reputation`, `lawful`, `is_npc`, `hide_in_delphi_app`, and `query`; sorts by name or faction type. Hidden Delphi factions are excluded by default. |
| `GET /api/factions/{faction}` | Returns one faction by UUID, including its reputation ladder/standings when present.                                                                                                                    |

### Game versions and changes

| Method and path                                      | Purpose and important inputs                                                                                                          |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/game-versions`                             | **P.** Lists versions. Filters: `code`, `channel` (`live`, `ptu`, `eptu`), and `is_default`; sorts by code, channel, or release date. |
| `GET /api/game-versions/default`                     | Returns the current default game-data version.                                                                                        |
| `GET /api/game-versions/{identifier}`                | Returns one version by case-insensitive version code.                                                                                 |
| `GET /api/game-versions/{version}/changelog`         | Summarizes the version's changes relative to its predecessor.                                                                         |
| `GET /api/game-versions/{version}/changelog/changes` | **P.** Lists changed entities. Filters: `entity_type` (`item`, `vehicle`) and `change_type` (`added`, `removed`, `modified`).         |

### Items

#### General item operations

| Method and path               | Purpose and important inputs                                                                                                                                                                                                                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/items`              | **P, V.** Lists game items. Supports `include=shops,variants,related_items,blueprints,vehicles,shops.items`; filters include variants, category, type/subtype, manufacturer/name, class name, query, classification, size, grade, class, rarity, event source, tags, port tags, vehicle, and `include_irrelevant`. |
| `GET /api/items/filters`      | **V.** Returns item facets for type, subtype, classification, size, grade, class, manufacturer, rarity, and event source. Item filters can narrow the facets.                                                                                                                                                      |
| `GET /api/items/{identifier}` | **V.** Looks up an item by UUID, slug, display name, or class name, case-insensitively. Supports `locale` and item includes. A matching vehicle redirects to its vehicle resource.                                                                                                                                 |
| `POST /api/items/search`      | **Deprecated, P.** Legacy JSON query search. Use `GET /api/items?filter[name]=...` or `filter[query]` instead.                                                                                                                                                                                                     |

#### Item category aliases

Each list route is **P, V** and supports the applicable normal item filters.
Each detail route accepts an identifier, `locale`, `include`, and `version`.

| List route                    | Detail route                               | Fixed scope                                                                              |
| ----------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `GET /api/weapons`            | `GET /api/weapons/{identifier}`            | FPS `WeaponPersonal` items.                                                              |
| `GET /api/weapon-attachments` | `GET /api/weapon-attachments/{identifier}` | Weapon attachments, excluding magazines and missiles.                                    |
| `GET /api/clothes`            | `GET /api/clothes/{identifier}`            | `FPS.Clothing.*` items.                                                                  |
| `GET /api/armor`              | `GET /api/armor/{identifier}`              | `FPS.Armor.*` items.                                                                     |
| `GET /api/food`               | `GET /api/food/{identifier}`               | Food, bottles, and drinks.                                                               |
| `GET /api/vehicle-weapons`    | `GET /api/vehicle-weapons/{identifier}`    | Vehicle `WeaponGun` items.                                                               |
| `GET /api/vehicle-items`      | `GET /api/vehicle-items/{identifier}`      | Vehicle coolers, shields, power plants, quantum drives, thrusters, and other components. |

### Manufacturers

| Method and path                         | Purpose and important inputs                                                      |
| --------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /api/manufacturers`                | **P.** Lists manufacturers; supports `filter[name]`.                              |
| `GET /api/manufacturers/{manufacturer}` | Returns one manufacturer by name, UUID, or manufacturer code, including products. |
| `POST /api/manufacturers/search`        | **Deprecated, P.** Legacy JSON query search. Use the manufacturer list filter.    |

### Missions

| Method and path               | Purpose and important inputs                                                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/missions`           | **P, V.** Lists missions, grouped by variants by default. Filters cover giver, faction, system, legality, sharing, one-time/prison/combat/defend/prerequisite flags, enemy/reward thresholds, title/description/query, reward/reputation scope, blueprint, location, and explicit grouping. |
| `GET /api/missions/filters`   | **V.** Returns mission facets such as giver, system, faction, combat, rank, legality, scope, blueprint, and reputation data.                                                                                                                                                                |
| `GET /api/missions/{mission}` | **V.** Returns one mission by slug or UUID with chain and associated-item data.                                                                                                                                                                                                             |

### Game starmap locations

| Method and path                   | Purpose and important inputs                                                                                                                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/locations`              | **P, V.** Lists locations. Filters include name/query, type/classification, respawn, jurisdiction, affiliation, scannable/travel flags, amenity, tag, parent, system, resource, `has_resources`, and `hide_minor_locations`. |
| `GET /api/locations/filters`      | **V.** Returns current location facets; normal location filters can narrow them.                                                                                                                                             |
| `GET /api/locations/{identifier}` | **V.** Returns a location by slug or UUID. `include=children,resources,missions`.                                                                                                                                            |
| `GET /api/locations/positions`    | Non-paginated world positions and jump-point connections. Filters: type and system. Returns coordinates, entry/exit data, fuel cost, and size class.                                                                         |

### In-game vehicles

#### General vehicles

| Method and path                  | Purpose and important inputs                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/vehicles`              | **P, V.** Lists game vehicles with manufacturer, version, Ship Matrix loaner, and SKU relationships. Optional includes cover Ship Matrix vehicle/components, components, hardpoints, and ports. Sorts and filters cover name, manufacturer, class, size, role, career, cargo, crew, health, shields, speeds, armor, cross-section, and quantum/shield EM/IR signatures. |
| `GET /api/vehicles/filters`      | **V.** Returns manufacturer, ground/gravlev/spaceship, size, role, career, and shield-face facets.                                                                                                                                                                                                                                                                      |
| `GET /api/vehicles/{identifier}` | **V.** Looks up a vehicle by name, class name, or UUID with optional relationships.                                                                                                                                                                                                                                                                                     |
| `POST /api/vehicles/search`      | **Deprecated, P.** Legacy JSON query search. Use vehicle list filters.                                                                                                                                                                                                                                                                                                  |

#### Ground-vehicle aliases

| Method and path                         | Purpose                                           |
| --------------------------------------- | ------------------------------------------------- |
| `GET /api/ground-vehicles`              | **P, V.** Vehicle list fixed to ground vehicles.  |
| `GET /api/ground-vehicles/{identifier}` | **V.** One ground vehicle with optional includes. |
| `POST /api/ground-vehicles/search`      | **Deprecated, P.** Legacy JSON search.            |

#### Gravlev-vehicle aliases

| Method and path                          | Purpose                                            |
| ---------------------------------------- | -------------------------------------------------- |
| `GET /api/gravlev-vehicles`              | **P, V.** Vehicle list fixed to gravlev vehicles.  |
| `GET /api/gravlev-vehicles/{identifier}` | **V.** One gravlev vehicle with optional includes. |
| `POST /api/gravlev-vehicles/search`      | **Deprecated, P.** Legacy JSON search.             |

### Unified search

| Method and path           | Purpose and important inputs                                                                                                                                                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/search`         | **V.** Requires `filter[query]` with at least two characters. Returns up to five grouped results for items, vehicles, locations, commodities, blueprints, and missions. Limited to 60 requests/minute/IP. |
| `GET /api/search/{query}` | **V.** Resolves an entity name, class name, or UUID and returns a `302` redirect to the best API resource. Preserves `locale`, `include`, and `version`; returns `404` when unresolved.                   |

### RSI Comm-Links

| Method and path                                  | Purpose and important inputs                                                                                                                                                       |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/comm-links`                            | **P.** Lists Comm-Links. `include=images,links`; filters include ID, title, content, channel, series, category, and creation date.                                                 |
| `GET /api/comm-links/filters`                    | Returns category, channel, and series facets, optionally narrowed with Comm-Link filters.                                                                                          |
| `GET /api/comm-links/{id}`                       | Returns one Comm-Link by CIG ID (minimum 12663). Images are always included; navigation metadata contains previous/next IDs.                                                       |
| `POST /api/comm-links/search`                    | **Deprecated.** Legacy JSON `keyword` or `query` search with locale/include and channel/series/category filters.                                                                   |
| `POST /api/comm-links/reverse-image-link-search` | Finds Comm-Links that reference an exact RSI/media.RSI image URL. JSON body contains `url`. Limited to 10 requests/minute.                                                         |
| `POST /api/comm-links/reverse-image-search`      | Multipart reverse-image search. Required image up to 5 MB; optional similarity 1–100 (default 75). Limited to 10 requests/minute; may return `501` when GD support is unavailable. |

### Comm-Link images

| Method and path                             | Auth         | Purpose and important inputs                                                                                                                                 |
| ------------------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/comm-link-images`                 | Public       | **P.** Lists images with Comm-Link, tag, duplicate, and base-image relationships. Optional `filter[tags]`; the docs currently warn that images have no tags. |
| `GET /api/comm-link-images/random`          | Public       | Returns random images. `limit` maximum 100; optional tag. Candidates are at least 250 KB and have no base image.                                             |
| `GET /api/comm-link-images/{image}`         | Public       | Returns one enriched image by numeric internal ID.                                                                                                           |
| `POST /api/comm-link-images/search`         | Public       | Searches image filenames. JSON `query` is 1–255 characters; optional tag.                                                                                    |
| `GET /api/comm-link-images/{image}/similar` | Bearer token | Returns visually similar images for a numeric image ID. Optional similarity 1–100 (default 50). Limited to 10 requests/minute.                               |

### Galactapedia

| Method and path                 | Purpose and important inputs                                                                                                    |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/galactapedia`         | **P.** Lists articles. Filters: category, tag, template, title, and creation date; sorts include title and relationship counts. |
| `GET /api/galactapedia/filters` | Returns category, tag, and template facets, optionally narrowed with article filters.                                           |
| `GET /api/galactapedia/{id}`    | Returns one localized CIG article. Supports `locale` and `include=categories,properties,tags,related`.                          |
| `POST /api/galactapedia/search` | **Deprecated.** Legacy JSON query search. Use `filter[title]` on the list route.                                                |

### RSI starmap celestial objects and systems

| Method and path                      | Purpose and important inputs                                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/celestial-objects`         | **P.** Lists celestial objects. Filters: star system, name, designation, and type; includes affiliation, star system, and jump points.         |
| `GET /api/celestial-objects/{code}`  | Returns one celestial object by code with optional relationships.                                                                              |
| `POST /api/celestial-objects/search` | **Deprecated, P.** Legacy JSON query search.                                                                                                   |
| `GET /api/starsystems`               | **P.** Lists star systems. Filters: affiliation, code, name, status, type, and size; includes affiliation, celestial objects, and jump points. |
| `GET /api/starsystems/filters`       | Returns affiliation, status, type, and size facets.                                                                                            |
| `GET /api/starsystems/{code}`        | Returns one star system by code/identifier with optional relationships.                                                                        |
| `POST /api/starsystems/search`       | **Deprecated, P.** Legacy JSON query search.                                                                                                   |

### Statistics

| Method and path         | Purpose                                                                                                    |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- |
| `GET /api/stats`        | **P.** Historical crowdfunding snapshots, newest first, including funds raised, fan count, and fleet size. |
| `GET /api/stats/latest` | Latest crowdfunding snapshot; `404` if no snapshot exists.                                                 |

### RSI Ship Matrix

| Method and path                        | Purpose and important inputs                                                                                                                                                                                                                                |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/shipmatrix/vehicles`         | **P.** Lists Ship Matrix vehicles. Filters: manufacturer, size, type, focus, production status, and name. Sorts include ID, chassis ID, name, MSRP, dimensions, cargo, crew, manufacturer, focus, type, and size. SKUs and loaners are included by default. |
| `GET /api/shipmatrix/vehicles/filters` | Returns cross-filtered manufacturer, size, type, focus, and production-status facets.                                                                                                                                                                       |
| `GET /api/shipmatrix/vehicles/{slug}`  | Returns one Ship Matrix vehicle. `include=components,loaner,skus`.                                                                                                                                                                                          |
| `POST /api/shipmatrix/vehicles/search` | **Deprecated, P.** Legacy JSON query search.                                                                                                                                                                                                                |

### Meta and authenticated user

| Method and path    | Auth         | Purpose                                                                                                         |
| ------------------ | ------------ | --------------------------------------------------------------------------------------------------------------- |
| `GET /api/openapi` | Public       | Returns the live OpenAPI 3.0 YAML document that defines this inventory.                                         |
| `GET /api/user`    | Bearer token | Returns the current authenticated user, including identity, email, verification/admin/language, and timestamps. |

## Client recommendations

1. Generate public data clients from the live OpenAPI YAML, but handle redirects,
   locale unions, deprecated searches, and pagination metadata deliberately.
2. Prefer filtered GET list operations over every deprecated POST search.
3. Populate filter controls from the relevant `/filters` operation; values can
   change with the game-data version.
4. Cache public data conservatively and preserve explicit `429`, validation,
   network, and schema errors.
5. Keep API fallback signatures version-aware. A value can differ from the
   user's installed game channel when the default API game-data version changes.

## Primary sources

- [Live OpenAPI YAML](https://api.star-citizen.wiki/api/openapi)
- [Rendered API documentation](https://docs.star-citizen.wiki/)
- [API project README](https://github.com/StarCitizenWiki/API/blob/master/readme.md)
- [API docs repository](https://github.com/StarCitizenWiki/api-docs)
