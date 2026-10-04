#!/usr/bin/env node
// Downloads the raw Virginia inputs into data/raw/va/ (gitignored):
//   - Auditor of Public Accounts, "Comparative Report of Local Government Revenues and
//     Expenditures" (Excel), one per fiscal year: revenue, spending by function, capital
//     projects, debt service, enterprise activities and outstanding debt for every city, county
//     and reporting town
//   - Census 2025 population estimates for VA and the 2024 gazetteers (counties and places)
//
//   node scripts/va/download.mjs      then: python3 scripts/va/apa-to-json.py
//
// The APA site lists reports with client-side code, so each year's report page is named here;
// add the next year's page when it is published (the amended edition when there is one).

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'va');
export const APA_PAGE = (id) => `https://www.apa.virginia.gov/local-government/reports/comparative-reports/${id}`;
export const REPORTS = { 2023: 20724, 2024: 22622, 2025: 23740 };
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_51.csv';
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', ...a], { maxBuffer: 1 << 26 }).toString();

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs();
  mkdirSync(RAW, { recursive: true });
  for (const [year, id] of Object.entries(REPORTS)) {
    const out = join(RAW, `cr-${year}.xlsx`);
    if (existsSync(out) && !args.force) { console.log(`cached ${out}`); continue; }
    const xlsx = curl(APA_PAGE(id)).match(/https:\/\/[a-z0-9.]+\.blob\.core\.windows\.net\/apa\/[A-F0-9-]+\.xlsx/i)?.[0];
    if (!xlsx) throw new Error(`No Excel file on ${APA_PAGE(id)}`);
    curl('-o', out, xlsx);
    console.log(`APA Comparative Report FY ${year} -> ${out}`);
  }
  curl('-o', join(RAW, 'popest.csv'), POP);
  for (const g of ['counties', 'place']) {
    curl('-o', join(RAW, `gaz-${g}.zip`), `${GAZ}/2024_Gaz_${g}_national.zip`);
    execFileSync('unzip', ['-o', '-q', join(RAW, `gaz-${g}.zip`), '-d', RAW], { stdio: 'inherit' });
  }
  console.log('Done. Next: python3 scripts/va/apa-to-json.py');
}
