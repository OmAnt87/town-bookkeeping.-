#!/usr/bin/env node
// Downloads Illinois State Board of Elections campaign disclosure files into data/raw/il/isbe/
// (gitignored) and keeps the receipts of local candidates' committees since the start of the
// year three years back (receipts-local.tsv), so the build does not read the ~1 GB file.
//
//   node scripts/il/fetch-isbe.mjs [--force]      then: node scripts/il/build-county.mjs --all

import { execFileSync } from 'node:child_process';
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';
import { ISBE_FILES, LEVEL } from './isbe-map.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'il', 'isbe');
const args = parseArgs();
mkdirSync(DIR, { recursive: true });
for (const f of ['Candidates', 'CmteCandidateLinks', 'Committees', 'Receipts']) {
  const out = join(DIR, `${f}.txt`);
  if (existsSync(out) && !args.force) { console.log(`cached ${out}`); continue; }
  execFileSync('curl', ['-sSfL', '--retry', '4', '-A', 'Mozilla/5.0', '-o', out, `${ISBE_FILES}${f}.txt`], { stdio: 'inherit' });
  console.log(`ISBE ${f} -> ${out}`);
}

const readTsv = (file) => {
  const [head, ...rows] = readFileSync(join(DIR, file), 'utf8').split(/\r?\n/).filter(Boolean);
  const keys = head.split('\t');
  return rows.map((l) => Object.fromEntries(l.split('\t').map((v, i) => [keys[i], v])));
};
const local = new Set(readTsv('Candidates.txt').filter((c) => LEVEL[String(c.DistrictType).trim()]).map((c) => c.ID));
const committees = new Set(readTsv('CmteCandidateLinks.txt').filter((l) => local.has(l.CandidateID)).map((l) => l.CommitteeID));
const since = `${new Date().getFullYear() - 3}-01-01`;

const out = createWriteStream(join(DIR, 'receipts-local.tsv'));
let head = null;
let kept = 0;
for await (const line of createInterface({ input: createReadStream(join(DIR, 'Receipts.txt')), crlfDelay: Infinity })) {
  if (!head) { head = line.split('\t'); out.write(`${line}\n`); continue; }
  const c = line.split('\t');
  if (!committees.has(c[1]) || String(c[6]).slice(0, 10) < since) continue;
  out.write(`${line}\n`);
  kept++;
}
out.end();
console.log(`${kept} receipts to ${committees.size} local candidate committees since ${since} -> receipts-local.tsv`);
