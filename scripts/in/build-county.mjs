#!/usr/bin/env node
// Builds real Town Ledger records for Indiana's counties, cities, towns and townships from the
// Census individual unit files (see scripts/common/town-census-build.mjs). Each county's file
// holds the county and the governments whose people mostly live in it. Indianapolis is
// consolidated with Marion County and reports as one city.
//
//   node scripts/in/download.mjs
//   node scripts/in/build-county.mjs --county Hamilton      (or --all)
//
// County treasurers collect every property tax in Indiana, so the levy rules for northern New
// England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'IN',
  name: 'Indiana',
  fips: '18',
  levy: false,
  cousubKinds: { city: 'City', township: 'Township' },
  placeKinds: { city: 'City', town: 'Town' },
  countyScope: 'All county funds, including the sheriff, jail, courts and county roads',
  countyNote: () => 'Public schools are run by separate school corporations with their own taxes, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school corporations with their own taxes, so they are not included. Residents also pay ${g.county}${g.kind === 'Township' ? '' : ' and the township they live in'}.`,
  memberNote: (g) => (g.kind === 'Township' ? 'Indiana townships cover the whole county, cities and towns included; the township trustee provides poor relief and, in many townships, fire protection.' : null),
  politicalNote: (isCounty) => `Political money is not scored: Indiana ${isCounty ? 'county' : 'local'} candidates file campaign finance reports with their county election board, not with the state.`,
});
