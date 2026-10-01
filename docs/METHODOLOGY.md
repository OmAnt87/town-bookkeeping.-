# Community Return Score

One question: **how much of a town's money comes back to the people who live there?**

The score runs from 0 to 100 and is the sum of five parts. Each part scales linearly between a "zero points" value and a "full points" value, clamped at both ends. The code lives in `js/engine/scoring.js`.

| Part | Points | Zero at | Full at | Measure |
|---|---|---|---|---|
| Money reaching residents | 30 | 50% | 88% | Direct-service spending / total spending |
| Low overhead | 15 | 30% | 6% | (Administration + consultants & legal) / total spending |
| Low outside political money | 20 | $12.00 | $0.50 | (PAC + developer/contractor + union contributions + town-paid lobbying) / population |
| Transparency | 20 | 0 of 6 | 6 of 6 | Practices followed (see below) |
| Fiscal health | 15 | | | 65%: debt per resident ($6,000 → $300). 35%: operating balance ((revenue − spending) / revenue, −10% → +2%) |

**Grades:** A 85+, B 70–84, C 55–69, D 40–54, F below 40.

## Missing data

A part with no data loaded (for example, no campaign-finance filings yet) is **not scored**. It is left out, and the remaining parts are rescaled to 100. Missing records never count as good or bad. A letter grade is given only when parts worth at least 50 points have data; otherwise the town shows "?" (not graded yet).

For New Jersey budgets, pensions, social security and employee insurance are spread across departments in proportion to their size, so they don't count as overhead. Reserves such as the reserve for uncollected taxes are not spending and are excluded. NJ municipal budgets cover the township's own operations only. School-district and county taxes on the same bill are separate governments and are not included.

## Definitions

- **Direct services:** police, fire and EMS; roads and infrastructure; water, sewer and sanitation; parks, library and recreation; health and human services.
- **Overhead:** general administration, outside consultants and legal, debt service.
- **Revenue beyond property tax:** sales and local-option taxes, state aid, federal grants, fees and permits, utility charges, fines and forfeitures, borrowing, other.
- **Political money:** contributions from organizations (not individuals) to local officials' campaigns, plus lobbying the town pays for. This money is tracked next to the budget but is not part of it.

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
