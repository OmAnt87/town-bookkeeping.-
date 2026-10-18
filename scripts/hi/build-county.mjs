#!/usr/bin/env node
// Builds real TownView records for Hawaii's counties from the Census individual unit files
// (see scripts/common/town-census-build.mjs). Each county has its own file.
//
//   node scripts/hi/download.mjs
//   node scripts/hi/fetch-csc.mjs                        # campaign finance (optional)
//   node scripts/hi/build-county.mjs --all
//
// Hawaii's counties levy and collect their own property taxes, so the levy rules for northern
// New England are off.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV } from '../lib.mjs';
import { buildState } from '../common/town-census-build.mjs';
import { countyFor, summarizeHiContributions, CSC_PAGE, COUNTIES } from './csc-map.mjs';

const CSC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'hi', 'csc', 'ccscha.csv');
const SINCE = `${new Date().getFullYear() - 3}-01-01`;
const KEY_OF = { Hawaii: 'County|15001', Kauai: 'County|15007', Maui: 'County|15009', Honolulu: 'Consolidated|17000' };

// Gathers contributions to each county's mayor, council and prosecuting attorney candidates.
function politics(geo) {
  if (!existsSync(CSC)) return null;
  const rows = parseCSV(readFileSync(CSC, 'utf8'));
  const known = new Map();
  for (const r of rows) if (COUNTIES.includes(String(r.county).trim())) known.set(r.reg_no, String(r.county).trim());
  const byKey = new Map();
  for (const r of rows) {
    const key = KEY_OF[countyFor(r, known)];
    if (key && geo.has(key)) (byKey.get(key) || byKey.set(key, []).get(key)).push(r);
  }
  const results = new Map([...byKey].map(([k, list]) => [k, summarizeHiContributions(list, SINCE)]));
  return {
    results,
    filers: new Set(byKey.keys()),
    since: SINCE,
    sourceUrl: CSC_PAGE,
    sourceLabel: (g) => `Hawaii Campaign Spending Commission: contributions to ${g.display}'s mayor, council and prosecuting attorney candidates since ${SINCE.slice(0, 4)}`,
    scope: () => 'County candidates: mayor, county council and prosecuting attorney',
    note: (g, isCounty, pol) => `Political money counts contributions from businesses, unions and PACs to ${g.display}'s mayor, council and prosecuting attorney candidates, reported to the Campaign Spending Commission since ${SINCE.slice(0, 4)}${pol.counted ? '' : ' (none were found)'}. Hawaii allows business and union contributions. Individuals, candidates' own money and family, in-kind gifts, and party and candidate committees are not counted.`,
    noneNote: (g) => `Political money is not scored: no candidates for ${g.display} offices reported contributions to the Campaign Spending Commission since ${SINCE.slice(0, 4)}.`,
  };
}

buildState({
  code: 'HI',
  name: 'Hawaii',
  fips: '15',
  levy: false,
  cousubKinds: {},
  placeKinds: {},
  countyScope: 'All county funds, including police, fire, roads, water, parks and solid waste',
  countyNote: () => 'Public schools are run by the state of Hawaii as one statewide district, so they are not included.',
  memberSchoolNote: () => 'Public schools are run by the state of Hawaii as one statewide district, so they are not included.',
  politicalNote: () => 'Political money is not scored: Campaign Spending Commission data was not loaded.',
  politics,
  consolidated: {
    '17000': { county: '003', display: 'City and County of Honolulu' },
  },
});
