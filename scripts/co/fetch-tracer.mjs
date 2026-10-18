#!/usr/bin/env node
// Downloads the Colorado Secretary of State's TRACER contribution files for the last four years and
// keeps county candidate committees' rows in data/raw/co/tracer/contributions.json (gitignored).
//
//   node scripts/co/fetch-tracer.mjs      then: node scripts/co/build-county.mjs --all

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRACER_FILE, parseTracer } from './tracer-map.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'co', 'tracer');
const NOW = new Date().getFullYear();
mkdirSync(RAW, { recursive: true });
const kept = [];
for (let year = NOW - 3; year <= NOW; year++) {
  const zip = join(RAW, `${year}.zip`);
  execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', '-o', zip, TRACER_FILE(year)], { stdio: 'inherit' });
  execFileSync('unzip', ['-o', '-q', zip, '-d', RAW], { stdio: 'inherit' });
  const file = join(RAW, `${year}_ContributionData.csv`);
  for (const r of parseTracer(readFileSync(file, 'latin1'))) {
    if (r.committeetype === 'Candidate Committee' && r.jurisdiction && r.jurisdiction !== 'STATEWIDE') kept.push(r);
  }
  rmSync(file);
}
writeFileSync(join(RAW, 'contributions.json'), JSON.stringify(kept));
console.log(`${kept.length} county-jurisdiction candidate rows -> data/raw/co/tracer/contributions.json. Next: node scripts/co/build-county.mjs --all`);
