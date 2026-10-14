#!/usr/bin/env node
// Downloads the raw Illinois inputs into data/raw/il/ (gitignored):
//   - Illinois Comptroller local government financial databases (each county, city, village,
//     town, township and district's Annual Financial Report), one Access database per fiscal
//     year, exported to comptroller/<year>/<table>.csv with mdbtools (`apt-get install mdbtools`)
//   - Census 2025 population estimates for IL and the 2024 gazetteers (counties, places and
//     county subdivisions) for population and map location
//
//   node scripts/il/comptroller-download.mjs [--force]
//   node scripts/il/fetch-isbe.mjs                         # campaign finance (optional)
//   node scripts/il/comptroller-build.mjs --all

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'il');
const DIR = join(RAW, 'comptroller');
export const COMPTROLLER_PAGE = 'https://illinoiscomptroller.gov/constituent-services/local-government/local-government-division/financial-databases/';
const DB = (y) => `https://illinoiscomptroller.gov/__media/sites/comptroller/assets/File/LocalGovernment/FinancialDatabases/data${y}.zip`;
export const COMPTROLLER_YEARS = [2023, 2024];
const TABLES = ['UnitData', 'UnitStats', 'Revenues', 'Expenditures', 'FundsUsed', 'Indebtedness'];
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_17.csv';
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs();
  for (const y of COMPTROLLER_YEARS) {
    const dir = join(DIR, String(y));
    if (!args.force && existsSync(join(dir, 'Revenues.csv'))) { console.log(`cached ${dir}`); continue; }
    mkdirSync(dir, { recursive: true });
    const zip = join(DIR, `data${y}.zip`);
    curl('-o', zip, DB(y));
    execFileSync('unzip', ['-o', '-q', zip, '-d', dir], { stdio: 'inherit' });
    const db = join(dir, `data${y}.accdb`);
    for (const t of TABLES) writeFileSync(join(dir, `${t}.csv`), execFileSync('mdb-export', [db, t], { maxBuffer: 1 << 28 }));
    console.log(`Comptroller FY ${y} -> ${dir}`);
  }
  curl('-o', join(RAW, 'popest.csv'), POP);
  for (const g of ['counties', 'place', 'cousubs']) {
    curl('-o', join(RAW, `gaz-${g}.zip`), `${GAZ}/2024_Gaz_${g}_national.zip`);
    execFileSync('unzip', ['-o', '-q', join(RAW, `gaz-${g}.zip`), '-d', RAW], { stdio: 'inherit' });
  }
  console.log('Done. Next: node scripts/il/fetch-isbe.mjs (optional), then node scripts/il/comptroller-build.mjs --all');
}
