// Maps the NJ DLGS User Friendly Budget (UFB) database's standardized revenue
// sources and appropriation "service types" to TownView categories.
//
// Appropriations: 'shared' = costs that support every department (insurance,
// statutory pension/social-security contributions, shared-service payments to
// other governments). They are spread across categories in proportion to size so
// they neither inflate overhead nor any one service. 'exclude' = reserves that
// are not spending.

import { cleanHistory as cleanTrend } from '../../js/engine/validate.js';

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

// Aggregates one year's lines into TownView revenue/spending objects.
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

// Property-tax lines that stay with the municipality. Everything else on the
// tax bill goes to the school districts, the county and fire districts.
const MUNICIPAL_TAX_LINES = ['Local Tax for Municipal Purposes', 'Minimum Library Tax', 'Open Space Levy Tax',
  'Arts and Cultural Levy Tax', 'Addition to Local District School Tax'];

const numberAt = (record, re) => {
  const k = Object.keys(record).find((x) => re.test(x));
  const v = k ? Number(record[k]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : 0;
};

// School, county and fire-district taxes the town collected and paid over in
// the calendar year before the filing (the year its realized revenue covers):
// total tax collections minus the municipal tax lines. Returns null when the
// filing has no usable figures. Some filings key collections or levy in the
// wrong unit (thousands, or a placeholder), so the larger of the two is used,
// and only when it is a plausible multiple of the municipal tax.
export function passThroughOf(record) {
  if (!record || record['Status|No UFB Available']) return null;
  const collected = numberAt(record, /^Tax Collections and Delinquent Taxes\|Total Tax Revenue, Collections/);
  const levy = numberAt(record, /^Tax Collections and Delinquent Taxes\|Total Tax Levy/);
  const realized = groupFor(record, 'realized');
  if (!realized) return null;
  const municipal = MUNICIPAL_TAX_LINES.reduce((a, l) => a + (Number(record[`${realized}|${l}`]) || 0), 0);
  const total = Math.max(collected, levy);
  if (municipal <= 0 || total < 1.1 * municipal || total > 30 * municipal) return null;
  return { amount: Math.round(total - municipal), total: Math.round(total), basis: total === collected ? 'collections' : 'levy' };
}

// History years from the budget filings that are not real results: a year
// whose revenue and spending repeat the previous year exactly (a filing copied
// forward), or a partial total far from the town's other years.
export function cleanBudgetHistory(history) {
  const median = (xs) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };
  const actual = history.filter((h) => h.basis === 'actual');
  const mr = median(actual.map((h) => h.revenue));
  const ms = median(actual.map((h) => h.spending));
  const dropped = [];
  const kept = [];
  for (const h of history) {
    const prev = kept.at(-1);
    const stale = prev && h.basis === 'actual' && prev.revenue === h.revenue && prev.spending === h.spending;
    const off = h.basis === 'actual' && actual.length >= 3
      && (h.revenue < 0.4 * mr || h.revenue > 2.5 * mr || h.spending < 0.4 * ms || h.spending > 2.5 * ms);
    if (stale || off) dropped.push(h.year);
    else kept.push(h);
  }
  return { history: kept, dropped };
}

// One town's filings by year: Map(year -> UFB record), matched on the state's municipal code.
export const muniCode = (r) => String(r['|Muni-code']).padStart(4, '0');
export function filingsFor(byYear, code) {
  const out = new Map();
  for (const [y, rows] of Object.entries(byYear)) {
    const r = [...rows.values()].find((x) => muniCode(x) === code);
    if (r) out.set(Number(y), r);
  }
  return out;
}

const PASS_THROUGH_NOTE = /^(Covers the municipal budget only|Includes \$[\d,]+ of school-district|School-district, county and fire-district taxes the town collects)/;

// Adds the school, county and fire-district taxes a town collects and pays
// over to its money in and out, and rebuilds its history from the filings.
// `filings` is filingsFor(...); `town` already has its budget revenue and
// spending. Safe to run again on a town it has already updated.
export function applyPassThrough(town, filings, source) {
  delete town.revenue.taxesForOtherGovernments;
  delete town.spending.paidToOtherGovernments;
  town.ledger = (town.ledger || []).filter((e) => e.category !== 'taxesForOtherGovernments' && e.category !== 'paidToOtherGovernments');
  const budgetRevenue = Object.values(town.revenue).reduce((a, b) => a + b, 0);
  const budgetSpending = Object.values(town.spending).reduce((a, b) => a + b, 0);

  // Each filing's pass-through taxes, without one-year spikes (a filing keyed
  // in the wrong unit or with a stray total).
  const passes = new Map([...filings].map(([y, r]) => [y, passThroughOf(r)]).filter(([, p]) => p));
  // A spike is a year 40% or more away from both neighbors while they agree.
  const near = (a, b) => a < 1.4 * b && b < 1.4 * a;
  const series = [...passes].sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < series.length - 1; i++) {
    const [prev, [y, cur], next] = [series[i - 1][1].amount, series[i], series[i + 1][1].amount];
    if (near(prev, next) && !near(cur.amount, prev) && !near(cur.amount, next)) passes.delete(y);
  }

  // The newest filing up to two years before the budget year with usable figures.
  let head = null;
  for (let y = town.fiscalYear; y >= town.fiscalYear - 2 && !head; y--) {
    if (passes.has(y)) head = { ...passes.get(y), year: y - 1 };
  }

  // History: each filing's prior-year actual revenue and final appropriations,
  // plus that year's pass-through taxes. Once a town has pass-through taxes, a
  // year without them is left out rather than drawn as a sudden drop.
  const raw = [];
  for (const [y, h] of [...filings.entries()].sort((a, b) => a[0] - b[0])) {
    if (h['Status|No UFB Available']) continue;
    const real = totalOf(h, groupFor(h, 'realized'));
    const mod = linesOf(h, groupFor(h, 'modified')).filter((l) => UFB_APPROPRIATION[l.label] !== 'exclude').reduce((a, l) => a + l.amount, 0);
    if (real > 0 && mod > 0) raw.push({ year: y - 1, revenue: Math.round(real), spending: Math.round(mod), basis: 'actual', pass: passes.get(y)?.amount ?? null });
  }
  raw.push({ year: town.fiscalYear, revenue: budgetRevenue, spending: budgetSpending, basis: 'budget', pass: head?.amount ?? null });
  const dedup = Object.values(Object.fromEntries(raw.map((h) => [h.year, h]))).sort((a, b) => a.year - b.year);
  // Prior-year actuals are sometimes filed only in part (realized revenue under half
  // of the appropriations it paid for). Realized revenue routinely runs well above
  // appropriations in small towns (surplus regenerated, delinquent taxes), so only
  // gaps past 2.5x count.
  const filed = dedup.filter((h) => h.basis === 'budget' || (h.revenue / h.spending >= 0.5 && h.revenue / h.spending <= 2.5));
  const { history: clean, dropped } = cleanBudgetHistory(filed);
  dropped.push(...dedup.filter((h) => !filed.includes(h)).map((h) => h.year));
  const missingPass = [];
  town.history = clean.filter((h) => {
    if (!head || h.pass != null) return true;
    missingPass.push(h.year);
    return false;
  }).map(({ pass, ...h }) => (head ? { ...h, revenue: h.revenue + pass, spending: h.spending + pass } : h));
  const trend = cleanTrend(town.history);
  dropped.push(...town.history.filter((h) => !trend.includes(h)).map((h) => h.year));
  town.history = trend;
  if (town.reporting?.basis) {
    town.reporting.scope = head ? 'Municipal operations, plus school, county and fire-district taxes collected and paid over' : 'Municipal operations; excludes schools and county';
  }

  town.notes = (town.notes || []).filter((n) => !PASS_THROUGH_NOTE.test(n));
  if (head) {
    town.revenue.taxesForOtherGovernments = head.amount;
    town.spending.paidToOtherGovernments = head.amount;
    const date = `${head.year}-12-31`;
    const what = `School, county and fire-district taxes (${head.year} tax ${head.basis} of $${head.total.toLocaleString('en-US')}, less the municipal share)`;
    town.ledger.unshift(
      { date, flow: 'in', category: 'taxesForOtherGovernments', counterparty: 'Property-tax bill: other governments\' share', description: `${what} collected`, amount: head.amount, source },
      { date, flow: 'out', category: 'paidToOtherGovernments', counterparty: 'School districts, county and fire districts', description: `${what} paid over`, amount: head.amount, source },
    );
    town.notes.unshift(`Includes $${head.amount.toLocaleString('en-US')} of school-district, county and fire-district taxes the town collects on the property-tax bill and pays over to those governments (${head.year}, the latest year the state reports). They are counted in money in and out but left out of the score, which uses the town's own budget.`);
  } else {
    town.notes.unshift('School-district, county and fire-district taxes the town collects on the property-tax bill are not shown: the state\'s filings have no usable tax-collection total for this town. Money in and out covers the municipal budget only.');
  }
  return { head, dropped, missingPass };
}
