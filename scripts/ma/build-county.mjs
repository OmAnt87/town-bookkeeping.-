#!/usr/bin/env node
// Builds real Town Ledger records for Massachusetts's 351 cities and towns, one county per file.
//
//   node scripts/ma/download.mjs && python3 scripts/ma/dls-to-json.py
//   node scripts/ma/fetch-ocpf.mjs                      # campaign finance (optional)
//   node scripts/ma/build-county.mjs --county Hampshire  (or --all)
//
// Figures are actual general-fund results each city and town reports to the Department of
// Revenue's Division of Local Services (DLS) on its annual Schedule A.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { aggregateMa, MA_REVENUE, MA_FUNCTION, MA_EXCISE } from './dls-map.mjs';
import { townMatcher, localFilers, summarizeMaReceipts, OCPF_URL } from './ocpf-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'ma');
const OUT = join(ROOT, 'data', 'real');
const GF_PAGE = 'https://dls-gw.dor.state.ma.us/reports/rdPage.aspx?rdReport=ScheduleA.GenFund_MAIN';
const RECEIPTS_PAGE = 'https://dls-gw.dor.state.ma.us/reports/rdPage.aspx?rdReport=TaxRateRecap.PAGE3.LocalReceiptsAct_vs_Est';
const DEBT_PAGE = 'https://dls-gw.dor.state.ma.us/reports/rdPage.aspx?rdReport=Dashboard.Cat_6_Reports.LongTermDebt351';
const SCHEDULE_A = 'https://www.mass.gov/lists/schedule-a-reports-revenues-expenditures-and-more';
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';

const args = parseArgs();
const dls = JSON.parse(readFileSync(join(RAW, 'dls.json'), 'utf8')).towns;
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const counties = Object.fromEntries(pop.filter((r) => r.sumlev === '050').map((r) => [r.county, r.name]));
const cousubXY = new Map(readFileSync(join(RAW, '2024_Gaz_cousubs_national.txt'), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'MA').map((c) => [c[1], [Number(c[9]), Number(c[10])]]));
const match = townMatcher(Object.values(dls).map((t) => t.name));

// Census county subdivision for each DLS municipality.
const census = new Map();
for (const r of pop.filter((p) => p.sumlev === '061')) {
  const m = r.name.match(/^(.+?) (Town city|city|town)$/);
  const name = m && match(m[1]);
  if (!name) continue;
  const geoid = `25${r.county}${r.cousub}`;
  census.set(name, { pop: Number(r[POP_YEAR]), xy: cousubXY.get(geoid), geoid, county: r.county, kind: m[2] === 'city' ? 'City' : 'Town', cityForm: m[2] !== 'town' });
}

// Political money: receipts to each town's party committees and mayoral and city council candidates.
const LEDGER_POLITICAL_MAX = 100;
const thisYear = new Date().getFullYear();
const OCPF_SINCE = `${thisYear - 3}-01-01`;
const OCPF = join(RAW, 'ocpf');
const haveOcpf = existsSync(join(OCPF, 'items-202.json'));
let filers = new Map();
const itemsByTown = new Map();
const filersByTown = new Map();
let pacIds = new Set();
if (haveOcpf) {
  const R = (f) => (existsSync(join(OCPF, f)) ? JSON.parse(readFileSync(join(OCPF, f), 'utf8')) : []);
  const lists = { lpc: [], mayoral: [], cc: [] };
  for (let y = thisYear - 3; y <= thisYear; y++) for (const k of Object.keys(lists)) lists[k].push(...R(`${k}-${y}.json`));
  filers = localFilers(lists, match);
  for (const f of filers.values()) filersByTown.set(f.town, (filersByTown.get(f.town) || 0) + 1);
  pacIds = new Set(R('items-299.json').map((i) => i.id));
  for (const rt of [202, 203]) {
    for (const i of R(`items-${rt}.json`)) {
      const f = filers.get(i.filerCpfId);
      if (f) (itemsByTown.get(f.town) || itemsByTown.set(f.town, []).get(f.town)).push(i);
    }
  }
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const complete = (gf) => gf?.revenue?.['Total Revenues'] && gf?.spending?.['Total Expenditures'];
const EXCISE_LABEL = { 'Motor Vehicle Excise': 'Motor vehicle excise', 'Other Excise': 'Other excise', 'A.Meals': 'Local meals excise', 'B.Room': 'Local room occupancy excise', 'C.Other': 'Other local excise (short-term rentals, jet fuel)', 'D.Cannabis': 'Local cannabis excise' };

function buildTown(code, t, report) {
  const years = Object.keys(t.gf).filter((y) => complete(t.gf[y])).sort();
  const latest = years.at(-1);
  // Prefer the latest year with actual excise receipts, so property tax can be separated.
  const year = years.filter((y) => t.receipts[y]).at(-1) || latest;
  const c = census.get(t.name);
  if (!latest) { report.skipped.push(`${t.name}: no Schedule A on file`); return null; }
  if (!c || !c.xy) { report.skipped.push(`${t.name}: no Census match`); return null; }
  const gf = t.gf[year];
  const a = aggregateMa(gf, t.receipts[year] || null);
  if (Math.abs(a.lineTotals.revenue - a.reported.revenue) > 2 || Math.abs(a.lineTotals.spending - a.reported.spending) > 2) {
    report.mismatch.push(`${t.name} ${year}: revenue ${a.lineTotals.revenue} vs ${a.reported.revenue}; spending ${a.lineTotals.spending} vs ${a.reported.spending}`);
  }
  if (!a.taxSplit) report.noTaxSplit.push(`${t.name} (${year})`);
  if (year !== latest) report.older.push(`${t.name} (${year}; FY ${latest} has no excise receipts yet)`);
  if (Number(year) < thisYear - 1) report.late.push(`${t.name} (FY ${year})`);

  const excluded = (g) => (g.revenue['Other Financing Sources'] || 0) + (g.revenue.Transfers || 0);
  const history = years.map((y) => ({
    year: Number(y), revenue: Math.round(t.gf[y].revenue['Total Revenues'] - excluded(t.gf[y])), spending: Math.round(t.gf[y].spending['Total Expenditures']), basis: 'actual',
  })).filter((h) => h.revenue > 0 && h.spending > 0);
  const debtYear = Object.keys(t.debt).filter((y) => y <= year).sort().at(-1);
  const debt = debtYear ? Math.round(t.debt[debtYear]) : null;

  const date = `${year}-06-30`;
  const rec = t.receipts[year] || {};
  const ledger = [
    ...Object.entries(MA_REVENUE).filter(([col]) => gf.revenue[col]).flatMap(([col, [k, label]]) => {
      if (col !== 'Taxes' || !a.excise) return [{ date, flow: 'in', category: k, counterparty: 'Schedule A: general fund revenue', description: label, amount: Math.round(gf.revenue[col]), source: GF_PAGE }];
      return [
        { date, flow: 'in', category: 'propertyTax', counterparty: 'Schedule A: general fund revenue', description: 'Property tax (taxes less excises), with penalties and interest', amount: a.revenue.propertyTax || 0, source: GF_PAGE },
        ...MA_EXCISE.filter((e) => rec[e]).map((e) => ({ date, flow: 'in', category: 'salesTax', counterparty: 'Local receipts: actual', description: EXCISE_LABEL[e], amount: Math.round(rec[e]), source: RECEIPTS_PAGE })),
      ];
    }),
    ...Object.entries(MA_FUNCTION).filter(([col]) => gf.spending[col]).map(([col, [k, label]]) => ({
      date, flow: 'out', category: k === 'shared' || k === 'benefits' ? 'administration' : k, counterparty: 'Schedule A: general fund spending',
      description: `${label}${k === 'benefits' ? '; spread across departments in totals' : k === 'shared' ? '; spread across departments in totals' : ''}`,
      amount: Math.round(gf.spending[col]), source: GF_PAGE,
    })),
  ].filter((l) => l.amount).sort((x, y) => (x.flow === y.flow ? y.amount - x.amount : x.flow === 'in' ? -1 : 1));

  const hasFilers = filersByTown.has(t.name);
  const pol = haveOcpf && hasFilers ? summarizeMaReceipts(itemsByTown.get(t.name) || [], filers, pacIds, OCPF_SINCE) : null;
  const display = `${c.kind === 'City' ? 'City' : 'Town'} of ${t.name === 'Manchester By The Sea' ? 'Manchester-by-the-Sea' : t.name}`;
  const ex = a.excluded;
  return {
    id: slugify(`${display} ma`),
    name: display,
    state: 'MA',
    stateName: 'Massachusetts',
    county: counties[c.county],
    type: c.cityForm ? 'City' : 'Town',
    lat: Math.round(c.xy[0] * 1e5) / 1e5,
    lng: Math.round(c.xy[1] * 1e5) / 1e5,
    population: c.pop || 1,
    fiscalYear: Number(year),
    asOf: new Date().toISOString().slice(0, 10),
    maDorCode: code,
    censusGeoid: c.geoid,
    revenue: a.revenue,
    spending: a.spending,
    ...(debt != null ? { debt } : {}),
    ...(pol ? { influence: pol.influence, topDonors: pol.topDonors } : {}),
    reporting: {
      basis: 'Actual results',
      scope: 'General fund; includes schools',
      ...(pol ? {
        politicalPeriod: `Since ${OCPF_SINCE.slice(0, 4)}; retrieved ${new Date().toISOString().slice(0, 10)}`,
        politicalScope: c.cityForm ? 'Party committees and mayoral and city council candidates; excludes other town candidates' : 'Party committees; excludes candidate committees',
      } : {}),
    },
    history,
    ledger: [...ledger, ...(pol ? pol.ledger.slice(0, LEDGER_POLITICAL_MAX) : [])],
    sources: [
      { label: `MA Division of Local Services, Schedule A general fund revenue and expenditures, FY ${year}`, url: GF_PAGE },
      ...(a.excise ? [{ label: `MA Division of Local Services, local receipts (actual excise collections), FY ${year}`, url: RECEIPTS_PAGE }] : []),
      ...(debt != null ? [{ label: `MA Division of Local Services, total outstanding long-term debt (Schedule A Part 10), FY ${debtYear}`, url: DEBT_PAGE }] : []),
      { label: 'MA Division of Local Services, Schedule A reports (history back to 2014)', url: SCHEDULE_A },
      { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
      { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
      ...(pol ? [{ label: `MA Office of Campaign and Political Finance, receipts of ${t.name}'s party committees${c.cityForm ? ' and city candidates' : ''} since ${OCPF_SINCE.slice(0, 4)}`, url: OCPF_URL }] : []),
    ],
    notes: [
      `Actual general-fund results for the fiscal year ended June 30, ${year}, as reported to the MA Division of Local Services on Schedule A, not a budget.`,
      ...(year !== latest ? [`FY ${year} is the latest year with actual excise collections on file, which are needed to separate property tax from other local taxes. FY ${latest} totals are in the history.`] : []),
      'Includes public schools. Massachusetts cities and towns pay for their schools and their share of any regional school district through the town budget, where most other states have separate school districts, so spending and property tax per resident run higher than in those states.',
      'Covers the general fund. Water, sewer and other enterprise funds, and fire, water and other districts inside the town, are separate and not included.',
      ...(debt != null ? [`Debt is all long-term debt the town reported outstanding at the end of FY ${debtYear} (Schedule A Part 10), including school construction and any water, sewer or other enterprise fund borrowing.`] : []),
      a.excise
        ? `"Taxes" on Schedule A include motor vehicle and other local excises (${money(a.excise)}), which are shown as other local taxes. The rest, with penalties and interest, is shown as property tax.`
        : `No actual excise collections are on file for FY ${year}, so all of Schedule A "Taxes" (which include motor vehicle and other excises) is shown as property tax.`,
      ...(ex['Other Financing Sources'] || ex.Transfers ? [`Left out: transfers in from the town's own funds (${money(ex.Transfers)}) and other financing sources such as bond proceeds (${money(ex['Other Financing Sources'])}), which are not new revenue.`] : []),
      ...(a.benefitsSpread ? [`Fixed costs (${money(a.benefitsSpread)}: health insurance, pensions and other benefits for town and school staff) are spread across departments in proportion to their size, schools included, as with benefits in other states. Debt service is left out of that spread.`] : []),
      ...(a.shared ? [`Intergovernmental assessments and other spending (${money(a.shared)}: charter school tuition, regional transit and county and state charges) are spread across departments in proportion to their size.`] : []),
      ...(pol
        ? [`Political money counts contributions from unions and registered PACs to ${t.name}'s party ward, town and city committees${c.cityForm ? ' and its candidates for mayor and city council' : ''}, filed with the Office of Campaign and Political Finance since ${OCPF_SINCE.slice(0, 4)}. Corporate contributions are banned in Massachusetts. Individuals and money passed between candidate and party committees are not counted. ${c.cityForm ? 'Candidates for other offices' : 'Candidates for town office'} file with the ${c.cityForm ? 'city' : 'town'} clerk, so their own committees are not included, and party committees also support state candidates.`]
        : ['Political money is not scored: no party committee or candidate for this town files with the Office of Campaign and Political Finance, and candidates for town office file with the town clerk.']),
      'Transparency practices have not been checked yet, so they are not scored.',
    ],
  };
}

const countyKey = (n) => n.replace(/ County$/, '');
const all = Object.values(counties).map(countyKey).sort();
const pick = args.all ? all : [all.find((r) => slugify(r) === slugify(String(args.county || '')))];
if (!pick[0]) { console.error(`Usage: node scripts/ma/build-county.mjs --county <county> | --all\nCounties: ${all.join(', ')}`); process.exit(1); }
const unmatched = Object.values(dls).filter((t) => !census.has(t.name)).map((t) => t.name);
if (unmatched.length) console.error(`No Census match: ${unmatched.join(', ')}`);
const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
for (const county of pick) {
  const report = { skipped: [], mismatch: [], noTaxSplit: [], older: [], late: [] };
  const towns = Object.entries(dls).filter(([, t]) => countyKey(counties[census.get(t.name)?.county] || '') === county)
    .map(([code, t]) => buildTown(code, t, report)).filter(Boolean).sort((x, y) => x.name.localeCompare(y.name));
  const file = `ma-${slugify(county)}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
  index.files.sort();
  writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  const types = towns.reduce((m, t) => ({ ...m, [t.type]: (m[t.type] || 0) + 1 }), {});
  console.log(JSON.stringify({ county, towns: towns.length, types, ...report }));
}
