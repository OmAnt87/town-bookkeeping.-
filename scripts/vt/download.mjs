#!/usr/bin/env node
// Downloads the raw Vermont inputs into data/raw/vt/ (gitignored):
//   - U.S. Census Bureau Annual Survey / Census of Governments individual unit files: every
//     county, city, village and town in Census of Governments years (2022), sampled units in
//     other years
//   - Census 2025 population estimates for VT and the 2024 gazetteers (counties, places and
//     county subdivisions, which is where the Census places Vermont's towns)
//   - Department of Taxes, Property Valuation and Review annual report data: taxes and tax rates
//     by town (education and municipal property taxes), tax years 2021-2024, converted to
//     taxrates.json by taxrates-to-json.py
//
//   node scripts/vt/download.mjs      then: node scripts/vt/build-county.mjs --all
//
// Vermont has no central collection of town financial reports (towns publish their own annual
// town reports), so the Census files are used.

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';
import { downloadUnits } from '../common/census-units.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, '..', '..', 'data', 'raw', 'vt');
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_50.csv';
// Taxes and Tax Rates by County, from each year's PVR annual report data page.
export const TAX_PAGE = 'https://tax.vermont.gov/pvr-annual-report';
const TAX_FILES = {
  2021: 'https://tax.vermont.gov/sites/tax/files/documents/TaxesRates_2021.xlsx',
  2022: 'https://tax.vermont.gov/sites/tax/files/documents/TaxRates2022.xlsx',
  2023: 'https://tax.vermont.gov/sites/tax/files/documents/TaxRates2023.xlsx',
  2024: 'https://tax.vermont.gov/sites/tax/files/documents/TaxRates2024.xlsx',
};
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });

const args = parseArgs();
mkdirSync(RAW, { recursive: true });
downloadUnits(RAW, curl, args.force);
curl('-o', join(RAW, 'popest.csv'), POP);
for (const g of ['counties', 'place', 'cousubs']) {
  curl('-o', join(RAW, `gaz-${g}.zip`), `${GAZ}/2024_Gaz_${g}_national.zip`);
  execFileSync('unzip', ['-o', '-q', join(RAW, `gaz-${g}.zip`), '-d', RAW], { stdio: 'inherit' });
}
const taxDir = join(RAW, 'taxrates');
mkdirSync(taxDir, { recursive: true });
for (const [y, url] of Object.entries(TAX_FILES)) curl('-o', join(taxDir, `${y}.xlsx`), url);
execFileSync('python3', ['-I', join(HERE, 'taxrates-to-json.py'), taxDir, join(RAW, 'taxrates.json')], { stdio: 'inherit' });
console.log('Done. Next: node scripts/vt/build-county.mjs --all');
