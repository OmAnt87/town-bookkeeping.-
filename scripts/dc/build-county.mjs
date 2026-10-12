#!/usr/bin/env node
// Builds real Town Ledger records for District of Columbia's counties and cities from the Census
// individual unit files (see scripts/common/town-census-build.mjs). Its file holds the District
// alone.
//
//   node scripts/dc/download.mjs
//   node scripts/dc/build-county.mjs --all
//
// The District collects its own property tax, so the levy rules for northern New England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'DC',
  name: 'District of Columbia',
  fips: '11',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City' },
  countyScope: 'All District funds',
  countyNote: () => '',
  memberSchoolNote: () => 'The District runs its own public schools, so school spending is included and left out of the services and overhead shares. It also provides services states provide elsewhere, such as Medicaid and the state university.',
  politicalNote: () => 'Political money is not scored: contributions to District of Columbia candidates were not loaded.',
});
