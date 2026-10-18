#!/usr/bin/env node
// Builds real TownView records for Alabama's counties, cities and towns from the Census
// individual unit files (see scripts/common/town-census-build.mjs). Each county's file holds the
// county and the cities and towns whose people mostly live in it.
//
//   node scripts/al/download.mjs
//   node scripts/al/fetch-fcpa.mjs                      # campaign finance (optional)
//   node scripts/al/build-county.mjs --all
//
// County revenue commissioners or tax collectors gather property taxes in Alabama, so the levy
// rules for northern New England are off.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV } from '../lib.mjs';
import { buildState } from '../common/town-census-build.mjs';
import { placeCommittee, committeeLabel, norm, summarizeAlContributions, FCPA_PAGE } from './fcpa-map.mjs';

const FCPA = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'al', 'fcpa');
const FIRST_YEAR = new Date().getFullYear() - 3;
const SINCE = `${FIRST_YEAR}-01-01`;

// Places each candidate committee by its office, then gathers contributions to it from
// businesses, unions and PACs.
function politics(geo) {
  if (!existsSync(join(FCPA, 'committees.json'))) return null;
  const places = { counties: new Map(), cities: new Map() };
  for (const g of geo.values()) {
    if (g.kind === 'County') places.counties.set(norm(String(g.county || g.display).replace(/ County$/, '')), g.key);
    else (places.cities.get(norm(g.base)) || places.cities.set(norm(g.base), []).get(norm(g.base))).push(g.key);
  }
  const placed = new Map();
  for (const c of JSON.parse(readFileSync(join(FCPA, 'committees.json'), 'utf8'))) {
    const key = placeCommittee(c, places);
    if (key && geo.has(key)) placed.set(String(c.committeeId), { key, label: committeeLabel(c), last: c.candidateLastName });
  }
  const receiptsBy = new Map();
  const files = readdirSync(FCPA).filter((f) => /^\d{4}_CashContributionsExtract1\.csv$/.test(f) && Number(f.slice(0, 4)) >= FIRST_YEAR);
  for (const f of files) {
    for (const r of parseCSV(readFileSync(join(FCPA, f), 'latin1'))) {
      const p = placed.get(String(r.committeeid).trim());
      if (!p) continue;
      (receiptsBy.get(p.key) || receiptsBy.set(p.key, []).get(p.key)).push({ ...r, recipient: p.label, candidatelast: p.last });
    }
  }
  const filers = new Set([...placed.values()].map((p) => p.key));
  const results = new Map([...filers].map((k) => [k, summarizeAlContributions(receiptsBy.get(k) || [], SINCE)]));
  const officeText = (isCounty) => (isCounty ? 'county commission, sheriff, revenue commissioner, tax assessor and collector, coroner and constable candidates' : 'candidates for mayor and city council');
  return {
    results,
    filers,
    since: SINCE,
    sourceUrl: FCPA_PAGE,
    sourceLabel: (g) => `Alabama Secretary of State FCPA contributions to ${g.display}'s candidates since ${FIRST_YEAR}`,
    scope: (isCounty) => (isCounty ? 'County candidates: commission, sheriff, revenue commissioner, tax assessor and collector, license commissioner, treasurer, coroner, constables' : 'Municipal candidates: mayor and city council'),
    note: (g, isCounty, pol) => `Political money counts itemized cash contributions from businesses, unions and PACs to ${officeText(isCounty)}, filed with the Secretary of State since ${FIRST_YEAR}${pol.counted ? '' : ' (none were found)'}.${isCounty ? '' : ' Municipal candidates are placed by the city of their mailing address, which can differ from the town they ran in.'} Alabama allows business and union contributions. Individuals, in-kind gifts, and party and candidate committees are not counted.`,
    noneNote: (g, isCounty) => `Political money is not scored: no ${officeText(isCounty)} of ${g.display} registered a campaign committee with the Secretary of State.`,
  };
}

buildState({
  code: 'AL',
  name: 'Alabama',
  fips: '01',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City', town: 'Town' },
  countyScope: 'All county funds, including the sheriff, jail, courts, county roads and solid waste',
  countyNote: () => 'Public schools are run by county and city boards of education, which the Census counts as separate school systems, so they are not included.',
  memberSchoolNote: () => 'Public schools are run by county and city boards of education, which the Census counts as separate school systems, so they are not included.',
  politicalNote: () => 'Political money is not scored: Secretary of State FCPA data was not loaded.',
  politics,
});
