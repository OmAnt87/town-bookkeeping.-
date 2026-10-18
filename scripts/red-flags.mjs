#!/usr/bin/env node
// Adds surveillance red flags from the EFF Atlas of Surveillance to every real
// town and county outside New Jersey (scripts/nj/red-flags.mjs handles NJ, where it also maps
// license-plate cameras and hand-checked corporate deals). Safe to re-run: it
// replaces what an earlier run added. Re-run after any build-county/build-state run.
//
//   node scripts/red-flags.mjs --download      # Atlas of Surveillance CSV
//   node scripts/red-flags.mjs                 # apply, then run scripts/build-summary.mjs
//   node scripts/red-flags.mjs --verbose       # also list agencies that matched no town
//   node scripts/red-flags.mjs --state MA,TN    # only these states
//
// Municipal police agencies are matched by name within the town's county (or statewide
// when the name is unique and the county is not one the state's towns use). County
// agencies (sheriffs, county police) are matched to county records where a state lists them.
// Ambiguous names are skipped, not guessed.

import { readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib.mjs';
import { parseCSVRows, ATLAS_LABELS, ATLAS_URL, ATLAS_PAGE, atlasLink, agencyTown, usDate } from './common/atlas.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw', 'atlas');
const OUT = join(ROOT, 'data', 'real');
const MARK = 'scripts/red-flags.mjs';
const STATEWIDE = /\bstatewide contract\b/i;
const args = parseArgs();

if (args.download) {
  mkdirSync(RAW, { recursive: true });
  execFileSync('curl', ['-sSfL', '-m', '300', '-A', 'Mozilla/5.0', '-o', join(RAW, 'atlas.csv'), ATLAS_URL], { stdio: 'inherit' });
  console.log('Downloaded. Now run: node scripts/red-flags.mjs');
  process.exit(0);
}
const atlasFile = join(RAW, 'atlas.csv');
if (!existsSync(atlasFile)) { console.error('Missing data/raw/atlas/atlas.csv. Run: node scripts/red-flags.mjs --download'); process.exit(1); }
// The day the Atlas was downloaded, so re-running on a later day does not restamp every town.
const SEARCHED = statSync(atlasFile).mtime.toISOString().slice(0, 10);

const KIND = /\b(charter township|township|borough|city|town|village|plantation)\b/i;
const norm = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/\bst\.?\s/g, 'saint ').replace(/\bmt\.?\s/g, 'mount ')
  .replace(/\bft\.?\s/g, 'fort ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
// "City of Akron" / "Adams Township" -> "akron" / "adams"
const baseName = (name) => norm(String(name)
  .replace(/^(city and county|city and borough|city|town|village|borough|township|municipality) of (the )?/i, '')
  .replace(/^(metro|metropolitan) /i, '')
  .replace(/\s+(metro|metro government|urban county)$/i, '')
  .replace(/\s+(charter township|township|borough|city|town|village|plantation)$/i, ''));
// Consolidated city-counties ("Metro Nashville-Davidson County", "Butte-Silver Bow") also
// answer to the city's own name, which is what their police departments use.
const aliases = (t) => {
  const b = baseName(t.name);
  const city = /-/.test(t.name) && /county|metro|borough|bow|lodge/i.test(t.name) ? [norm(baseName(t.name).split(' ')[0])] : [];
  return [b, ...city];
};
const countyKey = (c) => norm(String(c || '').replace(/\s+(county|parish|borough|census area|city and borough|municipality|planning region)$/i, ''));

const index = JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8'));
// --state NY,MA limits a run to those states' files (default: every state but NJ).
const only = args.state ? new Set(String(args.state).toLowerCase().split(',')) : null;
const datasets = index.files.filter((f) => !f.startsWith('nj-') && (!only || only.has(f.slice(0, 2))))
  .map((f) => ({ file: f, data: JSON.parse(readFileSync(join(OUT, f), 'utf8')) }));
const towns = datasets.flatMap((d) => d.data.towns);
const byState = new Map();
const countiesByState = new Map();
for (const t of towns) {
  if (t.type === 'County') {
    if (!countiesByState.has(t.state)) countiesByState.set(t.state, new Map());
    countiesByState.get(t.state).set(countyKey(t.name), t);
    continue;
  }
  if (!byState.has(t.state)) byState.set(t.state, []);
  byState.get(t.state).push({ t, bases: aliases(t), county: countyKey(t.county), kind: t.type.toLowerCase() });
}

// Previous runs' additions are cleared first, so re-running never doubles up.
for (const t of towns) {
  t.redFlags = (t.redFlags || []).filter((f) => f.addedBy !== MARK);
  t.sources = (t.sources || []).filter((s) => s.addedBy !== MARK);
  t.notes = (t.notes || []).filter((n) => !n.startsWith('Red flags:'));
}

function matchCounty(row) {
  return { town: countiesByState.get(row.State)?.get(countyKey(row.County)) || null };
}

function matchTown(row) {
  const pool = byState.get(row.State);
  if (!pool) return { town: null };
  const agency = agencyTown(row.Agency);
  const kind = agency.match(KIND)?.[1]?.toLowerCase().replace('charter township', 'township');
  const names = [...new Set([baseName(agency), baseName(row.City)].filter(Boolean))];
  const county = countyKey(row.County);
  for (const n of names) {
    const same = pool.filter((p) => p.bases.includes(n));
    if (!same.length) continue;
    const pick = (list) => {
      const typed = kind ? list.filter((p) => p.kind === kind) : list;
      if (typed.length === 1) return typed[0];
      // "Springfield Police Department" with both a city and a township of that name: prefer
      // the city or village that runs a police department when the other is a township.
      const notTwp = !kind ? typed.filter((p) => p.kind !== 'township') : [];
      return notTwp.length === 1 ? notTwp[0] : null;
    };
    // Statewide only when the Atlas county isn't one the state's towns use (Connecticut's
    // planning regions, Virginia's independent cities); otherwise a missing town could
    // be matched to a namesake elsewhere in the state.
    const knownCounty = pool.some((p) => p.county === county);
    const hit = pick(knownCounty ? same.filter((p) => p.county === county) : same);
    if (hit) return { town: hit.t };
    if (knownCounty && !same.some((p) => p.county === county)) continue;
    return { town: null, ambiguous: true };
  }
  return { town: null };
}

const rows = parseCSVRows(readFileSync(atlasFile, 'utf8'))
  .filter((r) => r.State !== 'NJ' && ATLAS_LABELS[r.Technology]
    && ((r['Type of Juris'] === 'Municipal' && byState.has(r.State)) || (r['Type of Juris'] === 'County' && countiesByState.has(r.State))));
const report = { matched: 0, unmatched: [], ambiguous: [] };
for (const r of rows) {
  const { town, ambiguous } = r['Type of Juris'] === 'County' ? matchCounty(r) : matchTown(r);
  if (!town) { (ambiguous ? report.ambiguous : report.unmatched).push(`${r.Agency} (${r.County}, ${r.State})`); continue; }
  report.matched++;
  town.redFlags.push({
    kind: 'surveillance',
    label: ATLAS_LABELS[r.Technology],
    vendor: r.Vendor || '',
    agency: r.Agency,
    date: usDate(r['Link 1 Date']),
    detail: r.Summary,
    source: { label: `EFF Atlas of Surveillance ${r.AOSNUMBER}${r['Link 1 Source'] ? `, citing ${r['Link 1 Source']}` : ''}`, url: atlasLink(r) },
    // Access every department in the state gets through a state contract (such as
    // Massachusetts's CrimeTracer contract) is shown but not scored: the town didn't choose it.
    ...(STATEWIDE.test(r.Summary) ? { scored: false, unscoredReason: 'Not scored: every police department in the state has this through a statewide contract, so it is not a local decision.' } : {}),
    addedBy: MARK,
  });
}

for (const t of towns) {
  t.redFlags.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  t.sources.push({ label: 'EFF Atlas of Surveillance (police surveillance technology, searched by department)', url: ATLAS_PAGE, addedBy: MARK });
  t.notes.push(`Red flags: surveillance programs come from the EFF Atlas of Surveillance, a public database of news reports and public records, searched on ${SEARCHED}. A town or county with none listed may still have programs nobody has reported. ${t.notes.some((n) => n.startsWith('Cameras:')) ? 'Data center deals and corporate tax breaks' : 'Data center deals, corporate tax breaks and license-plate cameras mapped by volunteers'} have not been checked for ${t.stateName} yet. Most records carry no dollar amount, so each documented program costs a quarter of the red-flag points instead of being counted as spending.`);
}
for (const d of datasets) writeFileSync(join(OUT, d.file), `${JSON.stringify(d.data, null, 1)}\n`);

const flagged = towns.filter((t) => t.redFlags.some((f) => f.scored !== false)).length;
console.log(`Atlas municipal and county records outside NJ for loaded states: ${rows.length}; matched ${report.matched}, ambiguous ${report.ambiguous.length}, unmatched ${report.unmatched.length}`);
console.log(`Towns with at least one scored red flag: ${flagged} of ${towns.length}`);
if (args.verbose) console.log(`Ambiguous:\n  ${report.ambiguous.join('\n  ')}\nUnmatched:\n  ${report.unmatched.join('\n  ')}`);
