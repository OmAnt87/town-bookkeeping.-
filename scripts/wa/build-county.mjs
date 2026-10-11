#!/usr/bin/env node
// Builds real Town Ledger records for Washington's counties, cities and towns from the Census
// individual unit files (see scripts/common/town-census-build.mjs). Each county's file holds the
// county and the cities and towns whose people mostly live in it. Washington has no townships.
//
//   node scripts/wa/download.mjs
//   node scripts/wa/build-county.mjs --county King      (or --all)
//
// County treasurers or tax collectors gather every property tax in Washington, so the levy rules for
// northern New England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'WA',
  name: 'Washington',
  fips: '53',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City', town: 'Town' },
  countyScope: 'All county funds, including the sheriff, jail, courts, public health, human services and county roads',
  countyNote: () => 'Public schools are run by separate school districts, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts, so they are not included. Residents also pay ${g.county}.`,
  politicalNote: (isCounty) => `Political money is not scored: contributions to Washington ${isCounty ? 'county' : 'city'} candidates were not loaded.`,
});
