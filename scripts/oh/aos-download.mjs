#!/usr/bin/env node
// Downloads the raw Ohio inputs into data/raw/oh/ (gitignored):
//   - the Auditor of State's Summarized Annual Financial Reports: one workbook per entity type
//     (township, village, city, county), year and basis of accounting, compiled from the
//     unaudited annual financial reports every public office files through the Hinkle System,
//     fiscal years 2023-2025, converted to aos/aos.json by aos-to-json.py
//   - Census 2025 population estimates for OH and the 2024 gazetteers (counties, places and
//     county subdivisions)
//
//   node scripts/oh/aos-download.mjs      then: node scripts/oh/aos-build.mjs --all

import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, '..', '..', 'data', 'raw', 'oh');
const DIR = join(RAW, 'aos');
export const AOS_PAGE = 'https://www.ohioauditor.gov/references/SummarizedAnnualFinancialReports';
export const AOS_YEARS = [2023, 2024, 2025];
// In order of preference when a government files more than one (most file only one).
export const BASES = ['REG', 'CASH', 'MOD', 'GAAP'];
const FILE = (type, year, basis) => `${AOS_PAGE}/SummarizedReports/${type}_${year}_${basis}_Summarized.XLSX`;
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_39.csv';
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '600', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(DIR, { recursive: true });
  for (const year of AOS_YEARS) {
    for (const type of ['Township', 'Village', 'City', 'County']) {
      for (const basis of BASES) {
        const out = join(DIR, `${type}_${year}_${basis}.xlsx`);
        // Not every type files under every basis: a missing workbook is skipped.
        try { curl('-o', out, FILE(type, year, basis)); execFileSync('unzip', ['-tq', out], { stdio: 'ignore' }); } catch { rmSync(out, { force: true }); }
      }
    }
  }
  execFileSync('python3', ['-I', join(HERE, 'aos-to-json.py'), DIR, join(DIR, 'aos.json')], { stdio: 'inherit' });
  curl('-o', join(RAW, 'popest.csv'), POP);
  for (const g of ['counties', 'place', 'cousubs']) {
    curl('-o', join(RAW, `gaz-${g}.zip`), `${GAZ}/2024_Gaz_${g}_national.zip`);
    execFileSync('unzip', ['-o', '-q', join(RAW, `gaz-${g}.zip`), '-d', RAW], { stdio: 'inherit' });
  }
  console.log('Done. Next: node scripts/oh/aos-build.mjs --all');
}
