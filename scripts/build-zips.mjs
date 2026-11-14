#!/usr/bin/env node
// Writes data/zip/<first 3 digits>.json: the center point of every ZIP code
// area, for "Find my town" on the map. The app fetches only the one small file
// for the ZIP a visitor types, and finds the nearest towns in the browser.
//
// Source: Census 2024 Gazetteer, ZIP Code Tabulation Areas (ZCTAs). ZCTAs cover
// the ZIP codes people live in; ZIPs used only for PO boxes or single large
// buildings have no area and are not listed.
//
//   node scripts/build-zips.mjs [--file 2024_Gaz_zcta_national.txt]

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw', 'zip');
const OUT = join(ROOT, 'data', 'zip');
const URL_ZCTA = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_zcta_national.zip';

// "GEOID ALAND AWATER ALAND_SQMI AWATER_SQMI INTPTLAT INTPTLONG", tab-separated.
// Returns { "060": { "06001": [41.79, -72.85], ... }, ... } with 4-decimal points (~10 m).
export function zipShards(text) {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split('\t').map((h) => h.trim());
  const [iZip, iLat, iLng] = ['GEOID', 'INTPTLAT', 'INTPTLONG'].map((h) => head.indexOf(h));
  if ([iZip, iLat, iLng].includes(-1)) throw new Error(`Unexpected gazetteer header: ${lines[0]}`);
  const shards = {};
  for (const line of lines.slice(1)) {
    const cols = line.split('\t').map((c) => c.trim());
    const zip = cols[iZip];
    const lat = Number(cols[iLat]);
    const lng = Number(cols[iLng]);
    if (!/^\d{5}$/.test(zip) || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    (shards[zip.slice(0, 3)] ||= {})[zip] = [Math.round(lat * 1e4) / 1e4, Math.round(lng * 1e4) / 1e4];
  }
  return shards;
}

function main() {
  const args = parseArgs();
  let file = args.file;
  if (!file) {
    mkdirSync(RAW, { recursive: true });
    console.log('Census ZCTA gazetteer...');
    execFileSync('curl', ['-sSfL', '-m', '300', '-A', 'Mozilla/5.0', '-o', join(RAW, 'zcta.zip'), URL_ZCTA], { stdio: 'inherit' });
    execFileSync('unzip', ['-o', '-q', join(RAW, 'zcta.zip'), '-d', RAW], { stdio: 'inherit' });
    file = join(RAW, readdirSync(RAW).find((f) => f.endsWith('.txt')));
  }
  const shards = zipShards(readFileSync(file, 'utf8'));
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  let zips = 0;
  for (const [prefix, map] of Object.entries(shards)) {
    writeFileSync(join(OUT, `${prefix}.json`), JSON.stringify(map));
    zips += Object.keys(map).length;
  }
  console.log(`data/zip/: ${zips} ZIP codes in ${Object.keys(shards).length} files`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
