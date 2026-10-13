#!/usr/bin/env node
// Builds real Town Ledger records for Nevada's counties and cities from the Census individual
// unit files (see scripts/common/town-census-build.mjs). Each county's file holds the county and
// the cities whose people mostly live in it.
//
//   node scripts/nv/download.mjs
//   node scripts/nv/build-county.mjs --all
//
// County treasurers collect every property tax in Nevada, so the levy rules for northern New
// England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'NV',
  name: 'Nevada',
  fips: '32',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City' },
  countyScope: 'All county funds, including the sheriff or metropolitan police, courts, social services and county roads',
  countyNote: () => 'Public schools are run by separate school districts, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts, so they are not included. Residents also pay ${g.county}.`,
  politicalNote: (isCounty) => `Political money is not scored: contributions to Nevada ${isCounty ? 'county' : 'city'} candidates were not loaded.`,
  consolidated: {
    '09700': { county: '510', display: 'Carson City' },
  },
});
