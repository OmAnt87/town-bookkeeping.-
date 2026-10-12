#!/usr/bin/env node
// Builds real Town Ledger records for Alabama's counties, cities and towns from the Census
// individual unit files (see scripts/common/town-census-build.mjs). Each county's file holds the
// county and the cities and towns whose people mostly live in it.
//
//   node scripts/al/download.mjs
//   node scripts/al/build-county.mjs --all
//
// County revenue commissioners or tax collectors gather property taxes in Alabama, so the levy
// rules for northern New England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'AL',
  name: 'Alabama',
  fips: '01',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City', town: 'Town' },
  countyScope: 'All county funds, including the sheriff, jail, courts, county roads and solid waste',
  countyNote: () => 'Public schools are run by county and city boards of education, which the Census counts as separate school systems, so they are not included.',
  memberSchoolNote: () => 'Public schools are run by county and city boards of education, which the Census counts as separate school systems, so they are not included.',
  politicalNote: (isCounty) => `Political money is not scored: contributions to Alabama ${isCounty ? 'county' : 'city'} candidates were not loaded.`,
});
