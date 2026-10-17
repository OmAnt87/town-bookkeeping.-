#!/usr/bin/env node
// Builds real Town Ledger records for Mississippi's counties, cities, towns and villages from
// the Census individual unit files (see scripts/common/town-census-build.mjs). Each county's
// file holds the county and the municipalities whose people mostly live in it.
//
//   node scripts/ms/download.mjs
//   node scripts/ms/build-county.mjs --all
//
// County tax collectors gather county, school and most city property taxes in Mississippi, so
// the levy rules for northern New England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'MS',
  name: 'Mississippi',
  fips: '28',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City', town: 'Town', village: 'Village' },
  countyScope: 'All county funds, including the sheriff, jail, courts and county roads',
  countyNote: () => 'Public schools are run by separate school districts, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts, so they are not included. Residents also pay ${g.county}.`,
  politicalNote: (isCounty) => `Political money is not scored: contributions to Mississippi ${isCounty ? 'county' : 'city'} candidates were not loaded.`,
});
