#!/usr/bin/env node
// Caches South Carolina campaign contributions from the State Ethics Commission's public
// contribution search into data/raw/sc/ethics/<year>.json, for each year since January three
// years ago: every group (non-individual) contribution to a county or municipal candidate, and
// the number of contributions of any kind to each local office (to know which governments have
// candidates filing).
//
//   node scripts/sc/fetch-ethics.mjs [--force]

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';
import { ETHICS_API, parseOffice } from './ethics-map.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'sc', 'ethics');
const KEEP = ['contributionId', 'officeRunId', 'candidateId', 'date', 'amount', 'candidateName', 'officeName', 'contributorName', 'group', 'contributorAddress'];
const args = parseArgs();

mkdirSync(DIR, { recursive: true });
const now = new Date().getFullYear();
for (let y = now - 3; y <= now; y++) {
  const out = join(DIR, `${y}.json`);
  if (existsSync(out) && !args.force && y < now - 1) { console.log(`cached ${out}`); continue; }
  const body = execFileSync('curl', ['-sSf', '--retry', '4', '--retry-all-errors', '-m', '600', '-X', 'POST', '-H', 'Content-Type: application/json',
    '-d', JSON.stringify({ contributionYear: y }), ETHICS_API], { maxBuffer: 1 << 30 }).toString();
  const all = JSON.parse(body);
  const offices = {};
  const rows = [];
  for (const r of all) {
    if (!parseOffice(r.officeName)) continue;
    const o = String(r.officeName).trim().replace(/\s+/g, ' ');
    offices[o] = (offices[o] || 0) + 1;
    if (r.group === 'Yes') rows.push(Object.fromEntries(KEEP.map((k) => [k, typeof r[k] === 'string' ? r[k].trim() : r[k]])));
  }
  writeFileSync(out, `${JSON.stringify({ offices, rows })}\n`);
  console.log(`${y}: ${all.length} contributions, ${Object.values(offices).reduce((a, b) => a + b, 0)} to local candidates, ${rows.length} from groups`);
}
