#!/usr/bin/env node
// Builds real TownView records for Iowa's counties and cities from the Census individual unit
// files (see scripts/common/town-census-build.mjs). Each county's file holds the county and the
// cities whose people mostly live in it. Iowa's townships are not governments in the Census
// count (their trustees mostly run cemeteries and contract for fire protection), so none are listed.
//
//   node scripts/ia/download.mjs
//   node scripts/ia/build-county.mjs --county Polk      (or --all)
//
// County treasurers collect every property tax in Iowa, so the levy rules for northern New
// England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'IA',
  name: 'Iowa',
  fips: '19',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City' },
  countyScope: 'All county funds, including the sheriff, jail, secondary roads, conservation and county services',
  countyNote: () => 'Public schools are run by separate school districts with their own taxes, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts with their own taxes, so they are not included. Residents also pay ${g.county}.`,
  politicalNote: (isCounty) => `Political money is not scored: contributions to Iowa ${isCounty ? 'county' : 'city'} candidates were not loaded.`,
});
