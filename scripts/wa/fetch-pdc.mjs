#!/usr/bin/env node
// Downloads organization contributions to Washington county, city and town candidates from the Public
// Disclosure Commission's open data (data.wa.gov) into data/raw/wa/pdc/contributions.json (gitignored).
//
//   node scripts/wa/fetch-pdc.mjs      then: node scripts/wa/build-county.mjs --all

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PDC_API } from './pdc-map.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'wa', 'pdc');
const SINCE = `${new Date().getFullYear() - 3}-01-01`;
const PAGE = 20000;
const FIELDS = 'filer_name,office,jurisdiction,jurisdiction_county,amount,cash_or_in_kind,receipt_date,code,contributor_category,contributor_name,url';
const WHERE = `type='Candidate' AND jurisdiction_type='Local' AND contributor_category='Organization' AND receipt_date>='${SINCE}'`;

mkdirSync(RAW, { recursive: true });
const rows = [];
for (let offset = 0; ; offset += PAGE) {
  const url = `${PDC_API}?$select=${FIELDS}&$where=${encodeURIComponent(WHERE)}&$order=id&$limit=${PAGE}&$offset=${offset}`;
  const page = JSON.parse(execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', url], { maxBuffer: 1 << 30 }).toString());
  rows.push(...page);
  if (page.length < PAGE) break;
}
writeFileSync(join(RAW, 'contributions.json'), JSON.stringify(rows));
console.log(`${rows.length} contributions since ${SINCE} -> data/raw/wa/pdc/contributions.json. Next: node scripts/wa/build-county.mjs --all`);
