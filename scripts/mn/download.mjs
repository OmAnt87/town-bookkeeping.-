#!/usr/bin/env node
// Downloads the raw Minnesota inputs into data/raw/mn/ (gitignored):
//   - U.S. Census Bureau Annual Survey / Census of Governments individual unit files: every
//     county, city and township in Census of Governments years (2022), sampled units in other years
//   - Census 2025 population estimates for MN and the 2024 gazetteers (counties, places and
//     county subdivisions, which is where the Census places Minnesota's townships)
//
//   node scripts/mn/download.mjs      then: node scripts/mn/build-county.mjs --all
//
// The Census files are used so Minnesota is built the same way as Ohio and northern New England.

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';
import { downloadUnits } from '../common/census-units.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'mn');
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_27.csv';
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });

const args = parseArgs();
mkdirSync(RAW, { recursive: true });
downloadUnits(RAW, curl, args.force);
curl('-o', join(RAW, 'popest.csv'), POP);
for (const g of ['counties', 'place', 'cousubs']) {
  curl('-o', join(RAW, `gaz-${g}.zip`), `${GAZ}/2024_Gaz_${g}_national.zip`);
  execFileSync('unzip', ['-o', '-q', join(RAW, `gaz-${g}.zip`), '-d', RAW], { stdio: 'inherit' });
}
console.log('Done. Next: node scripts/mn/build-county.mjs --all');
