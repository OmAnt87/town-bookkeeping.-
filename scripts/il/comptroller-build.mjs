#!/usr/bin/env node
// Builds real TownView records for Illinois's counties, cities, villages, towns and townships
// from each government's Annual Financial Report in the Illinois Comptroller's local government
// database (see comptroller-map.mjs), with political money from the State Board of Elections
// (see politics.mjs). Each county's file holds the county and the governments whose people mostly
// live in it.
//
//   node scripts/il/comptroller-download.mjs
//   node scripts/il/fetch-isbe.mjs                         # campaign finance (optional)
//   node scripts/il/comptroller-build.mjs --county Cook      (or --all)
//
// Every Illinois county, municipality and township files an Annual Financial Report with the
// Comptroller, so these are reported figures for nearly every government.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { aggregateComptroller, debtOutstanding } from './comptroller-map.mjs';
import { COMPTROLLER_PAGE, COMPTROLLER_YEARS } from './comptroller-download.mjs';
import { politics as loadPolitics } from './politics.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'il');
const OUT = join(ROOT, 'data', 'real');
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';
const LEDGER_POLITICAL_MAX = 100;

const args = parseArgs();
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);
const norm = (s) => String(s).toLowerCase().replace(/\(balance\)/, '').replace(/^st\.? /, 'saint ').replace(/^ste\.? /, 'sainte ').replace(/^mt\.? /, 'mount ').replace(/^mc /, 'mc').replace(/[^a-z0-9]/g, '');
// parseCSV lowercases column names; the Comptroller tables keep theirs (Code, Category, GN ...).
function readCsv(year, table) {
  const text = readFileSync(join(RAW, 'comptroller', String(year), `${table}.csv`), 'latin1');
  const names = new Map(text.slice(0, text.indexOf('\n')).split(',').map((h) => h.replace(/"/g, '').trim()).map((h) => [h.toLowerCase(), h]));
  return parseCSV(text).map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [names.get(k) || k, v])));
}

// Census geography for population and map location (names as in the Census-based builder).
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const gaz = (file, key, xcol) => new Map(readFileSync(join(RAW, file), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'IL').map((c) => [key(c[1]), [Number(c[xcol]), Number(c[xcol + 1])]]));
const countyXY = gaz('2024_Gaz_counties_national.txt', (id) => id, 8);
const cousubXY = gaz('2024_Gaz_cousubs_national.txt', (id) => id, 9);
const placeXY = gaz('2024_Gaz_place_national.txt', (id) => id.slice(2), 10);
const displayName = (kind, base) => (/^Township \d+$/.test(base) ? base : kind === 'Township' ? `${base} Township` : `${kind} of ${base}`);

const countyName = new Map();
const countyFips = new Map(); // normalized county name -> FIPS county code
const geo = new Map(); // 'County|031', 'Township|031|cicero', 'Village|oakpark'
const fileOf = (county) => slugify(county.replace(/ County$/, ''));
for (const r of pop.filter((p) => p.sumlev === '050')) {
  countyName.set(r.county, r.name);
  countyFips.set(norm(r.name.replace(/ County$/, '')), r.county);
  geo.set(`County|${r.county}`, { key: `County|${r.county}`, kind: 'County', base: r.name.replace(/ County$/, ''), display: r.name, geoid: `17${r.county}`, pop: Number(r[POP_YEAR]), xy: countyXY.get(`17${r.county}`), county: r.name });
}
for (const r of pop.filter((p) => p.sumlev === '061')) {
  const m = r.name.match(/^(.+) township$/) || r.name.match(/^(Township \d+)$/i);
  if (!m) continue;
  const key = `Township|${r.county}|${norm(m[1])}`;
  geo.set(key, { key, kind: 'Township', base: m[1], display: displayName('Township', m[1]), geoid: `17${r.county}${r.cousub}`, pop: Number(r[POP_YEAR]), xy: cousubXY.get(`17${r.county}${r.cousub}`), county: countyName.get(r.county) });
}
const placeCounty = new Map();
for (const r of pop.filter((p) => p.sumlev === '157')) {
  const cur = placeCounty.get(r.place);
  if (!cur || Number(r[POP_YEAR]) > cur.pop) placeCounty.set(r.place, { county: r.county, pop: Number(r[POP_YEAR]) });
}
const KIND = { city: 'City', village: 'Village', town: 'Town' };
for (const r of pop.filter((p) => p.sumlev === '162')) {
  const m = r.name.replace(/ \(balance\)$/, '').match(/^(.+) (city|village|town)$/);
  if (!m) continue;
  const kind = KIND[m[2]];
  const base = m[1].replace(/^Village of /, '');
  const key = `${kind}|${norm(base)}`;
  geo.set(key, { key, kind, base, display: displayName(kind, base), geoid: `17${r.place}`, pop: Number(r[POP_YEAR]), xy: placeXY.get(r.place), county: countyName.get(placeCounty.get(r.place)?.county) });
}

// Comptroller unit -> geography key, by the county the unit files in.
function geoKeyOf(u) {
  const fips = countyFips.get(norm(u.County));
  const name = u.UnitName.replace(/\s*\(.*\)$/, '').replace(/^United City of /i, '').trim();
  if (u.C1 === 'CO') return `County|${fips}`;
  if (u.C1 === 'TW') return [name, name.replace(/^Town of (the )?City of /i, 'City of ')].map((n) => `Township|${fips}|${norm(n.replace(/ Township$/i, ''))}`).find((k) => geo.has(k)) || null;
  // Some Census names keep the kind word (Gibson City city, Elk Grove Village village).
  const kinds = [u.Description, ...['Village', 'City', 'Town'].filter((k) => k !== u.Description)];
  return kinds.flatMap((k) => [`${k}|${norm(name)}`, `${k}|${norm(`${name} ${u.Description}`)}`]).find((k) => geo.has(k)) || null;
}

// Units and their reports by year.
const units = new Map(); // Code -> { u, byYear: { year: { rev, exp, debt, fyEnd } } }
for (const year of COMPTROLLER_YEARS) {
  const byCode = (table) => { const m = new Map(); for (const r of readCsv(year, table)) (m.get(r.Code) || m.set(r.Code, []).get(r.Code)).push(r); return m; };
  const rev = byCode('Revenues');
  const exp = byCode('Expenditures');
  const debt = byCode('Indebtedness');
  const funds = byCode('FundsUsed');
  for (const u of readCsv(year, 'UnitData')) {
    if (!['CO', 'TW', 'MU'].includes(u.C1)) continue;
    const e = units.get(u.Code) || units.set(u.Code, { u, byYear: {} }).get(u.Code);
    e.u = u;
    const general = (funds.get(u.Code) || []).find((f) => f.FundType === 'GN') || (funds.get(u.Code) || [])[0];
    const [mm, dd] = String(general?.FYEnd || '12/31').split('/');
    e.byYear[year] = { rev: rev.get(u.Code) || [], exp: exp.get(u.Code) || [], debt: (debt.get(u.Code) || [])[0], fyEnd: `${year}-${mm.padStart(2, '0')}-${(dd || '31').padStart(2, '0')}` };
  }
}

const report = { skipped: [], empty: [], inconsistent: [], older: [] };
const matched = [];
for (const e of units.values()) {
  const key = geoKeyOf(e.u);
  const g = key && geo.get(key);
  if (!g || !g.xy || !g.county) { report.skipped.push(`${e.u.UnitName} ${e.u.Description} (${e.u.County})`); continue; }
  matched.push({ e, key, g });
}
const politics = loadPolitics(new Map(matched.map(({ key, g }) => [key, g])));

function buildUnit({ e, key, g }) {
  const agg = (y) => aggregateComptroller(e.byYear[y].rev, e.byYear[y].exp);
  const status = (y) => { const a = agg(y); return a.empty ? 'empty' : a.inconsistent ? 'inconsistent' : 'ok'; };
  const years = Object.keys(e.byYear).sort();
  const reported = years.filter((y) => status(y) === 'ok');
  const year = reported.at(-1);
  if (!year) { report[status(years.at(-1))].push(g.display); return null; }
  if (years.at(-1) > year) report.older.push(`${g.display} (FY ${year}; FY ${years.at(-1)} ${status(years.at(-1))})`);
  const a = agg(year);
  const y = e.byYear[year];
  const isCounty = g.kind === 'County';
  const kindText = isCounty ? 'county' : g.kind.toLowerCase();
  const pol = politics?.filers.has(key) ? politics.results.get(key) : null;
  const asOf = new Date().toISOString().slice(0, 10);
  const fyEndText = new Date(`${y.fyEnd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const ledger = a.lines.map((l) => ({
    date: y.fyEnd, flow: l.group === 'revenue' ? 'in' : 'out', category: l.key, counterparty: 'Annual Financial Report (Illinois Comptroller)',
    description: l.label, amount: l.amount, source: COMPTROLLER_PAGE,
  })).sort((p, q) => (p.flow === q.flow ? q.amount - p.amount : p.flow === 'in' ? -1 : 1));
  const history = reported.map((yr) => { const h = agg(yr); return { year: Number(yr), revenue: sum(h.revenue), spending: sum(h.spending), basis: 'actual' }; });
  return {
    file: fileOf(g.county),
    town: {
      id: slugify(`${g.display} il`),
      name: g.display,
      state: 'IL',
      stateName: 'Illinois',
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
      debt: debtOutstanding(y.debt),
      ...(pol ? { influence: pol.influence, topDonors: pol.topDonors } : {}),
      reporting: {
        basis: 'Actual results, from the Annual Financial Report filed with the Illinois Comptroller',
        scope: isCounty
          ? 'County governmental and enterprise funds, including the sheriff, jail, courts and county highways; pension trusts and money the county collector holds for other governments are left out'
          : `All ${kindText} governmental and enterprise funds, including utilities; pension trusts are left out and schools are run by separate school districts`,
        ...(pol ? { politicalPeriod: `Since ${politics.since.slice(0, 4)}; retrieved ${asOf}`, politicalScope: politics.scope(isCounty) } : {}),
      },
      history,
      ledger: [...ledger, ...(pol ? pol.ledger.slice(0, LEDGER_POLITICAL_MAX) : [])],
      sources: [
        { label: `Illinois Comptroller local government financial database, FY ${year} (Annual Financial Reports)`, url: COMPTROLLER_PAGE },
        ...(pol ? [{ label: politics.sourceLabel(g), url: politics.sourceUrl }] : []),
        { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
        { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
      ],
      notes: [
        `Actual results for the fiscal year ended ${fyEndText}, as the ${kindText} reported them in its Annual Financial Report to the Illinois Comptroller. Not a budget.`,
        ...(Number(year) < COMPTROLLER_YEARS.at(-1) ? [`The FY ${COMPTROLLER_YEARS.at(-1)} report was ${status(years.at(-1)) === 'empty' ? 'missing or not filled in' : 'out of balance (revenue and spending more than four times apart)'}${e.byYear[COMPTROLLER_YEARS.at(-1)] ? '' : ' or not yet filed'}, so FY ${year} is used.`] : []),
        isCounty
          ? 'Public schools are run by separate school districts with their own taxes, so they are not included. The county collector gathers property taxes for every taxing district and pays them over; that money is left out.'
          : `Public schools are run by separate school districts with their own taxes, so they are not included. Residents also pay ${g.county}${g.kind === 'Township' ? '' : ' and, in most counties, the township they live in'}; park, library and fire protection districts are separate governments too.`,
        ...(g.kind === 'Township' ? ['Illinois townships maintain township roads, assess property and provide general assistance; most also cover the cities and villages inside them.'] : []),
        'Covers the general, special revenue, capital projects, debt service and enterprise (utility) funds. Pension trusts and other fiduciary funds, internal service funds and component units are left out, as are transfers between funds and borrowing.',
        ...(a.leftOut.depreciation ? [`Depreciation (${money(a.leftOut.depreciation)}) is left out; capital outlay is counted when paid.`] : []),
        ...(a.capital ? [`Capital outlay outside utility funds (${money(a.capital)}) is reported without a function, so it is spread over the ${kindText}'s services in proportion to their spending.`] : []),
        ...(a.spending.otherSpending ? [`The ${kindText} reported ${money(a.spending.otherSpending)} as "other" spending without a function${g.display === 'City of Chicago' ? ' (mostly pension contributions)' : ''}, so its spending cannot be split between services and overhead; the ${kindText} is not scored on services or overhead.`] : []),
        'Courts, legal services, public buildings, housing and community development count as overhead.',
        'Debt is bonds, contracts and other long-term debt outstanding at year end (beginning balance plus new debt less debt retired), as reported.',
        politics ? (pol ? politics.note(g, isCounty, pol) : politics.noneNote(g, isCounty)) : 'Political money is not scored: State Board of Elections data was not loaded.',
        'Transparency practices have not been checked yet, so they are not scored.',
      ],
    },
  };
}

const built = matched.map(buildUnit).filter(Boolean);
// Same-named townships and municipalities in different counties get the county in their id.
const nameCount = new Map();
for (const b of built) nameCount.set(b.town.name, (nameCount.get(b.town.name) || 0) + 1);
for (const b of built) if (nameCount.get(b.town.name) > 1) b.town.id = slugify(`${b.town.name} ${b.town.county} il`);

const files = [...new Set(built.map((b) => b.file))].sort();
const pick = args.all ? files : files.filter((f) => f.startsWith(slugify(String(args.county || '-'))));
if (!pick.length) { console.error(`Usage: node scripts/il/comptroller-build.mjs --county <county> | --all\nFiles: ${files.join(', ')}`); process.exit(1); }
const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
const ORDER = { County: 0, City: 1, Village: 2, Town: 3, Township: 4 };
for (const f of pick) {
  const towns = built.filter((b) => b.file === f).map((b) => b.town).sort((x, y) => ORDER[x.type] - ORDER[y.type] || x.name.localeCompare(y.name));
  const file = `il-${f}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
}
index.files.sort();
writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
if (args.all) writeFileSync(join(RAW, 'comptroller-report.json'), `${JSON.stringify({ ...report, political: politics ? built.filter((b) => b.town.influence).length : null }, null, 1)}\n`);
const types = built.reduce((m, b) => ({ ...m, [b.town.type]: (m[b.town.type] || 0) + 1 }), {});
console.log(JSON.stringify({ files: pick.length, governments: built.length, types, ...Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length])), political: politics ? built.filter((b) => b.town.influence).length : 'not loaded' }, null, 1));
