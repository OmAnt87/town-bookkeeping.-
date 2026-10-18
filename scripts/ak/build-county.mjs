#!/usr/bin/env node
// Builds real Town Ledger records for Alaska's boroughs and cities from the Census individual
// unit files (see scripts/common/town-census-build.mjs). Each borough's file holds the borough
// and the cities whose people mostly live in it.
//
//   node scripts/ak/download.mjs
//   node scripts/ak/fetch-apoc.mjs                      # campaign finance (optional)
//   node scripts/ak/build-county.mjs --all
//
// Boroughs and cities each levy their own property tax in Alaska, and many levy no property tax
// at all, so the levy rules for northern New England are off.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildState } from '../common/town-census-build.mjs';
import { LOCAL_OFFICE, norm, placeMunicipality, summarizeAkContributions, APOC_INCOME } from './apoc-map.mjs';

const APOC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'ak', 'apoc', 'income.json');
const FIRST_YEAR = new Date().getFullYear() - 3;
const SINCE = `${FIRST_YEAR}-01-01`;

// Places each candidate's reports by the municipality and office they name, then gathers
// contributions to them from businesses, unions and groups.
function politics(geo) {
  if (!existsSync(APOC)) return null;
  const places = { boroughs: new Map(), cities: new Map() };
  for (const g of geo.values()) if (g.kind === 'County') places.boroughs.set(norm(g.county || g.display), g.key);
  for (const g of geo.values()) {
    if (g.key.startsWith('Consolidated|')) places.boroughs.set(norm(g.display), g.key);
    else if (g.kind !== 'County') places.cities.set(norm(g.base), g.key);
  }
  const receiptsBy = new Map();
  for (const r of JSON.parse(readFileSync(APOC, 'utf8'))) {
    if (!LOCAL_OFFICE.test(r.Office || '')) continue;
    const key = placeMunicipality(r.Municipality, places);
    if (!key || !geo.has(key)) continue;
    (receiptsBy.get(key) || receiptsBy.set(key, []).get(key)).push(r);
  }
  const results = new Map([...receiptsBy].map(([k, rows]) => [k, summarizeAkContributions(rows, SINCE)]));
  const officeText = (g) => (g.kind === 'County' || g.key.startsWith('Consolidated|') ? 'mayor and assembly candidates' : 'mayor and city council candidates');
  return {
    results,
    filers: new Set(receiptsBy.keys()),
    since: SINCE,
    sourceUrl: APOC_INCOME,
    sourceLabel: (g) => `Alaska Public Offices Commission contributions to ${g.display}'s candidates since ${FIRST_YEAR}`,
    scope: (isCounty) => (isCounty ? 'Borough candidates: mayor and assembly' : 'Municipal candidates: mayor and council or assembly'),
    note: (g, isCounty, pol) => `Political money counts contributions from businesses, unions and registered groups (PACs) to ${officeText(g)}, reported to the Alaska Public Offices Commission since ${FIRST_YEAR}${pol.counted ? '' : ' (none were found)'}. Alaska bars businesses and unions from giving to candidates directly, so most of this money comes through their groups. Individuals, candidates' own money, in-kind gifts, and party and candidate committees are not counted.`,
    noneNote: (g) => `Political money is not scored: no ${officeText(g)} of ${g.display} reported contributions to the Alaska Public Offices Commission since ${FIRST_YEAR}. Some municipalities run their own campaign disclosure instead.`,
  };
}

buildState({
  code: 'AK',
  name: 'Alaska',
  fips: '02',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City' },
  countyScope: 'All borough funds, including the borough school district where the borough runs schools',
  countyNote: () => 'Borough school districts are part of the borough government in Alaska, so school spending is included (it is left out of the services and overhead shares).',
  memberSchoolNote: () => 'Some Alaska cities run their own school districts; where this one does, school spending is included and left out of the services and overhead shares.',
  politicalNote: () => 'Political money is not scored: Alaska Public Offices Commission data was not loaded.',
  politics,
  consolidated: {
    '03000': { county: '020', display: 'Municipality of Anchorage' },
    '36400': { county: '110', display: 'City and Borough of Juneau' },
    '70540': { county: '220', display: 'City and Borough of Sitka' },
    '86380': { county: '275', display: 'City and Borough of Wrangell' },
  },
});
