#!/usr/bin/env node
// Downloads the raw Massachusetts inputs into data/raw/ma/ (gitignored):
//   - Division of Local Services (DLS) Municipal Databank exports, one xlsx per report and year:
//       Schedule A general fund revenues and expenditures (FY2016 on),
//       long-term debt outstanding and population (Schedule A Part 10),
//       certified tax levies by class
//   - Census 2025 population estimates for MA cities and towns
//   - Census 2024 gazetteers (county subdivisions)
//
//   node scripts/ma/download.mjs      then: pip install openpyxl && python3 scripts/ma/dls-to-json.py

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'ma');
const DLS = 'https://dls-gw.dor.state.ma.us/reports/rdPage.aspx';
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_25.csv';
const JAR = join(RAW, 'cookies.txt');
const curl = (...a) => execFileSync('curl', ['-sSf', '-m', '900', '-A', 'Mozilla/5.0', '-c', JAR, '-b', JAR, ...a], { maxBuffer: 1 << 28 });

mkdirSync(RAW, { recursive: true });

// The Databank is a Logi Analytics site: each report page lists every municipality
// as a checkbox (by DOR code or by name, depending on the report); posting the form
// with an Excel export format answers with a redirect to the generated file.

// The gateway sometimes drops a connection mid-download; try each export a few times.
function exportReport(...a) {
  for (let i = 1; ; i++) {
    try { return exportOnce(...a); } catch (e) { if (i === 3) throw e; }
  }
}

function exportOnce(report, table, form, file) {
  const url = `${DLS}?rdReport=${report}&rdReportFormat=NativeExcel&rdExportTableID=${table}&rdExportFilename=x&rdShowGridlines=True&rdExcelOutputFormat=Excel2007`;
  const page = curl(`${DLS}?rdReport=${report}`).toString(); // also opens the report session
  const munis = [...page.matchAll(/name="iclMuni"[^>]*value="([^"]+)"/g)].map((m) => m[1].replace(/&amp;/g, '&'));
  if (munis.length < 351) throw new Error(`${report}: expected 351 municipalities on the page, found ${munis.length}`);
  const loc = curl('-X', 'POST', url, '--data-urlencode', `iclMuni=${munis.join(',')}`, '--data', form, '-o', '/dev/null', '-w', '%{redirect_url}').toString();
  if (!loc) throw new Error(`${report}: no export file`);
  curl('-o', join(RAW, file), loc);
  console.log(`DLS ${report} ${form} -> ${file}`);
}

const thisYear = new Date().getFullYear();
for (let y = 2016; y <= thisYear; y++) {
  for (const type of ['Revenues', 'Expenditures']) {
    const file = `schedA_${type.toLowerCase()}_${y}.xlsx`;
    try { exportReport('ScheduleA.GeneralFund', 'xtGenFund', `islYear=${y}&islAmountType=${type}`, file); } catch (e) {
      if (existsSync(join(RAW, file))) rmSync(join(RAW, file));
      console.log(`DLS Schedule A ${type} ${y}: not available (${e.message.split('\n')[0]})`);
    }
  }
}
const years = Array.from({ length: thisYear - 2015 }, (_, i) => 2016 + i);
exportReport('Dashboard.Cat_6_Reports.LongTermDebt351', 'tblLongTermDebt', `iclYear=${years.join(',')}`, 'debt.xlsx');
exportReport('PropertyTaxInformation.TaxLevies.LeviesByClass', 'tblTaxlevybyclass', `iclYear=${[...years, thisYear + 1].join(',')}`, 'levies.xlsx');

execFileSync('curl', ['-sSfL', '-m', '900', '-A', 'Mozilla/5.0', '-o', join(RAW, 'popest.csv'), POP], { stdio: 'inherit' });
execFileSync('curl', ['-sSfL', '-m', '900', '-A', 'Mozilla/5.0', '-o', join(RAW, 'gaz-cousubs.zip'), `${GAZ}/2024_Gaz_cousubs_national.zip`], { stdio: 'inherit' });
execFileSync('unzip', ['-o', '-q', join(RAW, 'gaz-cousubs.zip'), '-d', RAW], { stdio: 'inherit' });
console.log('Done. Next: python3 scripts/ma/dls-to-json.py');
