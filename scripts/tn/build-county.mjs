#!/usr/bin/env node
// Builds real TownView records for Tennessee's counties, cities and towns from the Census
// individual unit files (see scripts/common/town-census-build.mjs). Each county's file holds the
// county and the cities and towns whose people mostly live in it.
//
//   node scripts/tn/download.mjs
//   node scripts/tn/build-county.mjs --all
//
// County trustees collect county property taxes in Tennessee; cities collect their own, so the
// levy rules for northern New England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'TN',
  name: 'Tennessee',
  fips: '47',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City', town: 'Town' },
  countyScope: 'All county funds, including the county school system, sheriff, jail, courts and highways',
  countyNote: () => 'County school systems are part of county government in Tennessee, so school spending is included (it is left out of the services and overhead shares).',
  memberSchoolNote: (g) => `Some Tennessee cities run their own school systems; where this one does, school spending is included and left out of the services and overhead shares. Residents also pay ${g.county}.`,
  politicalNote: (isCounty) => `Political money is not scored: contributions to Tennessee ${isCounty ? 'county' : 'city'} candidates were not loaded.`,
  consolidated: {
    '52004': { county: '037', display: 'Metro Nashville-Davidson County' },
    '44382': { county: '127', display: 'Lynchburg-Moore County' },
  },
});
