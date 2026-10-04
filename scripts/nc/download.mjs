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
import { mkdirSync, existsSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'nc');
export const CENSUS_PAGE = (y) => `https://www.census.gov/data/datasets/${y}/econ/local/public-use-datasets.html`;
export const UNIT_FILE = (y) => `https://www2.census.gov/programs-surveys/gov-finances/tables/${y}/${y}_Individual_Unit_File${y === 2022 ? '' : 's'}.zip`;
export const YEARS = [2022, 2023, 2024];
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_37.csv';
const ZCTA = 'https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt';
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs();
  mkdirSync(RAW, { recursive: true });
  for (const y of YEARS) {
    const dir = join(RAW, `units-${y}`);
    if (existsSync(dir) && !args.force) { console.log(`cached ${dir}`); continue; }
    const zip = join(RAW, `units-${y}.zip`);
    curl('-o', zip, UNIT_FILE(y));
    rmSync(dir, { recursive: true, force: true });
    execFileSync('unzip', ['-o', '-q', '-j', zip, '-d', dir], { stdio: 'inherit' });
    // Keep stable names: FinEstDAT (items) and Fin_PID (unit identifiers).
    for (const f of readdirSync(dir)) {
      if (/FinEstDAT/i.test(f)) renameSync(join(dir, f), join(dir, 'items.txt'));
      else if (/Fin_PID/i.test(f)) renameSync(join(dir, f), join(dir, 'pid.txt'));
    }
    console.log(`Census individual unit file ${y} -> ${dir}`);
  }
  curl('-o', join(RAW, 'popest.csv'), POP);
  for (const g of ['counties', 'place']) {
    curl('-o', join(RAW, `gaz-${g}.zip`), `${GAZ}/2024_Gaz_${g}_national.zip`);
    execFileSync('unzip', ['-o', '-q', join(RAW, `gaz-${g}.zip`), '-d', RAW], { stdio: 'inherit' });
  }
  // ZIP code areas to counties, for placing campaign committees by address.
  curl('-o', join(RAW, 'zcta-county.txt'), ZCTA);
  console.log('Done. Next: node scripts/nc/fetch-ncsbe.mjs (optional), then node scripts/nc/build-county.mjs --all');
}
