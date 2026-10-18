#!/usr/bin/env node
// Builds real Town Ledger records for Ohio's counties, cities, villages and townships from the
// annual financial reports every public office files with the Auditor of State, as published in
// the Auditor's Summarized Annual Financial Reports (see aos-map.mjs). Each county's file holds
// the county and the governments whose people mostly live in it.
//
//   node scripts/oh/aos-download.mjs
//   node scripts/oh/aos-build.mjs --county Franklin      (or --all)
//
// County treasurers collect every property tax in Ohio, so each government's levy is its own.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { aggregateAos } from './aos-map.mjs';
import { AOS_PAGE, AOS_YEARS, BASES } from './aos-download.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'oh');
const OUT = join(ROOT, 'data', 'real');
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';

const args = parseArgs();
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);
const norm = (s) => String(s).toLowerCase().replace(/^village of city of /, 'city of ')
  .replace(/^(city|village|township) of /, '').replace(/ (city|village|township|county)$/, '')
  .replace(/\bst\.? /g, 'saint ').replace(/\bmt\.? /g, 'mount ').replace(/[^a-z0-9]/g, '');

// Census geography, keyed as in the Census build so ids and Census codes carry over: townships by
// county subdivision; cities and villages by the county subdivision that is the municipality
// (when it holds most of its people) or else by place.
const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
const gaz = (file, key, xcol) => new Map(readFileSync(join(RAW, file), 'utf8').split('\n').slice(1)
  .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === 'OH').map((c) => [key(c[1]), [Number(c[xcol]), Number(c[xcol + 1])]]));
const countyXY = gaz('2024_Gaz_counties_national.txt', (id) => id, 8);
const cousubXY = gaz('2024_Gaz_cousubs_national.txt', (id) => id.slice(2), 9);
const placeXY = gaz('2024_Gaz_place_national.txt', (id) => id.slice(2), 10);
const fileOf = (county) => slugify(county.replace(/ County$/, ''));
const KINDS = { city: 'City', village: 'Village', township: 'Township' };
const displayName = (kind, base) => (kind === 'Township' ? `${base} Township` : `${kind} of ${base.replace(/^Village of /, '')}`);

// Census names with a second name in parentheses ("Hartford (Croton)") or a "New" the Auditor
// leaves off ("New Matamoras") are found under each form.
const variants = (base) => {
  const b = base.replace(/^Village of /, '');
  const out = new Set([norm(b), norm(b.replace(/\s*\(.*\)/, ''))]);
  const inner = b.match(/\((.+)\)/);
  if (inner) out.add(norm(inner[1]));
  if (/^New /.test(b)) out.add(norm(b.replace(/^New /, '')));
  return [...out];
};
const countyName = new Map();
const countyByName = new Map();
const geo = new Map();
for (const r of pop.filter((p) => p.sumlev === '050')) {
  countyName.set(r.county, r.name);
  countyByName.set(norm(r.name), r.county);
  geo.set(`County|${r.county}`, { kind: 'County', display: r.name, geoid: `39${r.county}`, pop: Number(r[POP_YEAR]), xy: countyXY.get(`39${r.county}`), county: r.name });
}
const townships = new Map(); // 'county|name' -> cousub key
const cousubMuni = new Map(); // 'Kind|name' -> cousub key (largest part)
for (const r of pop.filter((p) => p.sumlev === '061')) {
  const m = r.name.match(/^(.+?) (city|village|township)$/);
  if (!m) continue;
  const kind = KINDS[m[2]];
  const key = `Cousub|${r.county}${r.cousub}`;
  geo.set(key, { kind, display: displayName(kind, m[1]), geoid: `39${r.county}${r.cousub}`, pop: Number(r[POP_YEAR]), xy: cousubXY.get(`${r.county}${r.cousub}`), county: countyName.get(r.county) });
  if (kind === 'Township') townships.set(`${r.county}|${norm(m[1])}`, key);
  else {
    for (const v of variants(m[1])) {
      const k = `${kind}|${v}`;
      if (!cousubMuni.has(k) || geo.get(cousubMuni.get(k)).pop < Number(r[POP_YEAR])) cousubMuni.set(k, key);
    }
  }
}
const placeCounty = new Map();
for (const r of pop.filter((p) => p.sumlev === '157')) {
  const cur = placeCounty.get(r.place);
  if (!cur || Number(r[POP_YEAR]) > cur.pop) placeCounty.set(r.place, { county: r.county, pop: Number(r[POP_YEAR]) });
}
const places = new Map(); // 'Kind|name' -> [place keys]
for (const r of pop.filter((p) => p.sumlev === '162')) {
  const m = r.name.match(/^(.+?) (city|village)$/);
  if (!m) continue;
  const kind = KINDS[m[2]];
  const key = `Place|${r.place}`;
  geo.set(key, { kind, display: displayName(kind, m[1]), geoid: `39${r.place}`, pop: Number(r[POP_YEAR]), xy: placeXY.get(r.place), county: countyName.get(placeCounty.get(r.place)?.county), countyFips: placeCounty.get(r.place)?.county });
  for (const v of variants(m[1])) { const k = `${kind}|${v}`; (places.get(k) || places.set(k, []).get(k)).push(key); }
}

function geoKeyOf(type, name, county) {
  const fips = countyByName.get(norm(county));
  if (type === 'County') return `County|${countyByName.get(norm(name))}`;
  if (type === 'Township') return townships.get(`${fips}|${norm(name)}`) || null;
  const kind = type;
  const n = norm(name);
  // A municipality that changed between city and village since the Census is found either way.
  for (const k of [kind, kind === 'City' ? 'Village' : 'City']) {
    const candidates = places.get(`${k}|${n}`) || [];
    const place = candidates.length === 1 ? candidates[0] : candidates.find((p) => geo.get(p).countyFips === fips) || null;
    const cousub = cousubMuni.get(`${k}|${n}`);
    if (!place && !cousub) continue;
    // Two municipalities can share a normalized name (Valley View and Valleyview): the county decides.
    const cousubHere = cousub && (candidates.length <= 1 || geo.get(cousub).county === countyName.get(fips));
    if (cousubHere && (!place || geo.get(cousub).pop >= geo.get(place).pop)) return cousub;
    return place || cousub;
  }
  return null;
}

const aos = JSON.parse(readFileSync(join(RAW, 'aos', 'aos.json'), 'utf8'));
const units = new Map();
const unmatched = [];
for (const year of AOS_YEARS) {
  for (const type of ['County', 'City', 'Village', 'Township']) {
    for (const basis of BASES) {
      const book = aos[`${type}_${year}_${basis}`];
      if (!book) continue;
      for (const [entity, gov] of Object.entries(book.gov)) {
        const [name, county] = entity.split('|');
        const key = geoKeyOf(type, name, county);
        if (!key || !geo.get(key)?.xy || !geo.get(key)?.county) { unmatched.push(`${name} (${county} County)`); continue; }
        const u = units.get(key) || units.set(key, { key, byYear: {} }).get(key);
        if (u.byYear[year]) continue; // one report per year; bases are read in order of preference
        u.byYear[year] = { gov, ent: book.ent[entity] || [], debt: book.debt[entity] || [], basis };
      }
    }
  }
}

const BASIS_TEXT = { REG: 'regulatory cash basis', CASH: 'cash basis', MOD: 'modified cash basis', GAAP: 'GAAP (modified accrual for governmental funds)' };
const aggregate = (y) => aggregateAos(y.gov, y.ent, y.debt);
const report = { skipped: [...new Set(unmatched)], empty: [], inconsistent: [], older: [], noResidents: [], unclassified: [], refinanced: [], remainder: [] };
function buildUnit(u) {
  const g = geo.get(u.key);
  if (!g.pop) { report.noResidents.push(`${g.display} (${g.county})`); return null; }
  const status = (y) => { const a = aggregate(u.byYear[y]); return a.empty ? 'empty' : a.inconsistent ? 'inconsistent' : 'ok'; };
  const years = Object.keys(u.byYear).sort();
  const reported = years.filter((y) => status(y) === 'ok');
  const year = reported.at(-1);
  if (!year) { report[status(years.at(-1))].push(g.display); return null; }
  const latest = AOS_YEARS.at(-1);
  if (Number(year) < latest) report.older.push(`${g.display} (${year}; ${latest} ${u.byYear[latest] ? (status(String(latest)) === 'empty' ? 'not filled in' : 'out of balance') : 'not yet filed'})`);
  const y = u.byYear[year];
  const a = aggregate(y);
  if (a.spending.otherSpending) report.unclassified.push(g.display);
  if (a.refinanced) report.refinanced.push(`${g.display} (${money(a.refinanced)})`);
  if (a.lines.some((l) => l.label.includes('not itemized'))) report.remainder.push(g.display);
  const isCounty = g.kind === 'County';
  const kindText = isCounty ? 'county' : g.kind.toLowerCase();
  const date = `${year}-12-31`;
  const ledger = a.lines.map((l) => ({
    date, flow: l.group === 'revenue' ? 'in' : 'out', category: l.key, counterparty: 'Annual financial report (Ohio Auditor of State)',
    description: l.label, amount: l.amount, source: AOS_PAGE,
  })).sort((p, q) => (p.flow === q.flow ? q.amount - p.amount : p.flow === 'in' ? -1 : 1));
  const history = reported.map((h) => { const x = aggregate(u.byYear[h]); return { year: Number(h), revenue: sum(x.revenue), spending: sum(x.spending), basis: 'actual' }; });
  return {
    file: fileOf(g.county),
    town: {
      id: slugify(`${g.display} oh`),
      name: g.display,
      state: 'OH',
      stateName: 'Ohio',
      county: g.county,
      type: g.kind,
      lat: Math.round(g.xy[0] * 1e5) / 1e5,
      lng: Math.round(g.xy[1] * 1e5) / 1e5,
      population: g.pop,
      fiscalYear: Number(year),
      asOf: new Date().toISOString().slice(0, 10),
      censusGeoid: g.geoid,
      revenue: a.revenue,
      spending: a.spending,
      ...(a.debt !== null ? { debt: a.debt } : {}),
      reporting: {
        basis: `Actual results for the calendar year (${BASIS_TEXT[y.basis]}), from the annual financial report filed with the Ohio Auditor of State`,
        scope: isCounty
          ? 'County governmental funds by function, including the sheriff, jail, courts, human services and county roads, plus county water, sewer and landfill funds'
          : `All ${kindText} governmental funds by function${g.kind === 'Township' ? '' : ', plus water, sewer, electric and other utility funds'}; schools are run by separate school districts`,
      },
      history,
      ledger,
      sources: [
        { label: `Ohio Auditor of State, Summarized Annual Financial Reports: ${g.kind} ${year} (${BASIS_TEXT[y.basis]}), unaudited`, url: AOS_PAGE },
        { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
        { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
      ],
      notes: [
        `Actual results for calendar year ${year}, as the ${kindText} reported them in its annual financial report to the Ohio Auditor of State (unaudited). Not a budget.`,
        ...(Number(year) < latest ? [`The ${latest} report was ${u.byYear[latest] ? (status(String(latest)) === 'empty' ? 'not filled in' : 'out of balance (revenue and spending more than four times apart)') : 'not yet filed with the Auditor of State'}, so ${year} is used.`] : []),
        isCounty
          ? 'Public schools are run by separate school districts with their own taxes, so they are not included.'
          : `Public schools are run by separate school districts with their own taxes, so they are not included. Residents also pay ${g.county}${g.kind === 'Township' ? '' : ' and, unless the municipality has left it, the surrounding township'}.`,
        ...(g.kind === 'Township' ? ['A township serves the parts of it outside cities, and in most cases also the villages inside it.'] : []),
        ...(g.kind !== 'Township' && !isCounty ? ['Most Ohio cities and villages levy a municipal income tax, which is counted with other local taxes.'] : []),
        'Governmental funds are reported by function. Capital outlay has no function, so it is spread over the other spending in proportion. Utility funds count operating revenue and expenses (depreciation left out) plus nonoperating revenue and debt payments.',
        `Intergovernmental disbursements, payments to refunded bond escrow agents, borrowing, transfers, advances, sales of capital assets and special or extraordinary items are left out.${a.refinanced ? ` Debt service also leaves out ${money(a.refinanced)} of principal repaid with new borrowing the ${kindText} did not spend on capital that year, most likely notes rolled over.` : ''}`,
        ...(a.lines.some((l) => l.label.includes('not itemized')) ? ['Part of the reported total receipts or disbursements is not broken down in the Auditor of State\'s summary; that part is shown as other receipts or disbursements.'] : []),
        ...(a.spending.otherSpending ? [`${money(a.spending.otherSpending)} of other spending is more than 15% of the total, so it is shown as not broken down and the ${kindText} is not scored on services or overhead.`] : []),
        'General government, courts, community and economic development and community environment count as overhead.',
        a.debt !== null ? 'Debt is long-term obligations at year end (bonds, notes, loans and leases), as reported.' : 'Long-term obligations were not reported, so debt is not scored.',
        `Political money is not scored: Ohio ${isCounty ? 'county' : 'local'} candidates file campaign finance reports with their county board of elections, not with the state.`,
        'Transparency practices have not been checked yet, so they are not scored.',
      ],
    },
  };
}

const built = [...units.values()].map(buildUnit).filter(Boolean);
const nameCount = new Map();
for (const b of built) nameCount.set(b.town.name, (nameCount.get(b.town.name) || 0) + 1);
for (const b of built) if (nameCount.get(b.town.name) > 1) b.town.id = slugify(`${b.town.name} ${b.town.county} oh`);

const files = [...new Set(built.map((b) => b.file))].sort();
const pick = args.all ? files : files.filter((f) => f.startsWith(slugify(String(args.county || '-'))));
if (!pick.length) { console.error(`Usage: node scripts/oh/aos-build.mjs --county <county> | --all\nFiles: ${files.join(', ')}`); process.exit(1); }
const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
mkdirSync(OUT, { recursive: true });
for (const f of pick) {
  const towns = built.filter((b) => b.file === f).map((b) => b.town).sort((x, y) => ((x.type === 'County') === (y.type === 'County') ? x.name.localeCompare(y.name) : x.type === 'County' ? -1 : 1));
  const file = `oh-${f}.json`;
  writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
  if (!index.files.includes(file)) index.files.push(file);
}
index.files.sort();
writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
if (args.all) writeFileSync(join(RAW, 'aos-report.json'), `${JSON.stringify(report, null, 1)}\n`);
const types = built.reduce((m, b) => ({ ...m, [b.town.type]: (m[b.town.type] || 0) + 1 }), {});
console.log(JSON.stringify({ files: pick.length, governments: built.length, types, ...Object.fromEntries(Object.entries(report).map(([k, v]) => [k, v.length])) }, null, 1));
