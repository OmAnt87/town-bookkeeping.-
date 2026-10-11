#!/usr/bin/env node
// Builds real Town Ledger records for Wisconsin's counties, cities, villages and towns from the
// Department of Revenue's County and Municipal Revenues and Expenditures workbook (see
// dor-map.mjs). Each county's file holds the county and the governments whose people mostly live
// in it.
//
//   node scripts/wi/dor-download.mjs
//   node scripts/wi/dor-build.mjs --county Dane      (or --all)
//
// Every Wisconsin county, city, village and town files a Municipal Financial Report with the
// Department of Revenue, so these are reported calendar-year figures for every government.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { aggregateCmre } from './dor-map.mjs';
import { CMRE_PAGE, CMRE_YEARS } from './dor-download.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'wi');
const OUT = join(ROOT, 'data', 'real');
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';

const args = parseArgs();
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);
const norm = (s) => String(s).toLowerCase().replace(/^st\.? /, 'saint ').replace(/^mt\.? /, 'mount ').replace(/[^a-z0-9]/g, '');

// Census geography for population and map location.
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const gaz = (file, key, xcol) => new Map(readFileSync(join(RAW, file), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'WI').map((c) => [key(c[1]), [Number(c[xcol]), Number(c[xcol + 1])]]));
const countyXY = gaz('2024_Gaz_counties_national.txt', (id) => id, 8);
const cousubXY = gaz('2024_Gaz_cousubs_national.txt', (id) => id, 9);
const placeXY = gaz('2024_Gaz_place_national.txt', (id) => id.slice(2), 10);
const displayName = (kind, base) => `${kind} of ${base}`;

const countyName = new Map();
const countyFips = new Map(); // normalized county name -> FIPS county code
const geo = new Map(); // 'County|025', 'Town|025|blooming grove', 'City|madison'
const fileOf = (county) => slugify(county.replace(/ County$/, ''));
for (const r of pop.filter((p) => p.sumlev === '050')) {
  countyName.set(r.county, r.name);
  countyFips.set(norm(r.name.replace(/ County$/, '')), r.county);
  geo.set(`County|${r.county}`, { kind: 'County', base: r.name.replace(/ County$/, ''), display: r.name, geoid: `55${r.county}`, pop: Number(r[POP_YEAR]), xy: countyXY.get(`55${r.county}`), county: r.name });
}
for (const r of pop.filter((p) => p.sumlev === '061')) {
  const m = r.name.match(/^(.+) town$/);
  if (!m) continue;
  geo.set(`Town|${r.county}|${norm(m[1])}`, { kind: 'Town', base: m[1], display: displayName('Town', m[1]), geoid: `55${r.county}${r.cousub}`, pop: Number(r[POP_YEAR]), xy: cousubXY.get(`55${r.county}${r.cousub}`), county: countyName.get(r.county) });
}
const placeCounty = new Map();
for (const r of pop.filter((p) => p.sumlev === '157')) {
  const cur = placeCounty.get(r.place);
  if (!cur || Number(r[POP_YEAR]) > cur.pop) placeCounty.set(r.place, { county: r.county, pop: Number(r[POP_YEAR]) });
}
for (const r of pop.filter((p) => p.sumlev === '162')) {
  const m = r.name.match(/^(.+) (city|village)$/);
  if (!m) continue;
  const kind = m[2] === 'city' ? 'City' : 'Village';
  geo.set(`${kind}|${norm(m[1])}`, { kind, base: m[1], display: displayName(kind, m[1]), geoid: `55${r.place}`, pop: Number(r[POP_YEAR]), xy: placeXY.get(r.place), county: countyName.get(placeCounty.get(r.place)?.county) });
}

const KIND = { C: 'City', V: 'Village', T: 'Town', Y: 'County' };
function geoKeyOf(row) {
  const kind = KIND[row.MuniTypeCode];
  const fips = countyFips.get(norm(row.CountyName));
  if (kind === 'County') return `County|${fips}`;
  const n = norm(row.Municipality);
  // A town that has since become a village (Rib Mountain) is found under its new kind.
  const keys = kind === 'Town' ? [`Town|${fips}|${n}`, `Village|${n}`, `City|${n}`] : [`${kind}|${n}`, `${kind === 'City' ? 'Village' : 'City'}|${n}`];
  const hit = keys.find((k) => geo.has(k));
  if (hit || kind === 'Town') return hit || null;
  // Longer Census names (Fontana-on-Geneva Lake village for Fontana): a unique prefix match.
  const prefixed = [...geo.keys()].filter((k) => k.startsWith(`${kind}|${n}`));
  return prefixed.length === 1 ? prefixed[0] : null;
}

// Rows by government and year, grouped by geography: a town that became a village (Rib Mountain)
// files under a new code but is the same government.
const cmre = JSON.parse(readFileSync(join(RAW, 'dor', 'cmre.json'), 'utf8'));
const units = new Map();
const unmatched = [];
for (const year of CMRE_YEARS) {
  for (const row of cmre[year] || []) {
    const key = geoKeyOf(row);
    if (!key || !geo.get(key)?.xy || !geo.get(key)?.county) { unmatched.push(row); continue; }
    const u = units.get(key) || units.set(key, { key, row, byYear: {} }).get(key);
    u.row = row;
    u.byYear[year] = row;
  }
}

const report = { skipped: [...new Set(unmatched.map((r) => `${r.Municipality} (${KIND[r.MuniTypeCode]}, ${r.CountyName})`))], empty: [], inconsistent: [], older: [], noResidents: [] };
function buildUnit(u) {
  const g = geo.get(u.key);
  // A town whose land a village has taken over (Harrison, Calumet County) can still file.
  if (!g.pop) { report.noResidents.push(`${g.display} (${g.county})`); return null; }
  const status = (y) => { const a = aggregateCmre(u.byYear[y]); return a.empty ? 'empty' : a.inconsistent ? 'inconsistent' : 'ok'; };
  const years = Object.keys(u.byYear).sort();
  const reported = years.filter((y) => status(y) === 'ok');
  const year = reported.at(-1);
  if (!year) { report[status(years.at(-1))].push(g.display); return null; }
  if (years.at(-1) > year) report.older.push(`${g.display} (${year}; ${years.at(-1)} ${status(years.at(-1))})`);
  const a = aggregateCmre(u.byYear[year]);
  const isCounty = g.kind === 'County';
  const kindText = isCounty ? 'county' : g.kind.toLowerCase();
  const date = `${year}-12-31`;
  const ledger = a.lines.map((l) => ({
    date, flow: l.group === 'revenue' ? 'in' : 'out', category: l.key, counterparty: 'Municipal Financial Report (Wisconsin Department of Revenue)',
    description: l.label, amount: l.amount, source: CMRE_PAGE,
  })).sort((p, q) => (p.flow === q.flow ? q.amount - p.amount : p.flow === 'in' ? -1 : 1));
  const history = reported.map((y) => { const h = aggregateCmre(u.byYear[y]); return { year: Number(y), revenue: sum(h.revenue), spending: sum(h.spending), basis: 'actual' }; });
  return {
    file: fileOf(g.county),
    town: {
      id: slugify(`${g.display} wi`),
      name: g.display,
      state: 'WI',
      stateName: 'Wisconsin',
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
      debt: a.debt,
      reporting: {
        basis: 'Actual results for the calendar year, from the Municipal Financial Report filed with the Wisconsin Department of Revenue',
        scope: isCounty
          ? 'County governmental funds by function, including the sheriff, jail, courts, human services and county highways, plus utility and other enterprise funds as totals'
          : `All ${kindText} governmental funds by function, plus utility and other enterprise funds as totals; schools are run by separate school districts`,
      },
      history,
      ledger,
      sources: [
        { label: `Wisconsin Department of Revenue, ${year} County and Municipal Revenues and Expenditures (Municipal Financial Reports)`, url: CMRE_PAGE },
        { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
        { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
      ],
      notes: [
        `Actual results for calendar year ${year}, as the ${kindText} reported them in its Municipal Financial Report to the Wisconsin Department of Revenue. Not a budget.`,
        ...(Number(year) < CMRE_YEARS.at(-1) ? [`The ${CMRE_YEARS.at(-1)} report was ${u.byYear[CMRE_YEARS.at(-1)] ? (status(String(CMRE_YEARS.at(-1))) === 'empty' ? 'not filled in' : 'out of balance (revenue and spending more than four times apart)') : 'not in the Department of Revenue compilation'}, so ${year} is used.`] : []),
        isCounty
          ? 'Public schools are run by separate school districts with their own taxes, so they are not included.'
          : `Public schools are run by separate school districts with their own taxes, so they are not included. Residents also pay ${g.county}.`,
        ...(g.kind === 'Town' ? ['Wisconsin towns govern the rural areas outside cities and villages; cities and villages are separate from the town around them.'] : []),
        'Governmental funds are reported by function. Water, sewer, electric and other utility and enterprise funds are reported only as total revenues and expenses, counted as utility charges and utilities.',
        ...(a.leftOut.sources || a.leftOut.uses ? [`Other financing sources (${money(a.leftOut.sources)}: borrowing, transfers and refunding) and uses (${money(a.leftOut.uses)}) are left out.`] : []),
        'General government, conservation and development, and other spending count as overhead.',
        'Debt is general obligation debt outstanding at year end, as reported.',
        `Political money is not scored: ${isCounty ? 'contributions to Wisconsin county candidates were not loaded' : 'Wisconsin local candidates file campaign finance reports with their municipal clerk, not with the state'}.`,
        'Transparency practices have not been checked yet, so they are not scored.',
      ],
    },
  };
}

const built = [...units.values()].map(buildUnit).filter(Boolean);
// Same-named towns in different counties get the county in their id.
const nameCount = new Map();
for (const b of built) nameCount.set(b.town.name, (nameCount.get(b.town.name) || 0) + 1);
for (const b of built) if (nameCount.get(b.town.name) > 1) b.town.id = slugify(`${b.town.name} ${b.town.county} wi`);

const files = [...new Set(built.map((b) => b.file))].sort();
const pick = args.all ? files : files.filter((f) => f.startsWith(slugify(String(args.county || '-'))));
if (!pick.length) { console.error(`Usage: node scripts/wi/dor-build.mjs --county <county> | --all\nFiles: ${files.join(', ')}`); process.exit(1); }
const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
const ORDER = { County: 0, City: 1, Village: 2, Town: 3 };
for (const f of pick) {
  const towns = built.filter((b) => b.file === f).map((b) => b.town).sort((x, y) => ORDER[x.type] - ORDER[y.type] || x.name.localeCompare(y.name));
  const file = `wi-${f}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
}
index.files.sort();
writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
if (args.all) writeFileSync(join(RAW, 'dor-report.json'), `${JSON.stringify(report, null, 1)}\n`);
const types = built.reduce((m, b) => ({ ...m, [b.town.type]: (m[b.town.type] || 0) + 1 }), {});
console.log(JSON.stringify({ files: pick.length, governments: built.length, types, ...Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length])) }, null, 1));
