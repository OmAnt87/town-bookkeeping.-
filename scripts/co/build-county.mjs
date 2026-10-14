#!/usr/bin/env node
// Builds real Town Ledger records for Colorado's counties, cities and towns from the Census
// individual unit files (see scripts/common/town-census-build.mjs). Each county's file holds the
// county and the cities and towns whose people mostly live in it. Colorado has no townships.
// Denver and Broomfield are consolidated cities and counties and report as one city each.
//
//   node scripts/co/download.mjs
//   node scripts/co/fetch-tracer.mjs                     # campaign finance (optional)
//   node scripts/co/build-county.mjs --county Denver      (or --all)
//
// County treasurers or tax collectors gather every property tax in Colorado, so the levy rules for
// northern New England are off.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildState } from '../common/town-census-build.mjs';
import { isCountyRace, summarizeCoContributions, TRACER_PAGE } from './tracer-map.mjs';

const TRACER = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'co', 'tracer', 'contributions.json');
const SINCE = `${new Date().getFullYear() - 3}-01-01`;

// County candidates only: city and town candidates file with their municipal clerk. Denver and
// Broomfield are listed as cities, so their county-jurisdiction committees are not placed.
function politics(geo) {
  if (!existsSync(TRACER)) return null;
  const counties = new Map();
  for (const g of geo.values()) if (g.kind === 'County') counties.set(g.base.toUpperCase(), g.key);
  const byKey = new Map();
  for (const r of JSON.parse(readFileSync(TRACER, 'utf8'))) {
    const key = counties.get(String(r.jurisdiction).trim());
    if (key && isCountyRace(r.committeename, r.jurisdiction)) (byKey.get(key) || byKey.set(key, []).get(key)).push(r);
  }
  const results = new Map([...byKey].map(([k, rows]) => [k, summarizeCoContributions(rows, SINCE)]));
  return {
    results,
    filers: new Set(byKey.keys()),
    since: SINCE,
    sourceUrl: TRACER_PAGE,
    sourceLabel: (g) => `Colorado Secretary of State TRACER: contributions to ${g.display} candidates since ${SINCE.slice(0, 4)}`,
    scope: () => 'County candidates whose committee names the office: commissioner, sheriff, clerk, treasurer, assessor, coroner, surveyor',
    note: (g, isCounty, pol) => `Political money counts itemized cash contributions from businesses, unions and political committees to ${g.display} candidates whose committee names a county office, reported to the Secretary of State's TRACER since ${SINCE.slice(0, 4)}${pol.counted ? '' : ' (none were found)'}. Committees whose names do not show the office are left out, so this is a floor. Individuals, LLC members, in-kind gifts and party and candidate committees are not counted.`,
    noneNote: (g, isCounty) => (isCounty
      ? `Political money is not scored: no ${g.display} candidate committee naming a county office reported contributions to TRACER since ${SINCE.slice(0, 4)}.`
      : 'Political money is not scored: Colorado city and town candidates file campaign reports with their municipal clerk, not with the state.'),
  };
}

buildState({
  code: 'CO',
  name: 'Colorado',
  fips: '08',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City', town: 'Town' },
  countyScope: 'All county funds, including the sheriff, jail, courts, public health, human services and county roads',
  countyNote: () => 'Public schools are run by separate school districts, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts, so they are not included.${/^City of (Denver|Broomfield)$/.test(g.display) ? '' : ` Residents also pay ${g.county}.`}`,
  politicalNote: () => 'Political money is not scored: TRACER data was not loaded.',
  politics,
});
