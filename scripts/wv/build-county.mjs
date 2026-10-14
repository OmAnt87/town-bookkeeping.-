#!/usr/bin/env node
// Builds real Town Ledger records for West Virginia's counties, cities, towns and villages from
// the Census individual unit files (see scripts/common/town-census-build.mjs). Each county's
// file holds the county and the municipalities whose people mostly live in it.
//
//   node scripts/wv/download.mjs
//   node scripts/wv/build-county.mjs --all
//
// County sheriffs collect every property tax in West Virginia, so the levy rules for northern
// New England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'WV',
  name: 'West Virginia',
  fips: '54',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City', town: 'Town', village: 'Village' },
  countyScope: 'All county commission funds, including the sheriff, courts and 911',
  countyNote: () => 'Public schools are run by county boards of education, which are separate governments, so they are not included. State roads cover what county roads do elsewhere.',
  memberSchoolNote: (g) => `Public schools are run by county boards of education, which are separate governments, so they are not included. Residents also pay ${g.county}.`,
  politicalNote: (isCounty) => `Political money is not scored: contributions to West Virginia ${isCounty ? 'county' : 'city'} candidates were not loaded.`,
});
