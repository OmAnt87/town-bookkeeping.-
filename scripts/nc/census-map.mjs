// Maps U.S. Census Bureau individual unit file item codes to Town Ledger categories, for North
// Carolina counties and municipalities (whose Annual Financial Information Report is filed on
// the Census template). Amounts in the files are in thousands of dollars.
//
// Spending is by function (the two digits after E current operations, F construction, G other
// capital outlay, I interest). Principal repaid (39U) counts as debt service, as elsewhere.
// Payments to other governments (L, M) are left out: the receiving government reports that
// spending itself, and in 2024 some counties report their own school system's funding there too,
// which would count it twice.
// Liquor stores (ABC boards), utilities and transit count as enterprise spending and revenue.
// Borrowing (29U), debt balances and insurance trust items are left out.

const FUNCTION = {
  12: 'education', 16: 'education', 18: 'education', 21: 'education',
  24: 'publicSafety', 62: 'publicSafety', 66: 'publicSafety', '04': 'publicSafety', '05': 'publicSafety',
  44: 'roads', 45: 'roads', 94: 'roads', '01': 'roads', 87: 'roads', 60: 'roads',
  80: 'utilities', 81: 'utilities', 91: 'utilities', 92: 'utilities', 93: 'utilities', 90: 'utilities',
  61: 'parks', 52: 'parks', 59: 'parks',
  32: 'healthServices', 36: 'healthServices', 77: 'healthServices', 79: 'healthServices',
  23: 'administration', 25: 'administration', 29: 'administration', 31: 'administration', 50: 'administration', 89: 'administration', '03': 'administration',
};
export const FUNCTION_LABEL = {
  12: 'Schools (elementary and secondary)', 16: 'Community colleges (auxiliary)', 18: 'Community colleges', 21: 'Other education',
  24: 'Fire protection', 62: 'Police', 66: 'Protective inspection', '04': 'Corrections (institutions)', '05': 'Corrections',
  44: 'Streets and highways', 45: 'Toll highways', 94: 'Transit', '01': 'Airports', 87: 'Water transport and terminals', 60: 'Parking',
  80: 'Sewerage', 81: 'Solid waste', 91: 'Water utility', 92: 'Electric utility', 93: 'Gas utility', 90: 'ABC liquor stores',
  61: 'Parks and recreation', 52: 'Libraries', 59: 'Natural resources',
  32: 'Health', 36: 'Hospitals', 77: 'Welfare institutions', 79: 'Social services',
  23: 'Financial administration', 25: 'Judicial and legal', 29: 'Central staff', 31: 'Public buildings', 50: 'Housing and community development', 89: 'General government (other)', '03': 'Other commercial activities',
};
const KIND = { E: 'operations', F: 'construction', G: 'capital equipment', I: 'interest' };

const UTILITY_CHARGES = new Set(['A80', 'A81', 'A90', 'A91', 'A92', 'A93', 'A94']);

// Returns { group: 'revenue'|'spending'|'debt'|'excluded', key, label } or null when unknown.
export function mapItem(code) {
  const c = String(code).trim().toUpperCase();
  const L = c[0];
  const fn = c.slice(1);
  if (c === 'T01') return { group: 'revenue', key: 'propertyTax', label: 'Property tax' };
  if (L === 'T') return { group: 'revenue', key: 'salesTax', label: 'Sales and other local taxes' };
  if (UTILITY_CHARGES.has(c)) return { group: 'revenue', key: 'utilityCharges', label: 'Utility, transit and ABC store charges' };
  if (L === 'A') return { group: 'revenue', key: 'feesPermits', label: 'Charges for services' };
  if (L === 'B') return { group: 'revenue', key: 'federalGrants', label: 'Federal aid' };
  if (L === 'C') return { group: 'revenue', key: 'stateAid', label: 'State aid' };
  if (L === 'D') return { group: 'revenue', key: 'grants', label: 'Aid from other local governments' };
  if (c === 'U30') return { group: 'revenue', key: 'finesForfeitures', label: 'Fines and forfeitures' };
  if (L === 'U') return { group: 'revenue', key: 'localRevenue', label: 'Interest, rents, sale of property, special assessments and other' };
  if (c === '39U') return { group: 'spending', key: 'debtService', label: 'Debt service: principal repaid' };
  if (L === 'I') return { group: 'spending', key: 'debtService', label: 'Debt service: interest' };
  if (L === 'J') return { group: 'spending', key: 'education', label: 'Scholarships and other subsidies' };
  if (L === 'L' || L === 'M') return { group: 'excluded', key: 'intergovernmental', label: 'Payments to other governments' };
  if ('EFG'.includes(L) && FUNCTION[fn]) return { group: 'spending', key: FUNCTION[fn], label: `${FUNCTION_LABEL[fn]} (${KIND[L]})` };
  if (c === '49U' || c === '64V') return { group: 'debt', key: 'debt', label: 'Debt outstanding' };
  if (c === '19U' || c === '29U' || c === '61V' || L === 'Y' || L === 'W' || L === 'X' || L === 'Z') return { group: 'excluded', key: c, label: c };
  return null;
}

// items: [{ code, amount (thousands), flag }] for one government-year.
export function aggregateNc(items) {
  const revenue = {};
  const spending = {};
  const lines = new Map();
  const unmapped = [];
  let intergovernmental = 0;
  let debt = 0;
  let proceeds = 0;
  const flags = { R: 0, I: 0 };
  let revSum = 0;
  let expSum = 0;
  for (const it of items) {
    const amount = (Number(it.amount) || 0) * 1000;
    flags[it.flag === 'I' ? 'I' : 'R']++;
    const m = mapItem(it.code);
    if (!m) { unmapped.push(it.code); continue; }
    if (m.group === 'debt') { debt += amount; continue; }
    if (m.group === 'excluded') {
      if (it.code === '29U') proceeds += amount;
      if (m.key === 'intergovernmental') intergovernmental += amount;
      continue;
    }
    const target = m.group === 'revenue' ? revenue : spending;
    if (m.group === 'revenue') revSum += amount; else expSum += amount;
    target[m.key] = (target[m.key] || 0) + amount;
    const lk = `${m.group}|${m.key}|${m.label}`;
    lines.set(lk, (lines.get(lk) || 0) + amount);
  }
  const has = (re) => items.some((it) => re.test(String(it.code).trim()) && Number(it.amount));
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v));
  return {
    revenue: round(revenue),
    spending: round(spending),
    intergovernmental: Math.round(intergovernmental),
    debt: Math.round(debt),
    proceeds: Math.round(proceeds),
    lines: [...lines].map(([k, amount]) => { const [group, key, label] = k.split('|'); return { group, key, label, amount: Math.round(amount) }; }),
    unmapped,
    lineTotals: { revenue: Math.round(revSum), spending: Math.round(expSum) },
    // The Census fills in units that did not report; those are estimates, not filings.
    imputed: flags.I > flags.R,
    // Some units carry only a few lines: their debt, or just their ABC liquor board. Every
    // county and municipality has property tax or its share of the local sales tax.
    incomplete: !has(/^E/) || !has(/^T0[19]$/),
  };
}
