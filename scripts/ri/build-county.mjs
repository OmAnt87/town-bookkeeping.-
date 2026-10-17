#!/usr/bin/env node
// Builds real Town Ledger records for Rhode Island's 39 cities and towns, one county per file.
//
//   node scripts/ri/download.mjs
//   node scripts/ri/fetch-erts.mjs                       # campaign finance (optional)
//   node scripts/ri/build-county.mjs --county Newport    (or --all)
//
// Figures are audited actual results each city and town reports to the Division of Municipal
// Finance under the state's uniform chart of accounts (Municipal Transparency Portal).

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { aggregateRi, revenueKey, spendingKey } from './mtp-map.mjs';
import { townMatcher, localFilers, recipientTown, summarizeRiReceipts, ERTS_URL } from './erts-map.mjs';
import { MTP_PAGE } from './download.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'ri');
const OUT = join(ROOT, 'data', 'real');
const MTP_PORTAL = 'https://municipalfinance.ri.gov/municipal-transparency';
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';

const args = parseArgs();
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const counties = Object.fromEntries(pop.filter((r) => r.sumlev === '050').map((r) => [r.county, r.name]));
const cousubXY = new Map(readFileSync(join(RAW, '2024_Gaz_cousubs_national.txt'), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'RI').map((c) => [c[1], [Number(c[9]), Number(c[10])]]));

// Census county subdivision for each town ("Providence city", "Bristol town").
const census = new Map();
for (const r of pop.filter((p) => p.sumlev === '061')) {
  const m = r.name.match(/^(.+?) (city|town)$/);
  if (!m) continue;
  const geoid = `44${r.county}${r.cousub}`;
  census.set(m[1], { pop: Number(r[POP_YEAR]), xy: cousubXY.get(geoid), geoid, county: r.county, kind: m[2] === 'city' ? 'City' : 'Town' });
}
const match = townMatcher([...census.keys()]);

// Municipal Transparency Portal rows by town and fiscal year. School districts are separate entities.
const byTown = new Map();
for (const r of parseCSV(readFileSync(join(RAW, 'mtp.csv'), 'utf8'))) {
  const e = Number(r.entity);
  if (!(e >= 1010 && e <= 1390) || /school district/i.test(r.entity_description) || r.report_description !== 'Municipal Data Report') continue;
  const town = match(r.entity_description);
  if (!town) continue;
  const t = byTown.get(town) || byTown.set(town, { code: r.entity, years: {} }).get(town);
  (t.years[r.fiscal_year] ||= []).push({
    control: r.control_description, department: r.department_description, group: r.group_description,
    cls: r.class_description, account: r.account_description, amount: r.amount,
  });
}

// Political money: PAC contributions to local candidates and party city and town committees.
const LEDGER_POLITICAL_MAX = 100;
const thisYear = new Date().getFullYear();
const ERTS_SINCE = `${thisYear - 3}-01-01`;
const ERTS = join(RAW, 'erts');
const haveErts = existsSync(join(ERTS, 'filers-9.json'));
const rowsByTown = new Map();
const filersByTown = new Map();
if (haveErts) {
  const R = (f) => (existsSync(join(ERTS, f)) ? JSON.parse(readFileSync(join(ERTS, f), 'utf8')) : []);
  const filers = localFilers([8, 9, 10, 11].flatMap((c) => R(`filers-${c}.json`)), match, [1, 2, 3, 4, 5, 6, 7].flatMap((c) => R(`filers-${c}.json`)));
  for (const f of filers.values()) filersByTown.set(f.town, (filersByTown.get(f.town) || 0) + 1);
  for (const file of readdirSync(ERTS).filter((f) => /^pac-.*\.csv$/.test(f))) {
    for (const r of parseCSV(readFileSync(join(ERTS, file), 'latin1'))) {
      const recipient = recipientTown(r.organizationname, filers, match);
      if (!recipient) continue;
      r.recipient = recipient;
      (rowsByTown.get(recipient.town) || rowsByTown.set(recipient.town, []).get(recipient.town)).push(r);
    }
  }
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const sum = (rows, control) => rows.filter((r) => r.control === control).reduce((a, r) => a + (Number(r.amount) || 0), 0);

function buildTown(name, t, report) {
  const years = Object.keys(t.years).filter((y) => sum(t.years[y], 'Revenue') > 0 && sum(t.years[y], 'Expenditures') > 0).sort();
  const year = years.at(-1);
  const c = census.get(name);
  if (!year) { report.skipped.push(`${name}: no audited year on file`); return null; }
  if (!c || !c.xy) { report.skipped.push(`${name}: no Census match`); return null; }
  const rows = t.years[year];
  const a = aggregateRi(rows);
  if (a.unmapped.length) report.unmapped.push(`${name} ${year}: ${a.unmapped.join(', ')}`);
  if (Math.abs(a.lineTotals.revenue - a.reported.revenue) > 2 || Math.abs(a.lineTotals.spending - a.reported.spending) > 2) {
    report.mismatch.push(`${name} ${year}: revenue ${a.lineTotals.revenue} vs ${a.reported.revenue}; spending ${a.lineTotals.spending} vs ${a.reported.spending}`);
  }
  if (Number(year) < Number(Object.keys(byTown.get('Providence')?.years || { [year]: 1 }).sort().at(-1))) report.older.push(`${name} (FY ${year})`);

  const history = years.map((y) => ({ year: Number(y), revenue: Math.round(sum(t.years[y], 'Revenue')), spending: Math.round(sum(t.years[y], 'Expenditures')), basis: 'actual' }));

  // Ledger: revenue by account, spending by department (with its groups).
  const date = `${year}-06-30`;
  const revLines = new Map();
  const expLines = new Map();
  for (const r of rows) {
    const v = Number(r.amount) || 0;
    if (!v) continue;
    if (r.control === 'Revenue') {
      const k = `${r.cls}|${r.account}`;
      const l = revLines.get(k) || revLines.set(k, { key: revenueKey(r), label: r.cls === r.account ? r.account : `${r.cls}: ${r.account}`, amount: 0 }).get(k);
      l.amount += v;
    } else if (r.control === 'Expenditures') {
      const key = spendingKey(r);
      const label = key === 'shared' ? 'General Government: capital outlays' : key === 'benefits' && r.department === 'General Government' ? 'General Government: town-wide benefits, pensions, insurance and claims' : r.department;
      const l = expLines.get(label) || expLines.set(label, { key, groups: {}, amount: 0 }).get(label);
      l.amount += v;
      l.groups[r.group] = (l.groups[r.group] || 0) + v;
    }
  }
  const GROUP_LABEL = { Compensation: 'salaries and wages', Benefits: 'benefits', 'ADC Payments': 'pension contributions', Operations: 'operations' };
  const ledger = [
    ...[...revLines.values()].filter((l) => Math.round(l.amount)).map((l) => ({
      date, flow: 'in', category: l.key || 'otherRevenue', counterparty: 'Municipal Transparency Portal: revenue', description: l.label, amount: Math.round(l.amount), source: MTP_PAGE,
    })),
    ...[...expLines].filter(([, l]) => Math.round(l.amount)).map(([dept, l]) => {
      const parts = Object.entries(l.groups).filter(([g, v]) => Math.round(v) && GROUP_LABEL[g]).map(([g, v]) => `${GROUP_LABEL[g]} ${money(v)}`);
      return {
        date, flow: 'out', category: l.key === 'benefits' || l.key === 'shared' ? 'administration' : l.key || 'administration', counterparty: 'Municipal Transparency Portal: spending',
        description: `${dept === 'Education' ? 'Education (appropriation to the school department)' : dept === 'OPEB' ? 'Retiree health benefits (OPEB)' : dept}${parts.length > 1 ? ` (${parts.join(', ')})` : ''}${l.key === 'benefits' ? '; spread across town departments in totals' : l.key === 'shared' ? '; spread across departments in totals' : ''}`,
        amount: Math.round(l.amount), source: MTP_PAGE,
      };
    }),
  ].sort((x, y) => (x.flow === y.flow ? y.amount - x.amount : x.flow === 'in' ? -1 : 1));

  const pol = haveErts && filersByTown.has(name) ? summarizeRiReceipts(rowsByTown.get(name) || [], ERTS_SINCE) : null;
  const display = `${c.kind} of ${name}`;
  const asOf = new Date().toISOString().slice(0, 10);
  const ex = a.excluded;
  return {
    id: slugify(`${display} ri`),
    name: display,
    state: 'RI',
    stateName: 'Rhode Island',
    county: counties[c.county],
    type: c.kind,
    lat: Math.round(c.xy[0] * 1e5) / 1e5,
    lng: Math.round(c.xy[1] * 1e5) / 1e5,
    population: c.pop || 1,
    fiscalYear: Number(year),
    asOf,
    riEntityCode: t.code,
    censusGeoid: c.geoid,
    revenue: a.revenue,
    spending: a.spending,
    ...(pol ? { influence: pol.influence, topDonors: pol.topDonors } : {}),
    reporting: {
      basis: 'Actual results (audited)',
      scope: 'Municipal funds under the uniform chart of accounts; schools shown as the town appropriation',
      ...(pol ? { politicalPeriod: `Since ${ERTS_SINCE.slice(0, 4)}; retrieved ${asOf}`, politicalScope: 'Local candidates and party city and town committees; excludes filers who also ran for state office' } : {}),
    },
    history,
    ledger: [...ledger, ...(pol ? pol.ledger.slice(0, LEDGER_POLITICAL_MAX) : [])],
    sources: [
      { label: `RI Division of Municipal Finance, Municipal Transparency Portal: audited actual revenue and spending, FY ${year}`, url: MTP_PAGE },
      { label: 'RI Municipal Transparency Portal (history back to FY 2016)', url: MTP_PORTAL },
      { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
      { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
      ...(pol ? [{ label: `RI Board of Elections, PAC contributions to ${name}'s local candidates and party committees since ${ERTS_SINCE.slice(0, 4)}`, url: ERTS_URL }] : []),
    ],
    notes: [
      `Audited actual results for the fiscal year ended June 30, ${year}, as reported to the RI Division of Municipal Finance under the state's uniform chart of accounts, not a budget.`,
      `Includes the town's appropriation to its schools (${money(a.spending.education || 0)}). Rhode Island school departments and regional school districts report separately, and state school aid goes to them directly, so total school spending is higher than shown.`,
      'Fire districts, water and sewer authorities and other independent districts are separate and not included.',
      ...(ex.financingSources || ex.financingUses ? [`Left out: other financing sources such as bond proceeds and transfers in (${money(ex.financingSources)}) and transfers out (${money(ex.financingUses)}), which are not new revenue or spending.`] : []),
      ...(a.benefitsSpread ? [`Retiree health benefits (OPEB) and the benefits, pension contributions, insurance and claims the town records under general government (${money(a.benefitsSpread)} together) are spread across the town's own departments in proportion to their size, as in other states. Schools and debt service are left out of that spread.`] : []),
      ...(a.shared ? [`Capital outlays recorded under general government (${money(a.shared)}) are spread across departments in proportion to their size.`] : []),
      `Property tax is what the town collected (current and prior years' levies, interest and penalties). The FY ${year} levy was ${money(a.levy)}.`,
      'Debt outstanding is not reported to the state in a form that can be loaded, so fiscal health is not scored.',
      ...(pol
        ? [`Political money counts PAC contributions, many from unions, to candidates for ${name} offices (mayor or administrator, council, school committee and other town offices, placed by their filing address) and to ${name}'s party committees, filed with the Board of Elections since ${ERTS_SINCE.slice(0, 4)}. Corporate contributions to candidates are banned in Rhode Island. Individuals and party and candidate committee money are not counted. A filer keeps one account across offices, so local candidates who have also run for state office are left out.`]
        : ['Political money is not scored: no candidate for local office in this town files with an address that places them here.']),
      'Transparency practices have not been checked yet, so they are not scored.',
    ],
  };
}

const countyKey = (n) => n.replace(/ County$/, '');
const all = Object.values(counties).map(countyKey).sort();
const pick = args.all ? all : [all.find((r) => slugify(r) === slugify(String(args.county || '')))];
if (!pick[0]) { console.error(`Usage: node scripts/ri/build-county.mjs --county <county> | --all\nCounties: ${all.join(', ')}`); process.exit(1); }
const missing = [...census.keys()].filter((n) => !byTown.has(n));
if (missing.length) console.error(`No transparency portal data: ${missing.join(', ')}`);
const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
for (const county of pick) {
  const report = { skipped: [], mismatch: [], unmapped: [], older: [] };
  const towns = [...byTown].filter(([n]) => countyKey(counties[census.get(n)?.county] || '') === county)
    .map(([n, t]) => buildTown(n, t, report)).filter(Boolean).sort((x, y) => x.name.localeCompare(y.name));
  const file = `ri-${slugify(county)}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
  index.files.sort();
  writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  const types = towns.reduce((m, t) => ({ ...m, [t.type]: (m[t.type] || 0) + 1 }), {});
  console.log(JSON.stringify({ county, towns: towns.length, types, ...report }));
}
