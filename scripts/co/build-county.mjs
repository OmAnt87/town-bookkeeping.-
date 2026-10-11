#!/usr/bin/env node
// Builds real Town Ledger records for Colorado's counties, cities and towns from the Census
// individual unit files (see scripts/common/town-census-build.mjs). Each county's file holds the
// county and the cities and towns whose people mostly live in it. Colorado has no townships.
// Denver and Broomfield are consolidated cities and counties and report as one city each.
//
//   node scripts/co/download.mjs
//   node scripts/co/build-county.mjs --county Denver      (or --all)
//
// County treasurers or tax collectors gather every property tax in Colorado, so the levy rules for
// northern New England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'CO',
  name: 'Colorado',
  fips: '08',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City', town: 'Town' },
  countyScope: 'All county funds, including the sheriff, jail, courts, public health, human services and county roads',
  countyNote: () => 'Public schools are run by separate school districts, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts, so they are not included.${/^City of (Denver|Broomfield)$/.test(g.display) ? '' : ` Residents also pay ${g.county}.`}`,
  politicalNote: (isCounty) => `Political money is not scored: contributions to Colorado ${isCounty ? 'county' : 'city'} candidates were not loaded.`,
});
