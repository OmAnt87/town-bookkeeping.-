#!/usr/bin/env node
// Builds real Town Ledger records for Massachusetts's 351 cities and towns, one county
// per file. Most Massachusetts counties no longer have a county government, but the
// Census still uses all 14 as geography.
//
//   node scripts/ma/download.mjs
//   pip install openpyxl && python3 scripts/ma/dls-to-json.py
//   node scripts/ma/build-county.mjs --county Berkshire   (or --all)
//
// Figures are actual general-fund results each city and town reports to the Division
// of Local Services on Schedule A, published in the DLS Municipal Databank.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { aggregateMa, MA_REVENUE, MA_SPENDING } from './dls-map.mjs';
import { summarizeMaReceipts, OCPF_URL } from './ocpf-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'ma');
const OUT = join(ROOT, 'data', 'real');
const SCHED_A_PAGE = 'https://dls-gw.dor.state.ma.us/reports/rdPage.aspx?rdReport=ScheduleA.GenFund_MAIN';
const DEBT_PAGE = 'https://dls-gw.dor.state.ma.us/reports/rdPage.aspx?rdReport=Dashboard.Category_6_Debt';
const LEVY_PAGE = 'https://dls-gw.dor.state.ma.us/reports/rdPage.aspx?rdReport=PropertyTaxInformation.TaxLevies.LeviesByClass';
const DATABANK_PAGE = 'https://www.mass.gov/info-details/division-of-local-services-municipal-databank';
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';

const args = parseArgs();
const dls = JSON.parse(readFileSync(join(RAW, 'dls.json'), 'utf8'));
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const counties = Object.fromEntries(pop.filter((r) => r.sumlev === '050').map((r) => [r.county, r.name]));
const cousubXY = new Map(readFileSync(join(RAW, '2024_Gaz_cousubs_national.txt'), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'MA').map((c) => [c[1], [Number(c[9]), Number(c[10])]]));

const norm = (s) => s.toLowerCase().replace(/ (town city|city|town)$/, '').replace(/[^a-z]/g, '');
const census = new Map(pop.filter((r) => r.sumlev === '061').map((r) => [norm(r.name), r]));
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

const years = (o) => Object.keys(o || {}).sort();

// OCPF receipts of each city's mayoral and council candidates (cached by fetch-ocpf.mjs).
const LEDGER_POLITICAL_MAX = 100;
const thisYear = new Date().getFullYear();
const OCPF_SINCE = `${thisYear - 3}-01-01`;
const OCPF_DIR = join(RAW, 'ocpf');
const ocpfByTown = new Map();
const ocpfLoaded = existsSync(join(OCPF_DIR, 'filers.json'));
if (ocpfLoaded) {
  for (const f of JSON.parse(readFileSync(join(OCPF_DIR, 'filers.json'), 'utf8'))) {
    const file = join(OCPF_DIR, `${f.cpfId}.json`);
    if (!existsSync(file)) continue;
    const k = norm(f.municipality);
    (ocpfByTown.get(k) || ocpfByTown.set(k, []).get(k)).push({ ...f, items: JSON.parse(readFileSync(file, 'utf8')) });
  }
}

function buildTown(code, m, report) {
  const c = census.get(norm(m.name));
  if (!c) { report.skipped.push(`${m.name}: no Census match`); return null; }
  const geoid = `25${c.county}${c.cousub}`;
  const xy = cousubXY.get(geoid);
  if (!xy) { report.skipped.push(`${m.name}: no map location`); return null; }
  const both = years(m.revenues).filter((y) => m.expenditures?.[y]);
  const year = both.at(-1);
  if (!year) { report.skipped.push(`${m.name}: no Schedule A`); return null; }
  const latestFiled = Math.max(...years(m.revenues).map(Number));
  const levy = Number(m.levies?.[year]?.['Total Levy']) || null;
  if (!levy) report.noLevy.push(`${m.name} ${year}`);
  const rev = m.revenues[year];
  const exp = m.expenditures[year];
  const a = aggregateMa(rev, exp, levy);
  if (Math.abs(a.lineTotals.revenue - a.reported.revenue) > 2 || Math.abs(a.lineTotals.spending - a.reported.spending) > 2) {
    report.mismatch.push(`${m.name} ${year}: revenue ${a.lineTotals.revenue} vs ${a.reported.revenue}; spending ${a.lineTotals.spending} vs ${a.reported.spending}`);
  }

  // Census calls a town with a city form of government "<Name> Town city"; its legal name is still the Town of <Name>.
  const kind = / city$/.test(c.name) && !/ Town city$/.test(c.name) ? 'City' : 'Town';
  const display = `${kind} of ${m.name}`;
  const excludedTotal = (y) => ['Other Financing Sources', 'Transfers'].reduce((s, k) => s + (Number(m.revenues[y]?.[k]) || 0), 0);
  const history = both.map((y) => ({
    year: Number(y),
    revenue: Math.round(Number(m.revenues[y]['Total Revenues']) - excludedTotal(y)),
    spending: Math.round(Number(m.expenditures[y]['Total Expenditures'])),
    basis: 'actual',
  })).filter((h) => h.revenue > 0 && h.spending > 0);

  const debtRow = m.debt?.[year];
  const debt = debtRow && debtRow['Total Outstanding Debt (Schedule A Part 10)'] != null ? Math.round(Number(debtRow['Total Outstanding Debt (Schedule A Part 10)'])) : null;
  const date = `${year}-06-30`;
  const taxes = Number(rev.Taxes) || 0;
  const ledger = [
    ...(a.revenue.propertyTax ? [{ date, flow: 'in', category: 'propertyTax', counterparty: 'Schedule A: revenue', description: levy ? 'Property tax (certified tax levy)' : 'Taxes (property tax, motor vehicle excise and other local taxes)', amount: a.revenue.propertyTax, source: levy ? LEVY_PAGE : SCHED_A_PAGE }] : []),
    ...(a.revenue.salesTax ? [{ date, flow: 'in', category: 'salesTax', counterparty: 'Schedule A: revenue', description: `Motor vehicle excise, local-option meals and room excises, and other taxes (Schedule A taxes of ${money(taxes)} less the property tax levy)`, amount: a.revenue.salesTax, source: SCHED_A_PAGE }] : []),
    ...Object.entries(MA_REVENUE).filter(([col]) => Number(rev[col])).map(([col, [k, label]]) => ({
      date, flow: 'in', category: k, counterparty: 'Schedule A: revenue', description: label, amount: Math.round(Number(rev[col])), source: SCHED_A_PAGE,
    })),
    ...Object.entries(MA_SPENDING).filter(([col]) => Number(exp[col])).map(([col, [k, label]]) => ({
      date, flow: 'out', category: k === 'shared' ? 'administration' : k, counterparty: 'Schedule A: spending',
      description: `${label}${k === 'shared' ? '; spread across departments in totals' : ''}`, amount: Math.round(Number(exp[col])), source: SCHED_A_PAGE,
    })),
  ].sort((x, y) => (x.flow === y.flow ? y.amount - x.amount : x.flow === 'in' ? -1 : 1));

  if (latestFiled < report.expectedYear) report.older.push(`${display} (${latestFiled})`);
  const filers = ocpfByTown.get(norm(m.name));
  const pol = filers ? summarizeMaReceipts(filers, OCPF_SINCE) : null;
  const offices = filers ? [...new Set(filers.map((f) => (f.office === 'Mayoral' ? 'mayor' : 'city council')))].join(' and ') : '';
  const ex = a.excluded;
  return {
    id: slugify(`${display} ma`),
    name: display,
    state: 'MA',
    stateName: 'Massachusetts',
    county: counties[c.county],
    type: kind,
    lat: Math.round(xy[0] * 1e5) / 1e5,
    lng: Math.round(xy[1] * 1e5) / 1e5,
    population: Number(c[POP_YEAR]) || Number(debtRow?.Population) || 1,
    fiscalYear: Number(year),
    asOf: new Date().toISOString().slice(0, 10),
    maDorCode: code,
    censusGeoid: geoid,
    revenue: a.revenue,
    spending: a.spending,
    ...(debt != null ? { debt } : {}),
    ...(pol ? { influence: pol.influence, topDonors: pol.topDonors } : {}),
    history,
    ledger: [...ledger, ...(pol ? pol.ledger.slice(0, LEDGER_POLITICAL_MAX) : [])],
    sources: [
      { label: `MA Division of Local Services, Schedule A general fund revenues and expenditures, FY ${year}`, url: SCHED_A_PAGE },
      ...(levy ? [{ label: `MA Division of Local Services, tax levies by class, FY ${year} (property tax)`, url: LEVY_PAGE }] : []),
      ...(debt != null ? [{ label: `MA Division of Local Services, municipal debt (Schedule A Part 10), FY ${year}`, url: DEBT_PAGE }] : []),
      { label: 'MA Division of Local Services Municipal Databank', url: DATABANK_PAGE },
      ...(pol ? [{ label: `MA Office of Campaign and Political Finance, receipts of ${display}'s candidates for ${offices} since ${OCPF_SINCE.slice(0, 4)}`, url: OCPF_URL }] : []),
      { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
      { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
    ],
    notes: [
      `Actual general-fund results for the fiscal year ended June 30, ${year}, as reported to the MA Division of Local Services on Schedule A, not a budget.`,
      ...(latestFiled > Number(year) ? [`FY ${latestFiled} revenue is filed but its spending is not yet, so FY ${year} is shown.`] : []),
      'Includes public schools. Massachusetts cities and towns pay for their schools, and their share of any regional school district, from the general fund, where many other states have separate school districts, so spending and property tax per resident run higher than in those states. Schools are left out of the services and overhead shares.',
      'Intergovernmental assessments are state and county charges deducted from state aid, mostly charter school tuition and school choice, plus transit and county charges. They are counted with schools.',
      `Fixed costs (${money(a.fixedCosts)}: health insurance, pensions and other benefits, including for school staff)${a.shared > a.fixedCosts ? ` and other expenditures (${money(a.shared - a.fixedCosts)})` : ''} are spread across departments, including schools, in proportion to their size. Debt service is left out of that spread.`,
      levy
        ? `Property tax is the certified tax levy (${money(levy)}). The rest of the taxes on Schedule A (${money(taxes - a.revenue.propertyTax)}) is shown as other taxes and excises: motor vehicle excise, local-option meals and room excises, and penalties and interest. Taxes collected in a year can differ slightly from the levy, so this split is close but not exact.`
        : 'No certified tax levy was found for this year, so all Schedule A taxes are shown as property tax, including motor vehicle excise and local-option excises.',
      'Covers the general fund. Water, sewer and other enterprise funds, and regional school districts and other separate authorities, are not included.',
      ...(ex['Other Financing Sources'] || ex.Transfers ? [`Left out: other financing sources such as bond proceeds (${money(ex['Other Financing Sources'])}) and transfers from the town's own funds (${money(ex.Transfers)}), which are not new revenue.`] : []),
      pol
        ? `Political money counts contributions from PACs and unions to ${pol.candidates} candidate${pol.candidates === 1 ? '' : 's'} for ${offices} who file with the MA Office of Campaign and Political Finance, since ${OCPF_SINCE.slice(0, 4)}. Business and corporate contributions to candidates are banned in Massachusetts. Individual donors (${money(pol.individuals)} in the same period) and party and candidate committees are not counted.${offices === 'mayor' ? ' City council candidates here file with the city clerk, so their money is not included.' : ''}`
        : ocpfLoaded
          ? 'Political money is not scored: candidates for office here file campaign reports with the city or town clerk, not the state. Only candidates for mayor, and for city council in some cities, file itemized reports with the MA Office of Campaign and Political Finance.'
          : 'Political money has not been loaded for Massachusetts yet, so it is not scored.',
    ],
  };
}

const all = [...new Set(Object.values(counties))].map((n) => n.replace(/ County$/, '')).sort();
const pick = args.all ? all : [all.find((n) => slugify(n) === slugify(String(args.county || '')))];
if (!pick[0]) { console.error(`Usage: node scripts/ma/build-county.mjs --county <name> | --all\nCounties: ${all.join(', ')}`); process.exit(1); }

// The latest year most cities and towns have filed; anyone behind it is a late filer.
const latestCounts = {};
for (const m of Object.values(dls)) if (m.revenues) { const y = Math.max(...years(m.revenues).map(Number)); latestCounts[y] = (latestCounts[y] || 0) + 1; }
const expectedYear = Number(Object.entries(latestCounts).sort((x, y) => y[1] - x[1])[0][0]);

const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
for (const county of pick) {
  const report = { expectedYear, skipped: [], mismatch: [], noLevy: [], older: [] };
  const codes = Object.keys(dls).filter((code) => dls[code].revenues && counties[census.get(norm(dls[code].name))?.county] === `${county} County`);
  const towns = codes.map((code) => buildTown(code, dls[code], report)).filter(Boolean).sort((x, y) => x.name.localeCompare(y.name));
  const file = `ma-${slugify(county)}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
  index.files.sort();
  writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  const types = towns.reduce((m, t) => ({ ...m, [t.type]: (m[t.type] || 0) + 1 }), {});
  console.log(JSON.stringify({ county, towns: towns.length, types, ...report }));
}
