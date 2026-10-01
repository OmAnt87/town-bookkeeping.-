#!/usr/bin/env node
// Downloads Connecticut State Elections Enforcement Commission (SEEC) receipts for
// party and political action committees into data/raw/ct/ (gitignored). Town party
// committees ("Greenwich Republican Town Committee") file here; candidates for town
// office file with their town clerk instead.
//
//   node scripts/ct/fetch-seec.mjs

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'ct');
const BASE = 'https://seec.ct.gov/ecrisreporting/Data/eCrisDownloads/exportdatafiles';
const XLSX_TO_CSV = `
import csv, sys, openpyxl
ws = openpyxl.load_workbook(sys.argv[1], read_only=True).active
with open(sys.argv[2], 'w', newline='', encoding='latin1', errors='replace') as f:
    w = csv.writer(f, quoting=csv.QUOTE_ALL)
    for row in ws.iter_rows(values_only=True):
        w.writerow(['' if v is None else (v.strftime('%m/%d/%Y') if hasattr(v, 'strftime') else v) for v in row])
`;
mkdirSync(RAW, { recursive: true });
const thisYear = new Date().getFullYear();
for (let y = thisYear - 3; y <= thisYear; y++) {
  const out = join(RAW, `seec_party_${y}.csv`);
  const url = `${BASE}/Receipts${y}CalendarYearPartyPACCommittees`;
  try {
    execFileSync('curl', ['-sSfL', '-m', '900', '-A', 'Mozilla/5.0', '-o', out, `${url}.csv`], { stdio: 'pipe' });
    console.log(`SEEC ${y}`);
  } catch {
    // Older years are published only as Excel workbooks.
    try {
      const xlsx = join(RAW, `seec_party_${y}.xlsx`);
      execFileSync('curl', ['-sSfL', '-m', '900', '-A', 'Mozilla/5.0', '-o', xlsx, `${url}.xlsx`], { stdio: 'pipe' });
      execFileSync('python3', ['-c', XLSX_TO_CSV, xlsx, out], { stdio: 'inherit' });
      console.log(`SEEC ${y} (from Excel)`);
    } catch {
      console.log(`SEEC ${y}: not published`);
    }
  }
}
