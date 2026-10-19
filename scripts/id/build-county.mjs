#!/usr/bin/env node
// Builds real TownView records for Idaho's counties and cities from the Census individual
// unit files (see scripts/common/town-census-build.mjs). Each county's file holds the county and
// the cities whose people mostly live in it.
//
//   node scripts/id/download.mjs
//   node scripts/id/build-county.mjs --all
//
// County treasurers collect every property tax in Idaho, so the levy rules for northern New
// England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'ID',
  name: 'Idaho',
  fips: '16',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City' },
  countyScope: 'All county funds, including the sheriff, jail, courts, county roads and indigent health care',
  countyNote: () => 'Public schools are run by separate school districts, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts, so they are not included. Residents also pay ${g.county}.`,
  politicalNote: (isCounty) => `Political money is not scored: contributions to Idaho ${isCounty ? 'county' : 'city'} candidates were not loaded.`,
});
