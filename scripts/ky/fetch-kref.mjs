#!/usr/bin/env node
// Downloads Kentucky Registry of Election Finance data for local races into data/raw/ky/kref/
// (gitignored), from the Registry's public search:
//   - candidates.json: every candidate in each election from three years ago through this year, with the office
//     and location (county, or "City-County") they filed for
//   - contributions.json: contributions from PACs and organizations to candidates in those elections
// Individuals' contributions are not fetched (they are not counted).
//
//   node scripts/ky/fetch-kref.mjs      then: node scripts/ky/build-county.mjs --all
//
// The search returns HTML pages of results; each page is fetched with curl and parsed.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { KREF_SEARCH, CONTRIBUTION_TYPES, parseResultRows } from './kref-map.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'ky', 'kref');
const SINCE = `${new Date().getFullYear() - 3}-01-01`;
// Through this year's general election: its candidates are already raising money.
const UNTIL = `${new Date().getFullYear()}-12-31`;

const get = (path, params) => {
  const args = ['-sSfG', '--retry', '4', '-m', '300', '-A', 'Mozilla/5.0', `${KREF_SEARCH}/${path}`];
  for (const [k, v] of params) args.push('--data-urlencode', `${k}=${v}`);
  return execFileSync('curl', args, { maxBuffer: 1 << 28 }).toString('utf8');
};
const iso = (us) => { const [m, d, y] = us.split('/'); return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`; };

// Every page of a search, up to the result count the first page reports.
function allPages(path, params, size) {
  const out = [];
  let total = Infinity;
  // Pages are numbered from 0.
  for (let page = 0; out.length < total; page++) {
    const html = get(path, [...params, ['PageSize', size], ['PageIndex', page]]);
    if (page === 0) total = Number(html.match(/([\d,]+)\s*Result/)?.[1].replace(/,/g, '') || 0);
    const rows = parseResultRows(html);
    if (!rows.length) break;
    out.push(...rows);
  }
  if (out.length < total) console.warn(`${path} ${params.map((p) => p[1]).join(' ')}: ${out.length} of ${total} rows`);
  return out;
}

mkdirSync(RAW, { recursive: true });
const dates = JSON.parse(get('GetAllElectionDates', [])).filter((d) => iso(d) >= SINCE && iso(d) <= UNTIL);
const candidates = [];
const contributions = [];
for (const date of dates) {
  for (const type of JSON.parse(get('BallotSearch/GetElectionTypeByDate', [['electionDate', date]]))) {
    const params = [['ElectionDate', date], ['ElectionType', type]];
    const cands = allPages('CandidateSearch', params, 100);
    for (const [name, office, , location] of cands) candidates.push({ election: iso(date), type, name, office, location });
    const contribs = allPages('ToCandidateSearch', [...params, ...CONTRIBUTION_TYPES.map((t) => ['ContributionTypes', t])], 50);
    for (const [amount, cdate, madeTo, contributor, report, , contributionType] of contribs) {
      contributions.push({ election: iso(date), type, amount: Number(amount.replace(/[$,]/g, '')), date: cdate, madeTo, contributor, report, contributionType });
    }
    console.log(`${date} ${type}: ${cands.length} candidates, ${contribs.length} PAC and organization contributions`);
  }
}
writeFileSync(join(RAW, 'candidates.json'), `${JSON.stringify(candidates)}\n`);
writeFileSync(join(RAW, 'contributions.json'), `${JSON.stringify(contributions)}\n`);
console.log(`Done: ${candidates.length} candidates, ${contributions.length} contributions. Next: node scripts/ky/build-county.mjs --all`);
