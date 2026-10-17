#!/usr/bin/env node
// Builds real Town Ledger records for North Dakota's counties, cities and townships from the
// Census individual unit files (see scripts/common/town-census-build.mjs). Each county's file
// holds the county and the governments whose people mostly live in it.
//
//   node scripts/nd/download.mjs
//   node scripts/nd/build-county.mjs --county Cass      (or --all)
//
// County treasurers collect every property tax in North Dakota, so the levy rules for northern
// New England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'ND',
  name: 'North Dakota',
  fips: '38',
  levy: false,
  cousubKinds: { city: 'City', township: 'Township' },
  placeKinds: { city: 'City' },
  countyScope: 'All county funds, including the sheriff, jail, courts, social services and county roads',
  countyNote: () => 'Public schools are run by separate school districts with their own taxes, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts with their own taxes, so they are not included. Residents also pay ${g.county}.`,
  memberNote: (g) => (g.kind === 'Township' ? 'North Dakota townships govern rural areas outside cities, mainly maintaining township roads; many hold road reserves, and in oil country they receive a share of oil tax revenue.' : null),
  politicalNote: (isCounty) => `Political money is not scored: contributions to North Dakota ${isCounty ? 'county' : 'local'} candidates were not loaded.`,
});
