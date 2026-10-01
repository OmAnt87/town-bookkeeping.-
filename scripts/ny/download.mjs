#!/usr/bin/env node
// Downloads the raw New York inputs into data/raw/ny/ (gitignored):
//   - State Comptroller Annual Financial Report data for towns, villages and cities (all years)
//   - State Comptroller debt data for each year since 2016
//   - Census 2025 population estimates for NY cities, towns and villages
//   - Census 2024 gazetteers (county subdivisions and places) for map locations
//
//   node scripts/ny/download.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'ny');
const OSC = 'https://wwe1.osc.state.ny.us/localgov/findata';
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_36.csv';

const curl = (...a) => execFileSync('curl', ['-sSfL', '-m', '900', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });
mkdirSync(RAW, { recursive: true });

for (const cls of ['town', 'village', 'city']) {
  console.log(`Comptroller ${cls} data...`);
  curl('-o', join(RAW, `${cls}.zip`), `${OSC}/level3zip/${cls}_all_years.zip`);
  execFileSync('unzip', ['-o', '-q', join(RAW, `${cls}.zip`), '-d', join(RAW, cls)], { stdio: 'inherit' });
}
for (let y = 2016; y <= new Date().getFullYear(); y++) {
  try {
    curl('-o', join(RAW, `debt_${y}.csv`), `${OSC}/level3zip/${y}_debtdetail.csv`);
  } catch {
    console.log(`  no debt file for ${y} yet`);
  }
}
console.log('Census population estimates and gazetteers...');
curl('-o', join(RAW, 'popest.csv'), POP);
for (const g of ['cousubs', 'place']) {
  curl('-o', join(RAW, `gaz-${g}.zip`), `${GAZ}/2024_Gaz_${g}_national.zip`);
  execFileSync('unzip', ['-o', '-q', join(RAW, `gaz-${g}.zip`), '-d', RAW], { stdio: 'inherit' });
}
console.log('Done. Next: python3 scripts/ny/osc-to-json.py');
