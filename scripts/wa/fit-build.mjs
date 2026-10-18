#!/usr/bin/env node
// Builds real Town Ledger records for Washington's counties, cities and towns from the annual
// reports every local government files with the State Auditor, as published in the Financial
// Intelligence Tool (see fit-map.mjs). Each county's file holds the county and the cities and
// towns whose people mostly live in it. Washington has no townships.
//
//   node scripts/wa/fit-download.mjs
//   node scripts/wa/fetch-pdc.mjs                        # campaign finance (optional)
//   node scripts/wa/fit-build.mjs --county King          (or --all)
//   node scripts/census-debt.mjs --state WA              # debt: the extracts carry none
//
// County treasurers gather every property tax in Washington, so each government's levy is its own.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { aggregateFit } from './fit-map.mjs';
import { FIT_PAGE, FIT_YEARS } from './fit-download.mjs';
import { placeJurisdiction, normPlace, summarizeWaContributions, PDC_PAGE } from './pdc-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'wa');
const OUT = join(ROOT, 'data', 'real');
const PDC = join(RAW, 'pdc', 'contributions.json');
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';
const SINCE = `${new Date().getFullYear() - 3}-01-01`;
const LEDGER_POLITICAL_MAX = 100;

const args = parseArgs();
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);
const norm = (s) => String(s).toLowerCase().replace(/\bst\.? /g, 'saint ').replace(/\bmt\.? /g, 'mount ').replace(/[^a-z0-9]/g, '');

// Census geography: counties by FIPS, cities and towns by place, in the county holding most of
// their people.
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const gaz = (file, key, xcol) => new Map(readFileSync(join(RAW, file), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'WA').map((c) => [key(c[1]), [Number(c[xcol]), Number(c[xcol + 1])]]));
const countyXY = gaz('2024_Gaz_counties_national.txt', (id) => id, 8);
const placeXY = gaz('2024_Gaz_place_national.txt', (id) => id.slice(2), 10);
const fileOf = (county) => slugify(county.replace(/ County$/, ''));

const countyName = new Map();
const geo = new Map(); // 'County|053', 'City|seattle', 'Town|winthrop'
for (const r of pop.filter((p) => p.sumlev === '050')) {
  countyName.set(r.county, r.name);
  geo.set(`County|${r.county}`, { key: `County|${r.county}`, kind: 'County', base: r.name.replace(/ County$/, ''), display: r.name, geoid: `53${r.county}`, pop: Number(r[POP_YEAR]), xy: countyXY.get(`53${r.county}`), county: r.name });
}
const placeCounty = new Map();
for (const r of pop.filter((p) => p.sumlev === '157')) {
  const cur = placeCounty.get(r.place);
  if (!cur || Number(r[POP_YEAR]) > cur.pop) placeCounty.set(r.place, { county: r.county, pop: Number(r[POP_YEAR]) });
}
for (const r of pop.filter((p) => p.sumlev === '162')) {
  const m = r.name.match(/^(.+) (city|town)$/);
  if (!m) continue;
  const kind = m[2] === 'city' ? 'City' : 'Town';
  const key = `${kind}|${norm(m[1])}`;
  geo.set(key, { key, kind, base: m[1], display: `${kind} of ${m[1]}`, geoid: `53${r.place}`, pop: Number(r[POP_YEAR]), xy: placeXY.get(r.place), county: countyName.get(placeCounty.get(r.place)?.county) });
}

// The Auditor's county code is the county's alphabetical number (1-39).
const fipsOf = (code) => String(Number(code) * 2 - 1).padStart(3, '0');
function geoKeyOf(name, type, county) {
  if (type === '06') return `County|${fipsOf(county)}`;
  const m = String(name).match(/^(City|Town) of (.+)$/);
  if (!m) return null;
  const n = norm(m[2]);
  return geo.has(`${m[1]}|${n}`) ? `${m[1]}|${n}` : geo.has(`${m[1] === 'City' ? 'Town' : 'City'}|${n}`) ? `${m[1] === 'City' ? 'Town' : 'City'}|${n}` : null;
}

const fit = JSON.parse(readFileSync(join(RAW, 'fit', 'fit.json'), 'utf8'));
const acct = (id) => fit.accounts[id]?.[0] || '';
const units = new Map();
const unmatched = [];
for (const year of FIT_YEARS) {
  for (const [mcag, g] of Object.entries(fit.years[year] || {})) {
    const name = fit.governments[mcag] || mcag;
    const key = geoKeyOf(name, g.type, g.county);
    if (!key || !geo.get(key)?.xy || !geo.get(key)?.county) { unmatched.push(name); continue; }
    const u = units.get(key) || units.set(key, { key, byYear: {} }).get(key);
    u.byYear[year] = g.rows.map(([id, fund, section, amount]) => [acct(id), fund, section, amount]);
  }
}

// Political money from the Public Disclosure Commission, placed by the jurisdiction of the office
// sought; city names that match more than one city or town are skipped.
function politics() {
  if (!existsSync(PDC)) return null;
  const counties = new Map();
  const cities = new Map();
  for (const k of units.keys()) {
    const g = geo.get(k);
    if (g.kind === 'County') counties.set(normPlace(g.base), k);
    else { const n = normPlace(g.base); cities.set(n, cities.has(n) ? null : k); }
  }
  const byKey = new Map();
  for (const r of JSON.parse(readFileSync(PDC, 'utf8'))) {
    const p = placeJurisdiction(r.jurisdiction);
    const key = !p ? null : p.level === 'county' ? counties.get(p.name) : cities.get(p.name);
    if (key) (byKey.get(key) || byKey.set(key, []).get(key)).push(r);
  }
  return new Map([...byKey].map(([k, rows]) => [k, summarizeWaContributions(rows, SINCE)]));
}
const pol = politics();
const officeText = (isCounty) => (isCounty ? 'county commissioner, council, executive, sheriff, prosecutor and other county office candidates' : 'candidates for mayor and council');

const report = { skipped: [...new Set(unmatched)], empty: [], inconsistent: [], older: [], noResidents: [], unclassified: [], refinanced: [], withPolitics: 0 };
function buildUnit(u) {
  const g = geo.get(u.key);
  if (!g.pop) { report.noResidents.push(`${g.display} (${g.county})`); return null; }
  const status = (y) => { const a = aggregateFit(u.byYear[y]); return a.empty ? 'empty' : a.inconsistent ? 'inconsistent' : 'ok'; };
  const years = Object.keys(u.byYear).sort();
  const reported = years.filter((y) => status(y) === 'ok');
  const year = reported.at(-1);
  if (!year) { report[status(years.at(-1))].push(g.display); return null; }
  const latest = FIT_YEARS.at(-1);
  if (Number(year) < latest) report.older.push(`${g.display} (FY ${year}; FY ${latest} ${u.byYear[latest] ? (status(String(latest)) === 'empty' ? 'not filled in' : 'out of balance') : 'not filed in time for the extract'})`);
  const a = aggregateFit(u.byYear[year]);
  if (a.spending.otherSpending) report.unclassified.push(g.display);
  if (a.refinanced) report.refinanced.push(`${g.display} (${money(a.refinanced)})`);
  const isCounty = g.kind === 'County';
  const kindText = g.kind.toLowerCase();
  const p = pol?.get(u.key);
  if (p) report.withPolitics++;
  const asOf = new Date().toISOString().slice(0, 10);
  const date = `${year}-12-31`;
  const ledger = a.lines.map((l) => ({
    date, flow: l.group === 'revenue' ? 'in' : 'out', category: l.key, counterparty: 'Annual report (Washington State Auditor)',
    description: l.label, amount: l.amount, source: FIT_PAGE,
  })).sort((x, y) => (x.flow === y.flow ? y.amount - x.amount : x.flow === 'in' ? -1 : 1));
  const history = reported.map((y) => { const h = aggregateFit(u.byYear[y]); return { year: Number(y), revenue: sum(h.revenue), spending: sum(h.spending), basis: 'actual' }; });
  return {
    file: fileOf(g.county),
    town: {
      id: slugify(`${g.display} wa`),
      name: g.display,
      state: 'WA',
      stateName: 'Washington',
      county: g.county,
      type: g.kind,
      lat: Math.round(g.xy[0] * 1e5) / 1e5,
      lng: Math.round(g.xy[1] * 1e5) / 1e5,
      population: g.pop,
      fiscalYear: Number(year),
      asOf,
      censusGeoid: g.geoid,
      revenue: a.revenue,
      spending: a.spending,
      ...(p ? { influence: p.influence, topDonors: p.topDonors } : {}),
      reporting: {
        basis: 'Actual results for the calendar year, from the annual report filed with the Washington State Auditor',
        scope: isCounty
          ? 'All county funds by function, including the sheriff, jail, courts, public health, human services and county roads'
          : `All ${kindText} funds by function, including water, sewer, electric and other utilities; schools are run by separate school districts`,
        ...(p ? { politicalPeriod: `Since ${SINCE.slice(0, 4)}; retrieved ${asOf}`, politicalScope: isCounty ? 'County candidates: commissioners or council, executive, sheriff, prosecutor, assessor, auditor, clerk, treasurer' : 'City and town candidates: mayor and council' } : {}),
      },
      history,
      ledger: [...ledger, ...(p ? p.ledger.slice(0, LEDGER_POLITICAL_MAX) : [])],
      sources: [
        { label: `Washington State Auditor, Financial Intelligence Tool: FY ${year} annual report data (Schedule 1)`, url: FIT_PAGE },
        { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
        { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
        ...(p ? [{ label: `Washington Public Disclosure Commission: contributions to ${g.display}'s candidates since ${SINCE.slice(0, 4)}`, url: PDC_PAGE }] : []),
      ],
      notes: [
        `Actual results for calendar year ${year}, as the ${kindText} reported them in its annual report to the Washington State Auditor. Not a budget.`,
        ...(Number(year) < latest ? [`The FY ${latest} report was ${u.byYear[latest] ? (status(String(latest)) === 'empty' ? 'not filled in' : 'out of balance (revenue and spending more than four times apart)') : 'not filed in time for the State Auditor\'s extract'}, so FY ${year} is used.`] : []),
        isCounty
          ? 'Public schools are run by separate school districts, so they are not included.'
          : `Public schools are run by separate school districts, so they are not included. Residents also pay ${g.county}.`,
        'Spending is reported by function (BARS account) for every fund, utilities included; capital expenditures count under their function when paid.',
        ...(a.leftOut.internalService ? [`Internal service funds (equipment rental, self-insurance, information technology and the like; ${money(a.leftOut.internalService)} of their revenue and spending) are left out, since the departments they serve report that spending.`] : []),
        `Borrowing, transfers between funds, interfund loans, refunded debt and depreciation are left out.${a.refinanced ? ` Debt service also leaves out ${money(a.refinanced)} of principal repaid with new borrowing the ${kindText} did not spend on capital that year, most likely refinancing.` : ''}`,
        ...(a.spending.otherSpending ? [`${money(a.spending.otherSpending)} of miscellaneous spending is more than 15% of the total, so it is shown as not broken down and the ${kindText} is not scored on services or overhead.`] : []),
        'General government, courts, legal services, planning, economic development, housing and conservation count as overhead.',
        p
          ? `Political money counts cash contributions from businesses, unions and PACs to ${officeText(isCounty)}, reported to the Public Disclosure Commission since ${SINCE.slice(0, 4)}${p.counted ? '' : ' (none were found)'}. Washington allows business and union contributions to local candidates. Individuals, candidates' own money, in-kind gifts, and party and caucus committees are not counted.`
          : pol
            ? `Political money is not scored: no ${officeText(isCounty)} of ${g.display} reported business, union or PAC contributions to the Public Disclosure Commission since ${SINCE.slice(0, 4)}.`
            : 'Political money is not scored: Public Disclosure Commission data was not loaded.',
        'Transparency practices have not been checked yet, so they are not scored.',
      ],
    },
  };
}

const built = [...units.values()].map(buildUnit).filter(Boolean);
const nameCount = new Map();
for (const b of built) nameCount.set(b.town.name, (nameCount.get(b.town.name) || 0) + 1);
for (const b of built) if (nameCount.get(b.town.name) > 1) b.town.id = slugify(`${b.town.name} ${b.town.county} wa`);

const files = [...new Set(built.map((b) => b.file))].sort();
const pick = args.all ? files : files.filter((f) => f.startsWith(slugify(String(args.county || '-'))));
if (!pick.length) { console.error(`Usage: node scripts/wa/fit-build.mjs --county <county> | --all\nFiles: ${files.join(', ')}`); process.exit(1); }
const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
for (const f of pick) {
  const towns = built.filter((b) => b.file === f).map((b) => b.town).sort((x, y) => ((x.type === 'County') === (y.type === 'County') ? x.name.localeCompare(y.name) : x.type === 'County' ? -1 : 1));
  const file = `wa-${f}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
}
index.files.sort();
writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
if (args.all) writeFileSync(join(RAW, 'fit-report.json'), `${JSON.stringify(report, null, 1)}\n`);
const types = built.reduce((m, b) => ({ ...m, [b.town.type]: (m[b.town.type] || 0) + 1 }), {});
console.log(JSON.stringify({ files: pick.length, governments: built.length, types, ...Object.fromEntries(Object.entries(report).map(([k, v]) => [k, Array.isArray(v) ? v.length : v])) }, null, 1));
