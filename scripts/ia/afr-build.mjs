#!/usr/bin/env node
// Builds real Town Ledger records for Iowa's counties and cities from the Department of
// Management's Annual Financial Report data (see afr-map.mjs). Each county's file holds the county
// and the cities whose people mostly live in it. Iowa's townships are not general-purpose
// governments (their trustees mostly run cemeteries and contract for fire protection), so none
// are listed.
//
//   node scripts/ia/afr-download.mjs
//   node scripts/ia/afr-build.mjs --county Polk      (or --all)
//
// Every Iowa city and county files an Annual Financial Report with the Department of Management,
// so these are reported figures for every government. Fiscal years end June 30. Debt outstanding
// is not in the published data, so no debt figure is given.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { aggregateCity, aggregateCounty } from './afr-map.mjs';
import { AFR_YEARS, DATASETS, DATASET_PAGE } from './afr-download.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'ia');
const OUT = join(ROOT, 'data', 'real');
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';

const args = parseArgs();
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);
// The Department of Management files Jewell Junction as Jewell.
const ALIAS = { jewell: 'jewelljunction' };
const norm = (s) => {
  const n = String(s).toLowerCase().replace(/\bst\.? /g, 'saint ').replace(/\bmt\.? /g, 'mount ').replace(/[^a-z0-9]/g, '');
  return ALIAS[n] || n;
};

// Census geography for population and map location: counties by FIPS, cities by place, in the
// county holding most of their people.
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const gaz = (file, key, xcol) => new Map(readFileSync(join(RAW, file), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'IA').map((c) => [key(c[1]), [Number(c[xcol]), Number(c[xcol + 1])]]));
const countyXY = gaz('2024_Gaz_counties_national.txt', (id) => id, 8);
const placeXY = gaz('2024_Gaz_place_national.txt', (id) => id.slice(2), 10);
const fileOf = (county) => slugify(county.replace(/ County$/, ''));

const countyName = new Map();
const geo = new Map(); // 'County|19153', 'City|desmoines' (or 'City|name|county' for a repeated name)
for (const r of pop.filter((p) => p.sumlev === '050')) {
  countyName.set(r.county, r.name);
  geo.set(`County|19${r.county}`, { kind: 'County', display: r.name, geoid: `19${r.county}`, pop: Number(r[POP_YEAR]), xy: countyXY.get(`19${r.county}`), county: r.name });
}
const placeCounty = new Map();
for (const r of pop.filter((p) => p.sumlev === '157')) {
  const cur = placeCounty.get(r.place);
  if (!cur || Number(r[POP_YEAR]) > cur.pop) placeCounty.set(r.place, { county: r.county, pop: Number(r[POP_YEAR]) });
}
const cities = pop.filter((p) => p.sumlev === '162' && / city$/.test(p.name));
const names = cities.map((r) => norm(r.name.replace(/ city$/, '')));
const DUP = new Set(names.filter((n, i) => names.indexOf(n) !== i));
const cityKey = (name, county) => (DUP.has(norm(name)) ? `City|${norm(name)}|${county}` : `City|${norm(name)}`);
for (const r of cities) {
  const base = r.name.replace(/ city$/, '');
  const fips = placeCounty.get(r.place)?.county;
  geo.set(cityKey(base, fips), { kind: 'City', display: `City of ${base}`, geoid: `19${r.place}`, pop: Number(r[POP_YEAR]), xy: placeXY.get(r.place), county: countyName.get(fips) });
}

// The Department of Management's city code starts with the county number (1-99, alphabetical),
// which is how a repeated city name is told apart.
const countyOfCode = (code) => String(Number(code.slice(0, 2)) * 2 - 1).padStart(3, '0');
const afr = JSON.parse(readFileSync(join(RAW, 'afr', 'afr.json'), 'utf8'));
const units = new Map();
const unmatched = [];
for (const year of AFR_YEARS) {
  for (const [code, c] of Object.entries(afr.city[year] || {})) {
    const key = cityKey(c.name, countyOfCode(code));
    if (!geo.get(key)?.xy || !geo.get(key)?.county) { unmatched.push(`${c.name} (city)`); continue; }
    const u = units.get(key) || units.set(key, { key, kind: 'city', byYear: {} }).get(key);
    u.byYear[year] = c;
  }
  for (const [fips, c] of Object.entries(afr.county[year] || {})) {
    const key = `County|${fips}`;
    if (!geo.has(key)) { unmatched.push(`${c.rev?.county_name || fips} (county)`); continue; }
    const u = units.get(key) || units.set(key, { key, kind: 'county', byYear: {} }).get(key);
    u.byYear[year] = c;
  }
}

const aggregate = (u, y) => (u.kind === 'county' ? aggregateCounty(u.byYear[y]) : aggregateCity(u.byYear[y]));
const report = { skipped: [...new Set(unmatched)], empty: [], inconsistent: [], older: [], noResidents: [], unclassified: [], refinanced: [] };
function buildUnit(u) {
  const g = geo.get(u.key);
  if (!g.pop) { report.noResidents.push(`${g.display} (${g.county})`); return null; }
  const status = (y) => { const a = aggregate(u, y); return a.empty ? 'empty' : a.inconsistent ? 'inconsistent' : 'ok'; };
  const years = Object.keys(u.byYear).sort();
  const reported = years.filter((y) => status(y) === 'ok');
  const year = reported.at(-1);
  if (!year) { report[status(years.at(-1))].push(g.display); return null; }
  const latest = AFR_YEARS.at(-1);
  if (Number(year) < latest) report.older.push(`${g.display} (FY ${year}; FY ${latest} ${u.byYear[latest] ? (status(String(latest)) === 'empty' ? 'not filled in' : 'out of balance') : 'not filed'})`);
  const a = aggregate(u, year);
  if (a.spending.otherSpending) report.unclassified.push(g.display);
  if (a.refinanced) report.refinanced.push(`${g.display} (${money(a.refinanced)})`);
  const isCounty = g.kind === 'County';
  const kindText = isCounty ? 'county' : 'city';
  const pages = isCounty ? [DATASETS.countyRev, DATASETS.countyExp] : [DATASETS.cityRev, DATASETS.cityExp];
  const date = `${year}-06-30`;
  const ledger = a.lines.map((l) => ({
    date, flow: l.group === 'revenue' ? 'in' : 'out', category: l.key, counterparty: 'Annual Financial Report (Iowa Department of Management)',
    description: l.label, amount: l.amount, source: DATASET_PAGE(l.group === 'revenue' ? pages[0] : pages[1]),
  })).sort((p, q) => (p.flow === q.flow ? q.amount - p.amount : p.flow === 'in' ? -1 : 1));
  const history = reported.map((y) => { const h = aggregate(u, y); return { year: Number(y), revenue: sum(h.revenue), spending: sum(h.spending), basis: 'actual' }; });
  const left = a.leftOut;
  return {
    file: fileOf(g.county),
    town: {
      id: slugify(`${g.display} ia`),
      name: g.display,
      state: 'IA',
      stateName: 'Iowa',
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
      reporting: {
        basis: 'Actual results for the fiscal year ended June 30, from the Annual Financial Report filed with the Iowa Department of Management',
        scope: isCounty
          ? 'All county funds by service area, including the sheriff, jail, secondary roads, mental health, conservation and county services'
          : 'All city funds by program, including water, sewer, electric and other enterprise funds; schools are run by separate school districts',
      },
      history,
      ledger,
      sources: [
        { label: `Iowa Department of Management, FY ${year} ${kindText} actual revenues (Annual Financial Reports, data.iowa.gov dataset ${pages[0]})`, url: DATASET_PAGE(pages[0]) },
        { label: `Iowa Department of Management, FY ${year} ${kindText} actual expenditures (Annual Financial Reports, data.iowa.gov dataset ${pages[1]})`, url: DATASET_PAGE(pages[1]) },
        { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
        { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
      ],
      notes: [
        `Actual results for the fiscal year ended June 30, ${year}, as the ${kindText} reported them in its Annual Financial Report to the Iowa Department of Management. Not a budget.`,
        ...(Number(year) < latest ? [`The FY ${latest} report was ${u.byYear[latest] ? (status(String(latest)) === 'empty' ? 'not filled in' : 'out of balance (revenue and spending more than four times apart)') : 'not in the published data'}, so FY ${year} is used.`] : []),
        isCounty
          ? 'Public schools are run by separate school districts with their own taxes, so they are not included.'
          : `Public schools are run by separate school districts with their own taxes, so they are not included. Residents also pay ${g.county}.`,
        isCounty
          ? 'Spending is reported by service area. Capital projects have no service area, so they are spread over the county\'s other spending in proportion.'
          : 'Spending is reported by program for every fund, enterprise funds included. Capital projects have no program, so they are spread over the city\'s other spending in proportion; enterprise capital outlay counts as utilities.',
        ...(left.internalService ? [`Internal service funds (self-insurance, central garages and the like; ${money(left.internalService)} of their revenue and spending) are left out, since the departments they serve report that spending.`] : []),
        `Borrowing, transfers between funds${isCounty ? ', refunded debt' : ', internal TIF loans'} and sales of capital assets are left out.${a.refinanced ? ` Debt service also leaves out ${money(a.refinanced)} paid with new borrowing the ${kindText} did not spend on capital that year, most likely refinancing or a rolled-over note.` : ''}`,
        ...(a.spending.otherSpending ? [`${money(a.spending.otherSpending)} of nonprogram spending is more than 15% of the total, so it is shown as not broken down and the county is not scored on services or overhead.`] : []),
        isCounty
          ? 'Administration and government services to residents (recorder, treasurer, elections) count as overhead.'
          : 'General government and community and economic development (including TIF rebates to developers) count as overhead.',
        'Debt outstanding is not in the Department of Management\'s published data, so no debt figure is given and debt is not scored.',
        `Political money is not scored: contributions to Iowa ${kindText} candidates were not loaded.`,
        'Transparency practices have not been checked yet, so they are not scored.',
      ],
    },
  };
}

const built = [...units.values()].map(buildUnit).filter(Boolean);
const nameCount = new Map();
for (const b of built) nameCount.set(b.town.name, (nameCount.get(b.town.name) || 0) + 1);
for (const b of built) if (nameCount.get(b.town.name) > 1) b.town.id = slugify(`${b.town.name} ${b.town.county} ia`);

const files = [...new Set(built.map((b) => b.file))].sort();
const pick = args.all ? files : files.filter((f) => f.startsWith(slugify(String(args.county || '-'))));
if (!pick.length) { console.error(`Usage: node scripts/ia/afr-build.mjs --county <county> | --all\nFiles: ${files.join(', ')}`); process.exit(1); }
const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
for (const f of pick) {
  const towns = built.filter((b) => b.file === f).map((b) => b.town).sort((x, y) => ((x.type === 'County') === (y.type === 'County') ? x.name.localeCompare(y.name) : x.type === 'County' ? -1 : 1));
  const file = `ia-${f}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
}
index.files.sort();
writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
if (args.all) writeFileSync(join(RAW, 'afr-report.json'), `${JSON.stringify(report, null, 1)}\n`);
const types = built.reduce((m, b) => ({ ...m, [b.town.type]: (m[b.town.type] || 0) + 1 }), {});
console.log(JSON.stringify({ files: pick.length, governments: built.length, types, ...Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length])) }, null, 1));
