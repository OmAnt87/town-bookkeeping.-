#!/usr/bin/env node
// Builds real Town Ledger records for Texas's counties, cities, towns and villages from the Census
// individual unit files (see scripts/common/town-census-build.mjs). Each county's file holds the
// county and the municipalities whose people mostly live in it. Texas has no townships.
//
//   node scripts/tx/download.mjs
//   node scripts/tx/build-county.mjs --county Travis      (or --all)
//
// County tax assessor-collectors gather most property taxes in Texas, and city figures show only
// their own levy, so the levy rules for northern New England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'TX',
  name: 'Texas',
  fips: '48',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City', town: 'Town', village: 'Village' },
  countyScope: 'All county funds, including the sheriff, jail, courts, county roads and, where the county runs them, hospitals',
  countyNote: () => 'Public schools are run by independent school districts with their own taxes, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by independent school districts with their own taxes, so they are not included. Residents also pay ${g.county}.`,
  politicalNote: (isCounty) => `Political money is not scored: contributions to Texas ${isCounty ? 'county' : 'city'} candidates were not loaded.`,
});
