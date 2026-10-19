// Maps an Illinois government's Annual Financial Report (Illinois Comptroller local government
// database: revenues by source and expenditures by function, in columns by fund type) to Town
// Ledger categories.
//
// Counted fund types: general (GN), special revenue (SR), capital projects (CP), debt service
// (DS) and enterprise (EP). Internal service (TS), fiduciary (FD: pension trusts and the money
// county collectors hold for every taxing district) and discretely presented component units (DP)
// are left out. The report's revenue codes hold no transfers or bond proceeds.
//
// Depreciation (272) is left out: it is a non-cash expense, and capital outlay (280) is counted
// when paid. Capital outlay has no function, so enterprise-fund capital outlay counts as utilities
// and the rest is spread over the government's other spending in proportion, which leaves its
// service and overhead shares as they are. Judiciary and legal (254) and housing and development
// (258) count as overhead, as elsewhere. "Other" (260) has no function either: where it is more
// than UNCLASSIFIED_SHARE of spending (Chicago reports pension contributions there) it is shown as
// spending not broken down, and the government is not scored on services or overhead; a smaller
// amount counts as general government.

export const UNCLASSIFIED_SHARE = 0.15;

export const COUNTED_FUNDS = ['GN', 'SR', 'CP', 'DS', 'EP'];

// Revenue code (3 digits) or sub-code -> [key, label].
export function revenueKey(cat) {
  const c = String(cat).replace(/t$/, '');
  const n = Number(c.slice(0, 3));
  if (n === 201) return ['propertyTax', 'Property tax'];
  if (n >= 202 && n <= 204) return ['salesTax', 'Local sales, utility and other taxes'];
  if (n === 205 || (n >= 211 && n <= 214)) return ['stateAid', 'State-shared income, sales, motor fuel, replacement and gaming taxes'];
  if (n === 215) return ['grants', 'State grants'];
  if (n === 225) return ['federalGrants', 'Federal grants'];
  if (n === 226) return ['grants', 'From other governments'];
  if (n === 231) return ['feesPermits', 'Licenses and permits'];
  if (n === 233) return ['finesForfeitures', 'Fines and forfeitures'];
  if (n === 234) return /^234[a-fi]$/i.test(c) ? ['utilityCharges', 'Water, sewer, electric, gas, transit, refuse and toll charges'] : ['feesPermits', 'Charges for services'];
  if (n === 235 || n === 236) return ['localRevenue', 'Interest and miscellaneous'];
  return null;
}

const FUNCTION = {
  '251': ['administration', 'General government'],
  '252': ['publicSafety', 'Police, fire and building inspection'],
  '253': ['publicSafety', 'Corrections'],
  '254': ['administration', 'Judiciary and legal'],
  '255': ['roads', 'Streets, highways, airports and parking'],
  '256': ['healthServices', 'Welfare, health and hospitals'],
  '256d': ['parks', 'Cemeteries'],
  '257': ['parks', 'Libraries, parks and recreation'],
  '258': ['administration', 'Housing and community development'],
  '275': ['utilities', 'Sewage, solid waste and environment'],
  '259a': ['debtService', 'Debt service: interest'],
  '259b': ['debtService', 'Debt service: principal'],
  '259': ['debtService', 'Debt service'],
  '271': ['utilities', 'Water, electric and gas utilities'],
  '271c': ['roads', 'Transit'],
  '260': ['otherSpending', 'Other (not classified by function)'],
};
// Expenditure code or sub-code -> [key, label], 'capital' (280), or null (left out).
export function functionKey(cat) {
  const c = String(cat).replace(/t$/, '').toLowerCase();
  if (c.startsWith('272')) return null; // depreciation
  if (c.startsWith('280')) return 'capital';
  return FUNCTION[c] || FUNCTION[c.slice(0, 3)] || null;
}

const num = (v) => Number(v) || 0;
const counted = (r) => COUNTED_FUNDS.reduce((a, f) => a + num(r[f]), 0);

// Rows for one code: its sub-codes (251a, 251b ...) where reported, else its total (251t). Where
// the sub-codes add up to less than the total, the rest is kept under the code's total row.
function detail(rows) {
  const byCode = new Map();
  for (const r of rows) {
    const code = String(r.Category).slice(0, 3);
    (byCode.get(code) || byCode.set(code, []).get(code)).push(r);
  }
  const out = [];
  for (const rs of byCode.values()) {
    const subs = rs.filter((r) => !/t$/.test(r.Category) && counted(r));
    const total = rs.find((r) => /t$/.test(r.Category));
    if (!subs.length) { if (total) out.push(total); continue; }
    out.push(...subs);
    if (!total) continue;
    const rest = Object.fromEntries([...COUNTED_FUNDS, 'TS', 'FD', 'DP'].map((f) => [f, num(total[f]) - subs.reduce((a, r) => a + num(r[f]), 0)]));
    if (COUNTED_FUNDS.some((f) => rest[f] > 1)) out.push({ ...total, ...Object.fromEntries(Object.entries(rest).map(([f, v]) => [f, Math.max(0, v)])) });
  }
  return out;
}

// One government-year: Revenues and Expenditures rows (Category, GN, SR, CP, DS, EP, TS, FD, DP).
export function aggregateComptroller(revRows, expRows) {
  const revenue = {};
  const spending = {};
  const lines = new Map();
  const add = (group, key, label, amount) => {
    if (!amount) return;
    const target = group === 'revenue' ? revenue : spending;
    target[key] = (target[key] || 0) + amount;
    const k = `${group}|${key}|${label}`;
    lines.set(k, (lines.get(k) || 0) + amount);
  };
  const leftOut = { revenue: 0, spending: 0, depreciation: 0 };
  for (const r of detail(revRows)) {
    leftOut.revenue += num(r.TS) + num(r.FD) + num(r.DP);
    const m = revenueKey(r.Category);
    if (m) add('revenue', m[0], m[1], counted(r));
  }
  let capital = 0;
  for (const r of detail(expRows)) {
    leftOut.spending += num(r.TS) + num(r.FD) + num(r.DP);
    const m = functionKey(r.Category);
    if (m === null) { if (String(r.Category).startsWith('272')) leftOut.depreciation += counted(r); continue; }
    if (m === 'capital') {
      add('spending', 'utilities', 'Capital outlay (enterprise funds)', num(r.EP));
      capital += counted(r) - num(r.EP);
      continue;
    }
    add('spending', m[0], m[1], counted(r));
  }
  // Capital outlay outside enterprise funds, spread over the other spending in proportion.
  const sum = (o) => Object.values(o).reduce((a, v) => a + v, 0);
  if (capital) {
    const base = Object.entries(spending).filter(([k]) => k !== 'debtService');
    const total = base.reduce((a, [, v]) => a + v, 0);
    if (total) for (const [k, v] of base) add('spending', k, 'Capital outlay (spread over services by spending)', (capital * v) / total);
    else add('spending', 'administration', 'Capital outlay', capital);
  }
  if (spending.otherSpending && spending.otherSpending <= UNCLASSIFIED_SHARE * sum(spending)) {
    spending.administration = (spending.administration || 0) + spending.otherSpending;
    delete spending.otherSpending;
    for (const [k, amount] of [...lines]) {
      if (!k.startsWith('spending|otherSpending|')) continue;
      lines.delete(k);
      const label = k.split('|')[2] === 'Other (not classified by function)' ? 'Other' : k.split('|')[2];
      const nk = `spending|administration|${label}`;
      lines.set(nk, (lines.get(nk) || 0) + amount);
    }
  }
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v));
  const r = round(revenue);
  const s = round(spending);
  return {
    revenue: r,
    spending: s,
    lines: [...lines].map(([k, amount]) => { const [group, key, label] = k.split('|'); return { group, key, label, amount: Math.round(amount) }; }).filter((l) => l.amount),
    capital: Math.round(capital),
    leftOut: { revenue: Math.round(leftOut.revenue), spending: Math.round(leftOut.spending), depreciation: Math.round(leftOut.depreciation) },
    empty: !sum(r) || !sum(s),
    // More than four times apart means an entry error or a part left out.
    inconsistent: sum(r) > 4 * sum(s) || sum(s) > 4 * sum(r),
  };
}

// Statement of indebtedness -> debt outstanding at year end. Rows 400-404 (general obligation,
// revenue, alternate revenue, contractual, other); columns +0 beginning, +6 issued, +12 retired;
// general obligation and revenue bonds are split by function (a-e), the others are totals (t).
export function debtOutstanding(row) {
  if (!row) return 0;
  let end = 0;
  for (const code of [400, 401, 402, 403, 404]) {
    const prefixes = code <= 401 ? ['a', 'b', 'c', 'd', 'e'] : ['t'];
    for (const p of prefixes) end += num(row[`${p}${code}`]) + num(row[`${p}${code + 6}`]) - num(row[`${p}${code + 12}`]);
  }
  return Math.max(0, Math.round(end));
}
