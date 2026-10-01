#!/usr/bin/env node
// Writes data/real/summary.json: every real town without its ledger, history,
// donors, notes and sources. The app loads this at startup (map, rankings and
// scores need only these fields) and fetches a county's full file when a town
// report is opened.
//
//   node scripts/build-summary.mjs        (run after any build-county script)

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'real');
const DETAIL_ONLY = ['ledger', 'history', 'topDonors', 'notes', 'sources'];

const { files } = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8'));
const towns = [];
for (const file of files) {
  for (const t of JSON.parse(readFileSync(join(DIR, file), 'utf8')).towns) {
    const light = { ...t, detailFile: file };
    for (const k of DETAIL_ONLY) delete light[k];
    towns.push(light);
  }
}
writeFileSync(join(DIR, 'summary.json'), JSON.stringify({ generated: new Date().toISOString().slice(0, 10), towns }));
console.log(`data/real/summary.json: ${towns.length} towns from ${files.length} files`);
