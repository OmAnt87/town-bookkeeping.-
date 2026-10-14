#!/usr/bin/env node
// Downloads Oklahoma Ethics Commission contribution files for the last four years (keeping candidate
// committees' rows) and the Commission's export of county and municipal candidates, into
// data/raw/ok/guardian/ (gitignored). The candidate export needs Playwright.
//
//   node scripts/ok/fetch-guardian.mjs      then: node scripts/ok/build-county.mjs --all

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCivix, fetchCandidates } from '../common/civix.mjs';
import { GUARDIAN, GUARDIAN_FILE } from './guardian-map.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'ok', 'guardian');
const NOW = new Date().getFullYear();
mkdirSync(RAW, { recursive: true });

const kept = [];
for (let year = NOW - 3; year <= NOW; year++) {
  const zip = join(RAW, `${year}.zip`);
  execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', '-o', zip, GUARDIAN_FILE(year)], { stdio: 'inherit' });
  execFileSync('unzip', ['-o', '-q', zip, '-d', RAW], { stdio: 'inherit' });
  const file = join(RAW, `${year}_ContributionLoanExtract.csv`);
  for (const r of parseCivix(readFileSync(file, 'latin1'))) if (r['committee type'] === 'Candidate Committee') kept.push(r);
  rmSync(file);
  rmSync(zip);
}
writeFileSync(join(RAW, 'contributions.json'), JSON.stringify(kept));
console.log(`${kept.length} candidate committee receipts since ${NOW - 3}`);

const candidates = await fetchCandidates(GUARDIAN, { types: ['COUNTY', 'MUNICIPAL'], sinceYear: NOW - 3, log: console.log });
writeFileSync(join(RAW, 'candidates.json'), JSON.stringify(candidates));
console.log(`${candidates.length} county and municipal candidates. Next: node scripts/ok/build-county.mjs --all`);
