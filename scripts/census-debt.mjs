#!/usr/bin/env node
// Adds outstanding debt from the U.S. Census Bureau's Annual Survey of State and Local
// Government Finances individual unit files to states whose own finance data has none
// (Florida's EDR files and Rhode Island's Municipal Transparency Portal). Safe to re-run;
// run it after the state's build, then scripts/build-summary.mjs.
//
//   node scripts/census-debt.mjs --state FL,RI
//
// Debt is long-term debt outstanding (49U) plus short-term debt (64V) at the end of the
// latest fiscal year the government reported itself; years the Census estimated (imputed)
// are skipped, so a government with only estimates gets no debt.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib.mjs';
import { downloadUnits, readUnits, aggregateUnit, CENSUS_PAGE, YEARS } from './common/census-units.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw', 'census-units');
const OUT = join(ROOT, 'data', 'real');
const MARK = 'scripts/census-debt.mjs';
const NOTE = 'Debt outstanding:';
const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const base = (s) => String(s || '').toLowerCase().replace(/^(city|town|village) of /, '').replace(/ (city|town|village|county)$/, '').replace(/[^a-z0-9]+/g, ' ').trim();

const args = parseArgs();
const picked = String(args.state || '').toUpperCase().split(',').filter(Boolean);
if (!picked.length) { console.error('Usage: node scripts/census-debt.mjs --state FL,RI'); process.exit(1); }

mkdirSync(RAW, { recursive: true });
downloadUnits(RAW, (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' }));

const { files } = JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8'));
for (const st of picked) {
  const datasets = files.filter((f) => f.startsWith(`${st.toLowerCase()}-`)).map((file) => ({ file, data: JSON.parse(readFileSync(join(OUT, file), 'utf8')) }));
  const towns = datasets.flatMap((d) => d.data.towns);
  if (!towns.length) { console.warn(`${st}: no files`); continue; }
  const fips = towns[0].censusGeoid.slice(0, 2);
  const units = readUnits(RAW, fips, '123');
  // Latest year each unit reported its own debt lines: { year, fyEnd, debt, name, kind, place }.
  const best = new Map();
  for (const y of [...YEARS].sort((a, b) => b - a)) {
    for (const u of units[y].values()) {
      if (best.has(u.id)) continue;
      const debtItems = u.items.filter((i) => i.code === '49U' || i.code === '64V');
      if (!debtItems.length || debtItems.some((i) => i.flag === 'I')) continue;
      best.set(u.id, { year: y, fyEnd: u.fyEnd, debt: aggregateUnit(u.items).debt, name: u.name, kind: u.kind, place: u.place });
    }
  }
  const byPlace = new Map();
  const byName = new Map();
  for (const b of best.values()) {
    byPlace.set(`${b.kind}|${b.place}`, b);
    byName.set(`${b.kind === 'county' ? 'county' : 'local'}|${base(b.name)}`, b);
  }
  let added = 0;
  for (const t of towns) {
    t.sources = (t.sources || []).filter((s) => s.addedBy !== MARK);
    t.notes = (t.notes || []).filter((n) => !n.startsWith(NOTE));
    if (t.debtSource === MARK) { delete t.debt; delete t.debtSource; }
    if (typeof t.debt === 'number') continue; // the state's own figure wins
    const g = t.censusGeoid;
    const isCounty = g.length === 5;
    const hit = isCounty ? byPlace.get(`county|99${g.slice(2)}`)
      : g.length === 7 ? byPlace.get(`muni|${g.slice(2)}`)
        : byPlace.get(`township|${g.slice(5)}`) || byName.get(`local|${base(t.name)}`);
    if (!hit) continue;
    t.debt = hit.debt;
    t.debtSource = MARK;
    added++;
    t.sources.push({ label: `U.S. Census Bureau, Annual Survey of State and Local Government Finances, ${hit.year} individual unit file (debt outstanding)`, url: CENSUS_PAGE(hit.year), addedBy: MARK });
    t.notes = t.notes.map((n) => n.replace(/ ?Debt outstanding is not (in the EDR data|reported to the state in a form that can be loaded), so fiscal health is not scored\./, '').trim()).filter(Boolean);
    t.notes.push(`${NOTE} ${money(hit.debt)} (long-term plus short-term debt at the end of the fiscal year ending ${hit.fyEnd}), as ${t.name} reported it to the U.S. Census Bureau's ${hit.year} Annual Survey of Local Government Finances. The state's own data does not report debt.${Number(hit.fyEnd.slice(0, 4)) !== t.fiscalYear ? ` That is a different year from the revenue and spending shown (FY ${t.fiscalYear}).` : ''}`);
  }
  for (const d of datasets) writeFileSync(join(OUT, d.file), `${JSON.stringify(d.data, null, 1)}\n`);
  console.log(`${st}: debt added for ${added} of ${towns.length} governments (${towns.length - towns.filter((t) => typeof t.debt === 'number').length} still without)`);
}
