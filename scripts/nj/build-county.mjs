#!/usr/bin/env node
// Builds real TownView records for New Jersey municipalities, one county per file.
//
//   1. Download the DLGS User Friendly Budget database and the Census gazetteer:
//        node scripts/nj/build-county.mjs --download
//   2. Convert the workbook (needs: pip install openpyxl):
//        python3 scripts/nj/ufb-to-json.py data/raw/nj/ufb-database.xlsm data/raw/nj/ufb.json
//   3. Build a county (or --all):
//        node scripts/nj/build-county.mjs --county Monmouth
//
// Output: data/real/nj-<county>.json, listed in data/real/index.json.
// Then re-run scripts/nj/red-flags.mjs: a rebuild drops the red-flag records.
// Nothing is estimated: a town with no usable budget filing is left out and
// reported, and sections without data (political money, transparency) are omitted.
// Money in and out also include the school, county and fire-district taxes the
// town collects and pays over (applyPassThrough in ufb-map.mjs).

import { reportingFor } from '../../js/engine/reporting.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, slugify } from '../lib.mjs';
import {
  groupFor, linesOf, totalOf, aggregateUFB, NJ_COUNTIES, countyFips, displayName, normName,
  UFB_REVENUE, UFB_APPROPRIATION, applyPassThrough, filingsFor,
} from './ufb-map.mjs';
import { summarizeElec, ELEC_SEARCH_URL } from './elec-map.mjs';
import { validateTown } from '../../js/engine/validate.js';

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
// ELEC writes "TWP", "&amp;" and former names in parentheses; a few towns use a different name entirely.
const ELEC_ALIASES = { 'city of orange township|Essex': 'ORANGE CITY' };
const cleanElec = (s) => s.replace(/&amp;/g, '&').replace(/\(.*?\)/g, '').replace(/\bTWP\b/g, 'TOWNSHIP').replace(/\bBORO\b/g, 'BOROUGH').replace(/&/g, 'AND').replace(/\s+/g, ' ').trim();
function elecFor(name, county) {
  const alias = ELEC_ALIASES[`${name.toLowerCase()}|${county}`];
  const pool = elecLocs.filter((l) => l.county === county).map((l) => ({ ...l, name: alias && l.name === alias ? name : cleanElec(l.name) }));
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

// A filing is usable when it has appropriations and anticipated revenue close to
// them: an adopted budget must balance by law. The two sides rarely match to the
// dollar here (the service-type breakdown leaves out a few items), but some
// current-year filings are still incomplete, with revenue entered for only a few
// lines, and those are passed over for the year before.
const usable = (r) => {
  if (!r || r['Status|No UFB Available'] || r['Status|Sig. Data Missing']) return false;
  const app = totalOf(r, groupFor(r, 'appropriations')) || 0;
  const rev = totalOf(r, groupFor(r, 'anticipated')) || 0;
  return app > 0 && rev / app >= 0.75 && rev / app <= 1.33;
};

function populationOf(r) {
  const k = Object.keys(r).find((x) => /^Population and Density\|Population \(/.test(x));
  return k ? Number(r[k]) || 0 : 0;
}

function buildTown(name, county, report) {
  // Latest balanced filing whose size is in line with the town's other years
  // (a few filings are complete but entered at a fraction of the real budget).
  const sizes = YEARS.map((y) => byYear[y].get(`${name}|${county}`)).filter(usable)
    .map((x) => totalOf(x, groupFor(x, 'appropriations')));
  const typical = sizes.sort((a, b) => a - b)[sizes.length >> 1];
  const inLine = (x) => { const v = totalOf(x, groupFor(x, 'appropriations')); return v / typical <= 4 && typical / v <= 4; };
  // Our category totals must also reconcile with the filing's own totals.
  const reconciles = (x) => {
    const a = aggregateUFB(linesOf(x, groupFor(x, 'anticipated')), linesOf(x, groupFor(x, 'appropriations')));
    const rev = Object.values(a.revenue).reduce((m, v) => m + v, 0);
    const app = Object.values(a.spending).reduce((m, v) => m + v, 0) + a.excluded;
    return Math.abs(rev - totalOf(x, groupFor(x, 'anticipated'))) <= 50 && Math.abs(app - totalOf(x, groupFor(x, 'appropriations'))) <= 50;
  };
  const year = YEARS.find((y) => { const x = byYear[y].get(`${name}|${county}`); return usable(x) && inLine(x) && reconciles(x); });
  if (year && year !== YEARS.find((y) => byYear[y].get(`${name}|${county}`) && !byYear[y].get(`${name}|${county}`)['Status|No UFB Available'])) {
    report.olderYear.push(`${displayName(name)} (${year})`);
  }
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
    // The reserve for uncollected taxes is set aside, not spent, so it is not a ledger payment.
    ...appLines.filter((l) => l.amount && UFB_APPROPRIATION[l.label] !== 'exclude').map((l) => {
      const k = UFB_APPROPRIATION[l.label];
      return {
        date: `${year}-01-01`, flow: 'out', category: k === 'shared' || !k ? 'administration' : k,
        counterparty: 'Adopted budget: appropriation', description: l.label + (k === 'shared' ? ' (spread across departments in totals)' : ''),
        amount: Math.round(l.amount), source: UFB_PAGE,
      };
    }),
  ];

  const town = {
    id: townId(name, county),
    name: displayName(name),
    state: 'NJ',
    stateName: 'New Jersey',
    county: `${county} County`,
    type: kind ? displayName(kind) : 'Municipality',
    lat: Math.round(place.lat * 1e5) / 1e5,
    lng: Math.round(place.lng * 1e5) / 1e5,
    // Older filings sometimes leave population blank; take the newest one on file.
    population: populationOf(r) || YEARS.map((y) => populationOf(byYear[y].get(`${name}|${county}`) || {})).find((p) => p > 0) || 0,
    fiscalYear: year,
    asOf: new Date().toISOString().slice(0, 10),
    njMuniCode: String(r['|Muni-code']).padStart(4, '0'),
    censusGeoid: place.geoid,
    revenue,
    spending,
    ...(Number.isFinite(netDebt) ? { debt: Math.round(netDebt) } : {}),
    history: [],
    ...(pol ? { influence: pol.influence, topDonors: pol.topDonors } : {}),
    ledger: [...ledger, ...(pol ? pol.ledger : [])],
    sources: [
      { label: `NJ DLGS User Friendly Budget Database, ${year} filing (adopted budget, net debt, population)`, url: UFB_PAGE },
      { label: 'Workbook download (DLGS)', url: UFB_XLSM_URL.replace(/%20/g, ' ') },
      { label: 'U.S. Census Bureau 2024 Gazetteer, county subdivisions (map location)', url: GAZ_PAGE },
      ...(pol ? [{ label: `NJ ELEC campaign-finance filings: contributions to ${displayName(name)} municipal candidates since ${ELEC_SINCE} (ELEC location ${elec.loc.code})`, url: ELEC_SEARCH_URL }] : []),
    ],
    notes: [
      `Insurance, pension and social-security contributions and shared-service payments ($${Math.round(shared).toLocaleString('en-US')}) are spread across departments in proportion to their size.`,
      ...(excluded ? [`The reserve for uncollected taxes ($${Math.round(excluded).toLocaleString('en-US')}) is set aside, not spent, so it is not counted as spending.`] : []),
      ...(pol
        ? [`Political money counts PAC, business and union contributions to candidates for ${displayName(name)} municipal office and mayor reported to NJ ELEC since ${ELEC_SINCE}. Individual donors ($${pol.individuals.toLocaleString('en-US')} in the same period), candidates' own committees and party committees are not counted. Small campaigns may file without itemizing, so some contributions may not appear.`]
        : ['Political money has not been loaded for this town yet, so it is not scored.']),
      'Contractor pay-to-play disclosures and transparency practices have not been loaded yet; transparency is not scored.',
    ],
  };
  const pt = applyPassThrough(town, filingsFor(byYear, town.njMuniCode), UFB_PAGE);
  if (!pt.head) report.noPassThrough.push(displayName(name));
  if (pt.dropped.length || pt.missingPass.length) report.history.push(`${displayName(name)}: dropped ${[...pt.dropped, ...pt.missingPass].sort().join(', ')}`);
  return town;
}

const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
for (const county of counties) {
  const report = { skipped: [], unmapped: [], mismatch: [], noElec: [], olderYear: [], history: [], issues: [], noPassThrough: [] };
  const names = [...new Set(YEARS.flatMap((y) => ufb[y].filter((r) => r['|County'] === county).map((r) => r['|Municipality'])))];
  const current = new Set(ufb[YEARS[0]].filter((r) => r['|County'] === county).map((r) => r['|Municipality']));
  const towns = names.filter((n) => current.has(n)).sort().map((n) => buildTown(n, county, report)).filter(Boolean);
  for (const t of towns) for (const i of validateTown(t)) report.issues.push(`${t.name} [${i.severity} ${i.code}] ${i.message}`);
  const file = `nj-${slugify(county)}.json`;
  for (const town of towns) town.reporting = reportingFor(town);
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
  index.files.sort();
  writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  const years = towns.reduce((a, t) => ({ ...a, [t.fiscalYear]: (a[t.fiscalYear] || 0) + 1 }), {});
  console.log(JSON.stringify({ county, towns: towns.length, of: current.size, years, skipped: report.skipped, unmapped: [...new Set(report.unmapped)], mismatch: report.mismatch, noElec: report.noElec, olderYear: report.olderYear, history: report.history, noPassThrough: report.noPassThrough, issues: report.issues }));
}
