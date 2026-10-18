#!/usr/bin/env node
// Downloads the Hawaii Campaign Spending Commission's contributions to state and county candidates
// (opendata.hawaii.gov, since 2015) into data/raw/hi/csc/ (gitignored).
//
//   node scripts/hi/fetch-csc.mjs      then: node scripts/hi/build-county.mjs --all

import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CSC_URL } from './csc-map.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'hi', 'csc');
mkdirSync(RAW, { recursive: true });
execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', 'Mozilla/5.0', '-o', join(RAW, 'ccscha.csv'), CSC_URL], { stdio: 'inherit' });
console.log('Done. Next: node scripts/hi/build-county.mjs --all');
