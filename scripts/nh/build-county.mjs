#!/usr/bin/env node
// Builds real Town Ledger records for New Hampshire's counties, cities and towns from the Census
// individual unit files (see scripts/common/town-census-build.mjs). Each county's file holds the
// county and the cities and towns in it.
//
//   node scripts/nh/download.mjs
//   node scripts/nh/build-county.mjs --county Grafton      (or --all)

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'NH',
  name: 'New Hampshire',
  fips: '33',
  cousubKinds: { city: 'City', town: 'Town' },
  countyScope: 'All county funds, including the county nursing home, jail and sheriff',
  countyNote: (g) => `${g.display}'s cities and towns collect the county tax with their own property tax bills and pay it over. Public schools are run by school districts and city school departments, so they are not included.`,
  sharesText: 'the school district, the county and the state education tax',
  politicalNote: (isCounty) => `Political money is not scored: New Hampshire ${isCounty ? 'county' : 'city and town'} candidates' contributions could not be loaded (${isCounty ? 'county candidates file with the Secretary of State, whose system was not reachable' : 'local candidates file with their city or town clerk, not with the state'}).`,
});
