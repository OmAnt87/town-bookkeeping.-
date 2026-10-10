# Community Return Score

One question: **how much of a town's money comes back to the people who live there?**

The score runs from 0 to 100 and is the sum of six parts. Each part scales linearly between a "zero points" value and a "full points" value, clamped at both ends. The code lives in `js/engine/scoring.js`.

| Part | Points | Zero at | Full at | Measure |
|---|---|---|---|---|
| Money reaching residents | 25 | 50% | 88% | Direct-service spending / total spending (not counting schools) |
| Low overhead | 10 | 30% | 6% | (Administration + consultants & legal) / total spending (not counting schools) |
| No surveillance or corporate giveaways | 10 | 5% or 4 documented | 0% and none | The lower of: (surveillance tech + corporate deals + corporate tax breaks) / total spending, and 1 − ¼ per documented program or deal |
| Low outside political money | 20 | $12.00 | $0.50 | (Corporate lobbying + PAC + developer/contractor + union contributions + town-paid lobbying) / population |
| Transparency | 20 | 0 of 6 | 6 of 6 | Practices followed (see below) |
| Fiscal health | 15 | | | 65%: debt per resident ($6,000 → $300). 35%: operating balance ((revenue − spending) / revenue, −10% → +2%) |

**Grades:** A 85+, B 70–84, C 55–69, D 40–54, F below 40.

## Missing data

A part with no data loaded (for example, no campaign-finance filings yet) is **not scored**. It is left out, and the remaining parts are rescaled to 100. Missing records never count as good or bad. A letter grade is given only when parts worth at least 50 points have data; otherwise the town shows "?" (not graded yet).

For New Jersey budgets, pensions, social security and employee insurance are spread across departments in proportion to their size, so they don't count as overhead. Reserves such as the reserve for uncollected taxes are not spending and are excluded. NJ municipal budgets cover the township's own operations only. School-district and county taxes on the same bill are separate governments and are not included.

For New York, figures are **actual results** from each government's Annual Financial Report to the State Comptroller, not budgets. Money the government only holds or passes along is left out: custodial and trust funds (for example, property taxes a town collects for school districts and the county), its internal self-insurance fund, transfers between its own funds, and bond refinancing. Employee benefits are spread across departments, as in New Jersey. Law and engineering costs count as outside consultants. A village's figures cover the village government only; its residents also pay the surrounding town, which is listed separately.

For Pennsylvania, figures are **actual results** from each municipality's Annual Audit and Financial Report (DCED-CLGS-30). "Other financing sources and uses" (transfers between funds, borrowing, refinancing) are left out because the statewide report does not break them down. "Other expenditures" (mostly insurance, pensions and benefits) are spread across departments. Taxes the statewide report does not itemize are shown as other local taxes. Political money is not scored, because municipal campaign reports are filed with each county, not the state.

## Red flags: surveillance and corporate giveaways

Some spending works against residents, so it counts against the score:

- **Surveillance tech:** Flock and other license-plate reader (ALPR) cameras, facial recognition, ShotSpotter, real-time crime centers.
- **Corporate deals:** data center contracts (water, power and road work built for a data center), subsidies to private developers.
- **Corporate tax breaks** (`taxBreaks`): data center abatements, discounted PILOT agreements and other corporate abatements. These are revenue the town gave up, so they are shown next to Money in, not inside it.

Most public records say a town *uses* a technology or *approved* a deal, not what it cost. Those go in `redFlags` and are scored by count: each distinct documented program or deal (license-plate readers, police drones, a data center tax break, corporate lobbying of officials, ...) costs a quarter of the part's points. Several records about the same program count once. Flock cameras are the deliberate exception: any Flock camera mapped inside a town is its own flag ("Flock camera network"), on top of any police license-plate-reader record, because Flock pools every scan into a search network shared with agencies nationwide.

Payments to known surveillance vendors and data center deals are flagged by name (`RED_FLAG_PATTERNS` in `js/engine/categories.js`) even when a town files them under police or general spending; those payments are moved out of direct services. The part is scored only when red-flag data has been checked for a town (a `surveillance` or `corporateDeals` spending line, even 0, a `taxBreaks` record, or a flagged ledger payment).

## Corporate lobbying

Corporate lobbying of town officials (`corporateLobbying`) is tracked separately from lobbying the town pays for. Each report shows how much of a town's political money came from corporations (corporate lobbying + business and contractor contributions), how that compares with the tax breaks the town gave away, and which companies both lobbied or donated **and** were paid by the town (a pay-to-play check that matches names across the ledger).

For Connecticut, figures are **actual general-fund results** reported to the Office of Policy and Management (Municipal Fiscal Indicators) for fiscal years ending June 30. Connecticut towns pay for public schools through the town budget. In most other states school districts are separate governments, so school spending is shown on Connecticut reports but left out of the services and overhead shares. Spending by department comes from the state's Uniform Chart of Accounts, and only for a year whose total matches the financial statements to the dollar; capital outlay and "other" are spread across departments, and employee benefits recorded under general government (town-wide health insurance and pensions) are spread across the town's own departments, not schools or debt. When no matching breakdown exists, spending other than schools and debt is shown as one total and the services and overhead parts are not scored. Transfers between funds and other financing sources are left out. Candidates for town office file with their town clerk, so political money comes from each town's party town committees, which file with the State Elections Enforcement Commission: contributions from PACs and unions, program-book ads bought by businesses (corporate contributions are banned in Connecticut), and gifts the Commission flags as from registered lobbyists or state contractors.

For Massachusetts, figures are **actual general-fund results** each city and town reports to the Department of Revenue's Division of Local Services on its annual Schedule A, for fiscal years ending June 30. As in Connecticut, cities and towns pay for public schools (including assessments to regional school districts), so school spending is shown but left out of the services and overhead shares. Schedule A reports spending by function. Fixed costs (health insurance, pensions and other benefits for town and school staff) are spread across departments by size, schools included but not debt service; intergovernmental assessments (charter school tuition, regional transit, county and state charges) and other spending are spread across all departments. Schedule A "Taxes" include motor vehicle and local option excises, which are taken from the state's actual local receipts and shown as other local taxes; the rest is property tax. Transfers between funds and other financing sources are left out. Political money comes from the Office of Campaign and Political Finance: contributions from unions and registered PACs to each town's party ward, town and city committees and to its candidates for mayor and city council (corporate contributions are banned in Massachusetts). Candidates for other town offices file with their town clerk and are not included.

For Rhode Island, figures are **audited actual results** each city and town reports to the Division of Municipal Finance under the state's uniform chart of accounts (Municipal Transparency Portal), for fiscal years ending June 30. School departments and regional school districts report separately and receive state school aid directly, so reports show the town's appropriation to its schools, left out of the services and overhead shares. Retiree health (OPEB) and the benefits, pension contributions, insurance and claims recorded under general government are spread across the town's own departments; capital outlays recorded under general government are spread across all departments. Debt outstanding is not available, so fiscal health is not scored. Political money comes from the Board of Elections: PAC contributions to local candidates (placed in a town by their filing address) and party city and town committees. Corporate contributions to candidates are banned in Rhode Island, and filers who have also run for state office are left out.

For Maryland, figures are **actual results** from each municipality's uniform financial report to the Department of Legislative Services, which DLS adjusts and reconciles to audited financial statements (Local Government Finances in Maryland), for fiscal years ending June 30. Governmental operating, governmental capital and enterprise funds are all counted, so town-run utilities and capital spending are included; debt proceeds are left out. Miscellaneous spending (pensions, health insurance, Social Security, judgments) is spread across departments by size, except debt service, and economic and community development count as overhead, as in New York and Pennsylvania. Counties provide schools and most other services, so municipal budgets are small. Baltimore City runs its own schools; its transfers to the school system are shown but left out of the services and overhead shares. Municipal candidates file campaign reports with their municipality, so political money is not scored.

For Virginia, counties and independent cities are listed alongside towns, since Virginia has no townships and the county or city is everyone's local government. Figures are **actual results** each locality reports to the Auditor of Public Accounts from its audited financial statements (Comparative Report of Local Government Revenues and Expenditures), for fiscal years ending June 30: general government, capital projects, debt service and enterprise funds. Counties and cities run schools; school spending is shown but left out of the services and overhead shares. Judicial administration and community development count as overhead; non-departmental spending and capital projects other than schools and roads are spread across departments. Borrowing, non-revenue receipts, transfers and depreciation are left out. Political money comes from the Department of Elections: contributions from businesses (allowed in Virginia), unions and PACs to local candidates, placed in a locality by their filing address.

For North Carolina, counties are listed alongside cities, towns and villages, since North Carolina has no townships. Figures are **actual results** from the Annual Financial Information Report each government files with the Local Government Commission on the Census Bureau's template, as published in the Census individual unit files: every government for FY 2022, and the sampled governments for FY 2023 and 2024, using each one's latest year. Governments whose figures the Census mostly estimated (imputed) are left out. All funds are counted, including utilities and ABC liquor stores. Counties fund the public schools, which the Census counts as part of the county; school spending is shown but left out of the services and overhead shares. Debt service counts interest and principal repaid; borrowing and payments to other governments (reported by the government receiving them) are left out. Courts, legal services, public buildings and community development count as overhead. Political money comes from the State Board of Elections: contributions from PACs, unions and other organizations (corporate contributions are banned) to county and municipal candidates, placed by office and filing address.

For South Carolina, counties are listed alongside cities and towns. Figures are **actual results** each government reported to the Census Bureau's Annual Survey of State and Local Government Finances, from the Census individual unit files, using the same mapping as North Carolina: every government for FY 2022 and the sampled governments for FY 2023 and 2024, using each one's latest year. Governments whose figures the Census mostly estimated, or whose records are incomplete (no operating spending, no property or sales tax, or spending under a quarter of revenue), are left out. All funds are counted, including utilities. School districts are separate governments, so schools are not included. Payments to other governments and borrowing are left out. Political money comes from the State Ethics Commission: contributions from businesses (allowed in South Carolina), unions and PACs to county and municipal candidates, placed by the office sought; solicitors, school boards and special purpose districts are left out.

For Georgia, counties and consolidated city-county governments are listed alongside cities and towns. Figures are **actual results** from the Report of Local Government Finance each government files with the Department of Community Affairs (from audited figures where available), using each government's latest report from FY 2022 on: taxes and other revenue by UCOA account, intergovernmental revenue, utility and enterprise revenue, spending by UCOA function (current operations and capital outlay) and enterprise fund expenses. Debt service is long-term principal retired plus interest; debt is all debt outstanding at year end, including short-term notes. School districts are separate governments, so schools are not included. Payments to other governments, including SPLOST proceeds passed from counties to cities, are left out. Courts, planning and economic development count as overhead. County and city candidates file campaign reports locally, so political money is not scored.

For Florida, counties are listed alongside cities, towns and villages; Jacksonville is consolidated with Duval County. Figures are **actual results** from the Annual Financial Report each government files with the Department of Financial Services, as compiled by the Office of Economic and Demographic Research, by Uniform Accounting System account code and fund type, using each government's latest year from FY 2022 on. General, special revenue, debt service, capital projects, permanent and enterprise funds are counted; internal service funds, fiduciary funds (pension, trust, custodial), component units, transfers, borrowing and other financing are left out. Enterprise funds report accrual expenses, so utility spending includes depreciation rather than capital purchases. Counties include their constitutional officers. School districts are separate governments, so schools are not included. Debt outstanding is not in the EDR data, so fiscal health is not scored, and local candidates file campaign reports locally, so political money is not scored.

For Delaware, counties are listed alongside cities and towns. Delaware has no statewide compilation of local finances, so figures are **actual results** each government reported to the Census Bureau's Annual Survey of State and Local Government Finances, with the same mapping and the same exclusions as North and South Carolina (estimated or incomplete records are left out). School districts are separate governments. Political money comes from the Department of Elections' Campaign Finance Reporting System: contributions from businesses (allowed in Delaware), unions, PACs and non-profits to county candidates and to municipal candidates who raise more than $5,000, placed by the county or municipality each committee's office names and classified by the contributor type reported.

For New Hampshire, counties are listed alongside cities and towns. Figures are **actual results** each government reported to the Census Bureau's Annual Survey of State and Local Government Finances, with the same mapping and exclusions as the Carolinas and Delaware (estimated or incomplete records are left out); the Census counts New Hampshire's towns as township governments. Each town and city collects the whole property tax bill and pays the school district's, the county's and the state education tax shares over. Where a town reported the whole levy to the Census as its own property tax, only the town's share is counted: what its spending needed beyond its other revenue, which is how the Department of Revenue Administration sets the town rate (so those towns show no surplus or deficit). A town with no schools of its own whose "other general government" spending is more than 40% of its budget is taken to have filed its school and county assessments as its own spending; that amount is left out as a payment to other governments. Most schools are run by separate school districts; cities that run their own school departments show school spending, left out of the services and overhead shares. Local candidates file campaign reports with their town or city clerk, so political money is not scored.

For Vermont and Maine, figures come from the same Census unit files and are handled the same way as New Hampshire, including the property tax and assessment rules. Vermont towns collect the state education property tax, which pays for schools through the state Education Fund, and the county tax; Vermont's incorporated villages are a second layer inside a town, levy only their own tax and are listed separately, and Vermont counties have very small budgets. Maine towns collect their assessment for the regional school unit or school district and the county tax; Maine's plantations are a simpler form of town government. In both states, cities and towns that run their own school departments show school spending, left out of the services and overhead shares. Local candidates do not file with the state, so political money is not scored.

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

## Display and comparison safeguards

The trust and usability release does not change component weights, thresholds,
normalization, or grades. Below 50 available points, the UI shows **Not graded**
instead of promoting the normalized partial score; individual components remain
visible. Unknown metrics sort last in either direction, use gray map markers,
and do not contribute to heat or color-scale calculations. Recorded zero remains
zero. Unitemized service totals are not presented as zero service spending.

Each grade includes fiscal year, retrieval date, component count and available
scoring weight. **Public-record data** identifies source-backed records; it is not
an independent verification claim. Cross-year and cross-scope figures may be
viewed side by side, but winner highlights require matching relevant metadata.
Political periods and recipient scopes must match for political comparisons.
Overall-score highlights also require the same available components.

The existing partial-transparency policy is unchanged: once any practice is
reported, unknown practices receive no points within that component. This differs
from excluding a wholly unavailable component and is a candidate for a separate
methodology revision. No new transparency observations are inferred in this release.
