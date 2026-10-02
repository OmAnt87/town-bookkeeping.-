#!/usr/bin/env node
// Caches Massachusetts campaign finance data from the Office of Campaign and Political Finance
// (OCPF, api.ocpf.us) into data/raw/ma/ocpf/:
//   - local filers: party town, city and ward committees (year-end reports) and mayoral and
//     city council candidates (bank depository reports), for this year and the three before
//   - every committee, union/association and registered PAC contribution statewide since
//     January 1 three years ago; build-county.mjs keeps the ones to local filers
//
//   node scripts/ma/fetch-ocpf.mjs [--force]

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'ma', 'ocpf');
const API = 'https://api.ocpf.us';
const args = parseArgs();
const get = (path) => JSON.parse(execFileSync('curl', ['-sSf', '--retry', '4', '--retry-all-errors', '-m', '300', `${API}/${path}`], { maxBuffer: 1 << 28 }).toString());
const save = (file, data) => { writeFileSync(join(DIR, file), JSON.stringify(data)); console.log(`OCPF -> ${file}`); };
const fresh = (file) => args.force || !existsSync(join(DIR, file));

mkdirSync(DIR, { recursive: true });
const thisYear = new Date().getFullYear();
const since = thisYear - 3;
for (let y = since; y <= thisYear; y++) {
  // The current year's lists change as filers report, so they are always refreshed.
  const always = y === thisYear;
  if (always || fresh(`lpc-${y}.json`)) save(`lpc-${y}.json`, ['D', 'R'].flatMap((p) => get(`reports/lpc/${y}?reportTypeId=&partyAffiliation=${p}&pageSize=1000`)));
  if (always || fresh(`mayoral-${y}.json`)) save(`mayoral-${y}.json`, get(`reports/mayoral/depository/${y}?onBallot=false`));
  if (always || fresh(`cc-${y}.json`)) save(`cc-${y}.json`, get(`reports/cc/ytd/${y}?PageSize=1000&districtCodeSought=&SortField=Cash%20On%20Hand&SortDirection=desc&onBallot=false`).reports);
}

// 202 committee, 203 union/association, 299 registered PACs (a subset of 202, kept to tell PACs apart).
const PAGE = 1000;
for (const rt of [202, 203, 299]) {
  const items = [];
  for (let start = 1; ; start += PAGE) {
    const q = new URLSearchParams({
      searchTypeCategory: 'A', startDate: `01/01/${since}`, endDate: '', pagesize: PAGE, startIndex: start, sortField: '', sortDirection: 'DESC',
      cpfId: '', recordTypeId: rt, name: '', cityCode: '-1', state: '', zipCode: '', occupation: '', employer: '', minAmount: '', maxAmount: '',
      description: '', filerFullNameReverse: '', withSummary: 'true',
    });
    const page = get(`search/items?${q}`);
    items.push(...page.items);
    if (items.length >= page.summary.count || !page.items.length) break;
  }
  save(`items-${rt}.json`, items);
}
console.log('Done. Next: node scripts/ma/build-county.mjs --all');
