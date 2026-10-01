#!/usr/bin/env node
// Builds real Town Ledger records for New Jersey municipalities, one county per file.
//
//   1. Download the DLGS User Friendly Budget database and the Census gazetteer:
//        node scripts/nj/build-county.mjs --download
//   2. Convert the workbook (needs: pip install openpyxl):
//        python3 scripts/nj/ufb-to-json.py data/raw/nj/ufb-database.xlsm data/raw/nj/ufb.json
//   3. Build a county (or --all):
//        node scripts/nj/build-county.mjs --county Monmouth
//
// Output: data/real/nj-<county>.json, listed in data/real/index.json.
// Nothing is estimated: a town with no usable budget filing is left out and
// reported, and sections without data (political money, transparency) are omitted.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, slugify } from '../lib.mjs';
import {
  groupFor, linesOf, totalOf, aggregateUFB, NJ_COUNTIES, countyFips, displayName, normName,
  UFB_REVENUE, UFB_APPROPRIATION,
} from './ufb-map.mjs';
import { summarizeElec, ELEC_SEARCH_URL } from './elec-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'nj');
const OUT = join(ROOT, 'data', 'real');
const UFB_XLSM_URL = 'https://www.nj.gov/dca/dlgs/programs/mc_budget_docs/UFB%20Database%20-%20FINAL.xlsm';
const UFB_PAGE = 'https://datahub.dca.nj.gov/datasets/user-friendly-budget-database';
const GAZ_URL = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_cousubs_national.zip';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';

const args = parseArgs();

// Political money window: the last four years, one full cycle of local elections.
const TODAY = new Date().toISOString().slice(0, 10);
const ELEC_SINCE = `${Number(TODAY.slice(0, 4)) - 4}${TODAY.slice(4)}`;
const ELEC_DIR = join(RAW, 'elec');
const elecLocs = existsSync(join(ELEC_DIR, 'locations.json')) ? JSON.parse(readFileSync(join(ELEC_DIR, 'locations.json'), 'utf8')) : [];
function elecFor(name, county) {
  const pool = elecLocs.filter((l) => l.county === county);
  const loc = pool.find((l) => l.name.toLowerCase() === name.toLowerCase())
    || pool.find((l) => normName(l.name) === normName(name) && l.name.split(' ').at(-1).toLowerCase() === name.split(' ').at(-1).toLowerCase())
    || pool.find((l) => normName(l.name) === normName(name));
  const file = loc && join(ELEC_DIR, `${loc.code}.json`);
  return file && existsSync(file) ? { loc, data: JSON.parse(readFileSync(file, 'utf8')) } : null;
}

if (args.download) {
  mkdirSync(RAW, { recursive: true });
  execFileSync('curl', ['-sSfL', '-A', 'Mozilla/5.0', '-o', join(RAW, 'ufb-database.xlsm'), UFB_XLSM_URL], { stdio: 'inherit' });
  execFileSync('curl', ['-sSfL', '-o', join(RAW, 'gaz-cousubs.zip'), GAZ_URL], { stdio: 'inherit' });
  execFileSync('unzip', ['-o', '-q', join(RAW, 'gaz-cousubs.zip'), '-d', RAW], { stdio: 'inherit' });
  console.log('Downloaded. Now run: python3 scripts/nj/ufb-to-json.py data/raw/nj/ufb-database.xlsm data/raw/nj/ufb.json');
  process.exit(0);
}

const counties = args.all ? NJ_COUNTIES : [NJ_COUNTIES.find((c) => c.toLowerCase() === String(args.county || '').toLowerCase())];
if (!counties[0]) {
  console.error(`Usage: node scripts/nj/build-county.mjs --county <name> | --all | --download\nCounties: ${NJ_COUNTIES.join(', ')}`);
  process.exit(1);
}

const ufb = JSON.parse(readFileSync(join(RAW, 'ufb.json'), 'utf8'));
const YEARS = Object.keys(ufb).map(Number).sort((a, b) => b - a); // newest first

// Census gazetteer: NJ county subdivisions with internal-point coordinates.
const gaz = readFileSync(join(RAW, '2024_Gaz_cousubs_national.txt'), 'utf8')
  .split('\n').slice(1).map((l) => l.split('\t').map((c) => c.trim()))
  .filter((c) => c[0] === 'NJ')
  .map((c) => ({ geoid: c[1], county: c[1].slice(2, 5), name: c[3], lat: Number(c[9]), lng: Number(c[10]) }));

function findPlace(ufbName, county) {
  const pool = gaz.filter((g) => g.county === countyFips(county));
  const lower = ufbName.toLowerCase();
  return pool.find((g) => g.name.toLowerCase() === lower)
    || pool.find((g) => g.name.toLowerCase().startsWith(`${lower} `))
    || pool.filter((g) => normName(g.name) === normName(ufbName)).sort((a, b) => a.name.length - b.name.length)[0]
    || null;
}

const key = (r) => `${r['|Municipality']}|${r['|County']}`;
const byYear = Object.fromEntries(YEARS.map((y) => [y, new Map(ufb[y].map((r) => [key(r), r]))]));

// Ids: name + "-nj", plus the county when the same name exists in several counties.
const nameCounts = {};
for (const r of ufb[YEARS[0]]) nameCounts[r['|Municipality'].toLowerCase()] = (nameCounts[r['|Municipality'].toLowerCase()] || 0) + 1;
const townId = (name, county) => slugify(nameCounts[name.toLowerCase()] > 1 ? `${name} ${county} county nj` : `${name} nj`);

const usable = (r) => r && !r['Status|No UFB Available'] && !r['Status|Sig. Data Missing']
  && (totalOf(r, groupFor(r, 'appropriations')) || 0) > 0;

function populationOf(r) {
  const k = Object.keys(r).find((x) => /^Population and Density\|Population \(/.test(x));
  return k ? Number(r[k]) || 0 : 0;
}

function buildTown(name, county, report) {
  const year = YEARS.find((y) => usable(byYear[y].get(`${name}|${county}`)));
  if (!year) { report.skipped.push(`${displayName(name)}: no usable budget filing in ${YEARS.at(-1)}-${YEARS[0]}`); return null; }
  const r = byYear[year].get(`${name}|${county}`);
  const place = findPlace(name, county);
  if (!place) { report.skipped.push(`${displayName(name)}: no Census location match`); return null; }

  const revG = groupFor(r, 'anticipated');
  const appG = groupFor(r, 'appropriations');
  const revLines = linesOf(r, revG);
  const appLines = linesOf(r, appG);
  const { revenue, spending, shared, excluded, unmapped } = aggregateUFB(revLines, appLines);
  report.unmapped.push(...unmapped);

  // Check our category totals against the filing's own totals.
  const revTotal = totalOf(r, revG);
  const appTotal = totalOf(r, appG);
  const ourRev = Object.values(revenue).reduce((a, b) => a + b, 0);
  const ourApp = Object.values(spending).reduce((a, b) => a + b, 0) + excluded;
  if (Math.abs(ourRev - revTotal) > 50 || Math.abs(ourApp - appTotal) > 50) {
    report.mismatch.push(`${displayName(name)} ${year}: revenue ${ourRev} vs ${revTotal}, appropriations ${ourApp} vs ${appTotal}`);
  }

  // History: prior-year actual revenue and final appropriations from every year's filing.
  const history = [];
  for (const y of [...YEARS].reverse()) {
    const h = byYear[y].get(`${name}|${county}`);
    if (!h || h['Status|No UFB Available']) continue;
    const real = totalOf(h, groupFor(h, 'realized'));
    const modG = groupFor(h, 'modified');
    const modLines = linesOf(h, modG);
    const mod = modLines.filter((l) => UFB_APPROPRIATION[l.label] !== 'exclude').reduce((a, l) => a + l.amount, 0);
    if (real > 0 && mod > 0) history.push({ year: y - 1, revenue: Math.round(real), spending: Math.round(mod), basis: 'actual' });
  }
  history.push({ year, revenue: Math.round(ourRev), spending: Math.round(ourApp - excluded), basis: 'budget' });
  const dedup = Object.values(Object.fromEntries(history.map((h) => [h.year, h]))).sort((a, b) => a.year - b.year);

  const netDebt = Number(r['Net Debt|Net Debt']);
  const elec = elecFor(name, county);
  if (!elec) report.noElec.push(displayName(name));
  const pol = elec ? summarizeElec(elec.data.rows, ELEC_SINCE) : null;
  const kind = (name.match(/(township|borough|city|town|village)$/i) || [])[1];
  const ledger = [
    ...revLines.filter((l) => l.amount).map((l) => ({
      date: `${year}-01-01`, flow: 'in', category: UFB_REVENUE[l.label] || 'otherRevenue',
      counterparty: 'Adopted budget: anticipated revenue', description: l.label, amount: Math.round(l.amount), source: UFB_PAGE,
    })),
    ...appLines.filter((l) => l.amount).map((l) => {
      const k = UFB_APPROPRIATION[l.label];
      return {
        date: `${year}-01-01`, flow: 'out', category: k === 'shared' || k === 'exclude' || !k ? 'administration' : k,
        counterparty: 'Adopted budget: appropriation', description: l.label + (k === 'shared' ? ' (spread across departments in totals)' : k === 'exclude' ? ' (reserve, not counted as spending)' : ''),
        amount: Math.round(l.amount), source: UFB_PAGE,
      };
    }),
  ];

  return {
    id: townId(name, county),
    name: displayName(name),
    state: 'NJ',
    stateName: 'New Jersey',
    county: `${county} County`,
    type: kind ? displayName(kind) : 'Municipality',
    lat: Math.round(place.lat * 1e5) / 1e5,
    lng: Math.round(place.lng * 1e5) / 1e5,
    population: populationOf(r),
    fiscalYear: year,
    asOf: new Date().toISOString().slice(0, 10),
    njMuniCode: String(r['|Muni-code']).padStart(4, '0'),
    censusGeoid: place.geoid,
    revenue,
    spending,
    ...(Number.isFinite(netDebt) ? { debt: Math.round(netDebt) } : {}),
    history: dedup,
    ...(pol ? { influence: pol.influence, topDonors: pol.topDonors } : {}),
    ledger: [...ledger, ...(pol ? pol.ledger : [])],
    sources: [
      { label: `NJ DLGS User Friendly Budget Database, ${year} filing (adopted budget, net debt, population)`, url: UFB_PAGE },
      { label: 'Workbook download (DLGS)', url: UFB_XLSM_URL.replace(/%20/g, ' ') },
      { label: 'U.S. Census Bureau 2024 Gazetteer, county subdivisions (map location)', url: GAZ_PAGE },
      ...(pol ? [{ label: `NJ ELEC campaign-finance filings: contributions to ${displayName(name)} municipal candidates since ${ELEC_SINCE} (ELEC location ${elec.loc.code})`, url: ELEC_SEARCH_URL }] : []),
    ],
    notes: [
      'Covers the municipal budget only. School-district and county taxes on the same property-tax bill belong to separate governments and are not included.',
      `Insurance, pension and social-security contributions and shared-service payments ($${Math.round(shared).toLocaleString('en-US')}) are spread across departments in proportion to their size.`,
      ...(excluded ? [`The reserve for uncollected taxes ($${Math.round(excluded).toLocaleString('en-US')}) is set aside, not spent, so it is not counted as spending.`] : []),
      ...(pol
        ? [`Political money counts PAC, business and union contributions to candidates for ${displayName(name)} municipal office and mayor reported to NJ ELEC since ${ELEC_SINCE}. Individual donors ($${pol.individuals.toLocaleString('en-US')} in the same period), candidates' own committees and party committees are not counted. Small campaigns may file without itemizing, so some contributions may not appear.`]
        : ['Political money has not been loaded for this town yet, so it is not scored.']),
      'Contractor pay-to-play disclosures and transparency practices have not been loaded yet; transparency is not scored.',
    ],
  };
}

const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
for (const county of counties) {
  const report = { skipped: [], unmapped: [], mismatch: [], noElec: [] };
  const names = [...new Set(YEARS.flatMap((y) => ufb[y].filter((r) => r['|County'] === county).map((r) => r['|Municipality'])))];
  const current = new Set(ufb[YEARS[0]].filter((r) => r['|County'] === county).map((r) => r['|Municipality']));
  const towns = names.filter((n) => current.has(n)).sort().map((n) => buildTown(n, county, report)).filter(Boolean);
  const file = `nj-${slugify(county)}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
  index.files.sort();
  writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  const years = towns.reduce((a, t) => ({ ...a, [t.fiscalYear]: (a[t.fiscalYear] || 0) + 1 }), {});
  console.log(JSON.stringify({ county, towns: towns.length, of: current.size, years, skipped: report.skipped, unmapped: [...new Set(report.unmapped)], mismatch: report.mismatch, noElec: report.noElec }));
}
