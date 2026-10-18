#!/usr/bin/env node
// Builds real Town Ledger records for Michigan's counties, cities, villages and townships (general
// law and charter) from the F-65 Annual Local Unit Fiscal Reports every unit files with the
// Department of Treasury (see f65-map.mjs). Each county's file holds the county and the
// governments whose people mostly live in it.
//
//   node scripts/mi/f65-download.mjs
//   node scripts/mi/f65-build.mjs --county Kent      (or --all)
//
// Townships and cities collect school and county taxes on their tax bills but report only their
// own levy, so each unit's property tax is its own.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { aggregateF65 } from './f65-map.mjs';
import { F65_PAGE, F65_YEARS } from './f65-download.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'mi');
const OUT = join(ROOT, 'data', 'real');
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';

const args = parseArgs();
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);

// Census geography, keyed as in the Census build so ids and Census codes carry over: cities and
// townships by county subdivision (a city in several counties keeps the county with most of its
// people), villages by place; a city whose subdivision is only a fragment of it uses its place.
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const gaz = (file, key, xcol) => new Map(readFileSync(join(RAW, file), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'MI').map((c) => [key(c[1]), [Number(c[xcol]), Number(c[xcol + 1])]]));
const countyXY = gaz('2024_Gaz_counties_national.txt', (id) => id, 8);
const cousubXY = gaz('2024_Gaz_cousubs_national.txt', (id) => id.slice(2), 9);
const placeXY = gaz('2024_Gaz_place_national.txt', (id) => id.slice(2), 10);
const fileOf = (county) => slugify(county.replace(/ County$/, ''));
const KINDS = { city: 'City', 'charter township': 'Charter Township', township: 'Township', village: 'Village' };
// "Village of Clarkston city" is the City of Clarkston, as in the Census build.
const displayName = (kind, base) => (/Township$/.test(kind) ? `${base} ${kind}` : `${kind} of ${base.replace(/^Village of /, '')}`);
const norm = (s) => String(s).toLowerCase().replace(/^(city|village) of (the village of )?/, '').replace(/ (city|village)( of the village)?$/, '').replace(/[^a-z0-9]/g, '');
const placeByName = new Map(); // 'Village|lakeisabella' -> place key, for codes that differ from the Census

const countyName = new Map();
const geo = new Map(); // 'County|163', 'Cousub|22000', 'Place|22000'
for (const r of pop.filter((p) => p.sumlev === '050')) {
  countyName.set(r.county, r.name);
  geo.set(`County|${r.county}`, { kind: 'County', display: r.name, geoid: `26${r.county}`, pop: Number(r[POP_YEAR]), xy: countyXY.get(`26${r.county}`), county: r.name });
}
for (const r of pop.filter((p) => p.sumlev === '061')) {
  const m = r.name.match(/^(.+?) (city|charter township|township)$/);
  if (!m) continue;
  if (Number(r[POP_YEAR]) < (geo.get(`Cousub|${r.cousub}`)?.pop ?? -1)) continue;
  const kind = KINDS[m[2]];
  geo.set(`Cousub|${r.cousub}`, { kind, display: displayName(kind, m[1]), geoid: `26${r.county}${r.cousub}`, pop: Number(r[POP_YEAR]), xy: cousubXY.get(`${r.county}${r.cousub}`), county: countyName.get(r.county) });
}
const placeCounty = new Map();
for (const r of pop.filter((p) => p.sumlev === '157')) {
  const cur = placeCounty.get(r.place);
  if (!cur || Number(r[POP_YEAR]) > cur.pop) placeCounty.set(r.place, { county: r.county, pop: Number(r[POP_YEAR]) });
}
for (const r of pop.filter((p) => p.sumlev === '162')) {
  const m = r.name.match(/^(.+?) (city|village)$/);
  if (!m) continue;
  const kind = KINDS[m[2]];
  geo.set(`Place|${r.place}`, { kind, display: displayName(kind, m[1]), geoid: `26${r.place}`, pop: Number(r[POP_YEAR]), xy: placeXY.get(r.place), county: countyName.get(placeCounty.get(r.place)?.county) });
  const n = `${kind}|${norm(m[1].replace(/^Village of /, ''))}`;
  placeByName.set(n, placeByName.has(n) ? null : `Place|${r.place}`);
}
// Treasury's FIPSCode is the county code for counties, the place code for cities and villages and
// the county subdivision code for townships.
function geoKeyOf(u) {
  if (u.Type === 'COUNTY') return `County|${u.FIPSCode}`;
  if (u.Type === 'TOWNSHIP') return `Cousub|${u.FIPSCode}`;
  if (u.Type === 'VILLAGE') return geo.has(`Place|${u.FIPSCode}`) ? `Place|${u.FIPSCode}` : placeByName.get(`Village|${norm(u.Name)}`) || null;
  const cousub = geo.get(`Cousub|${u.FIPSCode}`);
  const place = geo.get(`Place|${u.FIPSCode}`);
  return !cousub || /Township$/.test(cousub.kind) || (place && place.pop > cousub.pop) ? `Place|${u.FIPSCode}` : `Cousub|${u.FIPSCode}`;
}

const read = (name, y) => (existsSync(join(RAW, 'f65', `${name}-${y}.json`)) ? JSON.parse(readFileSync(join(RAW, 'f65', `${name}-${y}.json`), 'utf8')) : []);
const units = new Map();
const unmatched = [];
const debtOf = new Map(); // `${unitId}|${year}` -> long-term debt
for (const y of F65_YEARS) {
  const byUnit = new Map();
  for (const [kind, rows] of [['exp', read('expenditure', y)], ['rev', read('revenue', y)]]) {
    for (const r of rows) {
      const u = byUnit.get(r.LocalUnitID) || byUnit.set(r.LocalUnitID, { info: r, exp: [], rev: [] }).get(r.LocalUnitID);
      u[kind].push(r);
    }
  }
  for (const m of read('metrics', y)) if (m.FIELD_NAME === 'Total Long Term Debt') debtOf.set(`${m.LU_ID}|${y}`, Number(m.FIELD_VALUE));
  for (const [id, u] of byUnit) {
    const key = geoKeyOf(u.info);
    if (!geo.get(key)?.xy || !geo.get(key)?.county) { unmatched.push(`${u.info.Name} (${u.info.FIPSCode})`); continue; }
    const unit = units.get(key) || units.set(key, { key, id, byYear: {} }).get(key);
    unit.byYear[y] = { exp: u.exp, rev: u.rev, debt: debtOf.get(`${id}|${y}`), yeMonth: u.info.YEMonth };
  }
}

const aggregate = (y) => aggregateF65(y.exp, y.rev);
const report = { skipped: [...new Set(unmatched)], empty: [], inconsistent: [], older: [], noResidents: [], unclassified: [], noDebt: [] };
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function buildUnit(u) {
  const g = geo.get(u.key);
  if (!g.pop) { report.noResidents.push(`${g.display} (${g.county})`); return null; }
  const status = (y) => { const a = aggregate(u.byYear[y]); return a.empty ? 'empty' : a.inconsistent ? 'inconsistent' : 'ok'; };
  const years = Object.keys(u.byYear).sort();
  const reported = years.filter((y) => status(y) === 'ok');
  const year = reported.at(-1);
  if (!year) { report[status(years.at(-1))].push(g.display); return null; }
  const latest = F65_YEARS.at(-1);
  if (Number(year) < latest) report.older.push(`${g.display} (FY ${year}; FY ${latest} ${u.byYear[latest] ? (status(String(latest)) === 'empty' ? 'not filled in' : 'out of balance') : 'not yet published'})`);
  const y = u.byYear[year];
  const a = aggregate(y);
  if (a.spending.otherSpending) report.unclassified.push(g.display);
  const hasDebt = Number.isFinite(y.debt);
  if (!hasDebt) report.noDebt.push(g.display);
  const isCounty = g.kind === 'County';
  const kindText = isCounty ? 'county' : g.kind.toLowerCase();
  const month = Number(y.yeMonth) || 12;
  // A fiscal year ending before December carries the year it ends in.
  const fyEnd = new Date(Date.UTC(Number(year), month, 0)).toISOString().slice(0, 10);
  const ledger = a.lines.map((l) => ({
    date: fyEnd, flow: l.group === 'revenue' ? 'in' : 'out', category: l.key, counterparty: 'F-65 Annual Local Unit Fiscal Report (Michigan Department of Treasury)',
    description: l.label, amount: l.amount, source: F65_PAGE,
  })).sort((p, q) => (p.flow === q.flow ? q.amount - p.amount : p.flow === 'in' ? -1 : 1));
  const history = reported.map((h) => { const x = aggregate(u.byYear[h]); return { year: Number(h), revenue: sum(x.revenue), spending: sum(x.spending), basis: 'actual' }; });
  return {
    file: fileOf(g.county),
    town: {
      id: slugify(`${g.display} mi`),
      name: g.display,
      state: 'MI',
      stateName: 'Michigan',
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
      ...(hasDebt ? { debt: Math.round(y.debt) } : {}),
      reporting: {
        basis: 'Actual results for the fiscal year, from the F-65 Annual Local Unit Fiscal Report filed with the Michigan Department of Treasury',
        scope: isCounty
          ? 'County general, other governmental and enterprise funds and component units by function, including the road commission, including the sheriff, jail, courts, health department and county roads where the county runs them'
          : `All ${kindText} general, other governmental and enterprise funds and component units by function, including water and sewer; schools are run by separate school districts`,
      },
      history,
      ledger,
      sources: [
        { label: `Michigan Department of Treasury, MI Community Financial Dashboard: FY ${year} F-65 Annual Local Unit Fiscal Report`, url: F65_PAGE },
        { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
        { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
      ],
      notes: [
        `Actual results for the fiscal year ended ${MONTHS[month - 1]} ${Number(fyEnd.slice(8, 10))}, ${fyEnd.slice(0, 4)}, as the ${kindText} reported them in its F-65 Annual Local Unit Fiscal Report to the Michigan Department of Treasury. Not a budget.`,
        ...(Number(year) < latest ? [`The FY ${latest} report was ${u.byYear[latest] ? (status(String(latest)) === 'empty' ? 'not filled in' : 'out of balance (revenue and spending more than four times apart)') : 'not yet in the Treasury dashboard'}, so FY ${year} is used.`] : []),
        isCounty
          ? 'Public schools are run by separate school districts with their own taxes, so they are not included.'
          : `Public schools are run by separate school districts with their own taxes, so they are not included. Residents also pay ${g.county}${g.kind === 'Village' ? ' and the township the village is part of' : ''}.`,
        ...(g.kind === 'Village' ? ['Village residents also pay the township the village is part of, which is listed separately.'] : []),
        'Spending is reported by function for the general fund, other governmental funds, enterprise funds (water, sewer and other utilities) and component units (such as downtown development authorities). Capital outlay has no function, so enterprise capital counts as utilities and the rest is spread over the other spending in proportion.',
        ...(isCounty ? ['Component units are included: the county road commission and other authorities the county appoints and funds.'] : []),
        ...(a.leftOut.otherFunds ? [`Internal service funds (${money(a.leftOut.otherFunds)} of their revenue and spending) are left out, since the departments they serve report that spending.`] : []),
        'Borrowing, transfers between funds, sales of capital assets, depreciation and extraordinary items are left out.',
        ...(a.spending.otherSpending ? [`${money(a.spending.otherSpending)} of miscellaneous spending is more than 15% of the total, so it is shown as not broken down and the ${kindText} is not scored on services or overhead.`] : []),
        'General government, courts, community and economic development, and redevelopment and public housing count as overhead.',
        hasDebt ? 'Debt is total long-term debt at year end, as reported on the F-65.' : 'Long-term debt is not in the Treasury dashboard for this year, so debt is not scored.',
        `Political money is not scored: Michigan ${isCounty ? 'county' : 'local'} candidates file campaign finance reports with their county clerk, not with the state.`,
        'Transparency practices have not been checked yet, so they are not scored.',
      ],
    },
  };
}

const built = [...units.values()].map(buildUnit).filter(Boolean);
const nameCount = new Map();
for (const b of built) nameCount.set(b.town.name, (nameCount.get(b.town.name) || 0) + 1);
for (const b of built) if (nameCount.get(b.town.name) > 1) b.town.id = slugify(`${b.town.name} ${b.town.county} mi`);

const files = [...new Set(built.map((b) => b.file))].sort();
const pick = args.all ? files : files.filter((f) => f.startsWith(slugify(String(args.county || '-'))));
if (!pick.length) { console.error(`Usage: node scripts/mi/f65-build.mjs --county <county> | --all\nFiles: ${files.join(', ')}`); process.exit(1); }
const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
for (const f of pick) {
  const towns = built.filter((b) => b.file === f).map((b) => b.town).sort((x, y) => ((x.type === 'County') === (y.type === 'County') ? x.name.localeCompare(y.name) : x.type === 'County' ? -1 : 1));
  const file = `mi-${f}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
}
index.files.sort();
writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
if (args.all) writeFileSync(join(RAW, 'f65-report.json'), `${JSON.stringify(report, null, 1)}\n`);
const types = built.reduce((m, b) => ({ ...m, [b.town.type]: (m[b.town.type] || 0) + 1 }), {});
console.log(JSON.stringify({ files: pick.length, governments: built.length, types, ...Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length])) }, null, 1));
