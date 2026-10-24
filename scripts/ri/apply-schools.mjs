#!/usr/bin/env node
// Updates the Rhode Island files in data/real in place: adds each town's school department
// (state aid, federal aid and other school revenue, and its spending beyond the town
// appropriation) to money in and out, and rebuilds the history. Political money and other
// sections stay as they are, so this needs only data/raw/ri/mtp.csv (scripts/ri/download.mjs),
// not the campaign-finance cache. build-county.mjs does the same as part of a full build.
//
//   node scripts/ri/apply-schools.mjs && node scripts/build-summary.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV } from '../lib.mjs';
import { applySchools, groupMtp } from './schools.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'data', 'real');
// Same page as MTP_PAGE in download.mjs, which downloads when imported.
const MTP_PAGE = 'https://municipalfinance.ri.gov/municipal-transparency/mtp-docs-data/all-data';
const mtp = groupMtp(parseCSV(readFileSync(join(ROOT, 'data', 'raw', 'ri', 'mtp.csv'), 'utf8')));

const { files } = JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8'));
let updated = 0;
const none = [];
for (const file of files.filter((f) => f.startsWith('ri-'))) {
  const data = JSON.parse(readFileSync(join(OUT, file), 'utf8'));
  for (const town of data.towns) {
    const t = mtp.towns.get(Number(town.riEntityCode));
    if (!t?.years[town.fiscalYear]) throw new Error(`${town.name}: no FY ${town.fiscalYear} portal rows; rebuild with build-county.mjs`);
    if (applySchools(town, t.years, mtp.schools.get(Number(town.riEntityCode)) || {}, MTP_PAGE)) updated++;
    else none.push(`${town.name} (FY ${town.fiscalYear})`);
    for (const s of town.sources || []) {
      if (s.label === 'RI Municipal Transparency Portal (history back to FY 2016)') s.label += ', including town school departments';
    }
  }
  writeFileSync(join(OUT, file), `${JSON.stringify(data, null, 1)}\n`);
}
console.log(`${updated} towns with their school department; ${none.length} without: ${none.join(', ')}`);
