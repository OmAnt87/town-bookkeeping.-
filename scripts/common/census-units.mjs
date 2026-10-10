// U.S. Census Bureau Annual Survey of State and Local Government Finances individual unit
// files: download, parsing and mapping of item codes to Town Ledger categories, shared by the
// states whose local governments are taken from them (North and South Carolina, Delaware,
// New Hampshire).
// Amounts in the files are in thousands of dollars.
//
// Spending is by function (the two digits after E current operations, F construction, G other
// capital outlay, I interest). Principal repaid (39U) counts as debt service, as elsewhere.
// Payments to other governments (L, M) are left out: the receiving government reports that
// spending itself (and in North Carolina's 2024 file some counties report their own school
// system's funding there too, which would count it twice).
// Liquor stores, utilities and transit count as enterprise spending and revenue. Borrowing
// (29U), debt balances and insurance trust items are left out.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, renameSync, rmSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const CENSUS_PAGE = (y) => `https://www.census.gov/data/datasets/${y}/econ/local/public-use-datasets.html`;
export const UNIT_FILE = (y) => `https://www2.census.gov/programs-surveys/gov-finances/tables/${y}/${y}_Individual_Unit_File${y === 2022 ? '' : 's'}.zip`;
export const YEARS = [2022, 2023, 2024];

// Downloads each year's unit files into <raw>/units-<year>/ as items.txt and pid.txt.
export function downloadUnits(raw, curl, force = false) {
  for (const y of YEARS) {
    const dir = join(raw, `units-${y}`);
    if (existsSync(dir) && !force) { console.log(`cached ${dir}`); continue; }
    const zip = join(raw, `units-${y}.zip`);
    curl('-o', zip, UNIT_FILE(y));
    rmSync(dir, { recursive: true, force: true });
    execFileSync('unzip', ['-o', '-q', '-j', zip, '-d', dir], { stdio: 'inherit' });
    // Keep stable names: FinEstDAT (items) and Fin_PID (unit identifiers).
    for (const f of readdirSync(dir)) {
      if (/FinEstDAT/i.test(f)) renameSync(join(dir, f), join(dir, 'items.txt'));
      else if (/Fin_PID/i.test(f)) renameSync(join(dir, f), join(dir, 'pid.txt'));
    }
    console.log(`Census individual unit file ${y} -> ${dir}`);
  }
}

// Counties (type 1) and municipalities (type 2) of one state, by year, plus townships (type 3,
// New England towns) when types includes '3':
// { [year]: Map(id -> { id, kind: 'county'|'muni'|'township', name, place, fyEnd, items[] }) }.
// place is the FIPS place code (county subdivision code for a township), or '99' + county
// FIPS for a county.
export function readUnits(raw, stateFips, types = '12') {
  const units = {};
  const re = new RegExp(`^${stateFips}[${types}]`);
  for (const y of YEARS) {
    const dir = join(raw, `units-${y}`);
    const u = new Map();
    for (const l of readFileSync(join(dir, 'pid.txt'), 'latin1').split(/\r?\n/)) {
      if (!re.test(l)) continue;
      // Fiscal year end as MMDDYY; a few units leave it blank (June 30 is used).
      const fy = l.slice(116).trim().match(/\s(\d\d)(\d\d)(\d\d)$/);
      const fyEnd = fy ? `20${fy[3]}-${fy[1]}-${fy[2]}` : `${y}-06-30`;
      u.set(l.slice(0, 12), { id: l.slice(0, 12), kind: { 1: 'county', 2: 'muni', 3: 'township' }[l[2]], name: l.slice(12, 76).trim(), place: l.slice(111, 116).trim(), fyEnd, items: [] });
    }
    for (const l of readFileSync(join(dir, 'items.txt'), 'latin1').split(/\r?\n/)) {
      const g = u.get(l.slice(0, 12));
      if (g) g.items.push({ code: l.slice(12, 15), amount: Number(l.slice(15, 27)), flag: l.slice(31, 32) });
    }
    units[y] = u;
  }
  return units;
}

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
export function aggregateUnit(items) {
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
    // Some units carry only a few lines: their debt, or just a liquor board or other agency.
    // Every county and municipality has property tax or a share of the local sales tax, and
    // spends more than a quarter of its revenue (less means departments are missing).
    incomplete: !has(/^E/) || !has(/^T0[19]$/) || expSum * 4 < revSum,
  };
}
