#!/usr/bin/env node
// Downloads Massachusetts Office of Campaign and Political Finance (OCPF) receipts for
// municipal candidates who file with the state into data/raw/ma/ocpf/ (gitignored):
// candidates for mayor, and candidates for city council in the cities where council
// candidates file with OCPF. Everyone else running for city or town office files with
// the city or town clerk.
//
//   node scripts/ma/fetch-ocpf.mjs          (re-running only fetches committees not cached yet;
//                                            --refresh fetches everything again)

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'ma', 'ocpf');
const API = 'https://api.ocpf.us';
const PAGE = 1000;
const args = parseArgs();
const get = (path) => {
  for (let i = 1; ; i++) {
    try {
      return JSON.parse(execFileSync('curl', ['-sSf', '-m', '300', '-A', 'Mozilla/5.0', `${API}/${path}`], { maxBuffer: 1 << 28 }).toString());
    } catch (e) { if (i === 3) throw e; }
  }
};

mkdirSync(RAW, { recursive: true });
const thisYear = new Date().getFullYear();
const since = thisYear - 3;

// Who files with OCPF: the year-to-date depository reports for mayor and city council.
const councils = get('districts').filter((d) => d.office === 'City Councilor');
const filers = new Map();
for (let y = since; y <= thisYear; y++) {
  const lists = [get(`reports/mayoral/depository/${y}?onBallot=false`)];
  for (const d of councils) lists.push(get(`reports/cc/ytd/${y}?PageSize=1000&districtCodeSought=${d.code}&onBallot=false`));
  for (const l of lists) {
    for (const r of Array.isArray(l) ? l : l.reports || []) {
      const [office, place] = String(r.officeSought || '').split(',').map((s) => s.trim());
      if (place && !filers.has(r.cpfId)) filers.set(r.cpfId, { cpfId: r.cpfId, name: r.filerName, office, municipality: place });
    }
  }
  console.log(`OCPF ${y}: ${filers.size} municipal filers so far`);
}
writeFileSync(join(RAW, 'filers.json'), JSON.stringify([...filers.values()], null, 1));

// Each filer's itemized receipts since January 1 three years back, a page at a time.
let fetched = 0;
for (const f of filers.values()) {
  const file = join(RAW, `${f.cpfId}.json`);
  if (existsSync(file) && !args.refresh) continue;
  const items = [];
  for (let i = 0; ; i += PAGE) {
    const page = get(`search/items?searchTypeCategory=A&filerCpfId=${f.cpfId}&startDate=1/1/${since}&endDate=12/31/${thisYear}&pageSize=${PAGE}&currentIndex=${i}`).items || [];
    items.push(...page);
    if (page.length < PAGE) break;
  }
  writeFileSync(file, JSON.stringify(items.map(({ id, reportId, date, amountValue, amount, recordTypeDescription, fullNameReverse, firstName, lastName, employer, occupation, principalOfficer, contributorCpfId, isTransfer }) => ({
    id, reportId, date, amount: amountValue ?? Number(String(amount).replace(/[$,]/g, '')), recordTypeDescription, fullNameReverse, firstName, lastName, employer, occupation, principalOfficer, contributorCpfId, isTransfer,
  }))));
  fetched++;
}
console.log(`OCPF receipts: ${fetched} committees fetched, ${filers.size} in all (data/raw/ma/ocpf/)`);
