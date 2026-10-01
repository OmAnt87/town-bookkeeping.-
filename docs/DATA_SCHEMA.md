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
| `revenue` | object of USD | `propertyTax`, `salesTax`, `stateAid`, `federalGrants`, `feesPermits`, `utilityCharges`, `finesForfeitures`, `borrowing`, `otherRevenue` |
| `spending` | object of USD | `publicSafety`, `roads`, `utilities`, `parks`, `healthServices`, `administration`, `consultants`, `debtService` |
| `influence` | object of USD | `pacContributions`, `developerContributions`, `unionContributions`, `lobbyingPaid` |
| `topDonors` | array | `{ name, type, recipient, amount }` |
| `transparency` | object of booleans | `budgetOnline`, `openCheckbook`, `auditOnTime`, `competitiveBidding`, `meetingsRecorded`, `conflictDisclosures` |
| `debt` | number | Total outstanding debt, USD |
| `history` | array | `{ year, revenue, spending }`. Two or more entries draw the trend chart |
| `ledger` | array | `{ date, flow, category, counterparty, description, amount, source }` |
| `sources` | array | `{ label, url }` |

`ledger[].flow` is one of `in` (into the treasury), `out` (paid by the town) or `influence` (political money around the town). `category` is one of the keys above. Amounts are always positive; the flow gives the direction.

The canonical lists live in `js/engine/categories.js`. Validation is `validateDataset` in `js/engine/ledger.js`.
