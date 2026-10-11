#!/usr/bin/env node
// Builds real Town Ledger records for Missouri's counties, cities, towns, villages and townships
// from the Census individual unit files (see scripts/common/town-census-build.mjs). Each
// county's file holds the county and the governments whose people mostly live in it. St. Louis
// is an independent city outside any county.
//
//   node scripts/mo/download.mjs
//   node scripts/mo/build-county.mjs --county Greene      (or --all)
//
// County collectors gather every property tax in Missouri, so the levy rules for northern New
// England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'MO',
  name: 'Missouri',
  fips: '29',
  levy: false,
  cousubKinds: { township: 'Township' },
  placeKinds: { city: 'City', town: 'Town', village: 'Village' },
  countyScope: 'All county funds, including the sheriff, jail, courts and county roads',
  countyNote: () => 'Public schools are run by separate school districts with their own taxes, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts with their own taxes, so they are not included.${g.county && !/ city$/.test(g.county) ? ` Residents also pay ${g.county}${g.kind === 'Township' ? '' : ' and, in the counties that have them, the township they live in'}.` : ''}`,
  memberNote: (g) => (g.kind === 'Township' ? 'Missouri has townships in about 20 counties; they mainly maintain township roads.' : null),
  politicalNote: (isCounty) => `Political money is not scored: contributions to Missouri ${isCounty ? 'county' : 'local'} candidates were not loaded.`,
});
