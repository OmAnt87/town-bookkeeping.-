#!/usr/bin/env node
// Caches North Carolina campaign finance receipts from the State Board of Elections'
// transaction search (cf.ncsbe.gov/CFTxnLkup/) into data/raw/nc/ncsbe/: for each month since
// January three years ago, every contribution from a political committee, non-profit or other
// non-individual source, kept when it went to a candidate for a county or municipal office.
//
//   node scripts/nc/fetch-ncsbe.mjs [--force]
//
// The search pages its results 500 at a time. Filtering by office or committee type on the
// server times out, so receipts are fetched by type and date and filtered here.

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';
import { LOCAL_OFFICES, NCSBE_PAGE } from './ncsbe-map.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'nc', 'ncsbe');
const JAR = join(DIR, '.cookies');
const RECEIPT_TYPES = ['CPCM', 'NFPC', 'GEN '];
const PAGE = 500;
const KEEP = ['FullName', 'OrgName', 'TransSubTypeCode', 'CommName', 'SboeID', 'CommTypeCode', 'CandOfficeCode', 'CommCity', 'CommZip', 'OccurDate', 'Amount', 'GroupID', 'City', 'State'];
const args = parseArgs();
const curl = (...a) => execFileSync('curl', ['-sSf', '--retry', '4', '--retry-all-errors', '-m', '180', '-A', 'Mozilla/5.0', '-b', JAR, '-c', JAR, ...a], { maxBuffer: 1 << 30 }).toString();

const params = (from, to) => ({
  ReceiptType: RECEIPT_TYPES.map((t) => `'${t}'`).join(','), ExpenditureType: "' '", CommitteeType: '', PartyType: '', OfficeType: '',
  CommitteeIDs: '', SelectedCommitteeNames: '', CommitteeName: '', Cities: '', Counties: '', State: '', ZipCodes: '',
  DateFrom: from, DateTo: to, OrganizationName: '', FirstName: '', LastName: '', NameSoundsLike: false, NameIsOrg: false,
  Purpose: '', AmountFrom: '', AmountTo: '', JobProfession: '', JobProfSoundsLike: false, Employer: '', EmployerSoundsLike: false,
  PaymentType: '', Page: 0, Debug: false, IsAdvancedSearch: false,
});

function page(p, n) {
  const u = new URL('/CFTxnLkup/Results', NCSBE_PAGE);
  for (const [k, v] of Object.entries({ handler: 'PagedData', searchParamsJson: JSON.stringify(p), pageSize: PAGE, page: n, take: PAGE, skip: (n - 1) * PAGE })) u.searchParams.set(k, v);
  for (let attempt = 1; ; attempt++) {
    const out = curl(u.toString());
    if (out.startsWith('{')) return JSON.parse(out);
    if (attempt === 3) throw new Error(`NCSBE search failed: ${out.slice(0, 80)}`);
  }
}

mkdirSync(DIR, { recursive: true });
curl('-o', '/dev/null', NCSBE_PAGE); // session cookie
const now = new Date();
const mm = (m) => String(m).padStart(2, '0');
for (let y = now.getFullYear() - 3; y <= now.getFullYear(); y++) {
  for (let m = 1; m <= 12; m++) {
    if (y === now.getFullYear() && m > now.getMonth() + 1) break;
    const out = join(DIR, `${y}-${mm(m)}.json`);
    const current = y === now.getFullYear() && m >= now.getMonth();
    if (existsSync(out) && !args.force && !current) continue;
    const last = new Date(y, m, 0).getDate();
    const p = params(`${mm(m)}/01/${y}`, `${mm(m)}/${last}/${y}`);
    const rows = [];
    let total = 0;
    for (let n = 1; ; n++) {
      const d = page(p, n);
      total = d.Total;
      for (const r of d.Data) {
        if (!['CNC', 'JNT'].includes(r.CommTypeCode) || !LOCAL_OFFICES[String(r.CandOfficeCode).trim()]) continue;
        rows.push(Object.fromEntries(KEEP.map((k) => [k, typeof r[k] === 'string' ? r[k].trim() : r[k]])));
      }
      if (n * PAGE >= total || !d.Data.length) break;
    }
    writeFileSync(out, `${JSON.stringify(rows)}\n`);
    console.log(`${y}-${mm(m)}: ${total} receipts, ${rows.length} to local candidates`);
  }
}
rmSync(JAR, { force: true });
