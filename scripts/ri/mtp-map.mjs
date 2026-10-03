// Maps Rhode Island Municipal Transparency Portal (MTP) rows to Town Ledger categories.
//
// The MTP holds each city and town's audited actual results under the state's uniform
// chart of accounts: revenue by account and spending by department. Schools are a separate
// entity; the town's report shows its appropriation to them as "Municipal Education
// Appropriation" under the Education department.
//
// 'benefits' = OPEB (retiree health), and benefits, pension contributions, insurance and
// claims recorded under general government, which many towns pay centrally for the whole
// workforce: spread over the town's own departments by size, not schools or debt service,
// as with benefits in Connecticut. Capital outlays recorded under general government are
// spread across all departments, as with capital outlay in Connecticut.

export const RI_REVENUE_CLASS = {
  'Property Tax': 'propertyTax',
  'State Aid': 'stateAid',
  'Federal Aid': 'federalGrants',
  'Other Revenue': 'otherRevenue',
};
// Local non-property tax revenue, and the one property tax account that is not the levy.
export const RI_REVENUE_ACCOUNT = {
  'PILOT & Tax Treaty (excluded from levy) Collection': 'localRevenue',
  Departmental: 'feesPermits',
  'Licenses and Permits': 'feesPermits',
  'Rescue Run Revenue': 'feesPermits',
  'Police & Fire Detail': 'feesPermits',
  'Investment Income': 'localRevenue',
  'Other Local Non-Property Tax Revenues': 'localRevenue',
  'Fines and Forfeitures': 'finesForfeitures',
};

export const RI_DEPARTMENT = {
  'Police Department': 'publicSafety',
  'Fire Department': 'publicSafety',
  'Public Safety - Other': 'publicSafety',
  'Centralized Dispatch': 'publicSafety',
  'Public Works': 'roads',
  'General Government': 'administration',
  Finance: 'administration',
  Planning: 'administration',
  'Centralized Information Technology': 'administration',
  'Social Services': 'healthServices',
  Libraries: 'parks',
  'Parks and Rec': 'parks',
  Education: 'education',
  'Debt Service': 'debtService',
  OPEB: 'benefits',
};

const TOWN_EXCLUDED = new Set(['education', 'debtService']);
const CENTRAL_GROUPS = new Set(['Benefits', 'ADC Payments']);
const CENTRAL_ACCOUNTS = new Set(['Insurance', 'Claims & Settlements']);

// How one spending row counts: a department key, 'benefits' or 'shared'.
export function spendingKey(r) {
  const key = RI_DEPARTMENT[r.department];
  if (key !== 'administration' || r.department !== 'General Government') return key;
  if (r.account === 'Capital Outlays') return 'shared';
  if (CENTRAL_GROUPS.has(r.group) || CENTRAL_ACCOUNTS.has(r.account)) return 'benefits';
  return key;
}
const num = (v) => Number(v) || 0;

export const revenueKey = (r) => RI_REVENUE_ACCOUNT[r.account] || RI_REVENUE_CLASS[r.cls] || (r.group === 'Local Revenue' ? 'localRevenue' : null);

// rows: one town-year's MTP rows as { control, department, group, cls, account, amount }.
export function aggregateRi(rows) {
  const revenue = {};
  const spending = {};
  const unmapped = new Set();
  let revSum = 0;
  let expSum = 0;
  let benefits = 0;
  let shared = 0;
  const totals = { revenue: 0, spending: 0, financingSources: 0, financingUses: 0, levy: 0 };
  for (const r of rows) {
    const v = num(r.amount);
    if (r.control === 'Revenue') {
      totals.revenue += v;
      const key = revenueKey(r);
      if (!key) { unmapped.add(`revenue: ${r.cls} / ${r.account}`); continue; }
      revSum += v;
      revenue[key] = (revenue[key] || 0) + v;
    } else if (r.control === 'Expenditures') {
      totals.spending += v;
      const key = spendingKey(r);
      if (!key) { unmapped.add(`spending: ${r.department}`); continue; }
      expSum += v;
      if (key === 'benefits') benefits += v;
      else if (key === 'shared') shared += v;
      else spending[key] = (spending[key] || 0) + v;
    } else if (r.control === 'Financing Sources') totals.financingSources += v;
    else if (r.control === 'Financing Uses') totals.financingUses += v;
    else if (r.control === 'Levy') totals.levy += v;
  }
  const base = Object.values(spending).reduce((x, y) => x + y, 0);
  if (shared && base) for (const k of Object.keys(spending)) spending[k] += shared * (spending[k] / base);
  else if (shared) spending.administration = (spending.administration || 0) + shared;
  const townKeys = Object.keys(spending).filter((k) => !TOWN_EXCLUDED.has(k));
  const townBase = townKeys.reduce((a, k) => a + spending[k], 0);
  if (benefits && townBase) for (const k of townKeys) spending[k] += benefits * (spending[k] / townBase);
  else if (benefits) spending.administration = (spending.administration || 0) + benefits;
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v));
  return {
    revenue: round(revenue),
    spending: round(spending),
    benefitsSpread: Math.round(benefits),
    shared: Math.round(shared),
    unmapped: [...unmapped],
    lineTotals: { revenue: revSum, spending: expSum },
    reported: { revenue: totals.revenue, spending: totals.spending },
    excluded: { financingSources: Math.round(totals.financingSources), financingUses: Math.round(totals.financingUses) },
    levy: Math.round(totals.levy),
  };
}
