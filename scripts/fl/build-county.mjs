#!/usr/bin/env node
// Builds real Town Ledger records for Florida's counties, cities, towns and villages. Each
// county's file holds the county and the municipalities whose people mostly live in it;
// Jacksonville, consolidated with Duval County, heads Duval's file.
//
//   node scripts/fl/download.mjs && python3 scripts/fl/edr-to-json.py
//   node scripts/fl/build-county.mjs --county Hillsborough   (or --all)
//
// Figures are each government's Annual Financial Report to the Department of Financial Services,
// as compiled by the Office of Economic and Demographic Research (EDR).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { aggregateFl } from './edr-map.mjs';
import { EDR_PAGE } from './download.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'fl');
const OUT = join(ROOT, 'data', 'real');
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';
const AFR_PAGE = 'https://myfloridacfo.com/division/aa/local-governments';
export const MIN_YEAR = 2022;

const args = parseArgs();
const edr = JSON.parse(readFileSync(join(RAW, 'edr.json'), 'utf8'));
const index = JSON.parse(readFileSync(join(RAW, 'edr-index.json'), 'utf8'));
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const gaz = (file, xcol) => new Map(readFileSync(join(RAW, file), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'FL').map((c) => [c[1], [Number(c[xcol]), Number(c[xcol + 1])]]));
const countyXY = gaz('2024_Gaz_counties_national.txt', 8);
const placeXY = gaz('2024_Gaz_place_national.txt', 10);
const norm = (s) => String(s || '').toLowerCase().replace(/['’.]/g, '').replace(/&/g, ' and ').replace(/\bsaint\b/g, 'st').replace(/[^a-z0-9]+/g, '');

const counties = new Map();
const countyByGeoid = new Map();
for (const r of pop.filter((p) => p.sumlev === '050')) {
  const geoid = `12${r.county}`;
  const info = { geoid, name: r.name, base: r.name.replace(/ County$/, ''), pop: Number(r[POP_YEAR]), xy: countyXY.get(geoid), file: slugify(r.name) };
  counties.set(norm(info.base), info);
  countyByGeoid.set(geoid, info);
}
const placeCounty = new Map();
for (const r of pop.filter((p) => p.sumlev === '157')) {
  const cur = placeCounty.get(r.place);
  if (!cur || Number(r[POP_YEAR]) > cur.pop) placeCounty.set(r.place, { county: `12${r.county}`, pop: Number(r[POP_YEAR]) });
}
const KIND = { city: 'City', town: 'Town', village: 'Village' };
const places = new Map();
for (const r of pop.filter((p) => p.sumlev === '162')) {
  const m = r.name.match(/^(.+?) (city|town|village)( \(balance\))?$/);
  if (!m) continue;
  const c = countyByGeoid.get(placeCounty.get(r.place)?.county);
  places.set(norm(m[1]), { geoid: `12${r.place}`, base: m[1], kind: KIND[m[2]], pop: Number(r[POP_YEAR]), xy: placeXY.get(`12${r.place}`), county: c });
}

function geoFor(g) {
  if (g.kind === 'county') {
    const c = counties.get(norm(g.name.replace(/ County$/, '')));
    return c && { kind: 'County', display: c.name, geoid: c.geoid, pop: c.pop, xy: c.xy, county: c.name, file: c.file };
  }
  const p = places.get(norm(g.name));
  if (!p || !p.county) return null;
  if (norm(g.name) === 'jacksonville') {
    // Consolidated with Duval County in 1968; the county's file is headed by the city.
    const d = counties.get('duval');
    return { kind: 'Consolidated government', display: 'City of Jacksonville', geoid: p.geoid, pop: p.pop, xy: p.xy, county: d.name, file: d.file };
  }
  return { kind: p.kind, display: `${p.kind} of ${p.base}`, geoid: p.geoid, pop: p.pop, xy: p.xy, county: p.county.name, file: p.county.file };
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function fyEnd(text, year) {
  const m = String(text || '').match(/Ended\s+([A-Za-z]+)\s+(\d+),\s*(\d{4})/);
  if (!m) return `${year}-09-30`;
  return `${m[3]}-${String(MONTHS.indexOf(m[1]) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`;
}

function buildGov(g, report) {
  const rec = edr[`${g.kind}-${g.slug}`] || {};
  const years = [...new Set([...Object.keys(rec.revenues || {}), ...Object.keys(rec.expenditures || {})])].sort();
  const agg = (y) => aggregateFl(rec.revenues?.[y]?.lines, rec.expenditures?.[y]?.lines);
  const usable = years.filter((y) => { const a = agg(y); return !a.empty && !a.inconsistent; });
  const year = usable.at(-1);
  if (!year || Number(year) < MIN_YEAR) {
    const recent = years.filter((y) => Number(y) >= MIN_YEAR && !agg(y).empty);
    if (recent.length) report.inconsistent.push(`${g.name} (FY ${recent.join(', ')})`);
    else report.notFiled.push(`${g.name}${years.length ? ` (latest FY ${years.at(-1)})` : ''}`);
    return null;
  }
  const geo = geoFor(g);
  if (!geo || !geo.xy) { report.skipped.push(`${g.name}: no Census match`); return null; }
  const a = agg(year);
  if (years.at(-1) !== year) report.older.push(`${geo.display} (FY ${year}; FY ${years.at(-1)} ${agg(years.at(-1)).empty ? 'empty' : 'inconsistent'})`);
  const history = usable.map((y) => { const h = agg(y); return { year: Number(y), revenue: sum(h.revenue), spending: sum(h.spending), basis: 'actual' }; });
  const date = fyEnd(rec.revenues?.[year]?.fye || rec.expenditures?.[year]?.fye, year);
  const fyEndText = new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const src = g.kind === 'county' ? EDR_PAGE.county : EDR_PAGE.muni;
  const ledger = a.lines.map((l) => ({ date, flow: l.group === 'revenue' ? 'in' : 'out', category: l.key, counterparty: 'Annual Financial Report', description: l.label, amount: l.amount, source: src }))
    .sort((x, y) => (x.flow === y.flow ? y.amount - x.amount : x.flow === 'in' ? -1 : 1));
  const isCounty = geo.kind === 'County' || geo.kind === 'Consolidated government';
  const asOf = new Date().toISOString().slice(0, 10);
  return {
    file: geo.file,
    town: {
      id: slugify(`${geo.display} fl`),
      name: geo.display,
      state: 'FL',
      stateName: 'Florida',
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
      reporting: {
        basis: 'Actual results (Annual Financial Report to the Department of Financial Services, as compiled by EDR)',
        scope: `General government, special revenue, debt service, capital projects and enterprise funds${isCounty ? ', including the constitutional officers' : ''}; schools are run by separate school districts`,
      },
      history,
      ledger,
      sources: [
        { label: `FL Office of Economic and Demographic Research, Expenditures and Revenues Reported by Florida's ${g.kind === 'county' ? 'County' : 'Municipal'} Governments, FY ${year}`, url: src },
        { label: 'FL Department of Financial Services, Local Government Annual Financial Reports', url: AFR_PAGE },
        { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
        { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
      ],
      notes: [
        `Actual results for the fiscal year ended ${fyEndText}, from the Annual Financial Report the ${isCounty ? 'county' : 'municipality'} files with the Department of Financial Services, as compiled by the Office of Economic and Demographic Research. Not a budget.`,
        isCounty
          ? 'Public schools are run by separate school districts with their own taxes, so they are not included. The county includes its elected constitutional officers (sheriff, clerk, property appraiser, tax collector and supervisor of elections).'
          : `Public schools are run by separate school districts, and ${geo.county} provides many other services; residents pay the ${geo.kind.toLowerCase()}, the county and the school district.`,
        'Covers governmental and enterprise funds, including water, sewer, electric and other utilities. Enterprise funds report expenses on an accrual basis, so their spending includes depreciation rather than capital purchases.',
        `Left out: transfers between funds, borrowing and other financing (${money(a.leftOut.otherSources)} of receipts and ${money(a.leftOut.otherUses)} of payments), internal service funds, pension and other trust funds, and component units.`,
        'Debt service counts principal and interest paid from governmental funds; interest on enterprise debt is part of enterprise expenses. Debt outstanding is not in the EDR data, so fiscal health is not scored.',
        'Courts, legal services, planning, housing and economic development count as overhead.',
        `Political money is not scored: Florida ${isCounty ? 'county' : 'municipal'} candidates file campaign reports with the ${isCounty ? 'county supervisor of elections' : 'municipal clerk'}, not with a statewide agency.`,
        'Transparency practices have not been checked yet, so they are not scored.',
      ],
    },
  };
}

const built = [];
const report = { skipped: [], notFiled: [], inconsistent: [], older: [] };
for (const g of index) {
  const b = buildGov(g, report);
  if (b) built.push(b);
}
const files = [...new Set(built.map((b) => b.file))].sort();
const pick = args.all ? files : files.filter((f) => f.startsWith(slugify(String(args.county || '-'))));
if (!pick.length) { console.error(`Usage: node scripts/fl/build-county.mjs --county <county> | --all\nFiles: ${files.join(', ')}`); process.exit(1); }
const outIndex = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
const rank = (t) => (t.type === 'County' || t.type === 'Consolidated government' ? 0 : 1);
for (const f of pick) {
  const towns = built.filter((b) => b.file === f).map((b) => b.town).sort((x, y) => (rank(x) === rank(y) ? x.name.localeCompare(y.name) : rank(x) - rank(y)));
  const file = `fl-${f}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!outIndex.files.includes(file)) outIndex.files.push(file);
}
outIndex.files.sort();
writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(outIndex, null, 2)}\n`);
if (args.all) writeFileSync(join(RAW, 'build-report.json'), `${JSON.stringify(report, null, 1)}\n`);
const types = built.reduce((m, b) => ({ ...m, [b.town.type]: (m[b.town.type] || 0) + 1 }), {});
console.log(JSON.stringify({ files: pick.length, governments: built.length, types, ...report }, null, 1));
