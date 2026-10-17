#!/usr/bin/env node
// Builds real Town Ledger records for Nebraska's counties, cities and villages from the Census
// individual unit files (see scripts/common/town-census-build.mjs). Each county's file holds the
// county and the governments whose people mostly live in it.
//
//   node scripts/ne/download.mjs
//   node scripts/ne/build-county.mjs --county Lancaster      (or --all)
//
// County treasurers collect every property tax in Nebraska, so the levy rules for northern New
// England are off. Townships are left out: their Census records show road spending about twice
// their reported revenue, so their revenue appears incomplete.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'NE',
  name: 'Nebraska',
  fips: '31',
  levy: false,
  excludeUnitKinds: ['township'],
  excludeReason: 'Nebraska\'s township governments (in the counties that have them). Their Census records show only property tax and road spending, with spending about twice the reported revenue, so their revenue appears incomplete.',
  cousubKinds: { city: 'City' },
  placeKinds: { city: 'City', village: 'Village' },
  countyScope: 'All county funds, including the sheriff, jail, courts and county roads',
  countyNote: () => 'Public schools are run by separate school districts with their own taxes, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts with their own taxes, so they are not included. Residents also pay ${g.county}.`,
  politicalNote: (isCounty) => `Political money is not scored: contributions to Nebraska ${isCounty ? 'county' : 'local'} candidates were not loaded.`,
});
