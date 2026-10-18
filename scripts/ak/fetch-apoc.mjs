#!/usr/bin/env node
// Downloads Alaska Public Offices Commission (APOC) campaign disclosure income into
// data/raw/ak/apoc/ (gitignored): income.json holds every contribution reported by a candidate
// for municipal office in each report year since three years ago, with the municipality and
// office each candidate ran for.
//
//   node scripts/ak/fetch-apoc.mjs      then: node scripts/ak/build-county.mjs --all
//
// The income search is an ASP.NET form: a search for each report year, then the form's own
// "Export all as CSV" link. The site turns away curl's own user agent, so requests carry a
// browser's. The full export also holds every group's payroll deductions; only candidates'
// rows are kept.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSVRows } from '../common/atlas.mjs';
import { APOC_INCOME } from './apoc-map.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'ak', 'apoc');
const JAR = join(RAW, 'cookies.txt');
const FIRST_YEAR = new Date().getFullYear() - 3;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const FILTER = 'M$C$sCDTransactions$csfFilter$';
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '6', '--retry-all-errors', '-m', '1800', '-A', UA, '-c', JAR, '-b', JAR, ...a], { maxBuffer: 1 << 30 }).toString('utf8');
const hidden = (html) => Object.fromEntries([...html.matchAll(/<input type="hidden" name="([^"]+)" id="[^"]*" value="([^"]*)"/g)].map((m) => [m[1], m[2].replace(/&amp;/g, '&')]));
const post = (html, fields) => {
  const body = join(RAW, 'post.txt');
  writeFileSync(body, new URLSearchParams({ ...hidden(html), ...fields }).toString());
  return curl('-e', APOC_INCOME, '--data', `@${body}`, APOC_INCOME);
};

mkdirSync(RAW, { recursive: true });
const income = [];
for (let year = FIRST_YEAR; year <= new Date().getFullYear(); year++) {
  const filter = { [`${FILTER}ddlReportYear`]: String(year), [`${FILTER}ddlStatus`]: 'Default' };
  const results = post(curl(APOC_INCOME), { ...filter, [`${FILTER}btnSearch`]: 'Search' });
  const dialog = post(results, { ...filter, [`${FILTER}btnExport`]: 'Export' });
  const link = dialog.match(/id="[^"]*ExportDialog_hlAllCSV"[^>]*href="([^"]+)"/)?.[1].replace(/&amp;/g, '&');
  if (!link) throw new Error(`${year}: no CSV export link on the APOC income page`);
  const rows = parseCSVRows(curl(new URL(link, APOC_INCOME).href).replace(/^﻿/, ''));
  const kept = rows.filter((r) => r['Filer Type'] === 'Candidate' && r.Municipality);
  income.push(...kept);
  console.log(`${year}: ${rows.length} income rows, ${kept.length} to municipal candidates`);
}
writeFileSync(join(RAW, 'income.json'), `${JSON.stringify(income)}\n`);
rmSync(JAR, { force: true });
rmSync(join(RAW, 'post.txt'), { force: true });
console.log(`Done: ${income.length} contributions. Next: node scripts/ak/build-county.mjs --all`);
