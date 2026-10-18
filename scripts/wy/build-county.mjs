#!/usr/bin/env node
// Builds real TownView records for Wyoming's counties, cities and towns from the Census
// individual unit files (see scripts/common/town-census-build.mjs). Each county's file holds the
// county and the cities and towns whose people mostly live in it.
//
//   node scripts/wy/download.mjs
//   node scripts/wy/build-county.mjs --all
//
// County treasurers collect every property tax in Wyoming, so the levy rules for northern New
// England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'WY',
  name: 'Wyoming',
  fips: '56',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City', town: 'Town' },
  countyScope: 'All county funds, including the sheriff, jail, courts and county roads',
  countyNote: () => 'Public schools are run by separate school districts, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts, so they are not included. Residents also pay ${g.county}.`,
  politicalNote: (isCounty) => `Political money is not scored: contributions to Wyoming ${isCounty ? 'county' : 'city'} candidates were not loaded.`,
});
