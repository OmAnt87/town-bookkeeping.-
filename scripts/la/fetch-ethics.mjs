#!/usr/bin/env node
// Downloads Louisiana Board of Ethics campaign finance data into data/raw/la/ethics/ (gitignored):
//   - Contributions_<years>.csv: every e-filed contribution (the Board's bulk data download)
//   - filers.json: every e-filer in each election year since three years ago, with the office
//     filed for, from the Board's "Advanced Search of Campaign Finance E-Filers"
// The contribution files name the filer but not the office, so the two are joined by filer name.
//
//   node scripts/la/fetch-ethics.mjs      then: node scripts/la/build-county.mjs --all
//   (--filers-only skips the contribution files when they are already downloaded)
//
// The filer search is an ASP.NET form: each page is a form post carrying the page's view state.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONTRIBUTION_FILES, parseFilerRows } from './ethics-map.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'la', 'ethics');
const BASE = 'https://ethics.la.gov/campaignfinancesearch';
const JAR = join(RAW, 'cookies.txt');
const FIRST_YEAR = new Date().getFullYear() - 3;
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', '-c', JAR, '-b', JAR, ...a], { maxBuffer: 1 << 28 }).toString('utf8');
const hidden = (html) => Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"/g)].map((m) => [m[1], m[2].replace(/&amp;/g, '&')]));
const post = (url, fields) => {
  const body = join(RAW, 'post.txt');
  writeFileSync(body, new URLSearchParams(fields).toString());
  return curl('-e', url, '--data', `@${body}`, url);
};

mkdirSync(RAW, { recursive: true });
for (const f of CONTRIBUTION_FILES(FIRST_YEAR)) {
  if (process.argv.includes('--filers-only')) continue;
  curl('-o', join(RAW, f.name), f.url);
  console.log(`${f.name}`);
}

const filers = [];
for (let year = FIRST_YEAR; year <= new Date().getFullYear(); year++) {
  const search = curl(`${BASE}/SearchByNameAdv.aspx`);
  let page = post(`${BASE}/SearchByNameAdv.aspx`, {
    ...hidden(search),
    __EVENTTARGET: 'ctl00$ContentPlaceHolder1$SearchLinkButton',
    __EVENTARGUMENT: '',
    'ctl00$ContentPlaceHolder1$NameTextBox': '',
    'ctl00$ContentPlaceHolder1$OfficeTextBox': '',
    'ctl00$ContentPlaceHolder1$YearTextBox': String(year),
  });
  const records = Number(page.match(/(\d+) records were found/)?.[1] || 0);
  const pages = Math.ceil(records / 20);
  for (let n = 1; n <= pages; n++) {
    if (n > 1) {
      page = post(`${BASE}/SearchResultsAdv.aspx`, {
        ...hidden(page),
        __EVENTTARGET: 'ctl00$ContentPlaceHolder1$ResultsGridView',
        __EVENTARGUMENT: `Page$${n}`,
      });
    }
    for (const r of parseFilerRows(page)) filers.push({ year, ...r });
  }
  console.log(`${year}: ${records} e-filer records`);
}
writeFileSync(join(RAW, 'filers.json'), `${JSON.stringify(filers)}\n`);
rmSync(JAR, { force: true });
rmSync(join(RAW, 'post.txt'), { force: true });
console.log(`Done: ${filers.length} filer records. Next: node scripts/la/build-county.mjs --all`);
