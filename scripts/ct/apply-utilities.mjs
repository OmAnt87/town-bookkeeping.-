#!/usr/bin/env node
// Updates the Connecticut files in data/real in place: adds town-owned utilities (from the
// Census Bureau's finance survey) to money in and out for each town's fiscal year, and rebuilds
// the history. Political money and other sections stay as they are, so this needs only
// data/raw/ct from scripts/ct/download.mjs, not the campaign-finance cache.
// build-county.mjs does the same as part of a full build.
//
//   node scripts/ct/apply-utilities.mjs && node scripts/build-summary.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyUtilities, censusUtilities, utilityKey } from './utilities.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'ct');
const OUT = join(ROOT, 'data', 'real');

// The state's rows by tax code, as build-county.mjs groups them by town.
const byCode = new Map();
const names = new Map();
for (const r of JSON.parse(readFileSync(join(RAW, 'fs.json'), 'utf8'))) {
  names.set(r.entity_name, r.tax_code);
  const t = byCode.get(r.tax_code) || byCode.set(r.tax_code, { fs: {}, town: {} }).get(r.tax_code);
  t.fs[r.year] = r;
}
for (const r of JSON.parse(readFileSync(join(RAW, 'town.json'), 'utf8'))) {
  const t = byCode.get(names.get(r.town));
  if (t) t.town[r.fiscal_year_end] = r;
}
const utilities = censusUtilities(RAW);

const { files } = JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8'));
const added = [];
for (const file of files.filter((f) => f.startsWith('ct-'))) {
  const data = JSON.parse(readFileSync(join(OUT, file), 'utf8'));
  for (const town of data.towns) {
    const t = byCode.get(town.ctTaxCode);
    if (!t?.fs[town.fiscalYear]) throw new Error(`${town.name}: no FY ${town.fiscalYear} financial statements in fs.json`);
    const u = applyUtilities(town, t, utilities.get(utilityKey(town.name)));
    if (u) added.push(`${town.name} ($${Math.round(u.revenue / 1e6)}M in, $${Math.round(u.spending / 1e6)}M out)`);
  }
  writeFileSync(join(OUT, file), `${JSON.stringify(data, null, 1)}\n`);
}
console.log(`Town-owned utilities added for ${added.length} towns: ${added.join('; ')}`);
