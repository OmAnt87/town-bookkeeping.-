#!/usr/bin/env node
// Builds real Town Ledger records for California's counties, cities and towns from the Census
// individual unit files (see scripts/common/town-census-build.mjs). Each county's file holds the
// county and the cities and towns whose people mostly live in it. San Francisco is a
// consolidated city and county and reports as one city.
//
//   node scripts/ca/download.mjs
//   node scripts/ca/build-county.mjs --county Alameda      (or --all)
//
// County tax collectors gather every property tax in California, so the levy rules for northern
// New England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'CA',
  name: 'California',
  fips: '06',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City', town: 'Town' },
  countyScope: 'All county funds, including the sheriff, jails, courts, social services, public health and hospitals where the county runs them',
  countyNote: () => 'Public schools are run by separate school districts, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts, so they are not included.${/ County$/.test(g.county || '') && g.display !== 'City of San Francisco' ? ` Residents also pay ${g.county}.` : ''}`,
  politicalNote: (isCounty) => `Political money is not scored: contributions to California ${isCounty ? 'county' : 'city'} candidates were not loaded.`,
});
