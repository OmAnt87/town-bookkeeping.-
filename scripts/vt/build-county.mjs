#!/usr/bin/env node
// Builds real Town Ledger records for Vermont's counties, cities, towns and incorporated villages
// from the Census individual unit files (see scripts/common/town-census-build.mjs). Each county's
// file holds the county and the governments in it.
//
//   node scripts/vt/download.mjs
//   node scripts/vt/build-county.mjs --county Chittenden      (or --all)

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'VT',
  name: 'Vermont',
  fips: '50',
  cousubKinds: { city: 'City', town: 'Town' },
  placeKinds: { village: 'Village', city: 'City' },
  countyScope: 'All county funds (Vermont counties run little beyond the courthouse)',
  countyNote: (g) => `Vermont counties have small budgets, mostly the courthouse, paid by a county tax the towns in ${g.display} collect. Sheriffs and state's attorneys are mostly paid by the state, and public schools are run by school districts, so they are not included.`,
  sharesText: 'the state education tax (which pays for schools) and the county',
  ownLevyKinds: ['Village'],
  memberNote: (g) => (g.kind === 'Village' ? 'Village residents also pay the town the village is part of, which is listed separately.' : null),
  politicalNote: (isCounty) => `Political money is not scored: ${isCounty ? 'contributions to Vermont county candidates were not loaded' : 'Vermont city, town and village candidates do not file campaign finance reports with the state'}.`,
});
