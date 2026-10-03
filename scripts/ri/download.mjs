#!/usr/bin/env node
// Downloads the raw Rhode Island inputs into data/raw/ri/ (gitignored):
//   - Division of Municipal Finance, Municipal Transparency Portal "All Data" (audited actual
//     revenue and spending under the state's uniform chart of accounts, FY 2016 on)
//   - Census 2025 population estimates for RI towns and the 2024 gazetteer (county subdivisions)
//
//   node scripts/ri/download.mjs      then: node scripts/ri/build-county.mjs --all
//
// municipalfinance.ri.gov sits behind a Cloudflare browser check, so a plain download is
// refused. The script then uses Playwright (npm i playwright) if it is installed; otherwise
// download the file in a browser and save it as data/raw/ri/mtp.csv.

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'ri');
export const MTP_PAGE = 'https://municipalfinance.ri.gov/municipal-transparency/mtp-docs-data/all-data';
export const MTP_CSV = 'https://municipalfinance.ri.gov/sites/g/files/xkgbur546/files/2025-11/Q%20ALL%20DKAN%20data.csv';
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_44.csv';
const args = parseArgs();
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });

async function viaBrowser(out) {
  let chromium;
  try { ({ chromium } = await import('playwright')); } catch { return false; }
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  const browser = await chromium.launch({ proxy, args: ['--disable-blink-features=AutomationControlled'] });
  try {
    const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36', ignoreHTTPSErrors: !!proxy });
    const page = await ctx.newPage();
    await page.goto(MTP_PAGE, { timeout: 60000 });
    await page.waitForTimeout(8000); // let the browser check finish
    const res = await ctx.request.get(MTP_CSV, { timeout: 600000 });
    if (!res.ok()) throw new Error(`HTTP ${res.status()}`);
    writeFileSync(out, await res.body());
    return true;
  } finally { await browser.close(); }
}

mkdirSync(RAW, { recursive: true });
const mtp = join(RAW, 'mtp.csv');
if (existsSync(mtp) && !args.force) console.log(`cached ${mtp}`);
else {
  let ok = false;
  try { curl('-o', mtp, MTP_CSV); ok = true; } catch { console.log('Plain download refused (Cloudflare browser check); trying Playwright.'); }
  if (!ok) ok = await viaBrowser(mtp);
  if (!ok) {
    console.error(`Could not download the Municipal Transparency Portal data.\nOpen ${MTP_PAGE} in a browser, download "MTP All Data", and save it as ${mtp}.`);
    process.exit(1);
  }
  console.log(`Municipal Transparency Portal -> ${mtp}`);
}
curl('-o', join(RAW, 'popest.csv'), POP);
curl('-o', join(RAW, 'gaz-cousubs.zip'), `${GAZ}/2024_Gaz_cousubs_national.zip`);
execFileSync('unzip', ['-o', '-q', join(RAW, 'gaz-cousubs.zip'), '-d', RAW], { stdio: 'inherit' });
console.log('Done. Next: node scripts/ri/fetch-erts.mjs, then node scripts/ri/build-county.mjs --all');
