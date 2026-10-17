# Dataset format

A dataset is a JSON object with a `towns` array. Set `"demo": true` at the top level (or on each town) only for fictional data. That flag turns on the demo banner.

Required fields: `id`, `name`, `state`, `lat`, `lng`, `population`, `revenue`, `spending`. Everything else is optional and the app shows "not loaded" where it is missing.

| Field | Type | Notes |
|---|---|---|
| `id` | string | Unique, URL-safe, e.g. `cherry-hill-township-nj` |
| `name` | string | Display name |
| `state` / `stateName` | string | Two-letter code / full name |
| `county`, `type` | string | `type`: Township, Town, Village, Borough, City |
| `lat`, `lng` | number | Map position |
| `population` | number | Used for all per-resident figures |
| `fiscalYear` | number | Year the figures cover |
| `asOf` | `YYYY-MM-DD` | When the data was pulled |
| `revenue` | object of USD | `propertyTax`, `salesTax`, `stateAid`, `federalGrants`, `localRevenue`, `grants`, `feesPermits`, `utilityCharges`, `finesForfeitures`, `borrowing`, `otherRevenue`, `surplusUsed` (prior-year surplus; excluded from the non-property-tax share) |
| `spending` | object of USD | `publicSafety`, `roads`, `utilities`, `parks`, `healthServices`, `education` (schools paid by the town, as in Connecticut; left out of the services and overhead shares), `administration`, `consultants`, `debtService`, `otherSpending` (spending reported only as a total; services and overhead are then not scored), `surveillance` (Flock/ALPR cameras, facial recognition, ShotSpotter), `corporateDeals` (data center contracts, private-developer subsidies). Set the last two to `0` once checked and none found; leave them out if unknown |
| `taxBreaks` | object of USD | `dataCenterAbatements`, `corporateAbatements`. Revenue given up to corporations; not counted in revenue totals |
| `redFlags` | array | Documented programs and deals with no dollar figure: `{ kind, label, vendor, agency, date, detail, source \| sources }`. `kind` is `surveillance`, `dataCenter`, `corporateSubsidy` or `corporateLobbying`. An empty array means checked and none found. `scored: false` shows a record without counting it |
| `surveillanceMap` | object | `{ cameras, flock, townOperated, asOf, source }`: license-plate cameras mapped inside the town. Shown on the report; Flock cameras are also added to `redFlags` |
| `influence` | object of USD | `pacContributions`, `developerContributions`, `unionContributions`, `corporateLobbying` (companies lobbying town officials), `lobbyingPaid` (lobbyists the town hires) |
| `topDonors` | array | `{ name, type, recipient, amount }` |
| `transparency` | object of booleans | `budgetOnline`, `openCheckbook`, `auditOnTime`, `competitiveBidding`, `meetingsRecorded`, `conflictDisclosures` |
| `debt` | number | Total outstanding debt, USD |
| `history` | array | `{ year, revenue, spending }`. Two or more entries draw the trend chart |
| `ledger` | array | `{ date, flow, category, counterparty, description, amount, source }` |
| `sources` | array | `{ label, url }` |
| `notes` | array of strings | Plain-language notes on how the figures were prepared, shown under Sources |

`ledger[].flow` is one of `in` (into the treasury), `out` (paid by the town) or `influence` (political money around the town). `category` is one of the keys above. Amounts are always positive; the flow gives the direction.

The canonical lists live in `js/engine/categories.js`. Validation is `validateDataset` in `js/engine/ledger.js`.

## Reporting context and availability

`reporting` is an optional object containing `basis`, `scope`, `politicalPeriod`,
and `politicalScope` strings. These describe the financial reporting basis and
fund coverage, and the political record window and recipient population. The
county builders derive them from their existing source notes; the summary builder
retains them. Older datasets remain supported and display **Not recorded** for
missing metadata. Do not fill metadata from a state abbreviation alone.

Missing fields differ from explicit zero. Displays use **Not available** for
unknown figures and **Not graded** below the existing 50-point coverage threshold.
A documented surveillance program with no price does not establish zero cost.
Coverage shows both component count and the available original scoring weight.
Comparison highlights require known, matching relevant reporting context and
available values. Red-flag and tax-break comparisons do not declare winners,
because the schema does not establish comparable investigation coverage.

Imports validate unique URL-safe IDs, finite numeric amounts and population,
coordinate bounds, object/array shapes, source URLs, and required ledger fields.
Signed ledger adjustments remain supported because public filings include them.
A top-level `demo: true` marks every imported town as fictional.

Summary downloads omit ledger, history, donors, source notes and source lists.
Complete downloads fetch all referenced county details before producing a file;
a failed request identifies the town/file and produces no partial download.
