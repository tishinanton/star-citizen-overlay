# UEX Corp API 2.0

This reference inventories every method published in the
[UEX API documentation](https://uexcorp.space/api/documentation/) on
2026-07-23. It is a planning reference for Rockfall, not a replacement for the
live documentation. UEX can change resources and access rules independently of
this repository.

## What the API is for

UEX is a community-operated Star Citizen economy and logistics service. Its
API is strongest for:

- commodity, raw-material, item, fuel, vehicle, and marketplace prices;
- trade-route calculations and stock reports;
- locations, terminals, refinery data, and game catalogues;
- authenticated UEX user data such as trades, refinery jobs, wallet, fleet,
  notifications, marketplace favourites, and negotiations;
- community data submission.

UEX does **not** publish rock scanner signatures or cluster signatures. Rockfall
uses the Star Citizen Wiki commodity API for signature values and calculates a
cluster signature locally as `base signature × rock count`.

## Connection and access

| Concern                    | Published behavior                                                                                                                                                                                                                      |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API version                | `2.0`                                                                                                                                                                                                                                   |
| Base URL                   | `https://api.uexcorp.uk/2.0` is shown by the official method pages. `https://api.uexcorp.space/2.0` also serves the API, but clients should follow any canonical-host guidance UEX publishes.                                           |
| Format                     | JSON                                                                                                                                                                                                                                    |
| Success envelope           | Normally `{ "status": "ok", "data": ... }`; live responses may also include `http_code`.                                                                                                                                                |
| Error envelope             | Internal failures use `{ "status": "error", "http_code": 500, "message": ... }`; validation statuses vary by method. Quota failures use `status: "requests_limit_reached"`.                                                             |
| App credentials            | Create an application in [My Apps](https://uexcorp.space/api/apps). Lock-marked methods require application authorization. The official UI redacts the exact header value, so verify the current scheme there before shipping a client. |
| User submission credential | `POST /data_submit` additionally requires the user's `secret-key` header from their UEX profile.                                                                                                                                        |
| Client version             | An app key can be locked to a client version. Send the matching `X-Client-Version` header when configured.                                                                                                                              |
| Quota                      | 172,800 requests per day, stated by UEX as 120 requests per minute.                                                                                                                                                                     |
| Pagination                 | No page, limit, cursor, or other pagination contract is documented. Do not invent one.                                                                                                                                                  |
| Caching                    | Respect the TTL shown on each live method page. Static catalogues are commonly one day, price data around 30 minutes, and history around 12 hours.                                                                                      |
| Data quality               | Community reports can be stale or incorrect. See the [UEX API terms](https://uexcorp.space/about/terms).                                                                                                                                |

### Authentication notation

- **Public**: no lock is shown in the UEX documentation.
- **App**: the method is lock-marked and requires an application credential.
- **App + user**: application authorization plus the documented user
  `secret-key`.
- **Deprecated**: published but struck through; do not use in new integrations.

Paths below are relative to `https://api.uexcorp.uk/2.0`.

## GET methods

### Catalogues, game versions, and locations

| Path                     | Auth   | Purpose and important inputs                                                                                                                                                                                                                                                       |
| ------------------------ | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/categories`            | Public | Lists item, service, and contract categories. Optional `type` (`item`, `service`, `contract`) and `section`; includes mining/game-related flags.                                                                                                                                   |
| `/categories_attributes` | Public | Lists attribute definitions and category mappings, including descriptions and whether lower values are better. Filter by category where documented.                                                                                                                                |
| `/companies`             | Public | Lists in-game companies and manufacturers with names, codes, lore, and manufacturer metadata.                                                                                                                                                                                      |
| `/game_versions`         | Public | Returns currently supported game versions and status metadata.                                                                                                                                                                                                                     |
| `/game_versions_all`     | Public | Returns the full recorded game-version history.                                                                                                                                                                                                                                    |
| `/factions`              | Public | Lists factions, affiliations, names, and availability metadata.                                                                                                                                                                                                                    |
| `/jurisdictions`         | Public | Lists jurisdictions and their faction/location relationships.                                                                                                                                                                                                                      |
| `/star_systems`          | Public | Lists star systems and availability/system metadata.                                                                                                                                                                                                                               |
| `/planets`               | Public | Lists planets. Common filter: `id_star_system`.                                                                                                                                                                                                                                    |
| `/moons`                 | Public | Lists moons and their parent planet/system relationships.                                                                                                                                                                                                                          |
| `/orbits`                | Public | Lists orbit entities, including planet and Lagrange orbits. Filter by system or planet.                                                                                                                                                                                            |
| `/orbits_distances`      | Public | Returns distances between selected orbit entities.                                                                                                                                                                                                                                 |
| `/cities`                | Public | Lists cities and their system, planet, and orbit relationships.                                                                                                                                                                                                                    |
| `/outposts`              | Public | Lists outposts, parent locations, availability, and service flags.                                                                                                                                                                                                                 |
| `/space_stations`        | Public | Lists stations, parent system/orbit data, facilities, and availability.                                                                                                                                                                                                            |
| `/poi`                   | Public | Lists points of interest. Filters include `id_star_system`, `id_faction`, `id_jurisdiction`, `id_planet`, `id_orbit`, `id_moon`, `id_space_station`, `id_city`, and `id_outpost`. Includes mining, landing, armistice, monitoring, pad, trade, refinery, refuel, and repair flags. |
| `/jump_points`           | Public | Lists jump points and linked-system relationships.                                                                                                                                                                                                                                 |
| `/terminals`             | Public | Lists terminals with location, type, availability, code/slug, and capability data.                                                                                                                                                                                                 |
| `/terminals_distances`   | Public | Returns distances between selected terminals.                                                                                                                                                                                                                                      |
| `/contacts`              | Public | Returns the published community/contact directory.                                                                                                                                                                                                                                 |
| `/contracts`             | Public | Lists contracts with category, location, reward, status, and related metadata.                                                                                                                                                                                                     |
| `/release_notes`         | Public | Returns UEX release notes and associated version/date information.                                                                                                                                                                                                                 |

### UEX operation and user resources

| Path               | Auth   | Purpose and important inputs                                                                                                              |
| ------------------ | ------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `/data_parameters` | Public | Returns current LIVE/PTU versions, whether reports are accepted, datacenter status, price-variation thresholds, and reporting parameters. |
| `/data_extract`    | Public | Returns a curated UEX data extract selected with the method's published extract parameters.                                               |
| `/data_monitor`    | App    | Returns protected datacenter/report monitoring information.                                                                               |
| `/fleet`           | App    | Returns the authenticated user's or application's fleet and vehicle records.                                                              |
| `/organizations`   | App    | Looks up organization/profile information using the documented organization selectors.                                                    |
| `/user`            | Public | Looks up a public UEX user profile using the documented user selector, such as username.                                                  |

### Commodities, raw materials, fuel, trade, and currency

| Path                          | Auth       | Purpose and important inputs                                                                                                                                                                                                                             |
| ----------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/commodities`                | Public     | Full commodity catalogue. Includes IDs, names, codes/slugs, average prices, raw/refined/refinable/extractable/mineral/harvestable/fuel/illegal flags, and associated location IDs. It does not include scanner signatures.                               |
| `/commodities_alerts`         | Public     | Latest commodity price/stock alerts. Optional `id_commodity`; returns terminal, prices, SCU, stock status, and alert metadata.                                                                                                                           |
| `/commodities_averages`       | App        | 15-day CAX price and stock averages for required `id_commodity`, including current/min/max/average values, reports, status, and volatility.                                                                                                              |
| `/commodities_prices`         | Public     | Commodity prices at selected terminals. Requires at least one selector: `id_terminal` (up to 10 comma-separated IDs), `id_commodity`, or terminal/commodity `name`, `code`, or `slug`.                                                                   |
| `/commodities_prices_all`     | Public     | All commodity prices and stock values at all terminals in one response.                                                                                                                                                                                  |
| `/commodities_prices_history` | Public     | Historical reports for required `id_terminal` and `id_commodity`; optional `game_version`.                                                                                                                                                               |
| `/commodities_ranking`        | Deprecated | Legacy commodity ranking. Do not build new integrations against it.                                                                                                                                                                                      |
| `/commodities_raw_averages`   | Public     | 15-day CAX averages for required raw/ore `id_commodity`, including extrema, stock, status, and volatility.                                                                                                                                               |
| `/commodities_raw_prices`     | Public     | Raw/ore prices. Requires at least one of `id_terminal` (up to 10 comma-separated IDs) or `id_commodity`.                                                                                                                                                 |
| `/commodities_raw_prices_all` | Public     | All raw-commodity prices at every terminal.                                                                                                                                                                                                              |
| `/commodities_routes`         | Public     | Calculates common trade routes. Requires an origin terminal/planet/orbit or commodity selector; supports destination and faction/location filters. Returns prices, distance, available/reachable SCU, investment, profit, ROI, score, and service flags. |
| `/commodities_status`         | Public     | Lists commodity stock-status definitions, abbreviations, colors, and percentage ranges.                                                                                                                                                                  |
| `/fuel_prices`                | Public     | Fuel prices for selected terminals or locations.                                                                                                                                                                                                         |
| `/fuel_prices_all`            | Public     | Fuel prices for every terminal.                                                                                                                                                                                                                          |
| `/currencies_index`           | Public     | Returns the current UEX currency index and valuation metrics.                                                                                                                                                                                            |
| `/currencies_index_history`   | Public     | Returns timestamped currency-index history using the published currency/date filters.                                                                                                                                                                    |

### Items and vehicles

| Path                             | Auth   | Purpose and important inputs                                                                                                                                                                                         |
| -------------------------------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/items`                         | Public | Item catalogue for components, weapons, and other game items. Requires one of `id_category`, `id_company`, game `uuid`, or `size`; returns category/company, dimensions, specifications, availability, and metadata. |
| `/items_attributes`              | Public | Item attribute values and their attribute/category mappings.                                                                                                                                                         |
| `/items_prices`                  | Public | Item prices and availability at selected terminals, categories, or locations.                                                                                                                                        |
| `/items_prices_all`              | Public | All known item prices at all terminals.                                                                                                                                                                              |
| `/vehicles`                      | Public | Vehicle catalogue with manufacturer/category, dimensions, cargo, game UUID, and related metadata.                                                                                                                    |
| `/vehicles_loaners`              | Public | Maps pledged/original vehicles to their loaner vehicles.                                                                                                                                                             |
| `/vehicles_prices`               | Public | Purchase, rental, and pledge price overview for selected vehicles/types.                                                                                                                                             |
| `/vehicles_purchases_prices`     | Public | In-game vehicle purchase prices at selected terminals/locations.                                                                                                                                                     |
| `/vehicles_purchases_prices_all` | Public | All in-game vehicle purchase prices.                                                                                                                                                                                 |
| `/vehicles_rentals_prices`       | Public | Vehicle rental prices at selected terminals/locations.                                                                                                                                                               |
| `/vehicles_rentals_prices_all`   | Public | All vehicle rental prices.                                                                                                                                                                                           |

### Marketplace

| Path                                 | Auth       | Purpose and important inputs                                                                   |
| ------------------------------------ | ---------- | ---------------------------------------------------------------------------------------------- |
| `/marketplace_averages`              | Deprecated | Legacy marketplace average-price method.                                                       |
| `/marketplace_averages_all`          | Deprecated | Legacy all-marketplace-averages method.                                                        |
| `/marketplace_favorites`             | App        | Returns the authenticated user's favourite marketplace records.                                |
| `/marketplace_listings`              | Public     | Lists marketplace offers using listing, item, category, seller, status, and location filters.  |
| `/marketplace_negotiations`          | App        | Returns the authenticated user's marketplace negotiations and their listing/participant state. |
| `/marketplace_negotiations_messages` | App        | Returns messages in the authenticated user's selected negotiations.                            |
| `/marketplace_prices_averages`       | Public     | Average marketplace price for a selected item/category.                                        |
| `/marketplace_prices_averages_all`   | Public     | Average marketplace prices for all items.                                                      |
| `/marketplace_prices_history`        | Public     | Historical marketplace prices using item/date selectors.                                       |
| `/marketplace_trends`                | Public     | Current and rolling marketplace trend data for selected items/categories/time ranges.          |

### Refinery and community data

| Path                     | Auth   | Purpose and important inputs                                                                                                               |
| ------------------------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `/refineries_audits`     | Public | Submitted refinery audits with input material/quantity, inert/yield, method, cost/time, capacity, reporter, terminal, and location fields. |
| `/refineries_capacities` | Public | Current, weekly, and monthly refinery-capacity reports/averages.                                                                           |
| `/refineries_methods`    | Public | Lists refining methods and their characteristics.                                                                                          |
| `/refineries_yields`     | Public | Yield, cost, and duration statistics by commodity, method, refinery, or location.                                                          |
| `/crew`                  | Public | Community crew directory filtered by specialization, timezone, or availability.                                                            |
| `/polls`                 | Public | Poll catalogue with question, options, status, and current results.                                                                        |
| `/polls_audit`           | Public | Poll and voting audit records for a selected poll.                                                                                         |

### Authenticated user data

| Path                    | Auth | Purpose and important inputs                                                             |
| ----------------------- | ---- | ---------------------------------------------------------------------------------------- |
| `/user_notifications`   | App  | Returns current user notifications, statuses, and timestamps.                            |
| `/user_refineries_jobs` | App  | Returns saved refinery jobs with refinery, method, input/output, cost, time, and status. |
| `/user_trades`          | App  | Returns saved trade transactions with commodity, location, quantity, and value data.     |
| `/wallet_balance`       | App  | Returns the authenticated user's balance and currency information.                       |

## POST methods

| Path                                 | Auth       | Purpose and important inputs                                                                                                                                                                                                                                                                                          |
| ------------------------------------ | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/data_submit`                       | App + user | Submits Data Runner reports. Requires `id_terminal`, `type` (`commodity`, `item`, `vehicle_buy`, `vehicle_rent`), `is_production`, and type-specific `prices[n]` IDs and values. Commodity reports can include buy/sell prices, SCU, status values 1–7, missing flags, quality, faction affinity, and container data. |
| `/marketplace_advertise`             | App        | Creates or advertises a marketplace listing with the documented item/category/service, price, quantity, and listing fields.                                                                                                                                                                                           |
| `/marketplace_negotiations_messages` | App        | Sends a message in a selected marketplace negotiation.                                                                                                                                                                                                                                                                |
| `/user_refineries_jobs_add`          | App        | Adds a refinery job with refinery/terminal, method, input commodity/quantity, timing, cost, and yield data.                                                                                                                                                                                                           |
| `/user_trades_add`                   | App        | Adds a saved trade with commodity, origin/destination, terminals, quantity, and value fields.                                                                                                                                                                                                                         |
| `/user_trades_edit`                  | App        | Updates a saved trade identified by its trade ID.                                                                                                                                                                                                                                                                     |
| `/wallet_add`                        | App        | Adds a wallet transaction or balance adjustment using the published currency/value fields.                                                                                                                                                                                                                            |

## DELETE methods

| Path                           | Auth              | Purpose and important inputs                                                                                                                                           |
| ------------------------------ | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/marketplace_listings`        | Public in sidebar | Deletes a marketplace listing using its documented ID. The official sidebar shows no lock; treat that as a documentation anomaly and verify authentication before use. |
| `/user_refineries_jobs_remove` | App               | Removes a saved refinery job by job ID.                                                                                                                                |
| `/user_trades_remove`          | App               | Removes a saved trade by trade ID.                                                                                                                                     |

## Mining relevance for Rockfall

Useful future UEX integrations include:

1. `/commodities`, `/commodities_raw_prices`, and
   `/commodities_raw_averages` for ore identity and market context.
2. `/poi` for mining-related locations.
3. `/refineries_methods`, `/refineries_yields`, `/refineries_audits`, and
   `/refineries_capacities` for post-extraction planning.
4. `/commodities_routes` for deciding where to sell.

None of those methods owns the base scanner signature used by the current
overlay. Do not infer signatures from price, rarity, location, or commodity
flags.

## Primary sources

- [Official API index and method pages](https://uexcorp.space/api/documentation/)
- [UEX application management](https://uexcorp.space/api/apps)
- [UEX terms](https://uexcorp.space/about/terms)
- [UEX-showcased community OpenAPI definition](https://github.com/dolejska-daniel/uexcorp-openapi/blob/94efaef250e2fb948c7202ea1971043ac1ad2ba6/openapi.base.yaml)
