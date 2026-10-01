# Community Return Score

One question: **how much of a town's money comes back to the people who live there?**

The score runs from 0 to 100 and is the sum of six parts. Each part scales linearly between a "zero points" value and a "full points" value, clamped at both ends. The code lives in `js/engine/scoring.js`.

| Part | Points | Zero at | Full at | Measure |
|---|---|---|---|---|
| Money reaching residents | 25 | 50% | 88% | Direct-service spending / total spending |
| Low overhead | 10 | 30% | 6% | (Administration + consultants & legal) / total spending |
| No surveillance or corporate giveaways | 10 | 5% or 4 documented | 0% and none | The lower of: (surveillance tech + corporate deals + corporate tax breaks) / total spending, and 1 − ¼ per documented program or deal |
| Low outside political money | 20 | $12.00 | $0.50 | (Corporate lobbying + PAC + developer/contractor + union contributions + town-paid lobbying) / population |
| Transparency | 20 | 0 of 6 | 6 of 6 | Practices followed (see below) |
| Fiscal health | 15 | | | 65%: debt per resident ($6,000 → $300). 35%: operating balance ((revenue − spending) / revenue, −10% → +2%) |

**Grades:** A 85+, B 70–84, C 55–69, D 40–54, F below 40.

## Missing data

A part with no data loaded (for example, no campaign-finance filings yet) is **not scored**. It is left out, and the remaining parts are rescaled to 100. Missing records never count as good or bad. A letter grade is given only when parts worth at least 50 points have data; otherwise the town shows "?" (not graded yet).

For New Jersey budgets, pensions, social security and employee insurance are spread across departments in proportion to their size, so they don't count as overhead. Reserves such as the reserve for uncollected taxes are not spending and are excluded. NJ municipal budgets cover the township's own operations only. School-district and county taxes on the same bill are separate governments and are not included.

## Red flags: surveillance and corporate giveaways

Some spending works against residents, so it counts against the score:

- **Surveillance tech:** Flock and other license-plate reader (ALPR) cameras, facial recognition, ShotSpotter, real-time crime centers.
- **Corporate deals:** data center contracts (water, power and road work built for a data center), subsidies to private developers.
- **Corporate tax breaks** (`taxBreaks`): data center abatements, discounted PILOT agreements and other corporate abatements. These are revenue the town gave up, so they are shown next to Money in, not inside it.

Most public records say a town *uses* a technology or *approved* a deal, not what it cost. Those go in `redFlags` and are scored by count: each distinct documented program or deal (license-plate readers, police drones, a data center tax break, corporate lobbying of officials, ...) costs a quarter of the part's points. Several records about the same program count once.

Payments to known surveillance vendors and data center deals are flagged by name (`RED_FLAG_PATTERNS` in `js/engine/categories.js`) even when a town files them under police or general spending; those payments are moved out of direct services. The part is scored only when red-flag data has been checked for a town (a `surveillance` or `corporateDeals` spending line, even 0, a `taxBreaks` record, or a flagged ledger payment).

## Corporate lobbying

Corporate lobbying of town officials (`corporateLobbying`) is tracked separately from lobbying the town pays for. Each report shows how much of a town's political money came from corporations (corporate lobbying + business and contractor contributions), how that compares with the tax breaks the town gave away, and which companies both lobbied or donated **and** were paid by the town (a pay-to-play check that matches names across the ledger).

## Definitions

- **Direct services:** police, fire and EMS; roads and infrastructure; water, sewer and sanitation; parks, library and recreation; health and human services.
- **Overhead:** general administration, outside consultants and legal, debt service.
- **Red-flag spending:** surveillance tech and corporate deals. Neither counts as a direct service.
- **Revenue beyond property tax:** sales and local-option taxes, state aid, federal grants, fees and permits, utility charges, fines and forfeitures, borrowing, other.
- **Political money:** corporate lobbying of town officials, contributions from organizations (not individuals) to local officials' campaigns, plus lobbying the town pays for. This money is tracked next to the budget but is not part of it.

## Transparency practices

1. Publishes its full budget online
2. Posts an open checkbook of payments
3. Files its annual audit on time
4. Bids out large contracts competitively
5. Records and posts public meetings
6. Officials file conflict-of-interest disclosures

Unknown practices count as not followed, and the report shows them as "Unknown".

## Limits

- Towns classify spending differently, so the Census mapping in `scripts/census-codes.mjs` is a best-effort grouping.
- A political contribution is context, not proof of wrongdoing.
- Thresholds are judgment calls meant for comparison between towns. Change them in `COMPONENTS` and the whole app updates.
