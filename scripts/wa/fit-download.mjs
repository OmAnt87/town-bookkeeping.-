#!/usr/bin/env node
// Downloads the raw Washington inputs into data/raw/wa/ (gitignored):
//   - State Auditor's Financial Intelligence Tool (FIT) full extracts for fiscal years 2023-2025:
//     every local government's annual report (Schedule 1, by BARS account and fund), converted for
//     counties, cities and towns to fit/fit.json by fit-to-json.py
//   - Census 2025 population estimates for WA and the 2024 gazetteers (counties and places)
//
//   node scripts/wa/fit-download.mjs      then: node scripts/wa/fit-build.mjs --all

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, '..', '..', 'data', 'raw', 'wa');
const DIR = join(RAW, 'fit');
export const FIT_PAGE = 'https://portal.sao.wa.gov/FIT/';
export const FIT_YEARS = [2023, 2024, 2025];
const EXTRACT = (y) => `https://portal.sao.wa.gov/FIT/extracts/FullExtract(year=${y})`;
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_53.csv';
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '1800', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(DIR, { recursive: true });
  for (const y of FIT_YEARS) curl('-o', join(DIR, `${y}.xlsx`), EXTRACT(y));
  execFileSync('python3', ['-I', join(HERE, 'fit-to-json.py'), DIR, join(DIR, 'fit.json')], { stdio: 'inherit' });
  curl('-o', join(RAW, 'popest.csv'), POP);
  for (const g of ['counties', 'place']) {
    curl('-o', join(RAW, `gaz-${g}.zip`), `${GAZ}/2024_Gaz_${g}_national.zip`);
    execFileSync('unzip', ['-o', '-q', join(RAW, `gaz-${g}.zip`), '-d', RAW], { stdio: 'inherit' });
  }
  console.log('Done. Next: node scripts/wa/fit-build.mjs --all');
}
