#!/usr/bin/env node
// Builds real Town Ledger records for North Carolina's 100 counties and its cities, towns and
// villages. Each county's file holds the county and the municipalities whose people mostly live
// in it.
//
//   node scripts/nc/download.mjs
//   node scripts/nc/fetch-ncsbe.mjs                      # campaign finance (optional)
//   node scripts/nc/build-county.mjs --county Wake        (or --all)
//
// Figures are each government's Annual Financial Information Report (AFIR), which North
// Carolina counties and municipalities file with the Local Government Commission on the Census
// Bureau's template, as published in the Census individual unit files. Units whose figures the
// Census mostly estimated (imputed) are not filings and are left out.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { aggregateNc } from './census-map.mjs';
import { CENSUS_PAGE, YEARS, readUnits } from '../common/census-units.mjs';
import { zipCounties } from '../va/elect-map.mjs';
import { localityFor, summarizeNcReceipts, norm, NCSBE_PAGE, OFFICE_LABEL } from './ncsbe-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'nc');
const OUT = join(ROOT, 'data', 'real');
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';

const args = parseArgs();
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const gaz = (file, xcol) => new Map(readFileSync(join(RAW, file), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'NC').map((c) => [c[1], [Number(c[xcol]), Number(c[xcol + 1])]]));
const countyXY = gaz('2024_Gaz_counties_national.txt', 8);
const placeXY = gaz('2024_Gaz_place_national.txt', 10);

const units = readUnits(RAW, '37');

// Census geography: counties by FIPS, municipalities by place code (in the county holding
// most of their people).
const geo = new Map(); // key -> info; key 'County|037183' or 'Place|55000'
const countyName = new Map();
for (const r of pop.filter((p) => p.sumlev === '050')) {
  const geoid = `37${r.county}`;
  countyName.set(geoid, r.name);
  geo.set(`County|${geoid}`, { key: `County|${geoid}`, kind: 'County', display: r.name, base: r.name.replace(/ County$/, ''), geoid, pop: Number(r[POP_YEAR]), xy: countyXY.get(geoid), county: r.name, file: slugify(r.name) });
}
const placeCounty = new Map();
for (const r of pop.filter((p) => p.sumlev === '157')) {
  const cur = placeCounty.get(r.place);
  if (!cur || Number(r[POP_YEAR]) > cur.pop) placeCounty.set(r.place, { county: `37${r.county}`, pop: Number(r[POP_YEAR]) });
}
const KIND = { city: 'City', town: 'Town', village: 'Village' };
for (const r of pop.filter((p) => p.sumlev === '162')) {
  const m = r.name.match(/^(.+) (city|town|village)$/);
  if (!m) continue;
  const kind = KIND[m[2]];
  const c = placeCounty.get(r.place)?.county;
  geo.set(`Place|${r.place}`, { key: `Place|${r.place}`, kind, display: `${kind} of ${m[1]}`, base: m[1], geoid: `37${r.place}`, pop: Number(r[POP_YEAR]), xy: placeXY.get(`37${r.place}`), county: countyName.get(c), countyGeoid: c, file: c && slugify(countyName.get(c)) });
}
const geoKey = (u) => (u.kind === 'county' ? `County|37${u.place.slice(2)}` : `Place|${u.place}`);

// Political money: local candidates' committees placed in their county or municipality.
const LEDGER_POLITICAL_MAX = 100;
const thisYear = new Date().getFullYear();
const NCSBE_SINCE = `${thisYear - 3}-01-01`;
const NCSBE = join(RAW, 'ncsbe');
const haveNcsbe = existsSync(NCSBE) && existsSync(join(RAW, 'zcta-county.txt'));
const receiptsBy = new Map();
const unplaced = new Set();
if (haveNcsbe) {
  const zrows = readFileSync(join(RAW, 'zcta-county.txt'), 'utf8').split('\n').slice(1).map((l) => l.split('|'))
    .filter((c) => (c[9] || '').startsWith('37') && c[1]).map((c) => ({ zip: c[1], county: c[9], area: c[16] }));
  const munis = new Map();
  for (const g of geo.values()) if (g.kind !== 'County') (munis.get(norm(g.base)) || munis.set(norm(g.base), []).get(norm(g.base))).push({ key: g.key, county: g.countyGeoid });
  const ctx = {
    zipCounty: zipCounties(zrows),
    countyKey: new Map([...geo.values()].filter((g) => g.kind === 'County').map((g) => [g.geoid, g.key])),
    munis,
    placeCounty: new Map(pop.filter((p) => p.sumlev === '157').map((p) => [norm(p.name.replace(/ (town|city|village|CDP)( \(pt\.\))?$/, '')), `37${p.county}`])),
  };
  for (const f of readdirSync(NCSBE).filter((x) => /^\d{4}-\d\d\.json$/.test(x)).sort()) {
    for (const r of JSON.parse(readFileSync(join(NCSBE, f), 'utf8'))) {
      const loc = localityFor(r, ctx);
      if (!loc) { unplaced.add(r.SboeID); continue; }
      r.recipient = `${r.CommName.replace(/\s+/g, ' ')} (${OFFICE_LABEL[r.CandOfficeCode]})`;
      (receiptsBy.get(loc) || receiptsBy.set(loc, []).get(loc)).push(r);
    }
  }
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);

function buildUnit(key, byYear, report) {
  const g = geo.get(key);
  const any = Object.values(byYear)[0];
  const label = any.name;
  const filed = (y) => { const x = aggregateNc(byYear[y].items); return !x.imputed && !x.incomplete; };
  const reported = Object.keys(byYear).filter(filed).sort();
  const year = reported.at(-1);
  if (!year) {
    const latest = aggregateNc(Object.entries(byYear).sort().at(-1)[1].items);
    report[latest.imputed ? 'imputed' : 'incomplete'].push(g?.display || label);
    return null;
  }
  if (!g || !g.xy || !g.file) { report.skipped.push(`${label}: no Census match`); return null; }
  const u = byYear[year];
  const a = aggregateNc(u.items);
  if (a.unmapped.length) report.unmapped.push(`${g.display} ${year}: ${a.unmapped.join(' ')}`);
  if (Math.abs(sum(a.revenue) - a.lineTotals.revenue) > 2 || Math.abs(sum(a.spending) - a.lineTotals.spending) > 2) report.mismatch.push(`${g.display} ${year}`);
  if (Object.keys(byYear).some((y) => y > year)) report.older.push(`${g.display} (FY ${year}; FY ${Object.keys(byYear).sort().at(-1)} ${aggregateNc(byYear[Object.keys(byYear).sort().at(-1)].items).imputed ? 'estimated' : 'incomplete'})`);

  const history = reported.map((y) => {
    const h = aggregateNc(byYear[y].items);
    return { year: Number(y), revenue: sum(h.revenue), spending: sum(h.spending), basis: 'actual' };
  });
  const src = CENSUS_PAGE(year);
  const ledger = a.lines.filter((l) => l.amount && l.group !== 'debt').map((l) => ({
    date: u.fyEnd, flow: l.group === 'revenue' ? 'in' : 'out', category: l.key, counterparty: 'Annual Financial Information Report',
    description: l.label, amount: l.amount, source: src,
  })).sort((x, y) => (x.flow === y.flow ? y.amount - x.amount : x.flow === 'in' ? -1 : 1));

  const isCounty = g.kind === 'County';
  // Every local committee files with the State Board and every organizational contribution
  // statewide is fetched, so a government with none placed is scored as receiving none.
  const pol = haveNcsbe ? summarizeNcReceipts(receiptsBy.get(key) || [], NCSBE_SINCE) : null;
  const asOf = new Date().toISOString().slice(0, 10);
  const fyEndText = new Date(`${u.fyEnd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
  const officeText = isCounty ? 'candidates for county commissioner, sheriff, register of deeds and the county school board' : `candidates for ${g.kind.toLowerCase()} council (or board of commissioners or aldermen) and mayor`;
  return {
    file: g.file,
    town: {
      id: slugify(`${g.display} nc`),
      name: g.display,
      state: 'NC',
      stateName: 'North Carolina',
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
        basis: 'Actual results (Annual Financial Information Report, as published by the Census Bureau)',
        scope: isCounty ? 'All county funds, including the public school system and utilities' : 'All municipal funds, including utilities; schools are run by the county',
        ...(pol ? { politicalPeriod: `Since ${NCSBE_SINCE.slice(0, 4)}; retrieved ${asOf}`, politicalScope: isCounty ? 'County candidates: commissioners, sheriff, register of deeds and school board' : 'Municipal candidates: council and mayor' } : {}),
      },
      history,
      ledger: [...ledger, ...(pol ? pol.ledger.slice(0, LEDGER_POLITICAL_MAX) : [])],
      sources: [
        { label: `U.S. Census Bureau, ${year} Annual Survey of State and Local Government Finances, individual unit file (the ${isCounty ? 'county' : 'municipality'}'s Annual Financial Information Report)`, url: src },
        { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
        { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
        ...(pol ? [{ label: `NC State Board of Elections, receipts of ${g.display}'s local candidates since ${NCSBE_SINCE.slice(0, 4)}`, url: NCSBE_PAGE }] : []),
      ],
      notes: [
        `Actual results for the fiscal year ended ${fyEndText}, from the Annual Financial Information Report the ${isCounty ? 'county' : 'municipality'} files with the Local Government Commission, as published by the Census Bureau. Not a budget.`,
        ...(Number(year) < YEARS.at(-1) ? [`The Census surveys every government only in Census of Governments years (2022) and a sample in other years, so FY ${year} is the latest available.`] : []),
        isCounty
          ? 'Includes the public school system, which the county funds and the Census counts as part of the county, shown as schools and left out of the services and overhead shares, as in Connecticut, Massachusetts and Virginia.'
          : `${g.county} runs the schools and most social services, and residents pay both the ${g.kind.toLowerCase()} and the county.`,
        'Covers every fund, including water, sewer, electric and other utilities and ABC liquor stores. Debt service counts interest and principal repaid; borrowing and transfers between funds are left out.',
        ...(a.intergovernmental ? [`Payments to other governments (${money(a.intergovernmental)}) are left out, because the government receiving them reports that spending.`] : []),
        'Courts, legal services, public buildings, housing and community development count as overhead.',
        'Debt is long-term debt outstanding plus short-term debt at year end.',
        ...(pol
          ? [`Political money counts contributions from PACs, unions and other organizations to ${officeText}, filed with the State Board of Elections since ${NCSBE_SINCE.slice(0, 4)}${pol.counted ? '' : ' (none were found)'}. North Carolina bans corporate contributions. Individuals and party and candidate committees are not counted. Committees are placed by office and filing address, so a few may be assigned to a neighbouring ${isCounty ? 'county' : 'municipality'}.`]
          : ['Political money is not scored: State Board of Elections receipts were not loaded.']),
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
if (!pick.length) { console.error(`Usage: node scripts/nc/build-county.mjs --county <county> | --all\nFiles: ${files.join(', ')}`); process.exit(1); }
const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
for (const f of pick) {
  const towns = built.filter((b) => b.file === f).map((b) => b.town).sort((x, y) => ((x.type === 'County') === (y.type === 'County') ? x.name.localeCompare(y.name) : x.type === 'County' ? -1 : 1));
  const file = `nc-${f}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
}
index.files.sort();
writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
if (args.all) writeFileSync(join(RAW, 'build-report.json'), `${JSON.stringify(report, null, 1)}\n`);
const types = built.reduce((m, b) => ({ ...m, [b.town.type]: (m[b.town.type] || 0) + 1 }), {});
const scored = built.filter((b) => b.town.influence).length;
console.log(JSON.stringify({ files: pick.length, governments: built.length, types, politicalScored: scored, unplacedCommittees: unplaced.size, ...report }, null, 1));
