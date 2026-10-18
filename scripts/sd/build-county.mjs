#!/usr/bin/env node
// Builds real TownView records for South Dakota's counties, cities, towns and townships from
// the Census individual unit files (see scripts/common/town-census-build.mjs). Each county's
// file holds the county and the governments whose people mostly live in it.
//
//   node scripts/sd/download.mjs
//   node scripts/sd/build-county.mjs --county Minnehaha      (or --all)
//
// County treasurers collect every property tax in South Dakota, so the levy rules for northern
// New England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'SD',
  name: 'South Dakota',
  fips: '46',
  levy: false,
  cousubKinds: { city: 'City', town: 'Town', township: 'Township' },
  placeKinds: { city: 'City', town: 'Town', village: 'Village' },
  countyScope: 'All county funds, including the sheriff, jail, courts and county roads',
  countyNote: () => 'Public schools are run by separate school districts with their own taxes, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts with their own taxes, so they are not included. Residents also pay ${g.county}.`,
  memberNote: (g) => (g.kind === 'Township' ? 'South Dakota townships govern rural areas outside cities and towns, mainly maintaining township roads.' : null),
  politicalNote: (isCounty) => `Political money is not scored: contributions to South Dakota ${isCounty ? 'county' : 'local'} candidates were not loaded.`,
});
