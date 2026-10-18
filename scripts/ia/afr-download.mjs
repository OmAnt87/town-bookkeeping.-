#!/usr/bin/env node
// Downloads the raw Iowa inputs into data/raw/ia/ (gitignored):
//   - Iowa Department of Management Annual Financial Report data from data.iowa.gov: city actual
//     expenditures (dataset 923) and revenues (924) by line item and fund, county actual revenues
//     by type (936) and expenditures by service area (938), converted for fiscal years 2023-2025
//     to afr/afr.json by afr-to-json.py
//   - Census 2025 population estimates for IA and the 2024 gazetteers (counties and places) for
//     population and map location
//
//   node scripts/ia/afr-download.mjs      then: node scripts/ia/afr-build.mjs --all

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, '..', '..', 'data', 'raw', 'ia');
const DIR = join(RAW, 'afr');
export const DATASETS = { cityExp: 923, cityRev: 924, countyRev: 936, countyExp: 938 };
export const DATASET_PAGE = (id) => `https://data.iowa.gov/catalog/dataset/${id}`;
export const AFR_YEARS = [2023, 2024, 2025];
const ROWS = (id) => `https://idh-be.iowa.gov/api/v1/datasets/${id}/rows.csv`;
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_19.csv';
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '1800', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(DIR, { recursive: true });
  // Each download is a zip of one or more CSV parts.
  for (const id of Object.values(DATASETS)) curl('-o', join(DIR, `${id}.zip`), ROWS(id));
  execFileSync('python3', ['-I', join(HERE, 'afr-to-json.py'), DIR, join(DIR, 'afr.json'), ...AFR_YEARS.map(String)], { stdio: 'inherit' });
  curl('-o', join(RAW, 'popest.csv'), POP);
  for (const g of ['counties', 'place']) {
    curl('-o', join(RAW, `gaz-${g}.zip`), `${GAZ}/2024_Gaz_${g}_national.zip`);
    execFileSync('unzip', ['-o', '-q', join(RAW, `gaz-${g}.zip`), '-d', RAW], { stdio: 'inherit' });
  }
  console.log('Done. Next: node scripts/ia/afr-build.mjs --all');
}
