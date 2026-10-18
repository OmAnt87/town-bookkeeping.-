#!/usr/bin/env node
// Downloads the raw Minnesota inputs into data/raw/mn/ (gitignored):
//   - Office of the State Auditor financial data, compiled from the financial reporting form every
//     county, city and town files with the State Auditor: counties 2023-2024, cities 2022-2023 and
//     towns 2023 (the latest each publishes), converted to osa/osa.json by osa-to-json.py
//   - Census 2025 population estimates for MN and the 2024 gazetteers (counties, places and
//     county subdivisions) for population and map location
//
//   node scripts/mn/osa-download.mjs      then: node scripts/mn/osa-build.mjs --all

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, '..', '..', 'data', 'raw', 'mn');
const DIR = join(RAW, 'osa');
const OSA = 'https://www.osa.state.mn.us';
export const OSA_PAGE = {
  city: `${OSA}/forms-deadlines/forms-reports-and-data/cities/all-city-data/`,
  town: `${OSA}/forms-deadlines/forms-reports-and-data/towns/`,
  county: `${OSA}/forms-deadlines/forms-reports-and-data/`,
};
const FILES = {
  'city-2022': '/media/eg3pcaz3/cired_22_data.xlsx',
  'city-2023': '/media/x30lkoud/cired_23_data.xlsx',
  'town-2023': '/media/ooqdopiz/tnfinances_23_data.xlsx',
  'county-2023': '/media/2aijog4s/cored_23_data.xlsx',
  'county-2024': '/media/1f0jgkqh/cored_24_data.xlsx',
};
export const OSA_YEARS = { city: [2022, 2023], town: [2023], county: [2023, 2024] };
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_27.csv';
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(DIR, { recursive: true });
  for (const [name, path] of Object.entries(FILES)) curl('-o', join(DIR, `${name}.xlsx`), `${OSA}${path}`);
  execFileSync('python3', ['-I', join(HERE, 'osa-to-json.py'), DIR, join(DIR, 'osa.json')], { stdio: 'inherit' });
  curl('-o', join(RAW, 'popest.csv'), POP);
  for (const g of ['counties', 'place', 'cousubs']) {
    curl('-o', join(RAW, `gaz-${g}.zip`), `${GAZ}/2024_Gaz_${g}_national.zip`);
    execFileSync('unzip', ['-o', '-q', join(RAW, `gaz-${g}.zip`), '-d', RAW], { stdio: 'inherit' });
  }
  console.log('Done. Next: node scripts/mn/osa-build.mjs --all');
}
