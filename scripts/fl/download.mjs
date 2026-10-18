#!/usr/bin/env node
// Downloads the raw Florida inputs into data/raw/fl/ (gitignored):
//   - Office of Economic and Demographic Research (EDR), "Expenditures and Revenues Reported by
//     Florida's County / Municipal Governments": one revenue and one expenditure workbook per
//     government, by Uniform Accounting System account code and fund type, compiled from the
//     Annual Financial Reports filed with the Department of Financial Services (FY 2008 on)
//   - Census 2025 population estimates for FL and the 2024 gazetteers (counties and places)
//
//   node scripts/fl/download.mjs      then: python3 scripts/fl/edr-to-json.py
//                                     and:  node scripts/fl/build-county.mjs --all

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'fl');
export const EDR_BASE = 'https://www.edr.state.fl.us/Content/local-government/data/revenues-expenditures';
export const EDR_PAGE = { county: `${EDR_BASE}/cntyfiscal.cfm`, muni: `${EDR_BASE}/munifiscal.cfm` };
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_12.csv';
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '--retry-all-errors', '-m', '300', '-A', 'Mozilla/5.0', ...a], { maxBuffer: 1 << 28 });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs();
  mkdirSync(join(RAW, 'edr'), { recursive: true });
  const list = [];
  for (const [kind, page] of Object.entries(EDR_PAGE)) {
    const html = curl(page).toString('latin1');
    for (const m of html.matchAll(/href="((?:cntyfiscal|munifiscal)\/([a-z0-9-]+)revenues\.xlsx)"[^>]*>([^<]*?)(?:\s|&nbsp;)+revenues/gi)) {
      list.push({ kind, slug: m[2], name: m[3].replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').trim(), revenues: `${EDR_BASE}/${m[1]}`, expenditures: `${EDR_BASE}/${m[1].replace(/revenues\.xlsx$/, 'expenditures.xlsx')}` });
    }
  }
  writeFileSync(join(RAW, 'edr-index.json'), `${JSON.stringify(list, null, 1)}\n`);
  let fetched = 0;
  for (const g of list) {
    for (const part of ['revenues', 'expenditures']) {
      const out = join(RAW, 'edr', `${g.kind}-${g.slug}-${part}.xlsx`);
      if (existsSync(out) && statSync(out).size > 0 && !args.force) continue;
      try { curl('-o', out, g[part]); fetched++; } catch (e) { console.error(`failed: ${g.name} ${part}: ${e.message.split('\n')[0]}`); }
    }
  }
  console.log(`EDR: ${list.length} governments, ${fetched} workbooks downloaded`);
  curl('-o', join(RAW, 'popest.csv'), POP);
  for (const k of ['counties', 'place']) {
    curl('-o', join(RAW, `gaz-${k}.zip`), `${GAZ}/2024_Gaz_${k}_national.zip`);
    execFileSync('unzip', ['-o', '-q', join(RAW, `gaz-${k}.zip`), '-d', RAW], { stdio: 'inherit' });
  }
  console.log('Done. Next: python3 scripts/fl/edr-to-json.py, then node scripts/fl/build-county.mjs --all');
}
