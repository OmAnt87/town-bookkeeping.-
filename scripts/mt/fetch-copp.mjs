#!/usr/bin/env node
// Downloads Montana Commissioner of Political Practices (COPP) campaign finance data into
// data/raw/mt/copp/ (gitignored), from its public Campaign Electronic Reporting System:
//   - candidates-<CN|CT>-<year>.json: every county (CN) and city (CT) candidate for each election
//     year since three years ago, with office, county of residence and mailing address
//   - contributions-<CN|CT>-<year>.csv: every contribution to those candidates (the search's
//     pipe-delimited download)
//
//   node scripts/mt/fetch-copp.mjs      then: node scripts/mt/build-county.mjs --all
//
// The search keeps its criteria in the server session, and the site's load balancer sends each
// request to a different server without carrying the session along. So each search collects a
// session on several servers, sends all of them in one cookie (each server uses the one it
// knows), and repeats the search until every server has it. The site is slow: a statewide
// download takes about a minute to build.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { COPP_PUBLIC } from './copp-map.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'mt', 'copp');
const FIRST_YEAR = new Date().getFullYear() - 3;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const SERVERS = 8;

let cookie = '';
const curl = (args, timeout = 900) => execFileSync('curl', ['-sS', '--retry', '4', '-m', String(timeout), '-A', UA, ...(cookie ? ['-H', `Cookie: ${cookie}`] : []), ...args], { maxBuffer: 1 << 30 }).toString('utf8');

function newSessions() {
  cookie = '';
  const ids = [];
  let ts = '';
  for (let i = 0; i < SERVERS; i++) {
    const head = curl(['-D', '-', '-o', '/dev/null', `${COPP_PUBLIC}/search`], 120);
    const id = head.match(/JSESSIONID=[A-F0-9]+/)?.[0];
    if (id) ids.push(id);
    ts = head.match(/TS01d6b3be=[0-9a-f]+/)?.[0] || ts;
  }
  cookie = [...ids, ts].filter(Boolean).join('; ');
}
const postAll = (path, form) => { for (let i = 0; i < SERVERS; i++) curl(['-o', '/dev/null', '-X', 'POST', `${COPP_PUBLIC}/searchResults/${path}`, '--data', form]); };
const list = (path, sortCol, sortProp, length) => JSON.parse(curl([`${COPP_PUBLIC}/searchResults/${path}?sEcho=1&iDisplayStart=0&iDisplayLength=${length}&iSortCol_0=${sortCol}&sSortDir_0=asc&iSortingCols=1&mDataProp_${sortCol}=${sortProp}`]));

// The search answers with nothing when a request lands on a server that lost the criteria; the
// largest answer of a few tries is the full one.
function bestOf(tries, fn) {
  let best = null;
  for (let i = 0; i < tries; i++) {
    const r = fn();
    if (!best || r.iTotalRecords > best.iTotalRecords) best = r;
  }
  return best;
}

mkdirSync(RAW, { recursive: true });
for (let year = FIRST_YEAR; year <= new Date().getFullYear(); year++) {
  for (const type of ['CN', 'CT']) {
    newSessions();
    postAll('searchCandidates', `lastName=&firstName=&middleInitial=&electionYear=${year}&candidateTypeCode=${type}&officeCode=&countyCode=&partyCode=`);
    const cands = bestOf(4, () => list('listCandidateResults', 1, 'candidateName', 5000));
    writeFileSync(join(RAW, `candidates-${type}-${year}.json`), `${JSON.stringify(cands.aaData)}\n`);

    newSessions();
    postAll('searchFinancials', `financialSearchType=CONTR&contrSearchTypeCode=CONTRIBUTOR&contrCanLastName=&contrCanFirstName=&contrCommitteeName=&contributorLastName=&contributorFirstName=&contrPartyCode=&contrCandidateTypeCode=${type}&contrOfficeCode=&contrContributorTypeCode=&contrAmountRangeCode=&electionYear=${year}&contrSearchFromDate=&contrSearchToDate=`);
    const total = bestOf(SERVERS, () => list('listFinancialEntityCandResults', 3, 'transDateStr', 1)).iTotalRecords;
    const out = join(RAW, `contributions-${type}-${year}.csv`);
    let rows = 0;
    if (!total) writeFileSync(out, '');
    for (let attempt = 1; total && attempt <= 8 && rows < total; attempt++) {
      const prep = JSON.parse(curl(['-X', 'POST', `${COPP_PUBLIC}/searchResults/prepareDownloadFile`, '--data', 'candidateId=0&committeeId=0']) || '{}');
      if (!prep.fileName) continue;
      curl(['-o', out, `${COPP_PUBLIC}/searchResults/downloadFile?fileName=${encodeURIComponent(prep.fileName)}`]);
      // Rows start with the candidate ID; descriptions can run over several lines.
      rows = existsSync(out) && statSync(out).size ? (readFileSync(out, 'utf8').match(/^\d+\|/gm) || []).length : 0;
    }
    if (rows < total) throw new Error(`${type} ${year}: downloaded ${rows} of ${total} contributions`);
    console.log(`${year} ${type === 'CN' ? 'county' : 'city'}: ${cands.aaData.length} candidates, ${rows} contributions`);
  }
}
console.log('Done. Next: node scripts/mt/build-county.mjs --all');
