#!/usr/bin/env node
// Builds real Town Ledger records for Virginia's 95 counties, 38 independent cities and the
// towns that report to the Auditor of Public Accounts. Each county's file holds the county and
// its towns; each independent city has its own file.
//
//   node scripts/va/download.mjs && python3 scripts/va/apa-to-json.py
//   node scripts/va/fetch-elect.mjs                       # campaign finance (optional)
//   node scripts/va/build-county.mjs --county Loudoun      (or --all)
//
// Figures are actual results each locality reports to the Auditor of Public Accounts from its
// audited financial statements ("Comparative Report of Local Government Revenues and
// Expenditures").

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { aggregateVa } from './apa-map.mjs';
import { APA_PAGE, REPORTS } from './download.mjs';
import { isLocalReport, zipCounties, localityFor, summarizeVaReceipts, ELECT_PAGE, norm } from './elect-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'va');
const OUT = join(ROOT, 'data', 'real');
const APA_LIST = 'https://www.apa.virginia.gov/local-government/reports?type=comparative-reports';
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';

const args = parseArgs();
const apa = JSON.parse(readFileSync(join(RAW, 'apa.json'), 'utf8'));
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const gaz = (file, xcol) => new Map(readFileSync(join(RAW, file), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'VA').map((c) => [c[1], [Number(c[xcol]), Number(c[xcol + 1])]]));
const countyXY = gaz('2024_Gaz_counties_national.txt', 8);
const placeXY = gaz('2024_Gaz_place_national.txt', 10);

// Census geography. County equivalents: "Fairfax County", "Fairfax city" (independent city).
const geo = new Map(); // 'County|Fairfax' / 'City|Fairfax' / 'Town|Leesburg' -> info
const countyName = new Map();
for (const r of pop.filter((p) => p.sumlev === '050')) {
  const geoid = `51${r.county}`;
  const city = / city$/.test(r.name);
  const base = r.name.replace(/ (County|city)$/, '');
  const key = `${city ? 'City' : 'County'}|${base}`;
  countyName.set(geoid, city ? `${base} (independent city)` : r.name);
  geo.set(key, { key, kind: city ? 'City' : 'County', base, geoid, pop: Number(r[POP_YEAR]), xy: countyXY.get(geoid), county: countyName.get(geoid), file: slugify(r.name) });
}
// Towns: the place, in the county holding most of its people.
const townCounty = new Map();
for (const r of pop.filter((p) => p.sumlev === '157' && / town( \(pt\.\))?$/.test(p.name))) {
  const cur = townCounty.get(r.place);
  if (!cur || Number(r[POP_YEAR]) > cur.pop) townCounty.set(r.place, { county: `51${r.county}`, pop: Number(r[POP_YEAR]) });
}
for (const r of pop.filter((p) => p.sumlev === '162' && / town$/.test(p.name))) {
  const base = r.name.replace(/ town$/, '');
  const c = townCounty.get(r.place)?.county;
  geo.set(`Town|${base}`, { key: `Town|${base}`, kind: 'Town', base, geoid: `51${r.place}`, pop: Number(r[POP_YEAR]), xy: placeXY.get(`51${r.place}`), county: countyName.get(c), file: c && [...geo.values()].find((g) => g.geoid === c)?.file });
}
const findGeo = (k) => geo.get(k) || [...geo.values()].find((g) => `${g.kind}|${norm(g.base)}` === `${k.split('|')[0]}|${norm(k.split('|')[1])}`);

// Political money: local committees placed in their locality.
const LEDGER_POLITICAL_MAX = 100;
const thisYear = new Date().getFullYear();
const ELECT_SINCE = `${thisYear - 3}-01-01`;
const ELECT = join(RAW, 'elect');
const haveElect = existsSync(ELECT) && existsSync(join(RAW, 'zcta-county.txt'));
const receiptsBy = new Map();
const committeesBy = new Map();
const unplaced = new Set();
if (haveElect) {
  const zrows = readFileSync(join(RAW, 'zcta-county.txt'), 'utf8').split('\n').slice(1).map((l) => l.split('|'))
    .filter((c) => (c[9] || '').startsWith('51') && c[1]).map((c) => ({ zip: c[1], county: c[9], area: c[16] }));
  const ctx = {
    zipCounty: zipCounties(zrows),
    countyKey: new Map([...geo.values()].filter((g) => g.kind !== 'Town').map((g) => [g.geoid, g.key])),
    towns: new Map([...geo.values()].filter((g) => g.kind === 'Town').map((g) => [norm(g.base), g.key])),
    // Cities by name first, so "Fairfax" or "Richmond" in an address means the city.
    byName: new Map([...geo.values()].filter((g) => g.kind !== 'Town').sort((x) => (x.kind === 'City' ? 1 : -1)).map((g) => [norm(g.base), g.key])),
    placeCounty: new Map(pop.filter((p) => p.sumlev === '157').map((p) => [norm(p.name.replace(/ (town|city|CDP)$/, '')), `51${p.county}`])),
  };
  const committees = new Map();
  const reports = new Map();
  for (const f of readdirSync(ELECT).filter((x) => x.endsWith('-Report.csv')).sort()) {
    const t = readFileSync(join(ELECT, f), 'latin1');
    if (t.length < 1000) continue;
    for (const r of parseCSV(t)) {
      if (!isLocalReport(r)) continue;
      const loc = localityFor(r, ctx);
      if (!loc) { unplaced.add(r.committeecode); continue; }
      reports.set(r.reportid, r.committeecode);
      committees.set(r.committeecode, { loc, label: `${r.committeename.trim()} (${r.officesought.trim().replace(/^Member,? /i, '').toLowerCase()})` });
    }
  }
  for (const c of committees.values()) committeesBy.set(c.loc, (committeesBy.get(c.loc) || 0) + 1);
  for (const f of readdirSync(ELECT).filter((x) => x.endsWith('-ScheduleA.csv')).sort()) {
    const t = readFileSync(join(ELECT, f), 'latin1');
    if (t.length < 1000) continue;
    for (const r of parseCSV(t)) {
      const code = reports.get(r.reportid);
      if (!code) continue;
      const c = committees.get(code);
      r.recipient = c.label;
      (receiptsBy.get(c.loc) || receiptsBy.set(c.loc, []).get(c.loc)).push(r);
    }
  }
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

function buildLocality(key, years, report) {
  const g = findGeo(key);
  const reported = Object.keys(years).filter((y) => aggregateVa(years[y]).reported).sort();
  const year = reported.at(-1);
  const latest = Object.keys(REPORTS).sort().at(-1);
  if (!year) { report.notReported.push(key); return null; }
  if (!g || !g.xy) { report.skipped.push(`${key}: no Census match`); return null; }
  if (year !== latest) report.older.push(`${key} (FY ${year})`);
  const a = aggregateVa(years[year]);
  for (const [t, [x, z]] of Object.entries(a.check)) if (Math.abs(x - z) > 2) report.mismatch.push(`${key} ${year} ${t}: ${x} vs ${z}`);

  const history = reported.map((y) => {
    const h = aggregateVa(years[y]);
    return { year: Number(y), revenue: Object.values(h.revenue).reduce((s, v) => s + v, 0), spending: Object.values(h.spending).reduce((s, v) => s + v, 0), basis: 'actual' };
  });
  const date = `${year}-06-30`;
  const src = APA_PAGE(REPORTS[year]);
  const ledger = a.lines.filter((l) => Math.round(l.amount)).map((l) => ({
    date, flow: l.flow, category: l.key === 'shared' ? 'administration' : l.key, counterparty: `Comparative Report, Exhibit ${l.exhibit}`,
    description: `${l.label}${l.key === 'shared' ? '; spread across departments in totals' : ''}`, amount: Math.round(l.amount), source: src,
  })).sort((x, y) => (x.flow === y.flow ? y.amount - x.amount : x.flow === 'in' ? -1 : 1));

  const hasCommittees = committeesBy.has(g.key);
  const pol = haveElect && hasCommittees ? summarizeVaReceipts(receiptsBy.get(g.key) || [], ELECT_SINCE) : null;
  const display = g.kind === 'County' ? `${g.base} County` : `${g.kind} of ${g.base}`;
  const asOf = new Date().toISOString().slice(0, 10);
  const ex = a.excluded;
  const isTown = g.kind === 'Town';
  return {
    file: isTown ? g.file : g.file,
    town: {
      id: slugify(`${display} va`),
      name: display,
      state: 'VA',
      stateName: 'Virginia',
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
      ...(a.debt || years[year].G ? { debt: a.debt } : {}),
      ...(pol ? { influence: pol.influence, topDonors: pol.topDonors } : {}),
      reporting: {
        basis: 'Actual results (from audited financial statements)',
        scope: isTown ? 'General government, capital projects, debt service and enterprise funds; schools are run by the county' : 'General government, capital projects, debt service and enterprise funds; includes schools',
        ...(pol ? { politicalPeriod: `Since ${ELECT_SINCE.slice(0, 4)}; retrieved ${asOf}`, politicalScope: isTown ? 'Town council and mayoral candidates' : 'Local candidates: governing body, school board and constitutional officers' } : {}),
      },
      history,
      ledger: [...ledger, ...(pol ? pol.ledger.slice(0, LEDGER_POLITICAL_MAX) : [])],
      sources: [
        { label: `VA Auditor of Public Accounts, Comparative Report of Local Government Revenues and Expenditures, FY ${year}`, url: src },
        { label: 'VA Auditor of Public Accounts, comparative reports (history)', url: APA_LIST },
        { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
        { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
        ...(pol ? [{ label: `VA Department of Elections, receipts of ${display}'s local candidates since ${ELECT_SINCE.slice(0, 4)}`, url: ELECT_PAGE }] : []),
      ],
      notes: [
        `Actual results for the fiscal year ended June 30, ${year}, as reported to the Auditor of Public Accounts from the locality's audited financial statements, not a budget.`,
        ...(year !== latest ? [`FY ${latest} has not been reported to the Auditor yet, so FY ${year} is shown.`] : []),
        isTown
          ? `Towns sit inside counties, and town residents pay both. ${g.county} runs the schools and most other services, so the town's budget is small next to the county's.`
          : 'Includes public schools (the school division\'s operations and school construction), shown as schools and left out of the services and overhead shares, as in Connecticut and Massachusetts.',
        'Covers general government, capital projects, debt service (principal and interest) and enterprise activities such as water, sewer and electric utilities. Depreciation is left out.',
        ...(ex.debtProceeds || ex.nonRevenue ? [`Left out: borrowing (${money(ex.debtProceeds)}), non-revenue receipts (${money(ex.nonRevenue)}) and transfers between the locality's own funds.`] : []),
        ...(a.shared ? [`Non-departmental spending and capital projects other than schools and roads (${money(a.shared)}) are spread across departments in proportion to their size.`] : []),
        'Judicial administration (courts, the Commonwealth\'s attorney and clerks) and community development count as overhead.',
        ...(typeof a.debt === 'number' ? ['Debt is gross debt at year end: bonds, Literary Fund loans, other long-term obligations and temporary loans, for general government and enterprise activities.'] : []),
        ...(pol
          ? [`Political money counts contributions from businesses, unions and PACs to ${isTown ? 'candidates for town council and mayor' : 'candidates for the governing body, school board and the constitutional offices'}, filed with the Department of Elections since ${ELECT_SINCE.slice(0, 4)}. Virginia allows business contributions. Individuals and party and candidate committees are not counted. Committees are placed by their filing address, so a few may be assigned to a neighbouring locality.`]
          : ['Political money is not scored: no local candidate committee could be placed in this locality.']),
        'Transparency practices have not been checked yet, so they are not scored.',
      ],
    },
  };
}

const keys = [...new Set(Object.values(apa).flatMap((y) => Object.keys(y)))];
const built = [];
const report = { skipped: [], notReported: [], mismatch: [], older: [] };
for (const k of keys) {
  const years = Object.fromEntries(Object.entries(apa).filter(([, y]) => y[k]).map(([yr, y]) => [yr, y[k]]));
  const b = buildLocality(k, years, report);
  if (b) built.push(b);
}
const files = [...new Set(built.map((b) => b.file))].sort();
const pick = args.all ? files : files.filter((f) => f.startsWith(slugify(String(args.county || '-'))));
if (!pick.length) { console.error(`Usage: node scripts/va/build-county.mjs --county <county> | --all\nFiles: ${files.join(', ')}`); process.exit(1); }
const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
for (const f of pick) {
  const towns = built.filter((b) => b.file === f).map((b) => b.town).sort((x, y) => (x.type === y.type ? x.name.localeCompare(y.name) : x.type === 'Town' ? 1 : -1));
  const file = `va-${f}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
}
index.files.sort();
writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
const types = built.reduce((m, b) => ({ ...m, [b.town.type]: (m[b.town.type] || 0) + 1 }), {});
console.log(JSON.stringify({ files: pick.length, localities: built.length, types, unplacedCommittees: unplaced.size, ...report }, null, 1));
