#!/usr/bin/env node
// Builds real Town Ledger records for Alaska's boroughs and cities from the Census individual
// unit files (see scripts/common/town-census-build.mjs). Each borough's file holds the borough
// and the cities whose people mostly live in it.
//
//   node scripts/ak/download.mjs
//   node scripts/ak/build-county.mjs --all
//
// Boroughs and cities each levy their own property tax in Alaska, and many levy no property tax
// at all, so the levy rules for northern New England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'AK',
  name: 'Alaska',
  fips: '02',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City' },
  countyScope: 'All borough funds, including the borough school district where the borough runs schools',
  countyNote: () => 'Borough school districts are part of the borough government in Alaska, so school spending is included (it is left out of the services and overhead shares).',
  memberSchoolNote: () => 'Some Alaska cities run their own school districts; where this one does, school spending is included and left out of the services and overhead shares.',
  politicalNote: (isCounty) => `Political money is not scored: contributions to Alaska ${isCounty ? 'borough' : 'city'} candidates were not loaded.`,
  consolidated: {
    '03000': { county: '020', display: 'Municipality of Anchorage' },
    '36400': { county: '110', display: 'City and Borough of Juneau' },
    '70540': { county: '220', display: 'City and Borough of Sitka' },
    '86380': { county: '275', display: 'City and Borough of Wrangell' },
  },
});
