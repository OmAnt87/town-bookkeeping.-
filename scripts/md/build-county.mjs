#!/usr/bin/env node
// Builds real Town Ledger records for Maryland's 157 incorporated municipalities and Baltimore
// City, one county per file (Baltimore City is its own file, as an independent city).
//
//   node scripts/md/download.mjs && python3 scripts/md/lgf-to-json.py
//   node scripts/md/build-county.mjs --county Frederick     (or --all)
//
// Figures are actual results from each government's uniform financial report to the
// Department of Legislative Services, adjusted and reconciled to audited financial statements
// ("Local Government Finances in Maryland").

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { aggregateMd, MD_REVENUE, MD_FUNCTION } from './lgf-map.mjs';
import { reportUrl, LGF_PAGE } from './download.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'md');
const OUT = join(ROOT, 'data', 'real');
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';

const args = parseArgs();
const lgf = JSON.parse(readFileSync(join(RAW, 'lgf.json'), 'utf8'));
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const placeXY = new Map(readFileSync(join(RAW, '2024_Gaz_place_national.txt'), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'MD').map((c) => [c[1], [Number(c[10]), Number(c[11])]]));

const norm = (s) => String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
// DLS names that differ from the Census place name.
const ALIASES = { 'chevy chase section 3': 'chevy chase section three', 'chevy chase section 5': 'chevy chase section five', 'port tobacco': 'port tobacco village' };

// County names as the Census writes them; the PDF text sometimes drops an apostrophe's "s".
const COUNTIES = pop.filter((p) => p.sumlev === '050').map((p) => p.name);
const countyName = (s) => (s === 'Baltimore City' ? s : COUNTIES.find((c) => norm(c).replace(/s\b/g, '') === norm(s).replace(/s\b/g, '')) || s);

// Census places: incorporated municipalities ("Rockville city", "Laytonsville town").
const places = new Map();
for (const r of pop.filter((p) => p.sumlev === '162')) {
  const m = r.name.match(/^(.+?) (city|town|village)$/);
  if (!m) continue;
  places.set(norm(m[1]), { name: m[1], kind: m[2], pop: Number(r[POP_YEAR]), geoid: `24${r.place}` });
}

// Each government's statements by year. Special taxing districts and commissions are not
// Census places and are left out.
const govs = new Map();
for (const [year, ents] of Object.entries(lgf)) {
  for (const e of Object.values(ents)) {
    const isCity = e.name === 'Baltimore City';
    if (e.part !== 2 && !isCity) continue;
    const place = places.get(ALIASES[norm(e.name)] || norm(isCity ? 'Baltimore' : e.name));
    if (!place) continue;
    const key = place.geoid;
    const g = govs.get(key) || govs.set(key, { place, county: isCity ? 'Baltimore City' : countyName(e.county), years: {} }).get(key);
    g.years[year] = e;
  }
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const sumCols = (v) => (v || []).slice(0, 3).reduce((a, b) => a + (Number(b) || 0), 0);
const KIND = { city: 'City', town: 'Town', village: 'Village' };

function buildTown(g, report) {
  const years = Object.keys(g.years).filter((y) => !g.years[y].noData && sumCols(g.years[y].rows['revenues/Total']) > 0).sort();
  const latestReport = Object.keys(g.years).sort().at(-1);
  const year = years.at(-1);
  const p = g.place;
  const xy = placeXY.get(p.geoid);
  if (!year) { report.noData.push(p.name); return null; }
  if (!xy) { report.skipped.push(`${p.name}: no gazetteer location`); return null; }
  if (year !== latestReport) report.older.push(`${p.name} (FY ${year})`);
  const e = g.years[year];
  const a = aggregateMd(e.rows);
  if (a.unmapped.length) report.unmapped.push(`${p.name} ${year}: ${a.unmapped.join(', ')}`);
  if (Math.abs(a.lineTotals.revenue - a.reported.revenue) > 3 || Math.abs(a.lineTotals.spending - a.reported.spending) > 3) {
    report.mismatch.push(`${p.name} ${year}: revenue ${a.lineTotals.revenue} vs ${a.reported.revenue}; spending ${a.lineTotals.spending} vs ${a.reported.spending}`);
  }

  const history = years.map((y) => {
    const r = g.years[y].rows;
    return { year: Number(y), revenue: Math.round(sumCols(r['revenues/Total']) - sumCols(r['revenues/Debt Proceeds'])), spending: Math.round(sumCols(r['expenditures/Total'])), basis: 'actual' };
  });

  const date = `${year}-06-30`;
  const src = reportUrl(year);
  const COL = ['operating', 'capital', 'enterprise'];
  const split = (v) => {
    const parts = COL.map((c, i) => [c, Number(v[i]) || 0]).filter(([, x]) => x);
    return parts.length > 1 ? ` (${parts.map(([c, x]) => `${c} ${money(x)}`).join(', ')})` : parts[0] && parts[0][0] !== 'operating' ? ` (${parts[0][0]})` : '';
  };
  const ledger = [];
  for (const [k, v] of Object.entries(e.rows)) {
    const [section, ...rest] = k.split('/');
    const label = rest.join('/');
    const amount = Math.round(sumCols(v));
    if (label === 'Total' || !amount) continue;
    if (section === 'revenues' && MD_REVENUE[label]) {
      const [cat, text] = MD_REVENUE[label];
      if (label === 'Service Charges' && Number(v[2])) {
        ledger.push({ date, flow: 'in', category: 'utilityCharges', counterparty: 'Statement of revenues', description: 'Service charges (utilities and other enterprises)', amount: Math.round(v[2]), source: src });
        if (Math.round(amount - v[2])) ledger.push({ date, flow: 'in', category: 'feesPermits', counterparty: 'Statement of revenues', description: 'Service charges (governmental)', amount: Math.round(amount - v[2]), source: src });
      } else ledger.push({ date, flow: 'in', category: cat, counterparty: 'Statement of revenues', description: `${text}${split(v)}`, amount, source: src });
    } else if (section === 'expenditures' && MD_FUNCTION[label]) {
      const [cat, text] = MD_FUNCTION[label];
      ledger.push({
        date, flow: 'out', category: cat === 'benefits' ? 'administration' : cat, counterparty: 'Statement of expenditures',
        description: `${text}${split(v)}${cat === 'benefits' ? '; spread across departments in totals' : ''}`, amount, source: src,
      });
    }
  }
  ledger.sort((x, y) => (x.flow === y.flow ? y.amount - x.amount : x.flow === 'in' ? -1 : 1));

  const isCity = g.county === 'Baltimore City';
  const display = isCity ? 'City of Baltimore' : `${KIND[p.kind]} of ${p.name}`;
  const asOf = new Date().toISOString().slice(0, 10);
  const debt = typeof e.debt === 'number' ? Math.round(e.debt) : null;
  const proceeds = a.excluded['Debt Proceeds'] || 0;
  return {
    id: slugify(`${display} md`),
    name: display,
    state: 'MD',
    stateName: 'Maryland',
    county: g.county,
    type: KIND[p.kind],
    lat: Math.round(xy[0] * 1e5) / 1e5,
    lng: Math.round(xy[1] * 1e5) / 1e5,
    population: p.pop || 1,
    fiscalYear: Number(year),
    asOf,
    censusGeoid: p.geoid,
    revenue: a.revenue,
    spending: a.spending,
    ...(debt != null ? { debt } : {}),
    reporting: {
      basis: 'Actual results (reconciled to audited statements)',
      scope: isCity ? 'All funds, including schools (board of education transfers) and utilities' : 'All funds: governmental operating, capital and enterprise (utilities)',
      politicalPeriod: 'Not loaded',
      politicalScope: isCity ? 'Not loaded: Baltimore City candidates file with the State Board of Elections' : 'None statewide: municipal candidates file with their municipality',
    },
    history,
    ledger,
    sources: [
      { label: `MD Department of Legislative Services, Local Government Finances in Maryland, FY ${year}: statement of revenues and expenditures and debt`, url: src },
      { label: 'MD Department of Legislative Services, local finance reports (history)', url: LGF_PAGE },
      { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
      { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
    ],
    notes: [
      `Actual results for the fiscal year ended June 30, ${year}, from the town's uniform financial report to the Department of Legislative Services, adjusted and reconciled to its audited financial statements. Not a budget.`,
      ...(year !== latestReport ? [`No financial information was submitted for FY ${latestReport}, so FY ${year} is shown.`] : []),
      'Covers all of the town\'s funds: governmental operations, capital projects and enterprise funds such as water, sewer and electric utilities. Capital spending counts in the year it happens.',
      isCity
        ? 'Includes the city\'s transfers to the Baltimore City Public Schools and other boards, shown as schools and left out of the services and overhead shares.'
        : 'Schools, most police and many other services are provided by the county, not the town, so town budgets are small next to county ones.',
      ...(proceeds ? [`Left out: debt proceeds (${money(proceeds)}), which are borrowing, not revenue.`] : []),
      ...(a.benefitsSpread > 0 ? [`Miscellaneous spending (${money(a.benefitsSpread)}: pension contributions, health insurance, workers' compensation, Social Security and judgments) is spread across departments in proportion to their size, as with benefits in other states. Debt service is left out of that spread.`] : []),
      ...(debt != null ? [`Debt is total public debt at the end of FY ${year}: bonds, notes, loans (including State loans) and capital leases, less sinking fund assets, for both governmental and enterprise funds.`] : []),
      isCity
        ? 'Political money is not scored yet: Baltimore City candidates file with the State Board of Elections, whose data has not been loaded.'
        : 'Political money is not scored: candidates for municipal office file campaign reports with their municipality, and there is no statewide database of those filings.',
      'Transparency practices have not been checked yet, so they are not scored.',
    ],
  };
}

const counties = [...new Set([...govs.values()].map((g) => g.county))].sort();
const countyKey = (c) => c.replace(/ County$/, '').replace(/'/g, '');
const pick = args.all ? counties : counties.filter((c) => slugify(countyKey(c)) === slugify(String(args.county || '')));
if (!pick.length) { console.error(`Usage: node scripts/md/build-county.mjs --county <county> | --all\nCounties: ${counties.map(countyKey).join(', ')}`); process.exit(1); }
const unplaced = [...places.values()].filter((p) => ![...govs.values()].some((g) => g.place === p)).map((p) => p.name);
if (unplaced.length) console.error(`Census places with no DLS statement: ${unplaced.join(', ')}`);
const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
for (const county of pick) {
  const report = { skipped: [], noData: [], mismatch: [], unmapped: [], older: [] };
  const towns = [...govs.values()].filter((g) => g.county === county).map((g) => buildTown(g, report)).filter(Boolean).sort((x, y) => x.name.localeCompare(y.name));
  const file = `md-${slugify(countyKey(county))}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
  index.files.sort();
  writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  const types = towns.reduce((m, t) => ({ ...m, [t.type]: (m[t.type] || 0) + 1 }), {});
  console.log(JSON.stringify({ county, towns: towns.length, types, ...report }));
}
