#!/usr/bin/env node
// Builds real Town Ledger records for New York towns, villages and cities, one county per file.
//
//   node scripts/ny/download.mjs                      # OSC files, Census estimates and gazetteers
//   python3 scripts/ny/osc-to-json.py                 # condense OSC files -> data/raw/ny/osc.json
//   node scripts/ny/fetch-politics.mjs --all          # campaign contributions (optional, cached)
//   node scripts/ny/build-county.mjs --county Albany  # or --all
//
// Output: data/real/ny-<county>.json, listed in data/real/index.json.
// Then re-run scripts/common/red-flags.mjs --state ny: a rebuild drops the red-flag records.
// Figures are actual results from each government's Annual Financial Report to the
// NY Office of the State Comptroller. Nothing is estimated.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { aggregateOsc } from './osc-map.mjs';
import { summarizeNyContributions, NY_CF_URL } from './politics-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'ny');
const OUT = join(ROOT, 'data', 'real');
const OSC_PAGE = 'https://wwe1.osc.state.ny.us/localgov/findata/financial-data-for-local-governments.cfm';
const OPEN_BOOK = 'https://wwe2.osc.state.ny.us/transparency/localgov/LocalGovOverview.cfm';
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';
const LEDGER_POLITICAL_MAX = 100;

const args = parseArgs();
const osc = JSON.parse(readFileSync(join(RAW, 'osc.json'), 'utf8'));

// Census 2025 population estimates (sub-county file for NY).
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const countyFips = Object.fromEntries(pop.filter((r) => r.sumlev === '050').map((r) => [r.name.replace(/ County$/, ''), r.county]));
const COUNTIES = Object.keys(countyFips).sort();

const gazRows = (file) => readFileSync(join(RAW, file), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'NY');
const cousubXY = new Map(gazRows('2024_Gaz_cousubs_national.txt').map((c) => [c[1], [Number(c[9]), Number(c[10])]]));
const placeXY = new Map(gazRows('2024_Gaz_place_national.txt').map((c) => [c[1], [Number(c[10]), Number(c[11])]]));

const norm = (s) => String(s).toLowerCase().replace(/\bst\.?\s/g, 'saint ').replace(/\bmt\.?\s/g, 'mount ').replace(/[.'’]/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
// Spacing differs between sources ("Mc Donough" / "McDonough", "Summer Hill" / "Summerhill").
const loose = (s) => norm(s).replace(/\s+/g, '');

// OSC "Town of X" / "Village of X" / "City of X" -> Census row.
function censusFor(g) {
  const kind = g.class.toLowerCase();
  const base = g.name.replace(/^(Town|Village|City) of /i, '');
  const want = norm(`${base} ${kind}`);
  const fips = countyFips[g.county];
  if (kind === 'town') {
    const r = pop.find((p) => p.sumlev === '061' && p.county === fips && norm(p.name) === want)
      || pop.find((p) => p.sumlev === '061' && p.county === fips && loose(p.name) === loose(want));
    return r && { pop: Number(r[POP_YEAR]), xy: cousubXY.get(`36${r.county}${r.cousub}`), geoid: `36${r.county}${r.cousub}` };
  }
  let places = pop.filter((p) => p.sumlev === '162' && norm(p.name) === want);
  if (!places.length) places = pop.filter((p) => p.sumlev === '162' && loose(p.name) === loose(want));
  if (places.length > 1) {
    const inCounty = new Set(pop.filter((p) => p.sumlev === '157' && p.county === fips).map((p) => p.place));
    places = places.filter((p) => inCounty.has(p.place));
  }
  const r = places[0];
  return r && { pop: Number(r[POP_YEAR]), xy: placeXY.get(`36${r.place}`), geoid: `36${r.place}` };
}

// Ids: "<name>-<type>-ny", plus the county when the same name and type repeat statewide.
const idCounts = {};
for (const g of Object.values(osc)) { const k = slugify(g.name); idCounts[k] = (idCounts[k] || 0) + 1; }
const govId = (g) => {
  const base = g.name.replace(/^(Town|Village|City) of /i, '');
  return slugify(idCounts[slugify(g.name)] > 1 ? `${base} ${g.class} ${g.county} county ny` : `${base} ${g.class} ny`);
};

const politicsFile = (county) => join(RAW, 'politics', `${slugify(county)}.json`);
const ELEC_SINCE = (() => { const t = new Date().toISOString().slice(0, 10); return `${Number(t.slice(0, 4)) - 4}${t.slice(4)}`; })();

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

function buildGov(code, g, report, politics) {
  const years = Object.keys(g.years).sort();
  const usable = years.filter((y) => { const a = aggregateOsc(g.years[y].lines); return a.raw.revenue > 0 && a.raw.spending > 0; });
  const year = usable.at(-1);
  if (!year) { report.skipped.push(`${g.name}: no annual financial report with revenue and spending`); return null; }
  const census = censusFor(g);
  if (!census || !census.xy) { report.skipped.push(`${g.name}: not in the Census 2025 estimates (dissolved or renamed)`); return null; }
  if (Number(year) < 2022) report.old.push(`${g.name} (${year})`);

  const a = aggregateOsc(g.years[year].lines);
  report.unmapped.push(...a.unmapped);
  const revTotal = Object.values(a.revenue).reduce((x, y) => x + y, 0);
  const spTotal = Object.values(a.spending).reduce((x, y) => x + y, 0);
  // Counted + excluded must equal everything reported (benefits are spread, not dropped).
  if (Math.abs(revTotal + a.excluded.revenue - a.raw.revenue) > 50 || Math.abs(spTotal + a.excluded.spending - a.raw.spending) > 50) {
    report.mismatch.push(`${g.name} ${year}: revenue ${revTotal}+${a.excluded.revenue} vs ${a.raw.revenue}; spending ${spTotal}+${a.excluded.spending} vs ${a.raw.spending}`);
  }

  const history = usable.map((y) => {
    const h = aggregateOsc(g.years[y].lines);
    return { year: Number(y), revenue: Math.round(h.raw.revenue - h.excluded.revenue), spending: Math.round(h.raw.spending - h.excluded.spending), basis: 'actual' };
  });

  const debtYear = Object.keys(g.debt || {}).filter((y) => y <= year).sort().at(-1);
  const debt = debtYear ? Math.round(g.debt[debtYear]) : null;

  // Ledger: one row per OSC category line actually counted.
  const periodEnd = g.years[year].periodEnd;
  const grouped = {};
  for (const [key, amount] of Object.entries(g.years[year].lines)) {
    if (!amount) continue;
    const [, section, l1, l2] = key.split('|');
    const gk = `${section}|${l1}|${l2}`;
    grouped[gk] = (grouped[gk] || 0) + amount;
  }
  const { mapOscLine } = report.map;
  const ledger = Object.entries(grouped).map(([gk, amount]) => {
    const [section, l1, l2] = gk.split('|');
    const cat = mapOscLine(`A|${gk}|`);
    if (!cat || cat.startsWith('exclude:') || Math.round(amount) === 0) return null;
    return {
      date: periodEnd,
      flow: section === 'REVENUE' ? 'in' : 'out',
      category: cat === 'shared' ? 'administration' : cat,
      counterparty: section === 'REVENUE' ? 'Annual financial report: revenue' : 'Annual financial report: spending',
      description: `${l1}: ${l2}${cat === 'shared' ? ' (spread across departments in totals)' : ''}`,
      amount: Math.round(amount),
      source: OPEN_BOOK,
    };
  }).filter(Boolean).sort((x, y) => (x.flow === y.flow ? y.amount - x.amount : x.flow === 'in' ? -1 : 1));

  const kind = g.class;
  const base = g.name.replace(/^(Town|Village|City) of /i, '');
  const pol = politics ? summarizeNyContributions(politics, ELEC_SINCE) : null;
  const excludedRev = Object.entries(a.excluded.reasons.revenue).filter(([, v]) => v > 0);

  return {
    id: govId(g),
    name: g.name,
    state: 'NY',
    stateName: 'New York',
    county: `${g.county} County`,
    type: kind,
    lat: Math.round(census.xy[0] * 1e5) / 1e5,
    lng: Math.round(census.xy[1] * 1e5) / 1e5,
    population: census.pop,
    fiscalYear: Number(year),
    asOf: new Date().toISOString().slice(0, 10),
    nyOscCode: code,
    censusGeoid: census.geoid,
    revenue: a.revenue,
    spending: a.spending,
    ...(debt != null ? { debt } : {}),
    ...(pol ? { influence: pol.influence, topDonors: pol.topDonors } : {}),
    history,
    ledger: [...ledger, ...(pol ? pol.ledger.slice(0, LEDGER_POLITICAL_MAX) : [])],
    sources: [
      { label: `NY State Comptroller, Annual Financial Report data, fiscal year ending ${periodEnd} (revenue and spending)`, url: OSC_PAGE },
      { label: `${g.name} on Open Book New York (Comptroller)`, url: OPEN_BOOK },
      ...(debt != null ? [{ label: `NY State Comptroller debt data, outstanding at end of ${debtYear}`, url: OSC_PAGE }] : []),
      { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
      { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
      ...(pol ? [{ label: `NY State Board of Elections contributions via data.ny.gov, candidates for ${g.name} offices since ${ELEC_SINCE}`, url: NY_CF_URL }] : []),
    ],
    notes: [
      `Actual results reported to the State Comptroller for the fiscal year ending ${periodEnd}, not an adopted budget.`,
      ...(Number(year) < 2023 ? [`This is the latest annual report ${g.name} has filed with the State Comptroller; newer years are not on file.`] : []),
      kind === 'Village'
        ? `Covers the village government only. Village residents also pay the town that surrounds ${base}, which is listed separately, plus county and school taxes.`
        : 'Covers this government only. County, school-district and special-district taxes on the same bills belong to separate governments.',
      ...excludedRev.map(([reason, v]) => `Left out of money in: ${reason} (${money(v)}).`),
      `Employee benefits (${money(a.shared)}) are spread across departments in proportion to their size.`,
      ...(pol
        ? [`Political money counts PAC, business and union contributions to candidates for ${g.name} offices reported to the State Board of Elections since ${ELEC_SINCE}. Individual donors (${money(pol.individuals)} in the same period), candidates' own committees and party committees are not counted. Campaigns that raise little may not itemize, so some contributions may not appear.`]
        : ['Political money has not been loaded for this government yet, so it is not scored.']),
      'Transparency practices have not been checked yet, so they are not scored.',
    ],
  };
}

const { mapOscLine } = await import('./osc-map.mjs');
const counties = args.all ? COUNTIES : [COUNTIES.find((c) => c.toLowerCase() === String(args.county || '').toLowerCase())];
if (!counties[0]) {
  console.error(`Usage: node scripts/ny/build-county.mjs --county <name> | --all\nCounties: ${COUNTIES.join(', ')}`);
  process.exit(1);
}
const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });

for (const county of counties) {
  const report = { skipped: [], unmapped: [], mismatch: [], old: [], map: { mapOscLine } };
  const politics = existsSync(politicsFile(county)) ? JSON.parse(readFileSync(politicsFile(county), 'utf8')) : null;
  const govs = Object.entries(osc).filter(([, g]) => g.county === county);
  const towns = govs.map(([code, g]) => buildGov(code, g, report, politics ? (politics.byGov[code] || []) : null)).filter(Boolean)
    .sort((x, y) => x.name.localeCompare(y.name));
  if (!towns.length) { console.log(JSON.stringify({ county, towns: 0, of: govs.length, skipped: report.skipped })); continue; }
  const file = `ny-${slugify(county)}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
  index.files.sort();
  writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  const types = towns.reduce((m, t) => ({ ...m, [t.type]: (m[t.type] || 0) + 1 }), {});
  console.log(JSON.stringify({ county, towns: towns.length, of: govs.length, types, old: report.old, skipped: report.skipped, unmapped: [...new Set(report.unmapped)], mismatch: report.mismatch }));
}
