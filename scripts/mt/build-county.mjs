#!/usr/bin/env node
// Builds real TownView records for Montana's counties, cities and towns from the Census
// individual unit files (see scripts/common/town-census-build.mjs). Each county's file holds the
// county and the cities and towns whose people mostly live in it.
//
//   node scripts/mt/download.mjs
//   node scripts/mt/fetch-copp.mjs                      # campaign finance (optional)
//   node scripts/mt/build-county.mjs --all
//
// County treasurers collect every property tax in Montana, so the levy rules for northern New
// England are off.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildState } from '../common/town-census-build.mjs';
import { parsePipes, placeCandidate, displayName, norm, summarizeMtContributions, COPP_PAGE } from './copp-map.mjs';

const COPP = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'mt', 'copp');
const FIRST_YEAR = new Date().getFullYear() - 3;
const SINCE = `${FIRST_YEAR}-01-01`;

// Places each county and city candidate by office, county of residence and mailing city, then
// gathers contributions to them from committees and businesses (joined by candidate ID).
function politics(geo) {
  const files = existsSync(COPP) ? readdirSync(COPP) : [];
  if (!files.some((f) => f.startsWith('candidates-'))) return null;
  const countyOf = (g) => norm(String(g.county || g.display).replace(/ County$/, ''));
  const places = { counties: new Map(), cities: new Map(), consolidated: new Set() };
  for (const g of geo.values()) {
    if (g.kind === 'County') places.counties.set(countyOf(g), g.key);
    else (places.cities.get(norm(g.base)) || places.cities.set(norm(g.base), []).get(norm(g.base))).push({ key: g.key, county: countyOf(g) });
  }
  // Anaconda-Deer Lodge and Butte-Silver Bow: one government for the county and the city.
  for (const g of geo.values()) if (g.key.startsWith('Consolidated|')) { places.counties.set(countyOf(g), g.key); places.consolidated.add(countyOf(g)); }
  const placed = new Map();
  for (const f of files.filter((x) => /^candidates-(CN|CT)-\d{4}\.json$/.test(x))) {
    const type = f.slice(11, 13);
    for (const c of JSON.parse(readFileSync(join(COPP, f), 'utf8'))) {
      const key = placeCandidate(c, type, places);
      if (key && geo.has(key)) placed.set(String(c.candidateId), { key, label: `${displayName(c.candidateName)} (${c.officeTitle})` });
    }
  }
  const receiptsBy = new Map();
  for (const f of files.filter((x) => /^contributions-(CN|CT)-\d{4}\.csv$/.test(x))) {
    for (const r of parsePipes(readFileSync(join(COPP, f), 'utf8'))) {
      const p = placed.get(String(r['Candidate ID']).trim());
      if (!p) continue;
      (receiptsBy.get(p.key) || receiptsBy.set(p.key, []).get(p.key)).push({ ...r, recipient: p.label });
    }
  }
  const filers = new Set([...placed.values()].map((p) => p.key));
  const results = new Map([...filers].map((k) => [k, summarizeMtContributions(receiptsBy.get(k) || [], SINCE)]));
  const officeText = (isCounty) => (isCounty ? 'county commission, sheriff, clerk and recorder, treasurer, assessor and coroner candidates' : 'candidates for mayor and city council');
  return {
    results,
    filers,
    since: SINCE,
    sourceUrl: COPP_PAGE,
    sourceLabel: (g) => `Montana Commissioner of Political Practices contributions to ${g.display}'s candidates since ${FIRST_YEAR}`,
    scope: (isCounty) => (isCounty ? 'County candidates: commission, sheriff, clerk and recorder, treasurer, assessor, coroner, public administrator' : 'Municipal candidates: mayor and city council or aldermen'),
    note: (g, isCounty, pol) => `Political money counts cash contributions from political committees (including union and business committees) and businesses to ${officeText(isCounty)}, reported to the Commissioner of Political Practices since ${FIRST_YEAR}${pol.counted ? '' : ' (none were found)'}.${isCounty ? '' : ' City candidates are placed by the city of their mailing address, which can differ from the town they ran in.'} Montana bars corporations from giving to candidates directly, so most of this money comes through committees. Many contributions are dated the first day of their reporting period. Individuals, in-kind gifts, and party and candidate committees are not counted.`,
    noneNote: (g, isCounty) => `Political money is not scored: no ${officeText(isCounty)} of ${g.display} filed with the Commissioner of Political Practices since ${FIRST_YEAR}.`,
  };
}

buildState({
  code: 'MT',
  name: 'Montana',
  fips: '30',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City', town: 'Town' },
  countyScope: 'All county funds, including the sheriff, jail, courts and county roads',
  countyNote: () => 'Public schools are run by separate school districts, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts, so they are not included. Residents also pay ${g.county}.`,
  politicalNote: () => 'Political money is not scored: Commissioner of Political Practices data was not loaded.',
  politics,
  consolidated: {
    '01675': { county: '023', display: 'Anaconda-Deer Lodge County' },
    '11390': { county: '093', display: 'Butte-Silver Bow' },
  },
});
