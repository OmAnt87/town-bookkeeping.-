#!/usr/bin/env node
// Builds real Town Ledger records for Hawaii's counties from the Census individual unit files
// (see scripts/common/town-census-build.mjs). Each county has its own file.
//
//   node scripts/hi/download.mjs
//   node scripts/hi/build-county.mjs --all
//
// Hawaii's counties levy and collect their own property taxes, so the levy rules for northern
// New England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'HI',
  name: 'Hawaii',
  fips: '15',
  levy: false,
  cousubKinds: {},
  placeKinds: {},
  countyScope: 'All county funds, including police, fire, roads, water, parks and solid waste',
  countyNote: () => 'Public schools are run by the state of Hawaii as one statewide district, so they are not included.',
  memberSchoolNote: () => 'Public schools are run by the state of Hawaii as one statewide district, so they are not included.',
  politicalNote: () => 'Political money is not scored: contributions to Hawaii county candidates were not loaded.',
  consolidated: {
    '17000': { county: '003', display: 'City and County of Honolulu' },
  },
});
