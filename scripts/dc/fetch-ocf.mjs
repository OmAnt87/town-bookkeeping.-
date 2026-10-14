#!/usr/bin/env node
// Downloads contributions to District of Columbia principal campaign committees from the Office of
// Campaign Finance e-filing site (the Download Data search, exported as CSV) into
// data/raw/dc/ocf/contributions.csv (gitignored, converted from UTF-16 to UTF-8).
//
//   node scripts/dc/fetch-ocf.mjs      then: node scripts/dc/build-county.mjs --all

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OCF_PAGE } from './ocf-map.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'dc', 'ocf');
const JAR = join(RAW, 'cookies.txt');
const FROM = `01/01/${new Date().getFullYear() - 3}`;
const TO = new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' });
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', '-c', JAR, '-b', JAR, ...a]);

mkdirSync(RAW, { recursive: true });
curl('-o', '/dev/null', OCF_PAGE);
// Filer type 2 is principal campaign committees; the search is kept in the session, then exported.
curl('-o', '/dev/null', '-e', OCF_PAGE, '--data', `FilerTypeId=2&SearchType=Contributions&FromDate=${FROM}&ToDate=${TO}`, `${OCF_PAGE}/SubmitSearch`);
curl('-o', join(RAW, 'export.csv'), `${OCF_PAGE}/Export?exportType=CSV`);
// The export is UTF-16 with a title line before the header.
const text = readFileSync(join(RAW, 'export.csv')).toString('utf16le').replace(/^﻿/, '');
writeFileSync(join(RAW, 'contributions.csv'), text.slice(text.indexOf('\n') + 1));
rmSync(join(RAW, 'export.csv'));
rmSync(JAR, { force: true });
console.log(`Contributions since ${FROM} -> data/raw/dc/ocf/contributions.csv. Next: node scripts/dc/build-county.mjs --all`);
