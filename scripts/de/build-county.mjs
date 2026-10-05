#!/usr/bin/env node
// Builds real Town Ledger records for Delaware's counties, cities and towns. Each county's file
// holds the county and the municipalities whose people mostly live in it.
//
//   node scripts/de/download.mjs
//   node scripts/de/fetch-cfrs.mjs                       # campaign finance (optional)
//   node scripts/de/build-county.mjs --county Sussex      (or --all)
//
// Figures are what each government reported to the Census Bureau's Annual Survey of State and
// Local Government Finances (every government in the 2022 Census of Governments, a sample in
// other years), from the Census individual unit files. Delaware has no statewide compilation of
// local finances. Units whose figures the Census mostly estimated (imputed), or that carry only
// a few lines, are left out.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { CENSUS_PAGE, YEARS, readUnits, aggregateUnit } from '../common/census-units.mjs';
import { parseCommitteeOffice, summarizeDeReceipts, norm, CFRS_PAGE } from './cfrs-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'de');
const OUT = join(ROOT, 'data', 'real');
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';

const args = parseArgs();
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const gaz = (file, xcol) => new Map(readFileSync(join(RAW, file), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'DE').map((c) => [c[1], [Number(c[xcol]), Number(c[xcol + 1])]]));
const countyXY = gaz('2024_Gaz_counties_national.txt', 8);
const placeXY = gaz('2024_Gaz_place_national.txt', 10);

const units = readUnits(RAW, '10');

// Census geography: counties by FIPS, municipalities by place code (in the county holding
// most of their people).
const geo = new Map(); // key -> info; key 'County|10005' or 'Place|21200'
const countyName = new Map();
for (const r of pop.filter((p) => p.sumlev === '050')) {
  const geoid = `10${r.county}`;
  countyName.set(geoid, r.name);
  geo.set(`County|${geoid}`, { key: `County|${geoid}`, kind: 'County', display: r.name, base: r.name.replace(/ County$/, ''), geoid, pop: Number(r[POP_YEAR]), xy: countyXY.get(geoid), county: r.name, file: slugify(r.name) });
}
const placeCounty = new Map();
for (const r of pop.filter((p) => p.sumlev === '157')) {
  const cur = placeCounty.get(r.place);
  if (!cur || Number(r[POP_YEAR]) > cur.pop) placeCounty.set(r.place, { county: `10${r.county}`, pop: Number(r[POP_YEAR]) });
}
const KIND = { city: 'City', town: 'Town', village: 'Village' };
for (const r of pop.filter((p) => p.sumlev === '162')) {
  const m = r.name.match(/^(.+) (city|town|village)$/);
  if (!m) continue;
  const kind = KIND[m[2]];
  const c = placeCounty.get(r.place)?.county;
  geo.set(`Place|${r.place}`, { key: `Place|${r.place}`, kind, display: `${kind} of ${m[1]}`, base: m[1], geoid: `10${r.place}`, pop: Number(r[POP_YEAR]), xy: placeXY.get(`10${r.place}`), county: countyName.get(c), countyGeoid: c, file: c && slugify(countyName.get(c)) });
}
const geoKey = (u) => (u.kind === 'county' ? `County|10${u.place.slice(2)}` : `Place|${u.place}`);

// Political money: county and municipal candidates' committees, placed by the county or
// municipality their office names.
const LEDGER_POLITICAL_MAX = 100;
const thisYear = new Date().getFullYear();
const CFRS_SINCE = `${thisYear - 3}-01-01`;
const CFRS_DIR = join(RAW, 'cfrs');
const haveCfrs = existsSync(join(CFRS_DIR, 'committees-CO.csv')) && existsSync(join(CFRS_DIR, 'committees-MO.csv'));
const receiptsBy = new Map();
const filers = new Set(); // governments with a local committee that reported contributions
const unplaced = new Set();
if (haveCfrs) {
  const byName = { county: new Map(), municipal: new Map() };
  for (const g of geo.values()) byName[g.kind === 'County' ? 'county' : 'municipal'].set(norm(g.base), g.key);
  const committees = new Map();
  for (const f of ['committees-CO.csv', 'committees-MO.csv']) {
    for (const c of parseCSV(readFileSync(join(CFRS_DIR, f), 'utf8'))) {
      const o = parseCommitteeOffice(c.office);
      if (!o) continue;
      const loc = byName[o.level].get(norm(o.place));
      if (!loc) { unplaced.add(o.place); continue; }
      committees.set(String(c.cf_id).trim(), { loc, label: `${String(c.committee_name).trim()} (${o.office})` });
    }
  }
  for (const f of readdirSync(CFRS_DIR).filter((x) => /^contributions-\d{4}\.csv$/.test(x)).sort()) {
    for (const r of parseCSV(readFileSync(join(CFRS_DIR, f), 'utf8'))) {
      const c = committees.get(String(r.cf_id).trim());
      if (!c) continue;
      filers.add(c.loc);
      r.recipient = c.label;
      (receiptsBy.get(c.loc) || receiptsBy.set(c.loc, []).get(c.loc)).push(r);
    }
  }
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);

function buildUnit(key, byYear, report) {
  const g = geo.get(key);
  const any = Object.values(byYear)[0];
  const label = any.name;
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
  const a = aggregateUnit(u.items);
  if (a.unmapped.length) report.unmapped.push(`${g.display} ${year}: ${a.unmapped.join(' ')}`);
  if (Math.abs(sum(a.revenue) - a.lineTotals.revenue) > 2 || Math.abs(sum(a.spending) - a.lineTotals.spending) > 2) report.mismatch.push(`${g.display} ${year}`);
  if (Object.keys(byYear).some((y) => y > year)) report.older.push(`${g.display} (FY ${year}; FY ${Object.keys(byYear).sort().at(-1)} ${aggregateUnit(byYear[Object.keys(byYear).sort().at(-1)].items).imputed ? 'estimated' : 'incomplete'})`);

  const history = reported.map((y) => {
    const h = aggregateUnit(byYear[y].items);
    return { year: Number(y), revenue: sum(h.revenue), spending: sum(h.spending), basis: 'actual' };
  });
  const src = CENSUS_PAGE(year);
  const ledger = a.lines.filter((l) => l.amount && l.group !== 'debt').map((l) => ({
    date: u.fyEnd, flow: l.group === 'revenue' ? 'in' : 'out', category: l.key, counterparty: 'Annual Financial Information Report',
    description: l.label, amount: l.amount, source: src,
  })).sort((x, y) => (x.flow === y.flow ? y.amount - x.amount : x.flow === 'in' ? -1 : 1));

  const isCounty = g.kind === 'County';
  // Scored where a local committee reported contributions to CFRS; one with contributions but
  // none from businesses, unions or PACs is scored as receiving none.
  const pol = haveCfrs && filers.has(key) ? summarizeDeReceipts(receiptsBy.get(key) || [], CFRS_SINCE) : null;
  const asOf = new Date().toISOString().slice(0, 10);
  const fyEndText = new Date(`${u.fyEnd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const officeText = isCounty ? 'candidates for county council (or levy court), county executive and the other elected county offices' : `candidates for ${g.kind.toLowerCase()} council or commission and mayor`;
  return {
    file: g.file,
    town: {
      id: slugify(`${g.display} de`),
      name: g.display,
      state: 'DE',
      stateName: 'Delaware',
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
      ...(pol ? { influence: pol.influence, topDonors: pol.topDonors } : {}),
      reporting: {
        basis: 'Actual results (as reported to the Census Bureau\'s Annual Survey of Local Government Finances)',
        scope: `All ${isCounty ? 'county' : 'municipal'} funds, including utilities; schools are run by separate school districts`,
        ...(pol ? { politicalPeriod: `Since ${CFRS_SINCE.slice(0, 4)}; retrieved ${asOf}`, politicalScope: isCounty ? 'County candidates: council or levy court, executive and other county offices' : 'Municipal candidates raising over $5,000: council or commission and mayor' } : {}),
      },
      history,
      ledger: [...ledger, ...(pol ? pol.ledger.slice(0, LEDGER_POLITICAL_MAX) : [])],
      sources: [
        { label: `U.S. Census Bureau, ${year} Annual Survey of State and Local Government Finances, individual unit file`, url: src },
        { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
        { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
        ...(pol ? [{ label: `DE Department of Elections, Campaign Finance Reporting System: contributions to ${g.display}'s local candidates since ${CFRS_SINCE.slice(0, 4)}`, url: CFRS_PAGE }] : []),
      ],
      notes: [
        `Actual results for the fiscal year ended ${fyEndText}, as the ${isCounty ? 'county' : 'municipality'} reported them to the Census Bureau's Annual Survey of State and Local Government Finances. Not a budget.`,
        ...(Number(year) < YEARS.at(-1) ? [`The Census surveys every government only in Census of Governments years (2022) and a sample in other years, so FY ${year} is the latest available.`] : []),
        isCounty
          ? 'Public schools are run by separate school districts with their own taxes, so they are not included.'
          : `Public schools are run by separate school districts, and ${g.county} provides many other services; residents pay the ${g.kind.toLowerCase()}, the county and the school district.`,
        'Covers every fund, including water, sewer, electric and other utilities. Debt service counts interest and principal repaid; borrowing and transfers between funds are left out.',
        ...(a.intergovernmental ? [`Payments to other governments (${money(a.intergovernmental)}) are left out, because the government receiving them reports that spending.`] : []),
        'Courts, legal services, public buildings, housing and community development count as overhead.',
        'Debt is long-term debt outstanding plus short-term debt at year end.',
        ...(pol
          ? [`Political money counts contributions from businesses, unions, PACs and non-profits to ${officeText}, reported to the Department of Elections since ${CFRS_SINCE.slice(0, 4)}${pol.counted ? '' : ' (none were found)'}, classified by the contributor type each committee reports. Delaware allows business contributions. Individuals, candidates' own money and party and candidate committees are not counted.${isCounty ? '' : ' Municipal candidates who raise and spend $5,000 or less file only a certification and are not included.'}`]
          : [haveCfrs ? `Political money is not scored: no ${officeText} reported contributions to the Department of Elections since ${CFRS_SINCE.slice(0, 4)} (municipal candidates who raise and spend $5,000 or less do not file reports).` : 'Political money is not scored: Department of Elections contributions were not loaded.']),
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
const report = { skipped: [], imputed: [], incomplete: [], mismatch: [], unmapped: [], older: [] };
for (const [k, byYear] of keys) {
  const b = buildUnit(k, byYear, report);
  if (b) built.push(b);
}
const files = [...new Set(built.map((b) => b.file))].sort();
const pick = args.all ? files : files.filter((f) => f.startsWith(slugify(String(args.county || '-'))));
if (!pick.length) { console.error(`Usage: node scripts/de/build-county.mjs --county <county> | --all\nFiles: ${files.join(', ')}`); process.exit(1); }
const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
for (const f of pick) {
  const towns = built.filter((b) => b.file === f).map((b) => b.town).sort((x, y) => ((x.type === 'County') === (y.type === 'County') ? x.name.localeCompare(y.name) : x.type === 'County' ? -1 : 1));
  const file = `de-${f}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
}
index.files.sort();
writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
if (args.all) writeFileSync(join(RAW, 'build-report.json'), `${JSON.stringify(report, null, 1)}\n`);
const types = built.reduce((m, b) => ({ ...m, [b.town.type]: (m[b.town.type] || 0) + 1 }), {});
const scored = built.filter((b) => b.town.influence).length;
console.log(JSON.stringify({ files: pick.length, governments: built.length, types, politicalScored: scored, unplacedOffices: [...unplaced], ...report }, null, 1));
