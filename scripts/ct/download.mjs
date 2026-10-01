#!/usr/bin/env node
// Downloads the raw Connecticut inputs into data/raw/ct/ (gitignored):
//   - CT Office of Policy and Management "Municipal Fiscal Indicators" datasets on data.ct.gov:
//     financial statement information, Uniform Chart of Accounts spending, and individual town data
//   - Census 2025 population estimates for CT towns
//   - Census 2024 gazetteers (county subdivisions and places)
//
//   node scripts/ct/download.mjs      then: node scripts/ct/build-county.mjs --all

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'ct');
const SOCRATA = 'https://data.ct.gov/resource';
const DATASETS = { 'fs.json': 'd6pe-dw46', 'ucoa.json': 'e2qt-k238', 'town.json': 'ej6f-y2wf' };
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_9.csv';
const curl = (...a) => execFileSync('curl', ['-sSfL', '-m', '900', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });

mkdirSync(RAW, { recursive: true });
for (const [file, id] of Object.entries(DATASETS)) {
  curl('-o', join(RAW, file), `${SOCRATA}/${id}.json?$limit=100000`);
  console.log(`data.ct.gov ${id} -> ${file}`);
}
curl('-o', join(RAW, 'popest.csv'), POP);
for (const g of ['cousubs', 'place']) {
  curl('-o', join(RAW, `gaz-${g}.zip`), `${GAZ}/2024_Gaz_${g}_national.zip`);
  execFileSync('unzip', ['-o', '-q', join(RAW, `gaz-${g}.zip`), '-d', RAW], { stdio: 'inherit' });
}
console.log('Done. Next: node scripts/ct/build-county.mjs --all');
