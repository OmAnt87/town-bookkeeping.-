#!/usr/bin/env node
// Downloads Oklahoma Ethics Commission contribution files for the last four years (keeping candidate
// committees' rows) and each of those committees' registration page (jurisdiction and office), into
// data/raw/ok/guardian/ (gitignored).
//
//   node scripts/ok/fetch-guardian.mjs      then: node scripts/ok/build-county.mjs --all
//   node scripts/ok/fetch-guardian.mjs --committees-only      (keeps the contributions already fetched)

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCivix, fetchOrganizations } from '../common/civix.mjs';
import { GUARDIAN, GUARDIAN_FILE } from './guardian-map.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'ok', 'guardian');
const NOW = new Date().getFullYear();
mkdirSync(RAW, { recursive: true });

const committeesOnly = process.argv.includes('--committees-only') && existsSync(join(RAW, 'contributions.json'));
const kept = [];
for (let year = NOW - 3; year <= NOW && !committeesOnly; year++) {
  const zip = join(RAW, `${year}.zip`);
  execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', '-o', zip, GUARDIAN_FILE(year)], { stdio: 'inherit' });
  execFileSync('unzip', ['-o', '-q', zip, '-d', RAW], { stdio: 'inherit' });
  const file = join(RAW, `${year}_ContributionLoanExtract.csv`);
  for (const r of parseCivix(readFileSync(file, 'latin1'))) if (r['committee type'] === 'Candidate Committee') kept.push(r);
  rmSync(file);
  rmSync(zip);
}
if (!committeesOnly) {
  writeFileSync(join(RAW, 'contributions.json'), JSON.stringify(kept));
  console.log(`${kept.length} candidate committee receipts since ${NOW - 3}`);
}

const receipts = JSON.parse(readFileSync(join(RAW, 'contributions.json'), 'utf8'));
const orgs = await fetchOrganizations(GUARDIAN, receipts.map((r) => r['org id']), join(RAW, 'committees.json'), { log: console.log });
console.log(`${Object.keys(orgs).length} committees looked up. Next: node scripts/ok/build-county.mjs --all`);
