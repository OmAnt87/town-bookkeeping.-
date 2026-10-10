#!/usr/bin/env node
// Builds real Town Ledger records for New Hampshire's counties, cities and towns. Each county's
// file holds the county and the cities and towns in it.
//
//   node scripts/nh/download.mjs
//   node scripts/nh/build-county.mjs --county Grafton      (or --all)
//
// Figures are what each government reported to the Census Bureau's Annual Survey of State and
// Local Government Finances (every government in the 2022 Census of Governments, a sample in
// other years), from the Census individual unit files. The Census counts New Hampshire's towns
// as township governments. Units whose figures the Census mostly estimated (imputed), or that
// carry only a few lines, are left out.
//
// Property tax a town collects for its school district, the county and the state education tax
// is taken out where the town reported it as its own (see levy.mjs).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { CENSUS_PAGE, YEARS, readUnits, aggregateUnit } from '../common/census-units.mjs';
import { aggregateNh as aggregate } from './levy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'nh');
const OUT = join(ROOT, 'data', 'real');
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';

const args = parseArgs();
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const gaz = (file, key, xcol) => new Map(readFileSync(join(RAW, file), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'NH').map((c) => [key(c[1]), [Number(c[xcol]), Number(c[xcol + 1])]]));
const countyXY = gaz('2024_Gaz_counties_national.txt', (id) => id, 8);
const cousubXY = gaz('2024_Gaz_cousubs_national.txt', (id) => id.slice(5), 9);

const units = readUnits(RAW, '33', '123');

// Census geography: counties by FIPS; cities and towns by county subdivision code (a city's
// place code is the same as its county subdivision code).
const geo = new Map(); // key -> info; key 'County|33009' or 'Cousub|40180'
const countyName = new Map();
for (const r of pop.filter((p) => p.sumlev === '050')) {
  const geoid = `33${r.county}`;
  countyName.set(geoid, r.name);
  geo.set(`County|${geoid}`, { key: `County|${geoid}`, kind: 'County', display: r.name, geoid, pop: Number(r[POP_YEAR]), xy: countyXY.get(geoid), county: r.name, file: slugify(r.name.replace(/ County$/, '')) });
}
for (const r of pop.filter((p) => p.sumlev === '061')) {
  const m = r.name.match(/^(.+) (city|town)$/);
  if (!m) continue;
  const kind = m[2] === 'city' ? 'City' : 'Town';
  const county = countyName.get(`33${r.county}`);
  geo.set(`Cousub|${r.cousub}`, { key: `Cousub|${r.cousub}`, kind, display: `${kind} of ${m[1]}`, geoid: `33${r.county}${r.cousub}`, pop: Number(r[POP_YEAR]), xy: cousubXY.get(r.cousub), county, file: slugify(county.replace(/ County$/, '')) });
}
const geoKey = (u) => (u.kind === 'county' ? `County|33${u.place.slice(2)}` : `Cousub|${u.place}`);

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);

function buildUnit(key, byYear, report) {
  const g = geo.get(key);
  const any = Object.values(byYear)[0];
  const label = any.name;
  const isCounty = any.kind === 'county';
  const filed = (y) => { const x = aggregateUnit(byYear[y].items); return !x.imputed && !x.incomplete; };
  const reported = Object.keys(byYear).filter(filed).sort();
  const year = reported.at(-1);
  if (!year) {
    const latest = aggregateUnit(Object.entries(byYear).sort().at(-1)[1].items);
    report[latest.imputed ? 'imputed' : 'incomplete'].push(g?.display || label);
    return null;
  }
  if (!g || !g.xy || !g.file) { report.skipped.push(`${label}: no Census match`); return null; }
  const u = byYear[year];
  const a = aggregate(u.items, isCounty);
  if (a.unmapped.length) report.unmapped.push(`${g.display} ${year}: ${a.unmapped.join(' ')}`);
  if (Math.abs(sum(a.revenue) - a.lineTotals.revenue) > 2 || Math.abs(sum(a.spending) - a.lineTotals.spending) > 2) report.mismatch.push(`${g.display} ${year}`);
  if (a.passThrough) report.passThrough.push(`${g.display} (${money(a.passThrough)})`);
  if (Object.keys(byYear).some((y) => y > year)) report.older.push(`${g.display} (FY ${year}; FY ${Object.keys(byYear).sort().at(-1)} ${aggregateUnit(byYear[Object.keys(byYear).sort().at(-1)].items).imputed ? 'estimated' : 'incomplete'})`);

  const history = reported.map((y) => {
    const h = aggregate(byYear[y].items, isCounty);
    return { year: Number(y), revenue: sum(h.revenue), spending: sum(h.spending), basis: 'actual' };
  });
  const src = CENSUS_PAGE(year);
  const ledger = a.lines.filter((l) => l.amount && l.group !== 'debt').map((l) => ({
    date: u.fyEnd, flow: l.group === 'revenue' ? 'in' : 'out', category: l.key, counterparty: 'Annual Survey of Local Government Finances',
    description: l.label, amount: l.amount, source: src,
  })).sort((x, y) => (x.flow === y.flow ? y.amount - x.amount : x.flow === 'in' ? -1 : 1));

  const schools = (a.spending.education || 0) > 0.1 * sum(a.spending);
  const asOf = new Date().toISOString().slice(0, 10);
  const fyEndText = new Date(`${u.fyEnd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const kindText = isCounty ? 'county' : g.kind.toLowerCase();
  return {
    file: g.file,
    town: {
      id: slugify(`${g.display} nh`),
      name: g.display,
      state: 'NH',
      stateName: 'New Hampshire',
      county: g.county,
      type: g.kind,
      lat: Math.round(g.xy[0] * 1e5) / 1e5,
      lng: Math.round(g.xy[1] * 1e5) / 1e5,
      population: g.pop || 1,
      fiscalYear: Number(year),
      asOf,
      censusGeoid: g.geoid,
      revenue: a.revenue,
      spending: a.spending,
      debt: a.debt,
      reporting: {
        basis: 'Actual results (as reported to the Census Bureau\'s Annual Survey of Local Government Finances)',
        scope: isCounty
          ? 'All county funds, including the county nursing home, jail and sheriff'
          : `All ${kindText} funds, including utilities; ${schools ? `the ${kindText}'s school department is included` : 'schools are run by a separate school district'}`,
      },
      history,
      ledger,
      sources: [
        { label: `U.S. Census Bureau, ${year} Annual Survey of State and Local Government Finances, individual unit file`, url: src },
        { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
        { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
      ],
      notes: [
        `Actual results for the fiscal year ended ${fyEndText}, as the ${kindText} reported them to the Census Bureau's Annual Survey of State and Local Government Finances. Not a budget.`,
        ...(Number(year) < YEARS.at(-1) ? [`The Census surveys every government only in Census of Governments years (2022) and a sample in other years, so FY ${year} is the latest available.`] : []),
        isCounty
          ? `${g.display}'s cities and towns collect the county tax with their own property tax bills and pay it over. Public schools are run by school districts and city school departments, so they are not included.`
          : schools
            ? `The ${kindText} runs its own school department, so school spending is included. Residents also pay ${g.county} through the same tax bill.`
            : `Public schools are run by a separate school district. The ${kindText}'s tax bill also collects the school district's, ${g.county}'s and the state education tax; residents pay all of them, but only the ${kindText}'s share is counted here.`,
        ...(a.passThrough ? [`The ${kindText} reported ${money(a.passThrough + (a.revenue.propertyTax || 0))} of property tax, which includes the shares it collects for the school district, the county and the state education tax. Only the ${kindText}'s own share, ${money(a.revenue.propertyTax || 0)} (what its spending needed beyond its other revenue, which is how the state sets the ${kindText} tax rate), is counted, so the ${kindText} shows no surplus or deficit for the year.`] : []),
        'Covers every fund, including water, sewer, electric and other utilities. Debt service counts interest and principal repaid; borrowing and transfers between funds are left out.',
        ...(a.intergovernmental ? [`Payments to other governments (${money(a.intergovernmental)}) are left out, because the government receiving them reports that spending.`] : []),
        'Courts, legal services, public buildings, housing and community development count as overhead.',
        'Debt is long-term debt outstanding plus short-term debt at year end.',
        `Political money is not scored: New Hampshire ${isCounty ? 'county' : 'city and town'} candidates' contributions could not be loaded (${isCounty ? 'county candidates file with the Secretary of State, whose system was not reachable' : 'local candidates file with their city or town clerk, not with the state'}).`,
        'Transparency practices have not been checked yet, so they are not scored.',
      ],
    },
  };
}

const keys = new Map();
for (const y of YEARS) for (const u of units[y].values()) {
  const k = geoKey(u);
  (keys.get(k) || keys.set(k, {}).get(k))[y] = u;
}
const built = [];
const report = { skipped: [], imputed: [], incomplete: [], mismatch: [], unmapped: [], older: [], passThrough: [] };
for (const [k, byYear] of keys) {
  const b = buildUnit(k, byYear, report);
  if (b) built.push(b);
}
const files = [...new Set(built.map((b) => b.file))].sort();
const pick = args.all ? files : files.filter((f) => f.startsWith(slugify(String(args.county || '-'))));
if (!pick.length) { console.error(`Usage: node scripts/nh/build-county.mjs --county <county> | --all\nFiles: ${files.join(', ')}`); process.exit(1); }
const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
for (const f of pick) {
  const towns = built.filter((b) => b.file === f).map((b) => b.town).sort((x, y) => ((x.type === 'County') === (y.type === 'County') ? x.name.localeCompare(y.name) : x.type === 'County' ? -1 : 1));
  const file = `nh-${f}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
}
index.files.sort();
writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
if (args.all) writeFileSync(join(RAW, 'build-report.json'), `${JSON.stringify(report, null, 1)}\n`);
const types = built.reduce((m, b) => ({ ...m, [b.town.type]: (m[b.town.type] || 0) + 1 }), {});
console.log(JSON.stringify({ files: pick.length, governments: built.length, types, ...report, passThrough: report.passThrough.length }, null, 1));
