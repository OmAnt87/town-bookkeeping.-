#!/usr/bin/env node
// Builds real TownView records for Minnesota's counties, cities and townships from the Census
// individual unit files (see scripts/common/town-census-build.mjs). Each county's file holds the
// county and the governments whose people mostly live in it.
//
//   node scripts/mn/download.mjs
//   node scripts/mn/build-county.mjs --county Hennepin      (or --all)
//
// County auditors and treasurers collect every property tax in Minnesota, so the levy rules for
// northern New England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'MN',
  name: 'Minnesota',
  fips: '27',
  levy: false,
  cousubKinds: { city: 'City', township: 'Township' },
  placeKinds: { city: 'City' },
  countyScope: 'All county funds, including the sheriff, jail, human services, public health and county highways',
  countyNote: () => 'Public schools are run by separate school districts with their own taxes, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts with their own taxes, so they are not included. Residents also pay ${g.county}.`,
  memberNote: (g) => (g.kind === 'Township' ? 'Minnesota townships govern the areas outside cities, mostly maintaining township roads; many contract with a city or fire district for fire protection.' : null),
  politicalNote: (isCounty) => `Political money is not scored: Minnesota ${isCounty ? 'county' : 'local'} candidates file campaign finance reports with their ${isCounty ? 'county auditor' : 'city or township clerk'}, not with the state.`,
});
