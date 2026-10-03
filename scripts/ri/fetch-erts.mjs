#!/usr/bin/env node
// Caches Rhode Island campaign finance data from the Board of Elections' Electronic Reporting
// and Tracking System (ERTS, ricampaignfinance.com) into data/raw/ri/erts/:
//   - filers for local office: mayor/administrator, city/town council, school committee and
//     other city/town office (name, address, city, status), and filers for state office, since a
//     filer keeps one account across offices and state officials are left out of local money
//   - every PAC contribution statewide since January 1 three years ago, exported to CSV one
//     quarter at a time; build-county.mjs keeps the ones to local candidates and party committees
//
//   node scripts/ri/fetch-erts.mjs [--force]

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'ri', 'erts');
const SITE = 'https://ricampaignfinance.com/RIPublic';
const JAR = join(DIR, 'erts.cookies');
const args = parseArgs();
const curl = (...a) => execFileSync('curl', ['-sSf', '--retry', '4', '--retry-all-errors', '-m', '900', '-A', 'Mozilla/5.0', '-b', JAR, '-c', JAR, ...a], { maxBuffer: 1 << 30 }).toString('latin1');
const hidden = (html) => Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"/g)].map((m) => [m[1], m[2]]));
const form = (o) => Object.entries(o).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
const decode = (s) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();

export const OFFICES = { 8: 'Mayor/Administrator', 9: 'City/Town Council', 10: 'School Committee', 11: 'Other City/Town Office' };
export const STATE_OFFICES = { 1: 'Governor', 2: 'Lieutenant Governor', 3: 'Secretary of State', 4: 'Treasurer', 5: 'Attorney General', 6: 'State Senator', 7: 'State Representative' };

mkdirSync(DIR, { recursive: true });

// Filers by office, from the filings search (an ASP.NET postback).
for (const [code, office] of Object.entries({ ...OFFICES, ...STATE_OFFICES })) {
  const file = join(DIR, `filers-${code}.json`);
  if (existsSync(file) && !args.force) { console.log(`cached ${file}`); continue; }
  const page = curl(`${SITE}/Filings.aspx`);
  const html = curl('--data', form({
    ...hidden(page), txtOrgLastName: '', txtOrgFirstName: '', txtOrgCity: '', txtOrgState: '', txtOrgZip: '',
    lstOffice: code, lstParty: 'All', lstDisplayResults: 'All', lnkSubSearchOrg: 'Search',
  }), `${SITE}/Filings.aspx`);
  const rows = [...html.matchAll(/<tr class="Grid(?:Alt)?Item"[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => [...m[1].matchAll(/<td>([\s\S]*?)<\/td>/g)].map((c) => decode(c[1].replace(/<[^>]+>/g, ''))))
    .filter((c) => c.length === 5)
    .map(([name, address, city, state, status]) => ({ name, address, city, state, status, office }));
  if (!rows.length) throw new Error(`No filers found for ${office}`);
  writeFileSync(file, JSON.stringify(rows));
  console.log(`ERTS ${office}: ${rows.length} filers -> ${file}`);
}

// PAC contributions, one CSV export per quarter.
const pad = (n) => String(n).padStart(2, '0');
const thisYear = new Date().getFullYear();
const today = new Date();
for (let y = thisYear - 3; y <= thisYear; y++) {
  for (let q = 0; q < 4; q++) {
    const start = new Date(Date.UTC(y, q * 3, 1));
    if (start > today) break;
    const end = new Date(Date.UTC(y, q * 3 + 3, 0));
    const file = join(DIR, `pac-${y}-q${q + 1}.csv`);
    const current = end >= today;
    if (existsSync(file) && !args.force && !current) { console.log(`cached ${file}`); continue; }
    const us = (d) => `${pad(d.getUTCMonth() + 1)}/${pad(d.getUTCDate())}/${d.getUTCFullYear()}`;
    const url = `${SITE}/Reporting/TransactionReport.aspx?${form({
      OrgID: 0, BeginDate: us(start), EndDate: us(end), LastName: '%', FirstName: '', ContType: 4, State: '', City: '', ZIPCode: '', EmployerName: '',
      Amount: 0, ReportType: 'Contrib', CFStatus: 'F', MPFStatus: 'A', Level: 'S', SumBy: 'Type', Sort1: 'ReceiptDate', Direct1: 'desc',
      Sort2: 'None', Direct2: 'asc', Sort3: 'None', Direct3: 'asc', Site: 'Public', Incomplete: 'A', ContSource: 'CF',
    })}`;
    const report = curl(url);
    // A quarter with no contributions yet has no export link.
    if (!/lnkExport/.test(report)) { console.log(`ERTS PAC contributions ${us(start)}-${us(end)}: none yet`); continue; }
    const exported = curl('--data', form({ ...hidden(report), __EVENTTARGET: 'lnkExport', __EVENTARGUMENT: '' }), url);
    const guid = exported.match(/file=([0-9a-f-]+\.csv)/i)?.[1];
    if (!guid) throw new Error(`No export for ${y} Q${q + 1}`);
    writeFileSync(file, curl(`${SITE}/TempReports/${guid}`), 'latin1');
    console.log(`ERTS PAC contributions ${us(start)}-${us(end)} -> ${file}`);
  }
}
if (existsSync(JAR)) rmSync(JAR);
console.log('Done. Next: node scripts/ri/build-county.mjs --all');
