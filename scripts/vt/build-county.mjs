#!/usr/bin/env node
// Builds real Town Ledger records for Vermont's counties, cities, villages and towns. Each
// county's file holds the county and the cities, villages and towns in it.
//
//   node scripts/vt/download.mjs
//   node scripts/vt/build-county.mjs --county Chittenden      (or --all)
//
// Figures are what each government reported to the Census Bureau's Annual Survey of State and
// Local Government Finances (every government in the 2022 Census of Governments, a sample in
// other years), from the Census individual unit files. The Census counts Vermont's towns as
// township governments and its cities and incorporated villages as municipalities. Units whose
// figures the Census mostly estimated (imputed), that carry only a few lines, or whose revenue
// and spending are more than four times apart are left out.
//
// Education property tax a town or city collects for its school district is taken out where
// it was reported as the town's own (see edtax.mjs).

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { CENSUS_PAGE, YEARS, readUnits, aggregateUnit } from '../common/census-units.mjs';
import { aggregateVt, taxesFor, inconsistent } from './edtax.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'vt');
const OUT = join(ROOT, 'data', 'real');
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';
const TAX_PAGE = 'https://tax.vermont.gov/pvr-annual-report';

const args = parseArgs();
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const gaz = (file, key, xcol) => new Map(readFileSync(join(RAW, file), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'VT').map((c) => [key(c[1]), [Number(c[xcol]), Number(c[xcol + 1])]]));
const countyXY = gaz('2024_Gaz_counties_national.txt', (id) => id, 8);
const cousubXY = gaz('2024_Gaz_cousubs_national.txt', (id) => id.slice(5), 9);
const placeXY = gaz('2024_Gaz_place_national.txt', (id) => id.slice(2), 10);
const taxes = JSON.parse(readFileSync(join(RAW, 'taxrates.json'), 'utf8'));

const units = readUnits(RAW, '50', '123');

// Census geography: counties by FIPS; towns by county subdivision code; cities and villages by
// place code (in the county holding most of their people).
const geo = new Map(); // key -> info; key 'County|50007', 'Cousub|09025' or 'Place|10675'
const countyName = new Map();
for (const r of pop.filter((p) => p.sumlev === '050')) {
  const geoid = `50${r.county}`;
  countyName.set(geoid, r.name);
  geo.set(`County|${geoid}`, { key: `County|${geoid}`, kind: 'County', display: r.name, geoid, pop: Number(r[POP_YEAR]), xy: countyXY.get(geoid), county: r.name, file: slugify(r.name.replace(/ County$/, '')) });
}
for (const r of pop.filter((p) => p.sumlev === '061')) {
  const m = r.name.match(/^(.+) town$/);
  if (!m) continue;
  const county = countyName.get(`50${r.county}`);
  geo.set(`Cousub|${r.cousub}`, { key: `Cousub|${r.cousub}`, kind: 'Town', display: `Town of ${m[1]}`, geoid: `50${r.county}${r.cousub}`, pop: Number(r[POP_YEAR]), xy: cousubXY.get(r.cousub), county, file: slugify(county.replace(/ County$/, '')) });
}
const placeCounty = new Map();
for (const r of pop.filter((p) => p.sumlev === '157')) {
  const cur = placeCounty.get(r.place);
  if (!cur || Number(r[POP_YEAR]) > cur.pop) placeCounty.set(r.place, { county: `50${r.county}`, pop: Number(r[POP_YEAR]) });
}
for (const r of pop.filter((p) => p.sumlev === '162')) {
  const m = r.name.match(/^(.+) (city|village)$/);
  if (!m) continue;
  const kind = m[2] === 'city' ? 'City' : 'Village';
  const county = countyName.get(placeCounty.get(r.place)?.county);
  geo.set(`Place|${r.place}`, { key: `Place|${r.place}`, kind, display: `${kind} of ${m[1]}`, geoid: `50${r.place}`, pop: Number(r[POP_YEAR]), xy: placeXY.get(r.place), county, file: county && slugify(county.replace(/ County$/, '')) });
}
const geoKey = (u) => (u.kind === 'county' ? `County|50${u.place.slice(2)}` : u.kind === 'township' ? `Cousub|${u.place}` : `Place|${u.place}`);

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);

function buildUnit(key, byYear, report) {
  const g = geo.get(key);
  const any = Object.values(byYear)[0];
  const label = any.name;
  const isCounty = any.kind === 'county';
  // Counties and villages do not bill education tax.
  const billsEducation = !isCounty && !/ VILLAGE$/.test(label);
  const taxOf = (u) => (billsEducation ? taxesFor(taxes, u.name, u.fyEnd) : null);
  const agg = (y) => aggregateVt(byYear[y].items, taxOf(byYear[y]));
  const status = (y) => { const x = aggregateUnit(byYear[y].items); return x.imputed ? 'estimated' : x.incomplete ? 'incomplete' : inconsistent(agg(y)) ? 'inconsistent' : 'ok'; };
  const reported = Object.keys(byYear).filter((y) => status(y) === 'ok').sort();
  const year = reported.at(-1);
  const latest = Object.keys(byYear).sort().at(-1);
  if (!year) {
    report[{ estimated: 'imputed', incomplete: 'incomplete', inconsistent: 'inconsistent' }[status(latest)]].push(g?.display || label);
    return null;
  }
  if (!g || !g.xy || !g.file) { report.skipped.push(`${label}: no Census match`); return null; }
  const u = byYear[year];
  const tax = taxOf(u);
  if (billsEducation && !tax) report.noTax.push(g.display);
  const a = agg(year);
  if (a.unmapped.length) report.unmapped.push(`${g.display} ${year}: ${a.unmapped.join(' ')}`);
  if (Math.abs(sum(a.revenue) - a.lineTotals.revenue) > 2 || Math.abs(sum(a.spending) - a.lineTotals.spending) > 2) report.mismatch.push(`${g.display} ${year}`);
  if (a.passThrough) report.passThrough.push(`${g.display} (${money(a.passThrough)})`);
  if (latest > year) report.older.push(`${g.display} (FY ${year}; FY ${latest} ${status(latest)})`);

  const history = reported.map((y) => {
    const h = agg(y);
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
  const scopeNote = isCounty
    ? `Vermont counties are small: ${g.display} runs the courthouse and the sheriff's department, paid for by a county tax its towns collect. Towns, cities and villages provide most local services.`
    : g.kind === 'Village'
      ? `An incorporated village is a second layer of local government inside its town (here, ${g.county}): villagers pay both the village and the town. The village runs its own services, often water, sewer, electric, police or streets, and does not bill education tax.`
      : schools
        ? `The ${kindText} reports school spending of its own, so it is included. Vermont's schools are funded through the statewide Education Fund.`
        : `Public schools are run by a separate school district and funded through the statewide Education Fund. The ${kindText} bills the education property tax with its own and pays it over; residents pay both, but only the ${kindText}'s own share is counted here.`;
  return {
    file: g.file,
    town: {
      id: slugify(`${g.display} vt`),
      name: g.display,
      state: 'VT',
      stateName: 'Vermont',
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
          ? 'All county funds: courthouse, sheriff and county administration'
          : `All ${kindText} funds, including utilities; ${schools ? `the ${kindText}'s school spending is included` : 'schools are run by a separate school district'}`,
      },
      history,
      ledger,
      sources: [
        { label: `U.S. Census Bureau, ${year} Annual Survey of State and Local Government Finances, individual unit file`, url: src },
        ...(a.passThrough ? [{ label: `Vermont Department of Taxes, Property Valuation and Review annual report data: taxes and tax rates by town (tax year ${tax.taxYear})`, url: TAX_PAGE }] : []),
        { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
        { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
      ],
      notes: [
        `Actual results for the fiscal year ended ${fyEndText}, as the ${kindText} reported them to the Census Bureau's Annual Survey of State and Local Government Finances. Not a budget.`,
        ...(Number(year) < YEARS.at(-1) ? [`The Census surveys every government only in Census of Governments years (2022) and a sample in other years, so FY ${year} is the latest available.`] : []),
        scopeNote,
        ...(a.passThrough ? [`The ${kindText} reported ${money(a.passThrough + (a.revenue.propertyTax || 0))} of property tax, which includes ${money(a.passThrough)} of education property tax billed for the school district (the Vermont Department of Taxes lists ${money(tax.edu)} of education tax and ${money(tax.muni)} of municipal tax for tax year ${tax.taxYear}). Only the ${kindText}'s own municipal share, ${money(a.revenue.propertyTax || 0)}, is counted.`] : []),
        'Covers every fund, including water, sewer, electric and other utilities. Debt service counts interest and principal repaid; borrowing and transfers between funds are left out.',
        ...(a.intergovernmental ? [`Payments to other governments (${money(a.intergovernmental)}) are left out, because the government receiving them reports that spending.`] : []),
        'Courts, legal services, public buildings, housing and community development count as overhead.',
        'Debt is long-term debt outstanding plus short-term debt at year end.',
        'Political money is not scored: the Secretary of State\'s campaign finance system refused connections from the build environment, and most town candidates do not file there.',
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
const report = { skipped: [], imputed: [], incomplete: [], inconsistent: [], mismatch: [], unmapped: [], older: [], passThrough: [], noTax: [] };
for (const [k, byYear] of keys) {
  const b = buildUnit(k, byYear, report);
  if (b) built.push(b);
}
const files = [...new Set(built.map((b) => b.file))].sort();
const pick = args.all ? files : files.filter((f) => f.startsWith(slugify(String(args.county || '-'))));
if (!pick.length) { console.error(`Usage: node scripts/vt/build-county.mjs --county <county> | --all\nFiles: ${files.join(', ')}`); process.exit(1); }
const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
const ORDER = { County: 0, City: 1, Town: 2, Village: 3 };
for (const f of pick) {
  const towns = built.filter((b) => b.file === f).map((b) => b.town).sort((x, y) => ((x.type === 'County') === (y.type === 'County') ? x.name.localeCompare(y.name) : ORDER[x.type] - ORDER[y.type]));
  const file = `vt-${f}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
}
index.files.sort();
writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
if (args.all) writeFileSync(join(RAW, 'build-report.json'), `${JSON.stringify(report, null, 1)}\n`);
const types = built.reduce((m, b) => ({ ...m, [b.town.type]: (m[b.town.type] || 0) + 1 }), {});
console.log(JSON.stringify({ files: pick.length, governments: built.length, types, ...report, passThrough: report.passThrough.length }, null, 1));
