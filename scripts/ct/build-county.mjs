#!/usr/bin/env node
// Builds real Town Ledger records for Connecticut's 169 towns (and the City of Groton),
// one planning region per file. Connecticut has no county governments; since 2022 the
// Census uses its nine planning regions as county equivalents.
//
//   node scripts/ct/download.mjs
//   node scripts/ct/fetch-seec.mjs                     # town party committee receipts (optional)
//   node scripts/ct/build-county.mjs --county Capitol   (or --all)
//
// Figures are actual general-fund results reported to the CT Office of Policy and
// Management (Municipal Fiscal Indicators), published on data.ct.gov.

import { reportingFor } from '../../js/engine/reporting.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { aggregateCt, CT_REVENUE, CT_DEPARTMENT } from './mfi-map.mjs';
import { committeeMatcher, summarizeCtReceipts, SEEC_URL } from './seec-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'ct');
const OUT = join(ROOT, 'data', 'real');
const FS_PAGE = 'https://data.ct.gov/d/d6pe-dw46';
const UCOA_PAGE = 'https://data.ct.gov/d/e2qt-k238';
const TOWN_PAGE = 'https://data.ct.gov/d/ej6f-y2wf';
const OPM_PAGE = 'https://portal.ct.gov/opm/igpp/publications/municipal-fiscal-indicators';
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';

const args = parseArgs();
const fsRows = JSON.parse(readFileSync(join(RAW, 'fs.json'), 'utf8'));
const ucoa = JSON.parse(readFileSync(join(RAW, 'ucoa.json'), 'utf8'));
const townRows = JSON.parse(readFileSync(join(RAW, 'town.json'), 'utf8'));
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const regions = Object.fromEntries(pop.filter((r) => r.sumlev === '050').map((r) => [r.county, r.name]));
const gaz = (file, xcol) => new Map(readFileSync(join(RAW, file), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'CT').map((c) => [c[1], [Number(c[xcol]), Number(c[xcol + 1])]]));
const cousubXY = gaz('2024_Gaz_cousubs_national.txt', 9);
const placeXY = gaz('2024_Gaz_place_national.txt', 10);

// Group the state's rows by town.
const byTown = new Map();
const entry = (name) => byTown.get(name) || byTown.set(name, { fs: {}, ucoa: {}, town: {} }).get(name);
for (const r of fsRows) entry(r.entity_name).fs[r.year] = r;
for (const r of ucoa) if (/^\d{4}$/.test(r.department_code)) (entry(r.entity_name).ucoa[r.year] ||= []).push(r);
for (const r of ucoa) if (r.department_code === '51') entry(r.entity_name).ucoa[`${r.year}-total`] = Number(r.total);
for (const r of townRows) entry(r.town).town[r.fiscal_year_end] = r;

// Town party committee receipts from SEEC, grouped by town (cached by fetch-seec.mjs).
const LEDGER_POLITICAL_MAX = 100;
const thisYear = new Date().getFullYear();
const SEEC_SINCE = `${thisYear - 3}-01-01`;
const seecFiles = [...Array(4)].map((_, i) => join(RAW, `seec_party_${thisYear - 3 + i}.csv`)).filter(existsSync);
const seecByTown = new Map();
if (seecFiles.length) {
  const match = committeeMatcher([...new Set(fsRows.map((r) => r.entity_name))].filter((n) => !/\(CITY\)/.test(n)));
  for (const f of seecFiles) {
    for (const r of parseCSV(readFileSync(f, 'latin1'))) {
      const town = match(r.committee);
      if (town) (seecByTown.get(town) || seecByTown.set(town, []).get(town)).push(r);
    }
  }
}

const titleCase = (s) => s.toLowerCase().replace(/(^|[\s-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

// Census geography for a town: the county subdivision from the state's own FIPS code,
// plus whether it is a consolidated city or borough (a place with the same name and no "balance of" remainder).
function censusFor(name, fsRow) {
  if (/\(CITY\)/.test(name)) {
    const base = name.replace(/\s*\(CITY\)/, '');
    const pl = pop.find((p) => p.sumlev === '162' && p.name.toLowerCase() === `${base.toLowerCase()} city`);
    const parent = pop.find((p) => p.sumlev === '061' && p.name.toLowerCase() === `${base.toLowerCase()} town`);
    return pl && { pop: Number(pl[POP_YEAR]), xy: placeXY.get(`09${pl.place}`), geoid: `09${pl.place}`, region: parent?.county, kind: 'City', base, within: titleCase(base) };
  }
  const geoid = `0${fsRow.municipality_fips_geoid}`;
  const r = pop.find((p) => p.sumlev === '061' && `09${p.county}${p.cousub}` === geoid);
  if (!r) return null;
  const base = r.name.replace(/ town$/, '');
  const parts = pop.filter((p) => p.sumlev === '071' && p.cousub === r.cousub);
  const consolidated = parts.length === 1 && parts[0].place !== '99990' && /(city|borough)$/.test(parts[0].name)
    && Number(parts[0][POP_YEAR]) === Number(r[POP_YEAR]) ? parts[0].name.match(/(city|borough)$/)[1] : null;
  return { pop: Number(r[POP_YEAR]), xy: cousubXY.get(geoid), geoid, region: r.county, kind: consolidated ? titleCase(consolidated) : 'Town', base };
}

const ucoaMatches = (t, y) => t.ucoa[y] && t.fs[y] && Math.abs(t.ucoa[`${y}-total`] - Number(t.fs[y].d_26_total_expenditures)) <= 2;

function buildTown(name, t, report) {
  const fsYears = Object.keys(t.fs).sort();
  const latest = fsYears.at(-1);
  const matched = fsYears.filter((y) => ucoaMatches(t, y)).at(-1);
  const year = matched || latest;
  const fs = t.fs[year];
  const census = censusFor(name, fs);
  if (!census || !census.xy) { report.skipped.push(`${name}: no Census match`); return null; }
  const a = aggregateCt(fs, matched ? t.ucoa[year] : null);
  if (a.unmapped.length) report.unmapped.push(`${name} ${year}: ${a.unmapped.join(', ')}`);
  if (Math.abs(a.lineTotals.revenue - a.reported.revenue) > 2 || Math.abs(a.lineTotals.spending - a.reported.spending) > 2) {
    report.mismatch.push(`${name} ${year}: revenue ${a.lineTotals.revenue} vs ${a.reported.revenue}; spending ${a.lineTotals.spending} vs ${a.reported.spending}`);
  }
  if (!matched) report.notItemized.push(`${name} (${t.ucoa[latest] ? 'department total differs' : 'no department breakdown'})`);
  else if (year !== latest) report.older.push(`${name} (${year})`);

  // History: the state's town data series (2014 on), replaced by the financial statements where both exist.
  const hist = {};
  for (const [y, r] of Object.entries(t.town)) hist[y] = { revenue: Number(r.total_revenues), spending: Number(r.total_expenditures) };
  for (const [y, r] of Object.entries(t.fs)) hist[y] = { revenue: Number(r.d_15_total_revenues), spending: Number(r.d_26_total_expenditures) };
  const history = Object.entries(hist).filter(([, h]) => h.revenue > 0 && h.spending > 0).sort(([x], [y]) => x - y)
    .map(([y, h]) => ({ year: Number(y), revenue: Math.round(h.revenue), spending: Math.round(h.spending), basis: 'actual' }));

  const debt = fs.i_4_total_long_term_bonded == null ? null : Math.round(Number(fs.i_4_total_long_term_bonded));
  const date = `${year}-06-30`;
  const ledger = [
    ...Object.entries(CT_REVENUE).filter(([c]) => Number(fs[c])).map(([c, [k, label]]) => ({
      date, flow: 'in', category: k, counterparty: 'Financial statements: revenue', description: label, amount: Math.round(Number(fs[c])), source: FS_PAGE,
    })),
    ...(matched
      ? t.ucoa[year].filter((d) => Number(d.total)).map((d) => {
        const k = CT_DEPARTMENT[d.department_code] || 'administration';
        const parts = [['salaries and wages', d.salaries_wages], ['employee benefits', d.employee_benefits], ['other', d.other]]
          .filter(([, v]) => Number(v)).map(([l, v]) => `${l} ${money(Number(v))}`).join(', ');
        return {
          date, flow: 'out', category: k === 'shared' ? 'administration' : k, counterparty: 'Uniform Chart of Accounts: spending',
          description: `${d.function_description === d.department_description ? d.department_description : `${d.function_description}: ${d.department_description}`}${parts ? ` (${parts})` : ''}${k === 'shared' ? '; spread across departments in totals' : ''}${d.department_code === '4100' && Number(d.employee_benefits) ? '; benefits spread across town departments in totals' : ''}`,
          amount: Math.round(Number(d.total)), source: UCOA_PAGE,
        };
      })
      : [['d_20_total_education', 'education', 'Education'], ['d_21_debt_service_expenditures', 'debtService', 'Debt service'], ['d_24_all_other_expenditures', 'otherSpending', 'All other spending (not broken down by department)']]
        .filter(([c]) => Number(fs[c])).map(([c, k, label]) => ({
          date, flow: 'out', category: k, counterparty: 'Financial statements: spending', description: label, amount: Math.round(Number(fs[c])), source: FS_PAGE,
        }))),
  ].sort((x, y) => (x.flow === y.flow ? y.amount - x.amount : x.flow === 'in' ? -1 : 1));

  const isCityInTown = census.kind === 'City' && census.within;
  const pol = seecFiles.length && !isCityInTown ? summarizeCtReceipts(seecByTown.get(name) || [], SEEC_SINCE) : null;
  const display = census.kind === 'Town' ? `Town of ${titleCase(census.base)}` : `${census.kind} of ${titleCase(census.base)}`;
  const ex = a.excluded;
  return {
    id: slugify(`${display} ct`),
    name: display,
    state: 'CT',
    stateName: 'Connecticut',
    county: regions[census.region],
    type: census.kind,
    lat: Math.round(census.xy[0] * 1e5) / 1e5,
    lng: Math.round(census.xy[1] * 1e5) / 1e5,
    population: census.pop || Number(t.town[year]?.population_state_dept_of_public_health) || 1,
    fiscalYear: Number(year),
    asOf: new Date().toISOString().slice(0, 10),
    ctTaxCode: fs.tax_code,
    censusGeoid: census.geoid,
    revenue: a.revenue,
    spending: a.spending,
    ...(debt != null ? { debt } : {}),
    ...(pol ? { influence: pol.influence, topDonors: pol.topDonors } : {}),
    history,
    ledger: [...ledger, ...(pol ? pol.ledger.slice(0, LEDGER_POLITICAL_MAX) : [])],
    sources: [
      { label: `CT OPM Municipal Fiscal Indicators: financial statement information, FY ${year} (revenue, spending, debt)`, url: FS_PAGE },
      ...(matched ? [{ label: `CT OPM Municipal Fiscal Indicators: Uniform Chart of Accounts, FY ${year} (spending by department)`, url: UCOA_PAGE }] : []),
      { label: 'CT OPM Municipal Fiscal Indicators: individual town data, 2014 on (history)', url: TOWN_PAGE },
      { label: 'CT OPM Municipal Fiscal Indicators (publication)', url: OPM_PAGE },
      { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
      { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
      ...(pol ? [{ label: `CT State Elections Enforcement Commission, receipts of ${display}'s party town committees since ${SEEC_SINCE.slice(0, 4)}`, url: SEEC_URL }] : []),
    ],
    notes: [
      `Actual general-fund results for the fiscal year ended June 30, ${year}, as reported to the CT Office of Policy and Management, not a budget.`,
      ...(matched && year !== latest ? [`FY ${year} is the latest year where the state's department breakdown matches the town's financial statements. FY ${latest} totals are in the history.`] : []),
      ...(!matched ? [`The state's department breakdown for FY ${year} is ${t.ucoa[year] ? `${money(t.ucoa[`${year}-total`])}, which does not match the financial statements (${money(a.reported.spending)})` : 'not available'}, so spending other than schools and debt is shown as one total and services and overhead are not scored.`] : []),
      'Includes public schools. Connecticut towns pay for schools through the town budget (the board of education and any regional school district), where most other states have separate school districts, so spending and property tax per resident run higher than in those states.',
      census.kind === 'City' && census.within
        ? `The City of ${census.within} is a separate government inside the Town of ${census.within}, which is listed separately. City residents pay taxes to both.`
        : 'Covers the town\'s general fund. Water, sewer and other enterprise funds and independent authorities are separate.',
      ...(ex.transfersIn || ex.transfersOut || ex.netOtherFinancing ? [`Left out: transfers in (${money(ex.transfersIn)}) and out (${money(ex.transfersOut)}) between the town's own funds and other financing sources such as borrowing, which are not new revenue or spending.`] : []),
      ...(a.benefitsSpread ? [`Employee benefits the town records under general government (${money(a.benefitsSpread)}, such as health insurance and pensions for town staff) are spread across the town's own departments in proportion to their size, as in other states. Schools and debt service are left out of that spread.`] : []),
      ...(a.shared ? [`Capital outlay and "other" spending (${money(a.shared)}) are spread across departments in proportion to their size.`] : []),
      'The state reports revenue only as property tax, state, federal and all other, so fees, fines and local charges are not shown separately.',
      ...(pol
        ? [`Political money counts contributions from PACs, unions, businesses (program-book ads), registered lobbyists and state contractors to ${display}'s party town committees, filed with the State Elections Enforcement Commission since ${SEEC_SINCE.slice(0, 4)}. Other individual donors (${money(pol.individuals)} in the same period) and party and candidate committees are not counted. Candidates for town office file with the town clerk, so their own committees are not included, and town committees also support state candidates.`]
        : isCityInTown
          ? [`Political money is not scored: the City of ${census.within} has no party committees of its own (the Town of ${census.within}'s are counted there), and city candidates file with the city clerk.`]
          : ['Political money is not scored: Connecticut candidates for town office file campaign reports with their town clerk, and there is no statewide database of those filings.']),
      'Transparency practices have not been checked yet, so they are not scored.',
    ],
  };
}

const regionKey = (r) => r.replace(/ Planning Region$/, '');
const names = [...byTown.keys()].filter((n) => Object.keys(byTown.get(n).fs).length);
const built = new Map();
const reports = {};
for (const n of names) {
  const fsRow = byTown.get(n).fs[Object.keys(byTown.get(n).fs).sort().at(-1)];
  const c = censusFor(n, fsRow);
  const region = c ? regionKey(regions[c.region]) : 'unknown';
  (built.get(region) || built.set(region, []).get(region)).push(n);
}
const all = Object.values(regions).map(regionKey).sort();
const pick = args.all ? all : [all.find((r) => slugify(r) === slugify(String(args.county || '')))];
if (!pick[0]) { console.error(`Usage: node scripts/ct/build-county.mjs --county <region> | --all\nRegions: ${all.join(', ')}`); process.exit(1); }
if (built.has('unknown')) console.error(`No Census match: ${built.get('unknown').join(', ')}`);
const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
for (const region of pick) {
  const report = reports[region] = { skipped: [], mismatch: [], unmapped: [], notItemized: [], older: [] };
  const towns = (built.get(region) || []).map((n) => buildTown(n, byTown.get(n), report)).filter(Boolean).sort((x, y) => x.name.localeCompare(y.name));
  const file = `ct-${slugify(region)}.json`;
  for (const town of towns) town.reporting = reportingFor(town);
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
  index.files.sort();
  writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  const types = towns.reduce((m, t) => ({ ...m, [t.type]: (m[t.type] || 0) + 1 }), {});
  console.log(JSON.stringify({ region, towns: towns.length, types, ...report }));
}
