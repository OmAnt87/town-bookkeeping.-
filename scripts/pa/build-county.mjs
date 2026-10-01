#!/usr/bin/env node
// Builds real Town Ledger records for Pennsylvania municipalities (townships, boroughs,
// cities and the town of Bloomsburg), one county per file.
//
//   node scripts/pa/download.mjs                 # DCED statewide reports, Census estimates, gazetteer
//   python3 scripts/pa/afr-to-json.py            # -> data/raw/pa/afr.json
//   node scripts/pa/build-county.mjs --county Adams   (or --all)
//
// Figures are actual results from each municipality's Annual Audit and Financial Report
// (DCED-CLGS-30) as published by the PA Department of Community and Economic Development.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { aggregateAfr, PA_REVENUE, PA_EXPENDITURE } from './afr-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'pa');
const OUT = join(ROOT, 'data', 'real');
const DCED_PAGE = 'https://apps.dced.pa.gov/munstats-public/ReportInformation2.aspx?report=StatewideMuniAfr';
const DCED_MUNI = 'https://apps.dced.pa.gov/munstats-public/ReportInformation2.aspx?report=mAfrForm';
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';

const args = parseArgs();
const afr = JSON.parse(readFileSync(join(RAW, 'afr.json'), 'utf8'));
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const countyFips = Object.fromEntries(pop.filter((r) => r.sumlev === '050').map((r) => [r.name.replace(/ County$/, '').toUpperCase(), r.county]));
const cousubXY = new Map(readFileSync(join(RAW, '2024_Gaz_cousubs_national.txt'), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'PA').map((c) => [c[1], [Number(c[9]), Number(c[10])]]));

const SUFFIX = { BORO: 'borough', TWP: 'township', CITY: 'city', TOWN: 'town' };
const norm = (s) => String(s).toLowerCase().replace(/\bst\.?\s/g, 'saint ').replace(/\bmt\.?\s/g, 'mount ').replace(/[.'’]/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();
const loose = (s) => norm(s).replace(/\s+/g, '');
const split = (afrName) => {
  const m = afrName.trim().match(/^(.*?)\s+(BORO|TWP|CITY|TOWN)$/i);
  return m ? { base: m[1], kind: SUFFIX[m[2].toUpperCase()] } : { base: afrName.trim(), kind: '' };
};

const placeXY = new Map(readFileSync(join(RAW, '2024_Gaz_place_national.txt'), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'PA').map((c) => [c[1], [Number(c[10]), Number(c[11])]]));

const TYPE_WORDS = / (township|borough|city|town|municipality)$/i;
const gazByName = new Map(readFileSync(join(RAW, '2024_Gaz_cousubs_national.txt'), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'PA')
  .map((c) => [`${c[1].slice(2, 5)}|${loose(c[3].replace(TYPE_WORDS, ''))}`, [Number(c[9]), Number(c[10])]]));

function censusFor(g) {
  const { base, kind } = split(g.name);
  // Home-rule municipalities are "<name> municipality" in the Census; "Oil City" keeps its full name.
  const wants = [`${base} ${kind}`, `${base} municipality`, `${g.name.trim()} ${kind}`].map(norm);
  const fips = countyFips[g.county];
  const cands = pop.filter((p) => p.sumlev === '061');
  const r = cands.find((p) => p.county === fips && wants.includes(norm(p.name)))
    || cands.find((p) => p.county === fips && wants.map(loose).includes(loose(p.name)))
    // Municipalities split across a county line appear under their other county in the Census.
    || cands.find((p) => wants.includes(norm(p.name)) && Number(p[POP_YEAR]) > 0);
  if (r) {
    // Some codes differ between the estimates and the gazetteer (a type change to "municipality");
    // then find the location by name within the county.
    const xy = cousubXY.get(`42${r.county}${r.cousub}`) || gazByName.get(`${r.county}|${loose(base)}`);
    return { pop: Number(r[POP_YEAR]), xy, geoid: `42${r.county}${r.cousub}` };
  }
  // Philadelphia (city and county are one) is only listed as a place.
  const pl = pop.find((p) => p.sumlev === '162' && wants.includes(norm(p.name)));
  return pl && { pop: Number(pl[POP_YEAR]), xy: placeXY.get(`42${pl.place}`), geoid: `42${pl.place}` };
}

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\bMc([a-z])/g, (m, c) => `Mc${c.toUpperCase()}`);
const displayName = (g) => {
  const { base, kind } = split(g.name);
  return kind === 'city' ? `City of ${titleCase(base)}` : `${titleCase(base)} ${titleCase(kind || g.type)}`;
};
const typeLabel = (g) => (/township/i.test(g.type) ? 'Township' : g.type);

const idCounts = {};
for (const g of Object.values(afr)) { const k = slugify(displayName(g)); idCounts[k] = (idCounts[k] || 0) + 1; }
const govId = (g) => {
  const name = displayName(g);
  return slugify(idCounts[slugify(name)] > 1 ? `${name} ${titleCase(g.county)} county pa` : `${name} pa`);
};

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const filed = (r) => r && (r.status === 'A' || r.status === 'P');

function buildMuni(id, g, report) {
  const years = Object.keys(g.years).filter((y) => filed(g.years[y])).sort();
  const year = years.at(-1);
  if (!year) { report.skipped.push(`${g.name}: no annual financial report filed since ${Object.keys(g.years).sort()[0]}`); return null; }
  const census = censusFor(g);
  if (!census || !census.xy) { report.skipped.push(`${g.name}: not in the Census 2025 estimates (merged or renamed)`); return null; }
  if (Number(year) < 2023) report.old.push(`${displayName(g)} (${year})`);
  const rec = g.years[year];
  const a = aggregateAfr(rec);
  if (Math.abs(a.lineTotals.revenue - a.reported.revenue) > 2 || Math.abs(a.lineTotals.spending - a.reported.spending) > 2) {
    report.mismatch.push(`${g.name} ${year}: revenue ${Math.round(a.lineTotals.revenue)} vs ${a.reported.revenue}; spending ${Math.round(a.lineTotals.spending)} vs ${a.reported.spending}`);
  }
  const history = years.map((y) => {
    const h = aggregateAfr(g.years[y]);
    return { year: Number(y), revenue: Math.round(h.lineTotals.revenue - h.excluded.revenue), spending: Math.round(h.lineTotals.spending - h.excluded.spending), basis: 'actual' };
  });
  const debt = rec['Total Debt'] == null ? null : Math.round(Number(rec['Total Debt']));
  const date = `${year}-12-31`;
  const ledger = [
    ...Object.entries(PA_REVENUE).filter(([c, k]) => k !== 'exclude' && Number(rec[c])).map(([c, k]) => ({
      date, flow: 'in', category: k, counterparty: 'Annual financial report: revenue', description: c.replace(/ Revenues$/, ''), amount: Math.round(Number(rec[c])), source: DCED_MUNI,
    })),
    ...(Math.abs(a.unitemizedTaxes) > 0 ? [{ date, flow: 'in', category: 'salesTax', counterparty: 'Annual financial report: revenue', description: 'Other taxes not itemized in the statewide report', amount: a.unitemizedTaxes, source: DCED_MUNI }] : []),
    ...Object.entries(PA_EXPENDITURE).filter(([c, k]) => k !== 'exclude' && Number(rec[c])).map(([c, k]) => ({
      date, flow: 'out', category: k === 'shared' ? 'administration' : k, counterparty: 'Annual financial report: spending',
      description: c.replace(/ Expenditures$/, '') + (k === 'shared' ? ' (insurance, pensions and benefits; spread across departments in totals)' : ''),
      amount: Math.round(Number(rec[c])), source: DCED_MUNI,
    })),
  ].sort((x, y) => (x.flow === y.flow ? y.amount - x.amount : x.flow === 'in' ? -1 : 1));

  const name = displayName(g);
  return {
    id: govId(g),
    name,
    state: 'PA',
    stateName: 'Pennsylvania',
    county: `${titleCase(g.county)} County`,
    type: typeLabel(g),
    lat: Math.round(census.xy[0] * 1e5) / 1e5,
    lng: Math.round(census.xy[1] * 1e5) / 1e5,
    population: census.pop || Number(rec.Population) || 1,
    fiscalYear: Number(year),
    asOf: new Date().toISOString().slice(0, 10),
    paMuniId: id,
    censusGeoid: census.geoid,
    revenue: a.revenue,
    spending: a.spending,
    ...(debt != null ? { debt } : {}),
    history,
    ledger,
    sources: [
      { label: `PA DCED Statewide Municipal Annual Financial Reports, ${year} (revenue, spending, debt)`, url: DCED_PAGE },
      { label: `${name} annual financial report (DCED Municipal Statistics)`, url: DCED_MUNI },
      { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
      { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
    ],
    notes: [
      `Actual results from the ${year} Annual Audit and Financial Report filed with the PA Department of Community and Economic Development${rec.status === 'P' ? ' (marked pending review by DCED)' : ''}, not a budget.`,
      ...(Number(year) < 2023 ? [`This is the latest annual report ${name} has filed; newer years are not on file.`] : []),
      id === '510101' || /^PHILADELPHIA CITY$/i.test(g.name.trim())
        ? 'Philadelphia is a combined city and county, so these figures include county services. School-district taxes and independent authorities are separate.'
        : 'Covers the municipality only. County and school-district taxes on the same bills, and independent municipal authorities (often water and sewer), are separate.',
      ...(/township/i.test(g.type) ? [`${g.type}.`] : []),
      ...(a.excluded.revenue || a.excluded.spending ? [`Left out: other financing sources (${money(a.excluded.revenue)}) and uses (${money(a.excluded.spending)}), such as transfers between the municipality's own funds and borrowing, which the statewide report does not break down.`] : []),
      ...(a.shared ? [`"Other expenditures" (${money(a.shared)}, mostly insurance, pensions and employee benefits) are spread across departments in proportion to their size.`] : []),
      ...(Math.abs(a.unitemizedTaxes) > 0 ? [`${money(a.unitemizedTaxes)} of taxes are not itemized by type in the statewide report and are shown as other local taxes.`] : []),
      'Political money is not scored: Pennsylvania municipal candidates file campaign reports with their county board of elections, and there is no statewide database of those filings.',
      'Transparency practices have not been checked yet, so they are not scored.',
    ],
  };
}

const counties = Object.keys(countyFips).sort();
const pick = args.all ? counties : [counties.find((c) => c === String(args.county || '').toUpperCase())];
if (!pick[0]) { console.error(`Usage: node scripts/pa/build-county.mjs --county <name> | --all\nCounties: ${counties.join(', ')}`); process.exit(1); }
const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
for (const county of pick) {
  const report = { skipped: [], mismatch: [], old: [] };
  const towns = Object.entries(afr).filter(([, g]) => g.county === county)
    .map(([id, g]) => buildMuni(id, g, report)).filter(Boolean).sort((x, y) => x.name.localeCompare(y.name));
  const file = `pa-${slugify(county)}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
  index.files.sort();
  writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  const types = towns.reduce((m, t) => ({ ...m, [t.type]: (m[t.type] || 0) + 1 }), {});
  console.log(JSON.stringify({ county, towns: towns.length, of: Object.values(afr).filter((g) => g.county === county).length, types, old: report.old, skipped: report.skipped, mismatch: report.mismatch }));
}
