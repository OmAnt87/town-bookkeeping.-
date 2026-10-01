# Town Ledger

Plain-language bookkeeping for U.S. towns and townships. Town Ledger shows where a town's money comes from (including everything besides property tax), where it goes, and what political money flows around local officials. It then grades how well that money comes back to residents.

![Town report: score, money in, money out, political money, transparency and ledger](docs/town-report.png)

## Features

- **Interactive map.** Every town appears as a dot (or a heat layer), colored by how effectively it spends on residents. You can color it by the overall score, service dollars per resident, share of spending on services, political money per resident, or reliance on revenue other than property tax.
- **Town report card.** Each town gets a letter grade and a Community Return Score out of 100, with a plain-English breakdown of each part of the score.
- **Money in.** Every revenue stream: property tax, sales tax, state aid, federal grants, fees, utility charges, fines and borrowing. Property tax is shown separately.
- **Money out.** Direct services (police, fire, roads, water, parks, health) shown against overhead (administration, consultants, debt).
- **Political money.** PAC, developer, contractor and union contributions to local officials, plus lobbying the town pays for, with a top-contributors table.
- **Transparency check.** Six good-government practices: budget online, open checkbook, on-time audit, competitive bidding, recorded meetings, and conflict-of-interest disclosures.
- **Ledger.** Individual transactions you can search, filter, sort and export to CSV.
- **Five-year trend** of revenue against spending.
- **Rankings.** A sortable, filterable table of every town, exportable to CSV.
- **Compare.** Up to three towns side by side.
- **Bring your own data.** Import a JSON file in the browser, or build one with the scripts below.
- Light and dark themes, works on phones, no build step, no tracking.

## Run it

```bash
npm start          # http://localhost:8080  (Node 18+, no dependencies to install)
npm test           # engine, ledger, importer tests
```

It's a static site, so any static host works, including GitHub Pages (Settings > Pages > deploy from branch, root folder).

## Data

The app ships with **fictional demo towns** (`data/towns.json`, made by `npm run generate:demo`) so every feature works out of the box. The app shows a banner while demo data is loaded.

To use real figures, build a dataset with the pipeline scripts, then load it on the **Data** page or replace `data/towns.json`:

| Source | Script | What it fills |
|---|---|---|
| [Census Annual Survey of Local Government Finances](https://www.census.gov/programs-surveys/gov-finances.html) | `scripts/import-census-finance.mjs` | Revenue and spending by category |
| [USAspending.gov](https://www.usaspending.gov) | `scripts/fetch-usaspending.mjs` | Federal grants and their ledger entries |
| State or county campaign-finance portal (CSV export) | `scripts/import-contributions.mjs` | PAC, developer and union contributions, lobbying, top donors |
| Town budget, audit (ACFR) and website | edit the JSON | Transparency checks, debt, history |

Example:

```bash
node scripts/import-census-finance.mjs --file 2022FinEstDAT.txt --gov-id <14-digit id> \
  --id my-township-pa --name "My Township" --state PA --population 12000 --lat 40.8 --lng -77.7 --year 2022
node scripts/fetch-usaspending.mjs --state PA --city "My Town" --recipient "MY TOWNSHIP" --id my-township-pa --fy 2026
node scripts/import-contributions.mjs --csv contributions.csv --id my-township-pa
# -> data/my-township-pa.json, ready to load on the Data page
```

See [docs/DATA_SCHEMA.md](docs/DATA_SCHEMA.md) for every field and [docs/METHODOLOGY.md](docs/METHODOLOGY.md) for how scores are calculated.

## Project layout

```
index.html, css/, js/app.js     app shell, styles, router
js/views/                       map, town report, rankings, compare, method, data
js/engine/                      pure scoring + ledger logic (shared by app, scripts, tests)
js/charts.js                    small SVG chart helpers
data/towns.json                 demo dataset
scripts/                        demo generator, real-data importers, dev server
tests/                          node --test suite
vendor/                         Leaflet 1.9.4 and Leaflet.heat 0.2.0 (BSD-2-Clause)
```

Map tiles come from CARTO with OpenStreetMap data. State outlines (`data/us-states.json`) are built from the [us-atlas](https://github.com/topojson/us-atlas) package (ISC, U.S. Census Bureau boundaries) and show underneath the tiles, so the map stays usable when tiles are unavailable.
