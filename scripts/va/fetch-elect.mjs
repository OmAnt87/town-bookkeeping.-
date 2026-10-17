#!/usr/bin/env node
// Caches Virginia campaign finance data from the Department of Elections' monthly bulk files
// (apps.elections.virginia.gov/SBE_CSV/CF/YYYY_MM/) into data/raw/va/elect/: each month's
// reports (committee, office sought, district, address) and itemized receipts (Schedule A),
// since January three years ago. build-county.mjs keeps local candidates' receipts.
//
//   node scripts/va/fetch-elect.mjs [--force]

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'va', 'elect');
export const ELECT_URL = 'https://apps.elections.virginia.gov/SBE_CSV/CF/';
const args = parseArgs();
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '--retry-all-errors', '-m', '900', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });

mkdirSync(DIR, { recursive: true });
const now = new Date();
const since = now.getFullYear() - 3;
for (let y = since; y <= now.getFullYear(); y++) {
  for (let m = 1; m <= 12; m++) {
    if (y === now.getFullYear() && m > now.getMonth() + 1) break;
    const ym = `${y}_${String(m).padStart(2, '0')}`;
    const current = y === now.getFullYear() && m >= now.getMonth();
    for (const f of ['Report', 'ScheduleA']) {
      const out = join(DIR, `${ym}-${f}.csv`);
      if (existsSync(out) && statSync(out).size > 1000 && !args.force && !current) continue;
      try { curl('-o', out, `${ELECT_URL}${ym}/${f}.csv`); } catch { console.log(`${ym} ${f}: not available`); continue; }
      // A month with no filings yet is a short placeholder.
      if (statSync(out).size < 1000) console.log(`${ym} ${f}: empty`);
      else console.log(`ELECT ${ym} ${f} -> ${out}`);
    }
  }
}
console.log('Done. Next: node scripts/va/build-county.mjs --all');
