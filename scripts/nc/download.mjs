#!/usr/bin/env node
// Downloads the raw North Carolina inputs into data/raw/nc/ (gitignored):
//   - U.S. Census Bureau Annual Survey / Census of Governments individual unit files. North
//     Carolina counties and municipalities file their Annual Financial Information Report
//     (AFIR) with the Local Government Commission on the Census Bureau's template, and the
//     Census publishes them here: every unit in Census of Governments years (2022), sampled
//     units in other years.
//   - Census 2025 population estimates for NC, the 2024 gazetteers (counties and places) and
//     the 2020 ZIP code area to county relationship file
//
//   node scripts/nc/download.mjs      then: node scripts/nc/build-county.mjs --all
//
// The Treasurer's own AFIR reports (logos.nctreasurer.com) send an incomplete certificate
// chain that strict TLS clients refuse, so the Census copy is used.

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';
import { downloadUnits } from '../common/census-units.mjs';

export { CENSUS_PAGE, UNIT_FILE, YEARS } from '../common/census-units.mjs';
const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'nc');
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_37.csv';
const ZCTA = 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt';
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs();
  mkdirSync(RAW, { recursive: true });
  downloadUnits(RAW, curl, args.force);
  curl('-o', join(RAW, 'popest.csv'), POP);
  for (const g of ['counties', 'place']) {
    curl('-o', join(RAW, `gaz-${g}.zip`), `${GAZ}/2024_Gaz_${g}_national.zip`);
    execFileSync('unzip', ['-o', '-q', join(RAW, `gaz-${g}.zip`), '-d', RAW], { stdio: 'inherit' });
  }
  // ZIP code areas to counties, for placing campaign committees by address.
  curl('-o', join(RAW, 'zcta-county.txt'), ZCTA);
  console.log('Done. Next: node scripts/nc/fetch-ncsbe.mjs (optional), then node scripts/nc/build-county.mjs --all');
}
