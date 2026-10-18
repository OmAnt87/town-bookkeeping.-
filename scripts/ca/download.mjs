#!/usr/bin/env node
// Downloads the raw California inputs into data/raw/ca/ (gitignored):
//   - U.S. Census Bureau Annual Survey / Census of Governments individual unit files: every
//     county, city and town in Census of Governments years (2022), sampled units in other years
//   - Census 2025 population estimates for CA and the 2024 gazetteers (counties, places and
//     county subdivisions)
//
//   node scripts/ca/download.mjs      then: node scripts/ca/sco-download.mjs (see sco-build.mjs)
//
// The Census files are used so California is built the same way as Ohio and northern New England.

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';
import { downloadUnits } from '../common/census-units.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'ca');
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_6.csv';
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });

const args = parseArgs();
mkdirSync(RAW, { recursive: true });
downloadUnits(RAW, curl, args.force);
curl('-o', join(RAW, 'popest.csv'), POP);
for (const g of ['counties', 'place', 'cousubs']) {
  curl('-o', join(RAW, `gaz-${g}.zip`), `${GAZ}/2024_Gaz_${g}_national.zip`);
  execFileSync('unzip', ['-o', '-q', join(RAW, `gaz-${g}.zip`), '-d', RAW], { stdio: 'inherit' });
}
console.log('Done. Next: node scripts/ca/sco-download.mjs (State Controller reports), or node scripts/ca/build-county.mjs --all for the Census-only build');
