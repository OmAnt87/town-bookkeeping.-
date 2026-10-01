// Maps Connecticut OPM Municipal Fiscal Indicators to Town Ledger categories.
//
// Revenue comes from the financial statement section (property tax, state, federal, all other).
// Spending comes from the Uniform Chart of Accounts (UCOA) departments when the town's UCOA
// total matches its financial statement total; otherwise only schools and debt service are
// known and the rest is 'otherSpending' (not broken down).
//
// 'shared' = capital outlay and "other", spread across departments by size as with
// employee benefits in NJ and NY and "other expenditures" in PA. Employee benefits
// recorded under general government (town-wide health insurance and pensions) are
// spread over the town's own departments, not schools or debt service.

export const CT_REVENUE = {
  d_3_property_tax_revenue: ['propertyTax', 'Property tax'],
  d_6_state_revenues: ['stateAid', 'State revenue (state aid and grants)'],
  d_9_federal_revenues: ['federalGrants', 'Federal revenue'],
  d_12_all_other_revenues: ['otherRevenue', 'All other revenue (fees, charges, interest and other local sources)'],
};

export const CT_DEPARTMENT = {
  4100: 'administration',
  4201: 'publicSafety',
  4203: 'publicSafety',
  4299: 'publicSafety',
  4303: 'roads',
  4317: 'utilities',
  4330: 'utilities',
  4399: 'roads',
  4401: 'healthServices',
  4427: 'healthServices',
  4499: 'healthServices',
  4501: 'parks',
  4503: 'parks',
  4599: 'parks',
  4700: 'education',
  4705: 'education',
  4899: 'debtService',
  4900: 'shared',
  5000: 'shared',
};

const num = (v) => Number(v) || 0;
const TOWN_EXCLUDED = new Set(['education', 'debtService']);

// fs: one financial statement row; depts: that town-year's UCOA department rows
// (4-digit department codes), or null when the breakdown is missing or does not match.
export function aggregateCt(fs, depts) {
  const revenue = {};
  let revSum = 0;
  for (const [col, [key]] of Object.entries(CT_REVENUE)) {
    const v = num(fs[col]);
    revSum += v;
    if (v) revenue[key] = (revenue[key] || 0) + v;
  }
  const spending = {};
  let shared = 0;
  let benefitsSpread = 0;
  let expSum = 0;
  const unmapped = [];
  if (depts) {
    for (const d of depts) {
      const v = num(d.total);
      expSum += v;
      if (!v) continue;
      const key = CT_DEPARTMENT[d.department_code];
      if (!key) { unmapped.push(d.department_code); spending.administration = (spending.administration || 0) + v; continue; }
      if (key === 'shared') shared += v;
      else spending[key] = (spending[key] || 0) + v;
    }
    // Benefits filed under general government cover the whole town workforce
    // (schools keep their own), so they go to the town's own departments.
    const gg = depts.find((d) => d.department_code === '4100');
    benefitsSpread = Math.min(num(gg?.employee_benefits), spending.administration || 0);
    if (benefitsSpread) spending.administration -= benefitsSpread;
    const base = Object.values(spending).reduce((a, b) => a + b, 0);
    if (shared && base) for (const k of Object.keys(spending)) spending[k] += shared * (spending[k] / base);
    else if (shared) spending.administration = (spending.administration || 0) + shared;
    const townKeys = Object.keys(spending).filter((k) => !TOWN_EXCLUDED.has(k));
    const townBase = townKeys.reduce((a, k) => a + spending[k], 0);
    if (benefitsSpread && townBase) for (const k of townKeys) spending[k] += benefitsSpread * (spending[k] / townBase);
    else if (benefitsSpread) spending.administration = (spending.administration || 0) + benefitsSpread;
  } else {
    const parts = { education: num(fs.d_20_total_education), debtService: num(fs.d_21_debt_service_expenditures), otherSpending: num(fs.d_24_all_other_expenditures) };
    for (const [k, v] of Object.entries(parts)) { expSum += v; if (v) spending[k] = v; }
  }
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v));
  return {
    revenue: round(revenue),
    spending: round(spending),
    shared: Math.round(shared),
    benefitsSpread: Math.round(benefitsSpread),
    unmapped,
    lineTotals: { revenue: revSum, spending: expSum },
    reported: { revenue: num(fs.d_15_total_revenues), spending: num(fs.d_26_total_expenditures) },
    excluded: { transfersIn: num(fs.d_28_transfers_in), transfersOut: Math.abs(num(fs.d_29_transfers_out)), netOtherFinancing: num(fs.d_39_total_net_other_financing) },
  };
}
