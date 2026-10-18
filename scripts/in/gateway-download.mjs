#!/usr/bin/env node
// Downloads the raw Indiana inputs into data/raw/in/ (gitignored):
//   - Indiana Gateway (Department of Local Government Finance and State Board of Accounts)
//     Annual Financial Report data: detailed receipts, disbursements by fund (and by fund and
//     department), and debt, for counties, townships, cities and towns, and special units (for
//     the Consolidated City of Indianapolis), into gateway/<report>-<unit type>-<year>.bin
//     (pipe-delimited)
//   - Census 2025 population estimates for IN and the 2024 gazetteers (counties, places and
//     county subdivisions) for population and map location
//
//   node scripts/in/gateway-download.mjs [--force]   then: node scripts/in/gateway-build.mjs --all
//
// The download page is an ASP.NET form: a first post selects the data set, a second asks for the
// file.

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'in');
const DIR = join(RAW, 'gateway');
const JAR = join(RAW, 'gateway-cookies.txt');
export const GATEWAY_PAGE = 'https://gateway.ifionline.org/public/download.aspx';
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_18.csv';
export const GATEWAY_YEARS = [2023, 2024];
const REPORTS = { rcpt: 'Detailed Receipts', disbf: 'Disbursements by Fund', disb: 'Disbursements by Fund and Department', debt: 'Debt' };
const UNITS = { county: 'County', township: 'Township', citytown: 'City/Town', special: 'Special' };
const P = 'ctl00$ContentPlaceHolder1$';

const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', ...a], { maxBuffer: 1 << 28 });
const hidden = (html) => Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"/g)]
  .map((m) => [m[1], m[2].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")]));
const post = (fields, out) => curl('-b', JAR, '-c', JAR, ...(out ? ['-o', out] : []), '--data-binary', new URLSearchParams(fields).toString(),
  '-H', 'Content-Type: application/x-www-form-urlencoded', GATEWAY_PAGE);

function download(report, unit, year, out) {
  const pick = { [`${P}RadComboBox1`]: 'Annual Financial Reports', [`${P}RadComboBox2`]: report, [`${P}DropDownListUnitType`]: unit, [`${P}DropDownListYear`]: String(year) };
  const page = curl('-b', JAR, '-c', JAR, GATEWAY_PAGE).toString('utf8');
  const selected = post({ ...hidden(page), ...pick, __EVENTTARGET: `${P}RadComboBox1` }).toString('utf8');
  post({ ...hidden(selected), ...pick, [`${P}button_download1`]: 'Download' }, out);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs();
  mkdirSync(DIR, { recursive: true });
  for (const year of GATEWAY_YEARS) {
    for (const [u, unit] of Object.entries(UNITS)) {
      for (const [r, report] of Object.entries(REPORTS)) {
        // Townships have no departments; their by-fund report is the whole.
        if (r === 'disb' && (u === 'township' || u === 'special')) continue;
        const out = join(DIR, `${r}-${u}-${year}.bin`);
        if (!args.force && existsSync(out) && statSync(out).size > 1000) { console.log(`cached ${out}`); continue; }
        download(report, unit, year, out);
        console.log(`${report}, ${unit}, ${year} -> ${out}`);
      }
    }
  }
  const census = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });
  census('-o', join(RAW, 'popest.csv'), POP);
  for (const g of ['counties', 'place', 'cousubs']) {
    census('-o', join(RAW, `gaz-${g}.zip`), `${GAZ}/2024_Gaz_${g}_national.zip`);
    execFileSync('unzip', ['-o', '-q', join(RAW, `gaz-${g}.zip`), '-d', RAW], { stdio: 'inherit' });
  }
  console.log('Done. Next: node scripts/in/gateway-build.mjs --all');
}
