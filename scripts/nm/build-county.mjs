#!/usr/bin/env node
// Builds real TownView records for New Mexico's counties, cities, towns and villages from the
// Census individual unit files (see scripts/common/town-census-build.mjs). Each county's file
// holds the county and the municipalities whose people mostly live in it.
//
//   node scripts/nm/download.mjs
//   node scripts/nm/build-county.mjs --all
//
// County treasurers collect every property tax in New Mexico, so the levy rules for northern New
// England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'NM',
  name: 'New Mexico',
  fips: '35',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City', town: 'Town', village: 'Village' },
  countyScope: 'All county funds, including the sheriff, detention center, county roads and indigent health care',
  countyNote: () => 'Public schools are run by separate school districts, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts, so they are not included. Residents also pay ${g.county}.`,
  politicalNote: (isCounty) => `Political money is not scored: contributions to New Mexico ${isCounty ? 'county' : 'city'} candidates were not loaded.`,
});
