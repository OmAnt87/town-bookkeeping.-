#!/usr/bin/env node
// Downloads the raw Massachusetts inputs into data/raw/ma/ (gitignored):
//   - Division of Local Services (DLS) Schedule A general fund revenue and spending by function,
//     one Excel export per fiscal year, for all 351 cities and towns
//   - DLS local receipts (motor vehicle and other excise), to separate property tax from other local taxes
//   - DLS long-term debt
//   - Census 2025 population estimates for MA towns and the 2024 gazetteer (county subdivisions)
//
//   node scripts/ma/download.mjs [--from 2014]      then: python3 scripts/ma/dls-to-json.py

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'ma');
const DLS = 'https://dls-gw.dor.state.ma.us/reports/rdPage.aspx';
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_25.csv';
const JAR = join(RAW, 'dls.cookies');
const args = parseArgs();
const curl = (...a) => execFileSync('curl', ['-sSf', '--retry', '4', '--retry-all-errors', '-m', '900', '-A', 'Mozilla/5.0', '-b', JAR, '-c', JAR, ...a], { maxBuffer: 1 << 28 }).toString('latin1');

// DLS reports are Logi Analytics pages: open the report once (session cookie and the list
// of municipality codes), then post the form to the Excel export, which redirects to the file.
function dlsExport(report, table, form, out) {
  if (existsSync(out) && !args.force) return console.log(`cached ${out}`);
  const page = curl(`${DLS}?rdReport=${report}`);
  const munis = [...new Set([...page.matchAll(/name="iclMuni"[^>]*?value="(\d{3})"/gi)].map((m) => m[1]))];
  if (munis.length !== 351) throw new Error(`${report}: expected 351 municipalities, found ${munis.length}`);
  const body = [...Object.entries(form).flatMap(([k, v]) => [v].flat().map((x) => `${k}=${encodeURIComponent(x)}`)), ...munis.map((m) => `iclMuni=${m}`)].join('&');
  const url = `${DLS}?rdReport=${report}&rdReportFormat=NativeExcel&rdExportTableID=${table}&rdExportFilename=export&rdShowGridlines=True&rdExcelOutputFormat=Excel2007`;
  const loc = curl('-o', '/dev/null', '-w', '%{redirect_url}', '--data', body, url).trim();
  if (!loc) throw new Error(`${report}: no export redirect`);
  curl('-o', out, loc);
  console.log(`DLS ${report} ${JSON.stringify(form)} -> ${out}`);
}

mkdirSync(RAW, { recursive: true });
const thisYear = new Date().getFullYear();
const from = Number(args.from || 2014);
for (let y = from; y <= thisYear; y++) {
  for (const type of ['Revenues', 'Expenditures']) {
    try {
      dlsExport('ScheduleA.GeneralFund', 'xtGenFund', { islAmountType: type, islYear: y }, join(RAW, `gf-${type.toLowerCase()}-${y}.xlsx`));
    } catch (e) { console.error(`FY ${y} ${type}: ${e.message}`); }
  }
}
// Actual local receipts (all receipt types) for the years the report offers.
const lr = curl(`${DLS}?rdReport=TaxRateRecap.PAGE3.LocalReceiptsAct_vs_Est`);
const recTypes = [...new Set([...lr.matchAll(/name="iclRecType"[^>]*?value="(\d+)"/gi)].map((m) => m[1]))];
const lrYears = [...new Set([...lr.matchAll(/name="iclYear"[^>]*?value="(\d{4})"/gi)].map((m) => Number(m[1])))].filter((y) => y >= from && y <= thisYear);
for (const y of lrYears) {
  dlsExport('TaxRateRecap.PAGE3.LocalReceiptsAct_vs_Est', 'LocalReciptes', { iclRecType: recTypes, iclYear: y }, join(RAW, `local-receipts-${y}.xlsx`));
}
const ltd = curl(`${DLS}?rdReport=Dashboard.Cat_6_Reports.LongTermDebt351`);
const debtYears = [...new Set([...ltd.matchAll(/name="iclYear"[^>]*?value="(\d{4})"/gi)].map((m) => m[1]))];
dlsExport('Dashboard.Cat_6_Reports.LongTermDebt351', 'tblLongTermDebt', { iclYear: debtYears }, join(RAW, 'long-term-debt.xlsx'));

execFileSync('curl', ['-sSfL', '-m', '900', '-o', join(RAW, 'popest.csv'), POP], { stdio: 'inherit' });
execFileSync('curl', ['-sSfL', '-m', '900', '-o', join(RAW, 'gaz-cousubs.zip'), `${GAZ}/2024_Gaz_cousubs_national.zip`], { stdio: 'inherit' });
execFileSync('unzip', ['-o', '-q', join(RAW, 'gaz-cousubs.zip'), '-d', RAW], { stdio: 'inherit' });
if (existsSync(JAR) && readFileSync(JAR, 'utf8')) rmSync(JAR);
console.log('Done. Next: python3 scripts/ma/dls-to-json.py');
