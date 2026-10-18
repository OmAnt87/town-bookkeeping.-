#!/usr/bin/env node
// Builds real TownView records for Kansas's counties, cities and townships from the Census
// individual unit files (see scripts/common/town-census-build.mjs). Each county's file holds the
// county and the governments whose people mostly live in it. Kansas City is unified with
// Wyandotte County and reports as one city.
//
//   node scripts/ks/download.mjs
//   node scripts/ks/build-county.mjs --county Sedgwick      (or --all)
//
// County treasurers collect every property tax in Kansas, so the levy rules for northern New
// England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'KS',
  name: 'Kansas',
  fips: '20',
  levy: false,
  cousubKinds: { city: 'City', township: 'Township' },
  placeKinds: { city: 'City' },
  countyScope: 'All county funds, including the sheriff, jail, courts and county roads',
  countyNote: () => 'Public schools are run by separate school districts with their own taxes, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts with their own taxes, so they are not included. Residents also pay ${g.county}.`,
  memberNote: (g) => (g.kind === 'Township' ? 'Kansas townships govern the rural areas outside cities, mainly maintaining township roads and, in some, cemeteries and fire protection.' : null),
  politicalNote: (isCounty) => `Political money is not scored: contributions to Kansas ${isCounty ? 'county' : 'local'} candidates were not loaded.`,
});
