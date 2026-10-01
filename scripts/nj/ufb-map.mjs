// Maps the NJ DLGS User Friendly Budget (UFB) database's standardized revenue
// sources and appropriation "service types" to Town Ledger categories.
//
// Appropriations: 'shared' = costs that support every department (insurance,
// statutory pension/social-security contributions, shared-service payments to
// other governments). They are spread across categories in proportion to size so
// they neither inflate overhead nor any one service. 'exclude' = reserves that
// are not spending.

export const UFB_REVENUE = {
  'Surplus': 'surplusUsed',
  'Local Revenue': 'localRevenue',
  'State Aid (without offsetting appropriation)': 'stateAid',
  'Uniform Construction Code Fees': 'feesPermits',
  'Shared Services Agreements': 'otherRevenue',
  'Additional Revenue Offset by Appropriations': 'otherRevenue',
  'Public and Private Revenue': 'grants',
  'Other Special Items': 'otherRevenue',
  'Receipts from Delinquent Taxes': 'propertyTax',
  'Local Tax for Municipal Purposes': 'propertyTax',
  'Minimum Library Tax': 'propertyTax',
  'Open Space Levy Tax': 'propertyTax',
  'Arts and Cultural Levy Tax': 'propertyTax',
  'Addition to Local District School Tax': 'propertyTax',
  'Deficit General Budget': 'otherRevenue',
};

export const UFB_APPROPRIATION = {
  'General Government': 'administration',
  'Land-Use Administration': 'administration',
  'Uniform Construction Code': 'publicSafety', // building inspection, as in the Census "protective inspection" function
  'Insurance': 'shared',
  'Public Safety': 'publicSafety',
  'Public Works': 'roads',
  'Health and Human Services': 'healthServices',
  'Parks and Recreation': 'parks',
  'Education (including Library)': 'parks',
  'Unclassified': 'administration',
  'Utilities and Bulk Purchases': 'utilities',
  'Landfill / Solid Waste Disposal': 'utilities',
  'Contingency': 'administration',
  'Statutory Expenditures': 'shared',
  'Judgements': 'administration',
  'Shared Services': 'shared',
  'Court and Public Defender': 'publicSafety',
  'Capital': 'roads',
  'Debt': 'debtService',
  'Deferred Charges': 'debtService',
  'Debt - Type 1 School District': 'debtService',
  'Reserve for Uncollected Taxes': 'exclude',
  'Surplus General Budget': 'exclude',
};

const TOTAL_LABELS = /^(total|total appropriation|total general budget)$/i;

// Finds the column group for a sheet. `kind` is one of:
// realized (prior-year actual revenue), anticipated (budgeted revenue),
// modified (prior-year final appropriations), appropriations (budgeted).
export function groupFor(record, kind) {
  const groups = [...new Set(Object.keys(record).map((k) => k.split('|')[0]))];
  const tests = {
    realized: (g) => /Total Realized Revenues \(Actual\)/i.test(g),
    anticipated: (g) => /Total Anticipated Revenues/i.test(g),
    modified: (g) => /Total Modified Appropriations/i.test(g),
    appropriations: (g) => /Total Appropriations by Service Type/i.test(g) && !/Modified/i.test(g),
  };
  return groups.find(tests[kind]) || null;
}

// Returns [{ label, amount }] for one group, skipping totals and blanks.
export function linesOf(record, group) {
  if (!group) return [];
  return Object.entries(record)
    .filter(([k]) => k.startsWith(`${group}|`))
    .map(([k, v]) => ({ label: k.slice(group.length + 1).trim(), amount: Number(v) || 0 }))
    .filter((l) => l.label && l.label !== 'None' && !TOTAL_LABELS.test(l.label));
}

export function totalOf(record, group) {
  if (!group) return null;
  const key = Object.keys(record).find((k) => k.startsWith(`${group}|`) && TOTAL_LABELS.test(k.slice(group.length + 1).trim()));
  return key ? Number(record[key]) || 0 : null;
}

// Aggregates one year's lines into Town Ledger revenue/spending objects.
export function aggregateUFB(revLines, appLines) {
  const revenue = {};
  const unmapped = [];
  for (const l of revLines) {
    if (!l.amount) continue;
    const key = UFB_REVENUE[l.label];
    if (!key) unmapped.push(`revenue: ${l.label}`);
    const k = key || 'otherRevenue';
    revenue[k] = (revenue[k] || 0) + l.amount;
  }
  const spending = {};
  let shared = 0;
  let excluded = 0;
  for (const l of appLines) {
    if (!l.amount) continue;
    const key = UFB_APPROPRIATION[l.label];
    if (!key) unmapped.push(`appropriation: ${l.label}`);
    const k = key || 'administration';
    if (k === 'shared') shared += l.amount;
    else if (k === 'exclude') excluded += l.amount;
    else spending[k] = (spending[k] || 0) + l.amount;
  }
  const base = Object.values(spending).reduce((a, b) => a + b, 0);
  if (shared && base) for (const k of Object.keys(spending)) spending[k] += (spending[k] / base) * shared;
  for (const k of Object.keys(revenue)) revenue[k] = Math.round(revenue[k]);
  for (const k of Object.keys(spending)) spending[k] = Math.round(spending[k]);
  return { revenue, spending, shared, excluded, unmapped };
}

// NJ's own municipal codes start with the county number (alphabetical order).
export const NJ_COUNTIES = ['Atlantic', 'Bergen', 'Burlington', 'Camden', 'Cape May', 'Cumberland', 'Essex', 'Gloucester',
  'Hudson', 'Hunterdon', 'Mercer', 'Middlesex', 'Monmouth', 'Morris', 'Ocean', 'Passaic', 'Salem', 'Somerset', 'Sussex',
  'Union', 'Warren'];
// Census county FIPS codes for NJ are the odd numbers in the same order.
export const countyFips = (name) => String(NJ_COUNTIES.indexOf(name) * 2 + 1).padStart(3, '0');

export function displayName(ufbName) {
  return ufbName
    .split(/\s+/)
    .map((w) => (/^(of|the|and)$/i.test(w) ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ');
}

const TYPE_WORDS = /\b(township|borough|city|town|village)\b/g;
export const normName = (s) => String(s).toLowerCase().replace(/[.'’]/g, '').replace(TYPE_WORDS, '').replace(/\s+/g, ' ').trim();
