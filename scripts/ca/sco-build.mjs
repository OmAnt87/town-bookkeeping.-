#!/usr/bin/env node
// Builds real Town Ledger records for California's counties and cities from the State Controller's
// Financial Transactions Reports (see sco-map.mjs). Each county's file holds the county and the
// cities whose people mostly live in it; San Francisco is a consolidated city and county and is
// listed once, as a city.
//
//   node scripts/ca/download.mjs                    # Census population estimates and gazetteers
//   node scripts/ca/sco-download.mjs
//   pip install openpyxl && python3 scripts/ca/sco-debt-to-json.py
//   node scripts/ca/sco-build.mjs --county "Los Angeles"      (or --all)
//
// Every California city and county files a Financial Transactions Report each year, so these are
// reported figures for fiscal 2023-24 for nearly every government, where the Census unit files use
// 2022 for most cities.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { aggregateSco } from './sco-map.mjs';
import { SCO_PAGE, SCO_YEARS } from './sco-download.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'ca');
const SCO = join(RAW, 'sco');
const OUT = join(ROOT, 'data', 'real');
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';

const args = parseArgs();
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);
const norm = (s) => String(s).toLowerCase().replace(/^st\.? /, 'saint ').replace(/^mt\.? /, 'mount ').replace(/[^a-z]/g, '');

// Census geography for population and map location.
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const gaz = (file, xcol) => new Map(readFileSync(join(RAW, file), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'CA').map((c) => [c[1], [Number(c[xcol]), Number(c[xcol + 1])]]));
const countyXY = gaz('2024_Gaz_counties_national.txt', 8);
const placeXY = gaz('2024_Gaz_place_national.txt', 10);

const countyName = new Map();
const geo = new Map(); // 'County|<norm name>' or 'City|<norm name>'
for (const r of pop.filter((p) => p.sumlev === '050')) {
  countyName.set(r.county, r.name);
  geo.set(`County|${norm(r.name.replace(/ County$/, ''))}`, { kind: 'County', display: r.name, geoid: `06${r.county}`, pop: Number(r[POP_YEAR]), xy: countyXY.get(`06${r.county}`), county: r.name });
}
const placeCounty = new Map();
for (const r of pop.filter((p) => p.sumlev === '157')) {
  const cur = placeCounty.get(r.place);
  if (!cur || Number(r[POP_YEAR]) > cur.pop) placeCounty.set(r.place, { county: r.county, pop: Number(r[POP_YEAR]) });
}
for (const r of pop.filter((p) => p.sumlev === '162')) {
  const m = r.name.match(/^(.+) (city|town)$/);
  if (!m) continue;
  const kind = m[2] === 'city' ? 'City' : 'Town';
  geo.set(`City|${norm(m[1])}`, { kind, display: `${kind} of ${m[1]}`, geoid: `06${r.place}`, pop: Number(r[POP_YEAR]), xy: placeXY.get(`06${r.place}`), county: countyName.get(placeCounty.get(r.place)?.county) });
}
// The State Controller's spellings that differ from the Census's.
const ALIAS = { 'City|lacanadaflintridge': 'City|lacaadaflintridge', 'City|amador': 'City|amadorcity', 'City|elpasoderobles': 'City|elpasoderoblespasorobles', 'City|sanbuenaventura': 'City|sanbuenaventuraventura' };
const geoOf = (kind, name) => {
  const k = `${kind}|${norm(name)}`;
  return geo.get(ALIAS[k] || k) || null;
};

// Lines by entity and year.
const load = (f) => (existsSync(join(SCO, f)) ? JSON.parse(readFileSync(join(SCO, f), 'utf8')) : []);
const units = new Map(); // 'city|Los Angeles' -> { kind, name, county, byYear: { 2024: { rev: [], exp: [], pop } } }
for (const [file, kind, part] of [['city-revenues.json', 'city', 'rev'], ['city-expenditures.json', 'city', 'exp'], ['county-revenues.json', 'county', 'rev'], ['county-expenditures.json', 'county', 'exp']]) {
  for (const r of load(file)) {
    const id = `${kind}|${r.entity_name.trim()}`;
    const u = units.get(id) || units.set(id, { id, kind, name: r.entity_name.trim(), county: r.county, byYear: {} }).get(id);
    const y = (u.byYear[r.fiscal_year] ||= { rev: [], exp: [], pop: Number(r.estimated_population) || 0 });
    y[part].push(r);
  }
}
const debt = existsSync(join(SCO, 'debt.json')) ? JSON.parse(readFileSync(join(SCO, 'debt.json'), 'utf8')) : {};

function buildUnit(u, report) {
  const g = u.kind === 'county' ? geoOf('County', u.name) : geoOf('City', u.name);
  const debtOf = (y) => debt[u.id]?.[y];
  const agg = (y) => aggregateSco(u.byYear[y].rev, u.byYear[y].exp, { kind: u.kind, enterpriseDebtPayments: debtOf(y)?.enterpriseDebtPayments || 0 });
  const filed = (y) => { const a = agg(y); return sum(a.revenue) > 0 && sum(a.spending) > 0 && sum(a.spending) > sum(a.revenue) / 4 && sum(a.revenue) > sum(a.spending) / 4; };
  const years = Object.keys(u.byYear).sort();
  const reported = years.filter(filed);
  const year = reported.at(-1);
  if (!year) { report.incomplete.push(u.name); return null; }
  if (!g || !g.xy || !g.county) { report.skipped.push(`${u.name} (${u.kind}): no Census match`); return null; }
  if (String(SCO_YEARS.at(-1)) > year) report.older.push(`${g.display} (FY ${year}; FY ${SCO_YEARS.at(-1)} ${years.includes(String(SCO_YEARS.at(-1))) ? 'incomplete' : 'not filed'})`);
  const a = agg(year);
  const isCounty = u.kind === 'county';
  const sf = u.kind === 'city' && u.name === 'San Francisco';
  const kindText = isCounty ? 'county' : sf ? 'city and county' : g.kind.toLowerCase();
  const fyText = `fiscal year ${Number(year) - 1}-${String(year).slice(2)}`;
  const date = `${year}-06-30`;
  const ledger = a.lines.map((l) => ({
    date, flow: l.group === 'revenue' ? 'in' : 'out', category: l.key, counterparty: 'Financial Transactions Report (State Controller)',
    description: l.label, amount: l.amount, source: SCO_PAGE,
  })).sort((x, y) => (x.flow === y.flow ? y.amount - x.amount : x.flow === 'in' ? -1 : 1));
  const history = reported.map((y) => { const h = agg(y); return { year: Number(y), revenue: sum(h.revenue), spending: sum(h.spending), basis: 'actual' }; });
  const d = debtOf(year);
  return {
    file: slugify(g.county.replace(/ County$/, '')),
    town: {
      id: slugify(`${sf ? 'City of San Francisco' : g.display} ca`),
      name: sf ? 'City of San Francisco' : g.display,
      state: 'CA',
      stateName: 'California',
      county: g.county,
      type: sf ? 'City' : g.kind,
      lat: Math.round(g.xy[0] * 1e5) / 1e5,
      lng: Math.round(g.xy[1] * 1e5) / 1e5,
      population: g.pop || u.byYear[year].pop || 1,
      fiscalYear: Number(year),
      asOf: new Date().toISOString().slice(0, 10),
      censusGeoid: g.geoid,
      revenue: a.revenue,
      spending: a.spending,
      ...(d ? { debt: d.debt } : {}),
      reporting: {
        basis: 'Actual revenues and expenditures, from the Financial Transactions Report filed with the California State Controller',
        scope: isCounty
          ? 'All county governmental and enterprise funds, including the sheriff, jails, courts, social services, public health and county hospitals; internal service funds are left out'
          : `All ${kindText} governmental and enterprise funds, including utilities; internal service funds are left out and schools are run by separate school districts`,
      },
      history,
      ledger,
      sources: [
        { label: `California State Controller, By the Numbers: ${fyText} Financial Transactions Report (revenues, expenditures${d ? ', long-term debt and leases' : ''})`, url: SCO_PAGE },
        { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
        { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
      ],
      notes: [
        `Actual revenues and expenditures for ${fyText} (ending June 30, ${year}), as the ${kindText} reported them to the State Controller. Not a budget.`,
        ...(Number(year) < SCO_YEARS.at(-1) ? [`The ${kindText} had not filed a complete report for ${SCO_YEARS.at(-1) - 1}-${String(SCO_YEARS.at(-1)).slice(2)}, so ${Number(year) - 1}-${String(year).slice(2)} is used.`] : []),
        isCounty
          ? 'Public schools are run by separate school districts, so they are not included. Counties provide social services, public health, jails and courts for everyone in the county, and city-type services in unincorporated areas.'
          : `Public schools are run by separate school districts, so they are not included.${sf ? ' San Francisco is a consolidated city and county, so county services such as public health, social services and jails are included.' : ` Residents also pay ${g.county}.`}`,
        'Water, sewer, electric, gas and solid waste utilities count as utilities; airports, ports and transit as infrastructure; public hospitals as health services.',
        ...(isCounty ? ['Counties report capital outlay by fund rather than by service, so it counts as infrastructure.'] : []),
        'Internal service funds (charges between departments), depreciation and transfers between funds are left out. Enterprise funds\' interest is replaced by their principal and interest payments from the debt forms.',
        'Courts, legal services, prosecutors and public defenders, housing, planning and community development count as overhead.',
        d ? 'Debt is principal outstanding at year end on bonds, certificates of participation, other long-term debt, construction financing and leases, as reported.' : `Debt outstanding was not available for ${fyText}, so fiscal health is not scored.`,
        `Political money is not scored: California ${isCounty ? 'county' : 'city'} candidates file campaign reports with their local filing officer, not with the state.`,
        'Transparency practices have not been checked yet, so they are not scored.',
      ],
    },
  };
}

const built = [];
const report = { skipped: [], incomplete: [], older: [], duplicates: [] };
const seen = new Set();
for (const u of units.values()) {
  const b = buildUnit(u, report);
  if (!b) continue;
  if (seen.has(b.town.id)) { report.duplicates.push(b.town.name); continue; }
  seen.add(b.town.id);
  built.push(b);
}
const files = [...new Set(built.map((b) => b.file))].sort();
const pick = args.all ? files : files.filter((f) => f === slugify(String(args.county || '-')));
if (!pick.length) { console.error(`Usage: node scripts/ca/sco-build.mjs --county <county> | --all\nFiles: ${files.join(', ')}`); process.exit(1); }
const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
const ORDER = { County: 0, City: 1, Town: 2 };
for (const f of pick) {
  const towns = built.filter((b) => b.file === f).map((b) => b.town).sort((x, y) => ORDER[x.type] - ORDER[y.type] || x.name.localeCompare(y.name));
  const file = `ca-${f}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
}
index.files.sort();
writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
if (args.all) writeFileSync(join(SCO, 'report.json'), `${JSON.stringify(report, null, 1)}\n`);
const types = built.reduce((m, b) => ({ ...m, [b.town.type]: (m[b.town.type] || 0) + 1 }), {});
console.log(JSON.stringify({ files: pick.length, governments: built.length, types, ...Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length])) }, null, 1));
