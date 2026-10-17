#!/usr/bin/env node
// Downloads the raw Georgia inputs into data/raw/ga/ (gitignored):
//   - Department of Community Affairs, Report of Local Government Finance (RLGF): each county,
//     city and consolidated government's annual report (Excel), FY 2020 on (the UCOA form with
//     its machine-readable LOAD1 sheet). The DCA viewer lists each government's reports.
//   - Census 2025 population estimates for GA and the 2024 gazetteers (counties and places)
//
//   node scripts/ga/download.mjs      then: python3 scripts/ga/rlgf-to-json.py
//                                     and:  node scripts/ga/build-county.mjs --all

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'ga');
export const RLGF_VIEWER = 'https://apps.dca.ga.gov/RLGF/Default.aspx';
export const RLGF_PAGE = 'https://dca.georgia.gov/community-assistance/government-authority-reporting/report-local-government-finance-rlgf';
const DOCS = 'https://apps.dca.ga.gov';
export const FIRST_YEAR = 2020; // the UCOA form with the LOAD1 sheet
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_13.csv';
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '--retry-all-errors', '-m', '300', '-A', 'Mozilla/5.0', ...a], { maxBuffer: 1 << 28 });

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs();
  mkdirSync(join(RAW, 'rlgf'), { recursive: true });
  const indexFile = join(RAW, 'rlgf-index.json');
  let index = existsSync(indexFile) && !args.force ? JSON.parse(readFileSync(indexFile, 'utf8')) : null;
  if (!index) {
    // The viewer is an ASP.NET form: choosing a government posts the page back with its links.
    const page = curl(RLGF_VIEWER).toString('latin1');
    const hidden = Object.fromEntries([...page.matchAll(/<input type="hidden" name="(__[A-Z]+)" id="__[A-Z]+" value="([^"]*)"/g)].map((m) => [m[1], m[2]]));
    const govs = [...page.matchAll(/<option value="(\d+)">([^<]*)/g)].map((m) => ({ id: m[1], name: m[2].trim() }));
    index = [];
    for (const g of govs) {
      const form = new URLSearchParams({ ...hidden, __EVENTTARGET: 'ctl00$bodyContent$ddlGovs', __EVENTARGUMENT: '', 'ctl00$bodyContent$ddlGovs': g.id });
      const html = curl('--data', form.toString(), RLGF_VIEWER).toString('latin1');
      const files = Object.fromEntries([...html.matchAll(/href="([^"]*\/RLGF\/\d+_(\d{4})_RLGF_[^"]*\.xlsx?)"/gi)].map((m) => [m[2], m[1]]));
      index.push({ ...g, files });
    }
    writeFileSync(indexFile, `${JSON.stringify(index, null, 1)}\n`);
    console.log(`RLGF index: ${index.length} governments -> ${indexFile}`);
  }
  let fetched = 0;
  for (const g of index) {
    for (const [year, path] of Object.entries(g.files)) {
      if (Number(year) < FIRST_YEAR) continue;
      const out = join(RAW, 'rlgf', `${g.id}_${year}${path.toLowerCase().endsWith('.xlsx') ? '.xlsx' : '.xls'}`);
      if (existsSync(out) && statSync(out).size > 0 && !args.force) continue;
      try { curl('-o', out, DOCS + encodeURI(decodeURI(path))); fetched++; } catch (e) { console.error(`failed: ${g.name} ${year}: ${e.message.split('\n')[0]}`); }
    }
  }
  console.log(`RLGF files downloaded: ${fetched}`);
  curl('-o', join(RAW, 'popest.csv'), POP);
  for (const k of ['counties', 'place']) {
    curl('-o', join(RAW, `gaz-${k}.zip`), `${GAZ}/2024_Gaz_${k}_national.zip`);
    execFileSync('unzip', ['-o', '-q', join(RAW, `gaz-${k}.zip`), '-d', RAW], { stdio: 'inherit' });
  }
  console.log('Done. Next: python3 scripts/ga/rlgf-to-json.py, then node scripts/ga/build-county.mjs --all');
}
