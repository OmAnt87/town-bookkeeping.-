#!/usr/bin/env node
// Builds real Town Ledger records for Minnesota's counties, cities and towns (townships) from the
// Office of the State Auditor's financial data (see osa-map.mjs). Each county's file holds the
// county and the governments whose people mostly live in it.
//
//   node scripts/mn/osa-download.mjs
//   node scripts/mn/osa-build.mjs --county Hennepin      (or --all)
//
// Every Minnesota county, city and town files a financial reporting form (or its audited
// statements) with the State Auditor, so these are reported figures for every government.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { aggregateOsa } from './osa-map.mjs';
import { OSA_PAGE, OSA_YEARS } from './osa-download.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'mn');
const OUT = join(ROOT, 'data', 'real');
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';

const args = parseArgs();
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);
// "Saint Anthony [Stearns]" and "St. Anthony city" alike; a few names differ outright.
const ALIAS = { winnebago: 'winnebagocity' };
const norm = (s) => {
  const n = String(s).toLowerCase().replace(/\[.*\]/, '').replace(/\bst\.? /g, 'saint ').replace(/\bmt\.? /g, 'mount ').replace(/[^a-z0-9]/g, '');
  return ALIAS[n] || n;
};

// Census geography for population and map location, keyed as in the Census build so ids and
// Census codes carry over: cities by county subdivision (or by place where a city's largest
// subdivision is only a fragment of it), townships by county subdivision.
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const gaz = (file, key, xcol) => new Map(readFileSync(join(RAW, file), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'MN').map((c) => [key(c[1]), [Number(c[xcol]), Number(c[xcol + 1])]]));
const countyXY = gaz('2024_Gaz_counties_national.txt', (id) => id, 8);
const cousubXY = gaz('2024_Gaz_cousubs_national.txt', (id) => id.slice(2), 9);
const placeXY = gaz('2024_Gaz_place_national.txt', (id) => id.slice(2), 10);
const fileOf = (county) => slugify(county.replace(/ County$/, ''));

const countyName = new Map(); // FIPS county code -> 'Aitkin County'
const countyFips = new Map(); // normalized county name -> FIPS county code
const geo = new Map(); // 'County|001', 'City|ada', 'Township|001|aitkin'
for (const r of pop.filter((p) => p.sumlev === '050')) {
  countyName.set(r.county, r.name);
  countyFips.set(norm(r.name.replace(/ County$/, '')), r.county);
  geo.set(`County|${r.county}`, { kind: 'County', display: r.name, geoid: `27${r.county}`, pop: Number(r[POP_YEAR]), xy: countyXY.get(`27${r.county}`), county: r.name });
}
// Cities are found by name; the one name two cities share (St. Anthony, in Hennepin and Stearns
// counties) is told apart by county.
const cityNames = pop.filter((p) => p.sumlev === '162' && / city$/.test(p.name)).map((p) => norm(p.name.replace(/ city$/, '')));
const DUP = new Set(cityNames.filter((n, i) => cityNames.indexOf(n) !== i));
const cityKey = (name, county) => (DUP.has(norm(name)) ? `${norm(name)}|${county}` : norm(name));
const cityCousub = new Map();
for (const r of pop.filter((p) => p.sumlev === '061')) {
  const m = r.name.match(/^(.+) (city|township)$/);
  if (!m) continue;
  const g = { base: m[1], geoid: `27${r.county}${r.cousub}`, pop: Number(r[POP_YEAR]), xy: cousubXY.get(`${r.county}${r.cousub}`), county: countyName.get(r.county) };
  if (m[2] === 'township') geo.set(`Township|${r.county}|${norm(m[1])}`, { ...g, kind: 'Township', display: `${m[1]} Township` });
  // A city in several counties has a subdivision row in each: keep the one holding most people.
  else if (g.pop >= (cityCousub.get(cityKey(m[1], r.county))?.pop ?? -1)) cityCousub.set(cityKey(m[1], r.county), { ...g, county: countyName.get(r.county) });
}
const placeCounty = new Map();
for (const r of pop.filter((p) => p.sumlev === '157')) {
  const cur = placeCounty.get(r.place);
  if (!cur || Number(r[POP_YEAR]) > cur.pop) placeCounty.set(r.place, { county: r.county, pop: Number(r[POP_YEAR]) });
}
for (const r of pop.filter((p) => p.sumlev === '162')) {
  const m = r.name.match(/^(.+) city$/);
  if (!m) continue;
  const fips = placeCounty.get(r.place)?.county;
  const place = { base: m[1], geoid: `27${r.place}`, pop: Number(r[POP_YEAR]), xy: placeXY.get(r.place), county: countyName.get(fips) };
  const cousub = cityCousub.get(cityKey(m[1], fips));
  geo.set(`City|${cityKey(m[1], fips)}`, { ...(cousub && cousub.pop >= place.pop ? cousub : place), kind: 'City', display: `City of ${m[1]}` });
}
for (const [n, cousub] of cityCousub) if (!geo.has(`City|${n}`)) geo.set(`City|${n}`, { ...cousub, kind: 'City', display: `City of ${cousub.base}` });

// The Auditor's rows by government and year: governmental funds, enterprise funds and debt.
const osa = JSON.parse(readFileSync(join(RAW, 'osa', 'osa.json'), 'utf8'));
const sheet = (book, re) => book[Object.keys(book).find((s) => re.test(s))] || [];
const nameOf = (r) => r['Entity Name'] || r.GovEntityName || r['Town Name'];
const countyOf = (r) => r.ParentEntityName || r.CountyName || r['County Name'];
const rowId = (kind, r) => (kind === 'town' ? `${norm(r['Town Name'])}|${norm(countyOf(r))}` : String(r.GovEntityID));
function geoKeyOf(kind, r) {
  if (kind === 'county') return `County|${countyFips.get(norm(nameOf(r)))}`;
  if (kind === 'city') return `City|${cityKey(nameOf(r), countyFips.get(norm(countyOf(r))))}`;
  return `Township|${countyFips.get(norm(countyOf(r)))}|${norm(r['Town Name'])}`;
}
const units = new Map();
const unmatched = [];
for (const [kind, years] of Object.entries(OSA_YEARS)) {
  for (const year of years) {
    const book = osa[kind]?.[year];
    if (!book) continue;
    const ent = new Map();
    for (const e of sheet(book, /^Enterprise/)) (ent.get(rowId(kind, e)) || ent.set(rowId(kind, e), []).get(rowId(kind, e))).push(e);
    const debt = new Map(sheet(book, /^(Debt|Indebtedness)$/).map((d) => [rowId(kind, d), d]));
    for (const row of sheet(book, /^Governmental Funds$/)) {
      if (!nameOf(row)) continue;
      const key = geoKeyOf(kind, row);
      const g = geo.get(key);
      if (!g?.xy || !g.county) { unmatched.push(`${nameOf(row)} (${kind}, ${countyOf(row) || nameOf(row)})`); continue; }
      const u = units.get(key) || units.set(key, { key, kind, byYear: {} }).get(key);
      u.byYear[year] = { row, enterprises: ent.get(rowId(kind, row)) || [], debt: debt.get(rowId(kind, row)) || null };
    }
  }
}

const aggregate = (y) => aggregateOsa(y.row, y.enterprises, y.debt);
const report = { skipped: [...new Set(unmatched)], empty: [], inconsistent: [], older: [], noResidents: [], unclassified: [], refinanced: [] };
function buildUnit(u) {
  const g = geo.get(u.key);
  if (!g.pop) { report.noResidents.push(`${g.display} (${g.county})`); return null; }
  const status = (y) => { const a = aggregate(u.byYear[y]); return a.empty ? 'empty' : a.inconsistent ? 'inconsistent' : 'ok'; };
  const years = Object.keys(u.byYear).sort();
  const reported = years.filter((y) => status(y) === 'ok');
  const year = reported.at(-1);
  if (!year) { report[status(years.at(-1))].push(g.display); return null; }
  const latest = OSA_YEARS[u.kind].at(-1);
  if (Number(year) < latest) report.older.push(`${g.display} (${year}; ${u.byYear[latest] ? `${latest} ${status(String(latest)) === 'empty' ? 'not filled in' : 'out of balance'}` : `not in the ${latest} data`})`);
  const y = u.byYear[year];
  const a = aggregate(y);
  if (a.spending.otherSpending) report.unclassified.push(g.display);
  if (a.refinanced) report.refinanced.push(`${g.display} (${money(a.refinanced)})`);
  const isCounty = g.kind === 'County';
  const kindText = isCounty ? 'county' : g.kind === 'Township' ? 'town' : 'city';
  // Cities say "Cash" or "GAAP"; counties and towns -1 for GAAP (towns 0 for cash).
  const gaap = y.row.GAAPInd ?? y.debt?.GAAPInd;
  const basisText = gaap === 'Cash' || gaap === 0 ? ' (cash basis)' : gaap === 'GAAP' || gaap === -1 ? ' (modified accrual basis)' : '';
  const page = OSA_PAGE[u.kind];
  const date = `${year}-12-31`;
  const ledger = a.lines.map((l) => ({
    date, flow: l.group === 'revenue' ? 'in' : 'out', category: l.key, counterparty: 'Financial reporting form (Minnesota Office of the State Auditor)',
    description: l.label, amount: l.amount, source: page,
  })).sort((p, q) => (p.flow === q.flow ? q.amount - p.amount : p.flow === 'in' ? -1 : 1));
  const history = reported.map((h) => { const x = aggregate(u.byYear[h]); return { year: Number(h), revenue: sum(x.revenue), spending: sum(x.spending), basis: 'actual' }; });
  const left = a.leftOut;
  return {
    file: fileOf(g.county),
    town: {
      id: slugify(`${g.display} mn`),
      name: g.display,
      state: 'MN',
      stateName: 'Minnesota',
      county: g.county,
      type: g.kind,
      lat: Math.round(g.xy[0] * 1e5) / 1e5,
      lng: Math.round(g.xy[1] * 1e5) / 1e5,
      population: g.pop,
      fiscalYear: Number(year),
      asOf: new Date().toISOString().slice(0, 10),
      censusGeoid: g.geoid,
      revenue: a.revenue,
      spending: a.spending,
      debt: a.debt,
      reporting: {
        basis: `Actual results for the calendar year${basisText}, from the financial reporting form filed with the Minnesota Office of the State Auditor`,
        scope: isCounty
          ? 'County governmental funds by function, including the sheriff, jail, human services, public health and county highways, plus enterprise funds'
          : `All ${kindText} governmental funds by function, plus water, sewer, electric, liquor store and other enterprise funds; schools are run by separate school districts`,
      },
      history,
      ledger,
      sources: [
        { label: `Minnesota Office of the State Auditor, ${year} ${isCounty ? 'county' : kindText} financial data`, url: page },
        { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
        { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
      ],
      notes: [
        `Actual results for calendar year ${year}, as the ${kindText} reported them to the Minnesota Office of the State Auditor. Not a budget.`,
        ...(Number(year) < latest ? [`The ${latest} report was ${u.byYear[latest] ? (status(String(latest)) === 'empty' ? 'not filled in' : 'out of balance (revenue and spending more than four times apart)') : 'not in the State Auditor\'s data'}, so ${year} is used.`] : []),
        isCounty
          ? 'Public schools are run by separate school districts with their own taxes, so they are not included.'
          : `Public schools are run by separate school districts with their own taxes, so they are not included. Residents also pay ${g.county}.`,
        ...(g.kind === 'Township' ? ['Minnesota townships (towns) govern the areas outside cities, mostly maintaining township roads; many contract with a city or fire district for fire protection.'] : []),
        'Governmental funds are reported by function. Enterprise funds (water, sewer, electric, liquor stores and others) count their operating revenue and expenses with depreciation left out and capital outlay counted when paid, plus debt payments.',
        `${left.refunded ? `Borrowing, transfers between funds and ${money(left.refunded)} of refunded bond principal` : 'Borrowing and transfers between funds'} are left out.${a.refinanced ? ` Enterprise debt service also leaves out ${money(a.refinanced)} of principal repaid with new borrowing not spent on capital that year, most likely refinancing.` : ''}`,
        ...(a.spending.otherSpending ? [`${money(a.spending.otherSpending)} was reported as "all other" spending without a function, more than 15% of the total, so it is shown as not broken down and the ${kindText} is not scored on services or overhead.`] : []),
        'General government, housing and redevelopment, economic development and conservation of natural resources count as overhead.',
        'Debt is bonds, other long-term debt and short-term debt outstanding at year end, as reported.',
        `Political money is not scored: Minnesota ${isCounty ? 'county' : 'local'} candidates file campaign finance reports with their ${isCounty ? 'county auditor' : 'city or township clerk'}, not with the state.`,
        'Transparency practices have not been checked yet, so they are not scored.',
      ],
    },
  };
}

const built = [...units.values()].map(buildUnit).filter(Boolean);
// Same-named townships in different counties get the county in their id.
const nameCount = new Map();
for (const b of built) nameCount.set(b.town.name, (nameCount.get(b.town.name) || 0) + 1);
for (const b of built) if (nameCount.get(b.town.name) > 1) b.town.id = slugify(`${b.town.name} ${b.town.county} mn`);

const files = [...new Set(built.map((b) => b.file))].sort();
const pick = args.all ? files : files.filter((f) => f.startsWith(slugify(String(args.county || '-'))));
if (!pick.length) { console.error(`Usage: node scripts/mn/osa-build.mjs --county <county> | --all\nFiles: ${files.join(', ')}`); process.exit(1); }
const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
for (const f of pick) {
  const towns = built.filter((b) => b.file === f).map((b) => b.town).sort((x, y) => ((x.type === 'County') === (y.type === 'County') ? x.name.localeCompare(y.name) : x.type === 'County' ? -1 : 1));
  const file = `mn-${f}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
}
index.files.sort();
writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
if (args.all) writeFileSync(join(RAW, 'osa-report.json'), `${JSON.stringify(report, null, 1)}\n`);
const types = built.reduce((m, b) => ({ ...m, [b.town.type]: (m[b.town.type] || 0) + 1 }), {});
console.log(JSON.stringify({ files: pick.length, governments: built.length, types, ...Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length])) }, null, 1));
