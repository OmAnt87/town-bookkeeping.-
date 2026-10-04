#!/usr/bin/env node
// Downloads the raw Maryland inputs into data/raw/md/ (gitignored):
//   - Department of Legislative Services, "Local Government Finances in Maryland" (one PDF per
//     fiscal year): statements of revenues and expenditures and debt for every county,
//     municipality and State-created special district
//   - Census 2025 population estimates for MD places and the 2024 gazetteer (places)
//
//   node scripts/md/download.mjs [--from 2021]      then: python3 scripts/md/lgf-to-json.py

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'md');
export const LGF_PAGE = 'https://dls.maryland.gov/budget/local-finances/';
export const reportUrl = (year) => `https://dls.maryland.gov/pubs/prod/InterGovMatters/LocFinTaxRte/Local_Government_Finances_FY_${year}.pdf`;
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_24.csv';
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs();
  mkdirSync(RAW, { recursive: true });
  // Reports come out about a year and a half after the fiscal year ends.
  for (let y = Number(args.from || 2021); y <= new Date().getFullYear(); y++) {
    const out = join(RAW, `lgf-${y}.pdf`);
    if (existsSync(out) && !args.force) { console.log(`cached ${out}`); continue; }
    try { curl('-o', out, reportUrl(y)); console.log(`DLS Local Government Finances FY ${y} -> ${out}`); } catch { console.log(`FY ${y}: not published yet`); }
  }
  curl('-o', join(RAW, 'popest.csv'), POP);
  curl('-o', join(RAW, 'gaz-place.zip'), `${GAZ}/2024_Gaz_place_national.zip`);
  execFileSync('unzip', ['-o', '-q', join(RAW, 'gaz-place.zip'), '-d', RAW], { stdio: 'inherit' });
  console.log('Done. Next: pip install pdfplumber && python3 scripts/md/lgf-to-json.py');
}
