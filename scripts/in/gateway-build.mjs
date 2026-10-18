#!/usr/bin/env node
// Builds real Town Ledger records for Indiana's counties, townships, cities and towns, and the
// Consolidated City of Indianapolis, from each government's Annual Financial Report on Indiana
// Gateway (see gateway-map.mjs). Each county's file holds the county and the governments whose
// people mostly live in it.
//
//   node scripts/in/gateway-download.mjs
//   node scripts/in/gateway-build.mjs --county Hamilton      (or --all)
//
// Every Indiana government files its Annual Financial Report with the State Board of Accounts,
// so these are reported figures for nearly every government, where the Census unit files have
// figures the Census estimated for many townships and towns.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { aggregateGateway, debtOutstanding } from './gateway-map.mjs';
import { GATEWAY_PAGE, GATEWAY_YEARS } from './gateway-download.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'in');
const GW = join(RAW, 'gateway');
const OUT = join(ROOT, 'data', 'real');
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';
const INDIANAPOLIS = 'INDIANAPOLIS CONSOLIDATED CITY';

const args = parseArgs();
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);
const norm = (s) => String(s).toLowerCase().replace(/\(balance\)/, '').replace(/^st\.? /, 'saint ').replace(/^mt\.? /, 'mount ').replace(/[^a-z]/g, '');

// Gateway files: pipe-delimited, one header row; the special-unit files name the fund
// unit_fund_name.
function readGateway(file) {
  const path = join(GW, file);
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'latin1').split(/\r?\n/).filter(Boolean);
  const head = lines.shift().split('|');
  return lines.map((l) => {
    const c = l.split('|');
    const r = Object.fromEntries(head.map((h, i) => [h, c[i] ?? '']));
    r.fund_name = r.fund_name || r.unit_fund_name || '';
    return r;
  });
}

// Census geography for population and map location.
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const gaz = (file, key, xcol) => new Map(readFileSync(join(RAW, file), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'IN').map((c) => [key(c[1]), [Number(c[xcol]), Number(c[xcol + 1])]]));
const countyXY = gaz('2024_Gaz_counties_national.txt', (id) => id, 8);
const cousubXY = gaz('2024_Gaz_cousubs_national.txt', (id) => id, 9);
const placeXY = gaz('2024_Gaz_place_national.txt', (id) => id.slice(2), 10);

const countyName = new Map(); // FIPS county '097' -> 'Marion County'
const geo = new Map(); // 'County|097', 'Township|097|centertownship', 'City|indianapolis'
for (const r of pop.filter((p) => p.sumlev === '050')) {
  countyName.set(r.county, r.name);
  geo.set(`County|${r.county}`, { kind: 'County', display: r.name, geoid: `18${r.county}`, pop: Number(r[POP_YEAR]), xy: countyXY.get(`18${r.county}`), county: r.name });
}
for (const r of pop.filter((p) => p.sumlev === '061')) {
  const m = r.name.match(/^(.+) township$/);
  if (!m) continue;
  geo.set(`Township|${r.county}|${norm(m[1])}`, { kind: 'Township', display: `${m[1]} Township`, geoid: `18${r.county}${r.cousub}`, pop: Number(r[POP_YEAR]), xy: cousubXY.get(`18${r.county}${r.cousub}`), county: countyName.get(r.county) });
}
const placeCounty = new Map();
for (const r of pop.filter((p) => p.sumlev === '157')) {
  const cur = placeCounty.get(r.place);
  if (!cur || Number(r[POP_YEAR]) > cur.pop) placeCounty.set(r.place, { county: r.county, pop: Number(r[POP_YEAR]) });
}
for (const r of pop.filter((p) => p.sumlev === '162')) {
  const m = r.name.replace(/ \(balance\)$/, '').match(/^(.+) (city|town)$/);
  if (!m) continue;
  const kind = m[2] === 'city' ? 'City' : 'Town';
  geo.set(`${kind}|${norm(m[1])}`, { kind, display: `${kind} of ${m[1]}`, geoid: `18${r.place}`, pop: Number(r[POP_YEAR]), xy: placeXY.get(r.place), county: countyName.get(placeCounty.get(r.place)?.county) });
}

// Gateway unit -> geography key. County code n (1-92, alphabetical) is FIPS 2n-1.
function geoKeyOf(r, type) {
  const fips = String(2 * Number(r.cnty_cd) - 1).padStart(3, '0');
  const name = r.unit_name.trim();
  if (type === 'county') return `County|${fips}`;
  if (type === 'township') return `Township|${fips}|${norm(name.replace(/ TOWNSHIP$/, ''))}`;
  if (name === INDIANAPOLIS) return 'City|indianapolis';
  // "X CIVIL CITY", "X CIVIL TOWN", "CITY OF X", "TOWN OF X", or the bare name.
  const m = name.match(/^(.+?) (?:CIVIL )?(CITY|TOWN)$/i);
  const pre = name.match(/^(CITY|TOWN) OF (.+)$/i);
  const [kind, base] = m ? [m[2], m[1]] : pre ? [pre[1], pre[2]] : [null, name];
  const kinds = kind ? [/^city$/i.test(kind) ? 'City' : 'Town', /^city$/i.test(kind) ? 'Town' : 'City'] : ['Town', 'City'];
  // Some towns' Census names keep "City" (Parker City) or a leading "The" (The Pines).
  return kinds.flatMap((k) => [`${k}|${norm(base)}`, `${k}|${norm(base)}city`, `${k}|the${norm(base)}`]).find((k) => geo.has(k)) || null;
}

// Gateway rows by unit and year.
const units = new Map(); // key -> { type, name, byYear: { year: { receipts, disbursements, dept, debt } } }
for (const year of GATEWAY_YEARS) {
  for (const type of ['county', 'township', 'citytown', 'special']) {
    const files = { receipts: `rcpt-${type}-${year}.bin`, disbursements: `disbf-${type}-${year}.bin`, dept: `disb-${type}-${year}.bin`, debt: `debt-${type}-${year}.bin` };
    if (type === 'township') files.dept = null;
    for (const [part, file] of Object.entries(files)) {
      if (!file) continue;
      for (const r of readGateway(file)) {
        if (type === 'special' && r.unit_name.trim() !== INDIANAPOLIS) continue;
        const id = `${type}|${r.cnty_cd || r.county_cd_fk}|${r.unit_code}`;
        const u = units.get(id) || units.set(id, { id, type, name: r.unit_name.trim(), row: r, byYear: {} }).get(id);
        const y = (u.byYear[year] ||= { receipts: [], disbursements: [], dept: [], debt: [] });
        y[part].push(r);
      }
    }
  }
}

function buildUnit(u, report) {
  const key = geoKeyOf({ ...u.row, cnty_cd: u.row.cnty_cd || u.row.county_cd_fk }, u.type);
  const g = key && geo.get(key);
  const agg = (y) => aggregateGateway(u.byYear[y].receipts, u.byYear[y].disbursements, u.byYear[y].dept, { township: u.type === 'township' });
  const status = (y) => { const a = agg(y); return a.empty ? 'empty' : a.inconsistent ? 'inconsistent' : 'ok'; };
  const years = Object.keys(u.byYear).sort();
  const reported = years.filter((y) => status(y) === 'ok');
  const year = reported.at(-1);
  if (!year) { report[status(years.at(-1)) === 'empty' ? 'empty' : 'inconsistent'].push(u.name); return null; }
  if (!g || !g.xy || !g.county) { report.skipped.push(`${u.name}: no Census match`); return null; }
  if (years.at(-1) > year) report.older.push(`${g.display} (${year}; ${years.at(-1)} ${status(years.at(-1))})`);
  const a = agg(year);
  const isCounty = g.kind === 'County';
  const kindText = isCounty ? 'county' : u.name === INDIANAPOLIS ? 'consolidated city' : g.kind.toLowerCase();
  if (a.refinanced) report.refinanced.push(`${g.display} (${money(a.refinanced)})`);
  const date = `${year}-12-31`;
  const ledger = a.lines.map((l) => ({
    date, flow: l.group === 'revenue' ? 'in' : 'out', category: l.key, counterparty: 'Annual Financial Report (Indiana Gateway)',
    description: l.label, amount: l.amount, source: GATEWAY_PAGE,
  })).sort((x, y) => (x.flow === y.flow ? y.amount - x.amount : x.flow === 'in' ? -1 : 1));
  const history = reported.map((y) => { const h = agg(y); return { year: Number(y), revenue: sum(h.revenue), spending: sum(h.spending), basis: 'actual' }; });
  const memberSchool = `Public schools are run by separate school corporations with their own taxes, so they are not included. Residents also pay ${g.county}${g.kind === 'Township' ? '' : ' and the township they live in'}.`;
  return {
    file: slugify(g.county.replace(/ County$/, '')),
    town: {
      // Township names repeat across counties.
      id: slugify(g.kind === 'Township' ? `${g.display} ${g.county} in` : `${g.display} in`),
      name: u.name === INDIANAPOLIS ? 'City of Indianapolis' : g.display,
      state: 'IN',
      stateName: 'Indiana',
      county: g.county,
      type: g.kind,
      lat: Math.round(g.xy[0] * 1e5) / 1e5,
      lng: Math.round(g.xy[1] * 1e5) / 1e5,
      population: g.pop || 1,
      fiscalYear: Number(year),
      asOf: new Date().toISOString().slice(0, 10),
      censusGeoid: g.geoid,
      revenue: a.revenue,
      spending: a.spending,
      debt: debtOutstanding(u.byYear[year].debt),
      reporting: {
        basis: 'Actual receipts and disbursements (cash basis), from the Annual Financial Report filed with the Indiana State Board of Accounts through Indiana Gateway',
        scope: isCounty
          ? 'All county funds, including the sheriff, jail, courts and county roads; money the county collects for other governments is left out'
          : `All ${kindText} funds, including utilities; schools are run by separate school corporations`,
      },
      history,
      ledger,
      sources: [
        { label: `Indiana Gateway, ${year} Annual Financial Report data (detailed receipts, disbursements by fund and department, debt)`, url: GATEWAY_PAGE },
        { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
        { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
      ],
      notes: [
        `Actual receipts and disbursements for calendar year ${year}, as the ${kindText} reported them in its Annual Financial Report (cash basis). Not a budget.`,
        ...(Number(year) < GATEWAY_YEARS.at(-1) ? [`The ${GATEWAY_YEARS.at(-1)} report was ${status(years.at(-1)) === 'empty' ? 'missing or not filled in' : 'out of balance (revenue and spending more than four times apart)'}, so ${year} is used.`] : []),
        isCounty
          ? 'Public schools are run by separate school corporations with their own taxes, so they are not included. The county collects property and local income taxes for every government in the county and pays them over; that money is left out.'
          : memberSchool,
        ...(g.kind === 'Township' ? ['Indiana townships cover the whole county, cities and towns included; the township trustee provides poor relief and, in many townships, fire protection.'] : []),
        ...(u.name === INDIANAPOLIS ? ['Indianapolis is consolidated with Marion County: the consolidated city runs police, fire, public works and parks, while Marion County keeps the sheriff, courts and other county offices and is listed separately. The excluded cities and towns inside the county (such as Beech Grove, Lawrence and Speedway) are listed on their own.'] : []),
        'Indiana\'s chart of accounts has no function codes, so spending is assigned to a service from the department or fund name (a police department or fire fund is public safety, a motor vehicle highway fund roads, a sewage utility fund utilities); spending in other funds with general names counts as general government.',
        ...(a.spending.otherSpending ? [`The ${kindText} reported ${money(a.spending.otherSpending)} of general fund spending without departments, so it cannot be split between services and overhead; the ${kindText} is not scored on services or overhead.`] : []),
        ...(a.custodial.receipts ? [`Money the ${kindText} holds for others or passes through (tax settlements, payroll and clearing accounts, trusts and escrow; ${money(a.custodial.receipts)} received) is left out.`] : []),
        ...(a.borrowing ? [`Borrowing (${money(a.borrowing)}) is not counted as revenue.`] : []),
        ...(a.refinanced ? [`${money(a.refinanced)} of notes and bonds paid off with new borrowing (refinancing) is left out of debt service.`] : []),
        ...(a.intergovernmental ? [`Distributions to other governments (${money(a.intergovernmental)}) are left out, because the government receiving them reports that spending.`] : []),
        'Transfers between funds, purchases of investments and payroll withholdings paid over are left out.',
        'Courts, legal services, public buildings, housing and community development count as overhead.',
        'Debt is principal outstanding at year end on bonds, notes, leases and loans, as reported.',
        `Political money is not scored: Indiana ${isCounty ? 'county' : 'local'} candidates file campaign finance reports with their county election board, not with the state.`,
        'Transparency practices have not been checked yet, so they are not scored.',
      ],
    },
  };
}

const built = [];
const report = { skipped: [], empty: [], inconsistent: [], older: [], refinanced: [], duplicates: [] };
const seen = new Map();
for (const u of units.values()) {
  const b = buildUnit(u, report);
  if (!b) continue;
  if (seen.has(b.town.id)) { report.duplicates.push(b.town.name); continue; }
  seen.set(b.town.id, b);
  built.push(b);
}
const files = [...new Set(built.map((b) => b.file))].sort();
const pick = args.all ? files : files.filter((f) => f.startsWith(slugify(String(args.county || '-'))));
if (!pick.length) { console.error(`Usage: node scripts/in/gateway-build.mjs --county <county> | --all\nFiles: ${files.join(', ')}`); process.exit(1); }
const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
const ORDER = { County: 0, City: 1, Town: 2, Township: 3 };
for (const f of pick) {
  const towns = built.filter((b) => b.file === f).map((b) => b.town).sort((x, y) => ORDER[x.type] - ORDER[y.type] || x.name.localeCompare(y.name));
  const file = `in-${f}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
}
index.files.sort();
writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
if (args.all) writeFileSync(join(RAW, 'gateway-report.json'), `${JSON.stringify(report, null, 1)}\n`);
const types = built.reduce((m, b) => ({ ...m, [b.town.type]: (m[b.town.type] || 0) + 1 }), {});
console.log(JSON.stringify({ files: pick.length, governments: built.length, types, ...Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length])) }, null, 1));
