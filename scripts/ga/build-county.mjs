#!/usr/bin/env node
// Builds real Town Ledger records for Georgia's counties, consolidated governments, cities and
// towns. Each county's file holds the county (or consolidated government) and the cities whose
// people mostly live in it.
//
//   node scripts/ga/download.mjs && python3 scripts/ga/rlgf-to-json.py
//   node scripts/ga/build-county.mjs --county Fulton      (or --all)
//
// Figures are each government's Report of Local Government Finance to the Department of
// Community Affairs (all funds, from audited figures where available).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { aggregateGa } from './rlgf-map.mjs';
import { RLGF_PAGE, RLGF_VIEWER } from './download.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'ga');
const OUT = join(ROOT, 'data', 'real');
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';
export const MIN_YEAR = 2022; // older reports are left out

const args = parseArgs();
const rlgf = JSON.parse(readFileSync(join(RAW, 'rlgf.json'), 'utf8'));
const index = JSON.parse(readFileSync(join(RAW, 'rlgf-index.json'), 'utf8'));
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const gaz = (file, xcol) => new Map(readFileSync(join(RAW, file), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'GA').map((c) => [c[1], [Number(c[xcol]), Number(c[xcol + 1])]]));
const countyXY = gaz('2024_Gaz_counties_national.txt', 8);
const placeXY = gaz('2024_Gaz_place_national.txt', 10);
const norm = (s) => String(s || '').toLowerCase().replace(/['’.]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

// Census geography.
const counties = new Map(); // norm(base) -> info
const countyByGeoid = new Map();
for (const r of pop.filter((p) => p.sumlev === '050')) {
  const geoid = `13${r.county}`;
  const info = { geoid, name: r.name, base: r.name.replace(/ County$/, ''), pop: Number(r[POP_YEAR]), xy: countyXY.get(geoid), file: slugify(r.name) };
  counties.set(norm(info.base), info);
  countyByGeoid.set(geoid, info);
}
const placeCounty = new Map();
for (const r of pop.filter((p) => p.sumlev === '157')) {
  const cur = placeCounty.get(r.place);
  if (!cur || Number(r[POP_YEAR]) > cur.pop) placeCounty.set(r.place, { county: `13${r.county}`, pop: Number(r[POP_YEAR]) });
}
const places = new Map(); // norm(base) -> [info]
for (const r of pop.filter((p) => p.sumlev === '162')) {
  const m = r.name.match(/^(.+) (city|town)$/);
  if (!m) continue;
  const c = countyByGeoid.get(placeCounty.get(r.place)?.county);
  const info = { geoid: `13${r.place}`, base: m[1], kind: m[2] === 'city' ? 'City' : 'Town', pop: Number(r[POP_YEAR]), xy: placeXY.get(`13${r.place}`), county: c };
  (places.get(norm(m[1])) || places.set(norm(m[1]), []).get(norm(m[1]))).push(info);
}

// DCA government ids: type (1 county, 2 city, 3 consolidated), then DCA's 3-digit county code.
const dcaCounty = new Map(index.filter((g) => g.id[0] === '1').map((g) => [g.id.slice(1, 4), g.name.replace(/ County$/, '')]));
// Consolidated governments cover their whole county.
const CONSOLIDATED = { 3029029: 'Clarke', 3121121: 'Richmond', 3106002: 'Muscogee', 3026026: 'Chattahoochee', 3050050: 'Echols', 3118118: 'Quitman', 3011011: 'Bibb', 3152152: 'Webster' };
const CONSOLIDATED_NAME = { 3029029: 'Athens-Clarke County Unified Government', 3121121: 'Augusta-Richmond County', 3106002: 'Columbus Consolidated Government', 3026026: 'Cusseta-Chattahoochee County Unified Government', 3050050: 'Echols County Consolidated Government', 3118118: 'Georgetown-Quitman County Unified Government', 3011011: 'Macon-Bibb County', 3152152: 'Webster County Unified Government' };
// DCA spellings that differ from the Census's.
const ALIAS = { 'mt airy': 'mount airy', 'mt vernon': 'mount vernon', 'mt zion': 'mount zion', 'lagrange': 'lagrange', 'st marys': 'st marys' };

function geoFor(g) {
  if (g.id[0] === '3') {
    const c = counties.get(norm(CONSOLIDATED[g.id]));
    return c && { key: g.id, kind: 'Consolidated government', display: CONSOLIDATED_NAME[g.id], geoid: c.geoid, pop: c.pop, xy: c.xy, county: c.name, file: c.file };
  }
  if (g.id[0] === '1') {
    const c = counties.get(norm(g.name.replace(/ County$/, '')));
    return c && { key: g.id, kind: 'County', display: c.name, geoid: c.geoid, pop: c.pop, xy: c.xy, county: c.name, file: c.file };
  }
  // "Garden City City" is listed as "Garden City"; try the name with and without the type.
  const bases = [norm(g.name.replace(/ (City|Town)$/i, '')), norm(g.name)].map((b) => ALIAS[b] || b);
  const list = bases.map((b) => places.get(b)).find((l) => l?.length) || [];
  const home = dcaCounty.get(g.id.slice(1, 4));
  const p = list.length === 1 ? list[0] : list.find((x) => x.county && norm(x.county.base) === norm(home));
  return p && p.county && { key: g.id, kind: p.kind, display: `${p.kind} of ${p.base}`, geoid: p.geoid, pop: p.pop, xy: p.xy, county: p.county.name, file: p.county.file };
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const fyEndDate = (fye, year) => {
  const m = String(fye || '').match(/^([A-Za-z]+)\s+(\d+)/);
  const mi = m ? MONTHS.indexOf(m[1][0].toUpperCase() + m[1].slice(1).toLowerCase()) : 5;
  return `${year}-${String((mi < 0 ? 5 : mi) + 1).padStart(2, '0')}-${String(m ? m[2] : 30).padStart(2, '0')}`;
};

function buildGov(g, report) {
  const years = rlgf[g.id] || {};
  const usable = Object.keys(years).filter((y) => { const x = aggregateGa(years[y]); return !x.empty && !x.inconsistent; }).sort();
  const year = usable.at(-1);
  const latestListed = Object.keys(g.files).sort().at(-1);
  if (!year || Number(year) < MIN_YEAR) {
    const recent = Object.keys(years).filter((y) => Number(y) >= MIN_YEAR);
    if (recent.length) report.inconsistent.push(`${g.name} (FY ${recent.join(', ')})`);
    else report.notFiled.push(`${g.name}${latestListed ? ` (latest FY ${latestListed})` : ''}`);
    return null;
  }
  const geo = geoFor(g);
  if (!geo || !geo.xy) { report.skipped.push(`${g.name}: no Census match`); return null; }
  const b = years[year];
  const a = aggregateGa(b);
  for (const [t, [x, z]] of Object.entries(a.check)) if (Math.abs(x - z) > 2) report.mismatch.push(`${g.name} FY ${year} ${t}: mapped ${money(x)} vs form ${money(z)}`);
  const lastYear = Object.keys(years).sort().at(-1);
  if (lastYear !== year) report.older.push(`${geo.display} (FY ${year}; FY ${lastYear} report ${aggregateGa(years[lastYear]).empty ? 'empty' : 'inconsistent'})`);

  const history = usable.map((y) => { const h = aggregateGa(years[y]); return { year: Number(y), revenue: sum(h.revenue), spending: sum(h.spending), basis: 'actual' }; });
  const log = b.LOG1 || {};
  const date = fyEndDate(log.FYEmonth, year);
  const fyEndText = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const src = `https://apps.dca.ga.gov${g.files[year]}`;
  const ledger = a.lines.map((l) => ({ date, flow: l.group === 'revenue' ? 'in' : 'out', category: l.key, counterparty: 'Report of Local Government Finance', description: l.label, amount: l.amount, source: src }))
    .sort((x, y) => (x.flow === y.flow ? y.amount - x.amount : x.flow === 'in' ? -1 : 1));
  const audited = /^y/i.test(String(log.Audited || ''));
  const isCity = geo.kind === 'City' || geo.kind === 'Town';
  const asOf = new Date().toISOString().slice(0, 10);
  return {
    file: geo.file,
    town: {
      id: slugify(`${geo.display} ga`),
      name: geo.display,
      state: 'GA',
      stateName: 'Georgia',
      county: geo.county,
      type: geo.kind,
      lat: Math.round(geo.xy[0] * 1e5) / 1e5,
      lng: Math.round(geo.xy[1] * 1e5) / 1e5,
      population: geo.pop || 1,
      fiscalYear: Number(year),
      asOf,
      censusGeoid: geo.geoid,
      revenue: a.revenue,
      spending: a.spending,
      debt: a.debt,
      reporting: {
        basis: `Actual results (Report of Local Government Finance to the Department of Community Affairs${audited ? ', from audited figures' : ''})`,
        scope: 'All funds, including utilities and other enterprise funds; schools are run by separate school districts',
      },
      history,
      ledger,
      sources: [
        { label: `GA Department of Community Affairs, Report of Local Government Finance, FY ${year}`, url: src },
        { label: 'GA Department of Community Affairs, Report of Local Government Finance (all years)', url: RLGF_VIEWER },
        { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
        { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
      ],
      notes: [
        `Actual results for the fiscal year ended ${fyEndText}, from the Report of Local Government Finance filed with the Department of Community Affairs${audited ? ' (audited figures)' : ' (the report says the figures are not audited)'}. Not a budget.`,
        ...(Number(year) < Number(lastYear || year) || Number(year) < new Date().getFullYear() - 1 ? [`FY ${year} is the latest report filed with DCA.`] : []),
        isCity
          ? `Public schools are run by separate school districts, and ${geo.county} provides many other services; residents pay the ${geo.kind.toLowerCase()}, the county and the school district.`
          : 'Public schools are run by separate school districts with their own taxes, so they are not included.',
        'Covers every fund, including water, sewer, electric, gas, airport and other enterprise funds. Debt service counts long-term principal retired and interest; borrowing and transfers between funds are left out.',
        ...(a.intergovernmental ? [`Payments to other governments (${money(a.intergovernmental)}) are left out, because the government receiving them reports that spending.`] : []),
        'Courts, legal services, public buildings, housing, planning and economic development count as overhead.',
        'Debt is revenue bonds, general obligation bonds, other long-term debt, capital leases, special assessment debt and short-term notes outstanding at year end.',
        `Political money is not scored: Georgia ${isCity ? 'city' : 'county'} candidates file their campaign reports with the ${isCity ? 'city clerk' : 'county election superintendent'}, not with a statewide agency.`,
        'Transparency practices have not been checked yet, so they are not scored.',
      ],
    },
  };
}

const built = [];
const report = { skipped: [], notFiled: [], inconsistent: [], mismatch: [], older: [] };
for (const g of index) {
  const b = buildGov(g, report);
  if (b) built.push(b);
}
const files = [...new Set(built.map((b) => b.file))].sort();
const pick = args.all ? files : files.filter((f) => f.startsWith(slugify(String(args.county || '-'))));
if (!pick.length) { console.error(`Usage: node scripts/ga/build-county.mjs --county <county> | --all\nFiles: ${files.join(', ')}`); process.exit(1); }
const outIndex = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
const rank = (t) => (t.type === 'City' || t.type === 'Town' ? 1 : 0);
for (const f of pick) {
  const towns = built.filter((b) => b.file === f).map((b) => b.town).sort((x, y) => (rank(x) === rank(y) ? x.name.localeCompare(y.name) : rank(x) - rank(y)));
  const file = `ga-${f}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!outIndex.files.includes(file)) outIndex.files.push(file);
}
outIndex.files.sort();
writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(outIndex, null, 2)}\n`);
if (args.all) writeFileSync(join(RAW, 'build-report.json'), `${JSON.stringify(report, null, 1)}\n`);
const types = built.reduce((m, b) => ({ ...m, [b.town.type]: (m[b.town.type] || 0) + 1 }), {});
console.log(JSON.stringify({ files: pick.length, governments: built.length, types, ...report, notFiled: report.notFiled.length }, null, 1));
