#!/usr/bin/env node
// Caches Washington Public Disclosure Commission (PDC) contributions to city and county
// candidates into data/raw/wa/pdc.json (gitignored), from the PDC's "Contributions to
// Candidates and Political Committees" dataset on data.wa.gov. Only receipts from businesses,
// PACs and unions since January 1 three years ago are kept; individuals are not fetched.
//
//   node scripts/wa/fetch-pdc.mjs            then: node scripts/wa/build-county.mjs --all

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CITY_OFFICES, COUNTY_OFFICES, COUNTED_CODES } from './pdc-map.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'wa');
const API = 'https://data.wa.gov/resource/kv7h-kjye.json';
const PAGE = 50000;
const since = `${new Date().getFullYear() - 3}-01-01`;
const list = (xs) => xs.map((x) => `'${x.replace(/'/g, "''")}'`).join(',');
const where = `receipt_date >= '${since}T00:00:00' AND office in(${list([...CITY_OFFICES, ...COUNTY_OFFICES])}) AND code in(${list(COUNTED_CODES)})`;
const fields = 'id,report_number,filer_id,filer_name,office,jurisdiction,jurisdiction_county,jurisdiction_type,election_year,amount,receipt_date,code,contributor_name,contributor_city,contributor_state';

mkdirSync(RAW, { recursive: true });
const rows = [];
for (let offset = 0; ; offset += PAGE) {
  const out = execFileSync('curl', ['-sSfG', '--retry', '4', '--retry-all-errors', '-m', '600', API,
    '--data-urlencode', `$select=${fields}`, '--data-urlencode', `$where=${where}`,
    '--data-urlencode', '$order=id', '--data-urlencode', `$limit=${PAGE}`, '--data-urlencode', `$offset=${offset}`], { maxBuffer: 1 << 30 });
  const page = JSON.parse(out.toString());
  rows.push(...page);
  console.log(`PDC: ${rows.length} receipts`);
  if (page.length < PAGE) break;
}
writeFileSync(join(RAW, 'pdc.json'), JSON.stringify({ since, fetched: new Date().toISOString().slice(0, 10), rows }));
console.log(`data/raw/wa/pdc.json: ${rows.length} business, PAC and union receipts to city and county candidates since ${since}`);
