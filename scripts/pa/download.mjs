#!/usr/bin/env node
// Downloads the raw Pennsylvania inputs into data/raw/pa/ (gitignored):
//   - DCED "Statewide Municipal Annual Financial Reports" spreadsheet for each year since 2016
//   - Census 2025 population estimates for PA municipalities
//   - Census 2024 gazetteers (county subdivisions and places)
//
//   node scripts/pa/download.mjs      then: pip install xlrd && python3 scripts/pa/afr-to-json.py

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'pa');
const DCED = 'https://apps.dced.pa.gov/Munstats-public/ReportToPdf.aspx?report=StatewideMuniAfr&type=excel&paramList=';
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_42.csv';
const curl = (...a) => execFileSync('curl', ['-sSfL', '-m', '900', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });

mkdirSync(RAW, { recursive: true });
for (let y = 2016; y < new Date().getFullYear(); y++) {
  try {
    curl('-o', join(RAW, `afr_${y}.xls`), `${DCED}${y}`);
    console.log(`DCED ${y}`);
  } catch {
    console.log(`DCED ${y}: not published yet`);
  }
}
curl('-o', join(RAW, 'popest.csv'), POP);
for (const g of ['cousubs', 'place']) {
  curl('-o', join(RAW, `gaz-${g}.zip`), `${GAZ}/2024_Gaz_${g}_national.zip`);
  execFileSync('unzip', ['-o', '-q', join(RAW, `gaz-${g}.zip`), '-d', RAW], { stdio: 'inherit' });
}
console.log('Done. Next: python3 scripts/pa/afr-to-json.py');
