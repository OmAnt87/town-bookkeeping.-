#!/usr/bin/env node
// Downloads the raw Wisconsin inputs into data/raw/wi/ (gitignored):
//   - Department of Revenue "County and Municipal Revenues and Expenditures" (CMRE) workbooks,
//     compiled from every county's, city's, village's and town's Municipal Financial Report,
//     calendar years 2023-2024, converted to dor/cmre.json by cmre-to-json.py
//   - Census 2025 population estimates for WI and the 2024 gazetteers (counties, places and
//     county subdivisions) for population and map location
//
//   node scripts/wi/dor-download.mjs      then: node scripts/wi/dor-build.mjs --all

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, '..', '..', 'data', 'raw', 'wi');
const DIR = join(RAW, 'dor');
export const CMRE_PAGE = 'https://www.revenue.wi.gov/Pages/Report/county-municipal-revenues-expenditures.aspx';
const CMRE = { 2023: 'https://www.revenue.wi.gov/SLFReportscotvc/cmreb2023.xlsx', 2024: 'https://www.revenue.wi.gov/SLFReportscotvc/CMREB2024.xlsx' };
export const CMRE_YEARS = Object.keys(CMRE).map(Number);
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_55.csv';
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(DIR, { recursive: true });
  for (const [y, url] of Object.entries(CMRE)) curl('-o', join(DIR, `${y}.xlsx`), url);
  execFileSync('python3', ['-I', join(HERE, 'cmre-to-json.py'), DIR, join(DIR, 'cmre.json')], { stdio: 'inherit' });
  curl('-o', join(RAW, 'popest.csv'), POP);
  for (const g of ['counties', 'place', 'cousubs']) {
    curl('-o', join(RAW, `gaz-${g}.zip`), `${GAZ}/2024_Gaz_${g}_national.zip`);
    execFileSync('unzip', ['-o', '-q', join(RAW, `gaz-${g}.zip`), '-d', RAW], { stdio: 'inherit' });
  }
  console.log('Done. Next: node scripts/wi/dor-build.mjs --all');
}
