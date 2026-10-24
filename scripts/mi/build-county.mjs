#!/usr/bin/env node
// Builds real TownView records for Michigan's counties, cities, villages and townships
// (general law and charter) from the Census individual unit files (see
// scripts/common/town-census-build.mjs). Each county's file holds the county and the governments
// whose people mostly live in it.
//
//   node scripts/mi/download.mjs
//   node scripts/mi/build-county.mjs --county Kent      (or --all)
//
// Michigan townships and cities collect school and county taxes on their tax bills, but their
// Census figures do not show those levies as their own (revenue is close to spending), so the
// levy rules for northern New England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'MI',
  name: 'Michigan',
  fips: '26',
  levy: false,
  cousubKinds: { city: 'City', 'charter township': 'Charter Township', township: 'Township' },
  placeKinds: { city: 'City', village: 'Village' },
  countyScope: 'All county funds, including the sheriff, jail, courts, health department and county roads where the county runs them',
  countyNote: () => 'Public schools are run by separate school districts with their own taxes, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts with their own taxes, so they are not included. Residents also pay ${g.county}${g.kind === 'Village' ? ' and the township the village is part of' : ''}.`,
  memberNote: (g) => (g.kind === 'Village' ? 'Village residents also pay the township the village is part of, which is listed separately.' : null),
  politicalNote: (isCounty) => `Political money is not scored: Michigan ${isCounty ? 'county' : 'local'} candidates file campaign finance reports with their county clerk, not with the state.`,
});
