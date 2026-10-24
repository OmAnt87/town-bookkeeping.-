#!/usr/bin/env node
// Updates the NJ files in data/real in place: adds the school, county and
// fire-district taxes each town collects and pays over to its money in and
// out, and rebuilds its history from the budget filings. Political money and
// red flags stay as they are, so this needs only the converted budget workbook
// (data/raw/nj/ufb.json), not the ELEC cache or the red-flag downloads.
// build-county.mjs does the same as part of a full build.
//
//   node scripts/nj/apply-pass-through.mjs && node scripts/build-summary.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyPassThrough, filingsFor, muniCode } from './ufb-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'data', 'real');
const UFB_PAGE = 'https://datahub.dca.nj.gov/datasets/user-friendly-budget-database';

const ufb = JSON.parse(readFileSync(join(ROOT, 'data', 'raw', 'nj', 'ufb.json'), 'utf8'));
const byYear = Object.fromEntries(Object.entries(ufb).map(([y, rows]) => [y, new Map(rows.map((r) => [muniCode(r), r]))]));

const { files } = JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8'));
let updated = 0;
const missing = [];
const history = [];
for (const file of files.filter((f) => f.startsWith('nj-'))) {
  const data = JSON.parse(readFileSync(join(OUT, file), 'utf8'));
  for (const town of data.towns) {
    const filings = filingsFor(byYear, town.njMuniCode);
    if (!filings.has(town.fiscalYear)) throw new Error(`${town.name}: no ${town.fiscalYear} filing in ufb.json; rebuild with build-county.mjs`);
    const { head, dropped, missingPass } = applyPassThrough(town, filings, UFB_PAGE);
    if (head) updated++;
    else missing.push(town.name);
    if (dropped.length || missingPass.length) history.push(`${town.name}: ${[...dropped, ...missingPass].sort().join(', ')}`);
  }
  writeFileSync(join(OUT, file), `${JSON.stringify(data, null, 1)}\n`);
}
console.log(`${updated} towns with pass-through taxes; ${missing.length} without: ${missing.join(', ')}`);
console.log(`History years dropped (${history.length} towns):\n  ${history.join('\n  ')}`);
