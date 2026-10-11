#!/usr/bin/env node
// Builds real Town Ledger records for Wisconsin's counties, cities, villages and towns from the
// Census individual unit files (see scripts/common/town-census-build.mjs). Each county's file
// holds the county and the governments whose people mostly live in it.
//
//   node scripts/wi/download.mjs
//   node scripts/wi/build-county.mjs --county Dane      (or --all)
//
// Wisconsin towns are the Census's township governments. Municipal treasurers collect the
// school, county and technical college levies on the same bill, but their Census figures show only
// their own levy (revenue is close to spending), so the levy rules for northern New England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'WI',
  name: 'Wisconsin',
  fips: '55',
  levy: false,
  cousubKinds: { city: 'City', village: 'Village', town: 'Town' },
  placeKinds: { city: 'City', village: 'Village' },
  countyScope: 'All county funds, including the sheriff, jail, courts, human services and county highways',
  countyNote: () => 'Public schools are run by separate school districts with their own taxes, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts with their own taxes, so they are not included. Residents also pay ${g.county}.`,
  memberNote: (g) => (g.kind === 'Town' ? 'Wisconsin towns govern the rural areas outside cities and villages; cities and villages are separate from the town around them.' : null),
  politicalNote: (isCounty) => `Political money is not scored: ${isCounty ? 'contributions to Wisconsin county candidates were not loaded' : 'Wisconsin local candidates file campaign finance reports with their municipal clerk, not with the state'}.`,
});
