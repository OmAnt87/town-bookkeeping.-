#!/usr/bin/env node
// Updates the Massachusetts files in data/real in place: adds each town's special revenue,
// capital projects and enterprise funds for its fiscal year to money in and out, and rebuilds
// its history. Political money and other sections stay as they are, so this needs only the
// converted DLS exports (data/raw/ma/dls.json), not the campaign-finance cache.
// build-county.mjs does the same as part of a full build.
//
//   node scripts/ma/download.mjs && python3 scripts/ma/dls-to-json.py
//   node scripts/ma/apply-other-funds.mjs && node scripts/build-summary.mjs

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyOtherFunds } from './dls-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'data', 'real');
const OTHER_PAGE = 'https://dls-gw.dor.state.ma.us/reports/rdPage.aspx?rdReport=ScheduleA.Special_Rev_Funds.SpecialRevFunds';
const SOURCE_LABEL = (y) => `MA Division of Local Services, Schedule A special revenue, capital projects and enterprise fund revenue and expenditures, FY ${y}`;

const dls = JSON.parse(readFileSync(join(ROOT, 'data', 'raw', 'ma', 'dls.json'), 'utf8')).towns;
const { files } = JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8'));
let updated = 0;
const none = [];
const unmapped = new Set();
for (const file of files.filter((f) => f.startsWith('ma-'))) {
  const data = JSON.parse(readFileSync(join(OUT, file), 'utf8'));
  for (const town of data.towns) {
    const t = dls[town.maDorCode];
    if (!t) throw new Error(`${town.name}: DOR code ${town.maDorCode} not in dls.json`);
    const { other } = applyOtherFunds(town, t, OTHER_PAGE);
    other.unmapped.forEach((u) => unmapped.add(u));
    town.sources = (town.sources || []).filter((s) => !/special revenue, capital projects and enterprise/.test(s.label));
    if (other.totals.revenue || other.totals.spending) {
      updated++;
      const at = town.sources.findIndex((s) => /general fund revenue and expenditures/.test(s.label));
      town.sources.splice(at + 1, 0, { label: SOURCE_LABEL(town.fiscalYear), url: OTHER_PAGE });
    } else none.push(`${town.name} (FY ${town.fiscalYear})`);
    town.notes = town.notes.map((n) => n.replace(/^Actual general-fund results for the fiscal year/, 'Actual results for the fiscal year'));
  }
  writeFileSync(join(OUT, file), `${JSON.stringify(data, null, 1)}\n`);
}
console.log(`${updated} towns with other funds; ${none.length} without: ${none.join(', ')}`);
if (unmapped.size) console.log(`Unmapped spending columns (spread as shared): ${[...unmapped].join(', ')}`);
