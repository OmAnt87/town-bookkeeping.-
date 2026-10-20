#!/usr/bin/env node
// Downloads the raw Maine inputs into data/raw/me/ (gitignored):
//   - U.S. Census Bureau Annual Survey / Census of Governments individual unit files: every
//     county, city, town and plantation in Census of Governments years (2022), sampled units in other years
//   - Census 2025 population estimates for ME and the 2024 gazetteers (counties, places and
//     county subdivisions, which is where the Census places Maine's towns)
//
//   node scripts/me/download.mjs      then: node scripts/me/build-county.mjs --all
//
// Maine has no statewide compilation of municipal finances (towns publish annual reports and
// audits individually; Maine Revenue Services' valuation return covers taxes, not spending), so
// the Census files are used.

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';
import { downloadUnits } from '../common/census-units.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'me');
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_23.csv';
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });

const args = parseArgs();
mkdirSync(RAW, { recursive: true });
downloadUnits(RAW, curl, args.force);
curl('-o', join(RAW, 'popest.csv'), POP);
for (const g of ['counties', 'place', 'cousubs']) {
  curl('-o', join(RAW, `gaz-${g}.zip`), `${GAZ}/2024_Gaz_${g}_national.zip`);
  execFileSync('unzip', ['-o', '-q', join(RAW, `gaz-${g}.zip`), '-d', RAW], { stdio: 'inherit' });
}
console.log('Done. Next: node scripts/me/build-county.mjs --all');
