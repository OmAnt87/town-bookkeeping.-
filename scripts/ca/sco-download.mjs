#!/usr/bin/env node
// Downloads the California State Controller's Financial Transactions Report data for cities and
// counties ("By the Numbers", bythenumbers.sco.ca.gov) into data/raw/ca/sco/ (gitignored):
//   - revenues and expenditures by line, fiscal years SCO_YEARS (Socrata API, non-zero lines)
//   - the latest raw-data workbooks, for long-term debt, leases and debt payments
//
//   node scripts/ca/download.mjs                    # Census population estimates and gazetteers
//   node scripts/ca/sco-download.mjs
//   pip install openpyxl && python3 scripts/ca/sco-debt-to-json.py
//   node scripts/ca/sco-build.mjs --all

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCO_PAGE = 'https://bythenumbers.sco.ca.gov/';
export const SCO_YEARS = [2020, 2021, 2022, 2023, 2024];
const API = 'https://bythenumbers.sco.ca.gov/resource';
// Socrata ids: city revenues, city expenditures, county revenues, county expenditures. County
// datasets name the amount column "values".
export const SCO_SETS = {
  'city-revenues': { id: 'rrtv-rsj9', value: 'value' },
  'city-expenditures': { id: 'ju3w-4gxp', value: 'value' },
  'county-revenues': { id: 'emxv-k8xv', value: 'values' },
  'county-expenditures': { id: 'uctr-c2j8', value: 'values' },
};
// Raw-data workbooks (every Financial Transactions Report table) for FY 2022-23 and 2023-24.
const WORKBOOKS = { cities: 'wjvf-fpdc', counties: 'bmic-m77z' };

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'ca', 'sco');
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', ...a], { maxBuffer: 1 << 30 });

if (import.meta.url === `file://${process.argv[1]}`) {
  mkdirSync(RAW, { recursive: true });
  const PAGE = 50000;
  for (const [name, { id, value }] of Object.entries(SCO_SETS)) {
    const fields = ['entity_name', 'fiscal_year', 'category', 'subcategory_1', 'subcategory_2', 'line_description', `${value} as value`, 'estimated_population'];
    if (name.startsWith('city')) fields.push('county');
    const where = `fiscal_year >= '${SCO_YEARS[0]}' AND ${value} != 0`;
    const rows = [];
    for (let offset = 0; ; offset += PAGE) {
      const url = `${API}/${id}.json?$select=${encodeURIComponent(fields.join(','))}&$where=${encodeURIComponent(where)}&$order=:id&$limit=${PAGE}&$offset=${offset}`;
      const page = JSON.parse(curl(url).toString());
      rows.push(...page);
      if (page.length < PAGE) break;
    }
    writeFileSync(join(RAW, `${name}.json`), JSON.stringify(rows));
    console.log(`${name}: ${rows.length} lines`);
  }
  for (const [name, id] of Object.entries(WORKBOOKS)) {
    const meta = JSON.parse(curl(`https://bythenumbers.sco.ca.gov/api/views/${id}.json`).toString());
    curl('-o', join(RAW, `${name}-raw.xlsx`), `https://bythenumbers.sco.ca.gov/api/views/${id}/files/${meta.blobId}?download=true&filename=${encodeURIComponent(meta.blobFilename)}`);
    console.log(`${name}: ${meta.blobFilename}`);
  }
  console.log('Done. Next: python3 scripts/ca/sco-debt-to-json.py');
}
