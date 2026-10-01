#!/usr/bin/env node
// Downloads itemized contributions to candidates for municipal office (and mayor)
// in each NJ municipality from NJ ELEC's public search (njelecefilesearch.com).
// Raw results are cached in data/raw/nj/elec/<location-code>.json.
//
//   node scripts/nj/fetch-elec.mjs --county Monmouth        (or --all; add --refresh to re-download)
//
// Requests go through curl (one at a time, with a pause between them).

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';
import { NJ_COUNTIES } from './ufb-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DIR = join(ROOT, 'data', 'raw', 'nj', 'elec');
const BASE = 'https://www.njelecefilesearch.com';
const COOKIES = join(DIR, 'cookies.txt');
const COLS = ['CONTRIBUTOR', 'Address', 'EMP_NAME', 'EmployerAddress', 'OccupationName', 'CAND_NAME', 'ContributorType', 'ContributionType', 'CONT_DATE', 'CONT_AMT', 'CONTRIB_S'];
const PAGE = 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const curl = (args) => execFileSync('curl', ['-sS', '-m', '180', '-A', 'Mozilla/5.0', '-c', COOKIES, '-b', COOKIES, ...args], { maxBuffer: 1 << 28 }).toString();

// ELEC's location list: "1320" -> "HOLMDEL TOWNSHIP". The first two digits are the county.
export function elecLocations() {
  const cache = join(DIR, 'locations.json');
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, 'utf8'));
  const html = curl(['-L', `${BASE}/SearchContributionToEntity`]);
  const sel = html.match(/id="ddlLocationCodes"[^>]*>([\s\S]*?)<\/select>/)[1];
  const list = [...sel.matchAll(/<option value="(\d{3,4})">----([^<]+)<\/option>/g)].map((m) => ({
    code: m[1].padStart(4, '0'),
    name: m[2].trim(),
    county: NJ_COUNTIES[Number(m[1].padStart(4, '0').slice(0, 2)) - 1],
  }));
  writeFileSync(cache, JSON.stringify(list, null, 1));
  return list;
}

function fetchPage(code, start) {
  const p = new URLSearchParams();
  p.append('NONPACOnly', 'true');
  p.append('LocationCodes[]', String(Number(code)));
  p.append('OfficeCodes[]', '9'); // municipal office
  p.append('OfficeCodes[]', 'G'); // mayor
  p.append('draw', '1');
  p.append('start', String(start));
  p.append('length', String(PAGE));
  p.append('order[0][column]', '8');
  p.append('order[0][dir]', 'desc');
  p.append('search[value]', '');
  p.append('search[regex]', 'false');
  COLS.forEach((c, i) => {
    for (const [k, v] of [['data', c], ['name', c], ['searchable', 'true'], ['orderable', 'true'], ['search][value', ''], ['search][regex', 'false']]) {
      p.append(`columns[${i}][${k}]`, v);
    }
  });
  const out = curl(['-X', 'POST', `${BASE}/api/VWContributionDetail/GetContBitsDataByObject`,
    '-H', 'X-Requested-With: XMLHttpRequest', '-H', 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8',
    '-H', `Referer: ${BASE}/SearchContributionToEntity`, '--data', p.toString()]);
  return JSON.parse(out);
}

const KEEP = ['CONTRIBUTOR', 'CONT_TYPE', 'ContributorType', 'ContributionType', 'CONT_DATE', 'CONT_AMT', 'CAND_NAME', 'ELECTIONYEAR', 'ELECTIONTYPE', 'OFFICE', 'PARTY', 'LOCATION', 'LOCATION_CODE', 'CITY', 'STATE', 'CONTRIB_S'];

export async function fetchTown(code, { refresh = false } = {}) {
  const file = join(DIR, `${code}.json`);
  if (!refresh && existsSync(file)) return JSON.parse(readFileSync(file, 'utf8'));
  const rows = [];
  let total = Infinity;
  for (let start = 0; start < total; start += PAGE) {
    const res = fetchPage(code, start);
    total = res.recordsTotal;
    rows.push(...res.data.map((r) => Object.fromEntries(KEEP.map((k) => [k, r[k]]))));
    await sleep(400);
  }
  const data = { code, fetched: new Date().toISOString(), total, rows };
  writeFileSync(file, JSON.stringify(data));
  return data;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs();
  mkdirSync(DIR, { recursive: true });
  curl(['-L', '-o', '/dev/null', `${BASE}/SearchContributionToEntity`]); // session cookie
  const counties = args.all ? NJ_COUNTIES : [NJ_COUNTIES.find((c) => c.toLowerCase() === String(args.county || '').toLowerCase())];
  if (!counties[0]) { console.error('Usage: node scripts/nj/fetch-elec.mjs --county <name> | --all [--refresh]'); process.exit(1); }
  const locs = elecLocations();
  for (const county of counties) {
    let n = 0;
    let recs = 0;
    for (const loc of locs.filter((l) => l.county === county)) {
      try {
        const d = await fetchTown(loc.code, { refresh: !!args.refresh });
        n++;
        recs += d.rows.length;
      } catch (err) {
        console.error(`  ${loc.name} (${loc.code}): ${err.message.split('\n')[0]}`);
      }
    }
    console.log(`${county}: ${n} municipalities, ${recs} contribution records`);
  }
}
