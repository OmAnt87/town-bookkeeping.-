#!/usr/bin/env node
// Builds real Town Ledger records for Arkansas's counties, cities and towns from the Census
// individual unit files (see scripts/common/town-census-build.mjs). Each county's file holds the
// county and the cities and towns whose people mostly live in it.
//
//   node scripts/ar/download.mjs
//   node scripts/ar/build-county.mjs --all
//
// County collectors gather every property tax in Arkansas, so the levy rules for northern New
// England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'AR',
  name: 'Arkansas',
  fips: '05',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City', town: 'Town' },
  countyScope: 'All county funds, including the sheriff, jail, courts, county roads and solid waste',
  countyNote: () => 'Public schools are run by separate school districts, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts, so they are not included. Residents also pay ${g.county}.`,
  politicalNote: (isCounty) => `Political money is not scored: contributions to Arkansas ${isCounty ? 'county' : 'city'} candidates were not loaded.`,
});
