#!/usr/bin/env node
// Builds real Town Ledger records for Kentucky's counties and cities from the Census individual
// unit files (see scripts/common/town-census-build.mjs). Each county's file holds the county and
// the cities whose people mostly live in it.
//
//   node scripts/ky/download.mjs
//   node scripts/ky/build-county.mjs --all
//
// County sheriffs collect property taxes for counties, schools and the state in Kentucky; cities
// may collect their own, so the levy rules for northern New England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'KY',
  name: 'Kentucky',
  fips: '21',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City' },
  countyScope: 'All fiscal court funds, including the sheriff, jail, county roads and solid waste',
  countyNote: () => 'Public schools are run by separate school districts, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts, so they are not included. Residents also pay ${g.county}.`,
  politicalNote: (isCounty) => `Political money is not scored: contributions to Kentucky ${isCounty ? 'county' : 'city'} candidates were not loaded.`,
  consolidated: {
    '46027': { county: '067', display: 'Lexington-Fayette Urban County' },
    '48003': { county: '111', display: 'Louisville Metro' },
  },
});
