#!/usr/bin/env node
// Builds real TownView records for Ohio's counties, cities, villages and townships from the
// Census individual unit files (see scripts/common/town-census-build.mjs). Each county's file
// holds the county and the governments whose people mostly live in it.
//
//   node scripts/oh/download.mjs
//   node scripts/oh/build-county.mjs --county Franklin      (or --all)
//
// County treasurers collect every property tax in Ohio, so the levy rules for northern New
// England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'OH',
  name: 'Ohio',
  fips: '39',
  levy: false,
  cousubKinds: { city: 'City', village: 'Village', township: 'Township' },
  placeKinds: { city: 'City', village: 'Village' },
  countyScope: 'All county funds, including the sheriff, jail, courts, human services and county roads',
  countyNote: () => 'Public schools are run by separate school districts with their own taxes, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts with their own taxes, so they are not included. Residents also pay ${g.county}${g.kind === 'Township' ? '' : ' and, unless the municipality has left it, the surrounding township'}.`,
  memberNote: (g) => (g.kind === 'Township' ? 'A township serves the parts of it outside cities, and in most cases also the villages inside it.' : null),
  politicalNote: (isCounty) => `Political money is not scored: Ohio ${isCounty ? 'county' : 'local'} candidates file campaign finance reports with their county board of elections, not with the state.`,
});
