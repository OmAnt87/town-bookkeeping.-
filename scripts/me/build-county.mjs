#!/usr/bin/env node
// Builds real Town Ledger records for Maine's counties, cities, towns and plantations from the
// Census individual unit files (see scripts/common/town-census-build.mjs). Each county's file
// holds the county and the governments in it.
//
//   node scripts/me/download.mjs
//   node scripts/me/build-county.mjs --county Cumberland      (or --all)

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'ME',
  name: 'Maine',
  fips: '23',
  cousubKinds: { city: 'City', town: 'Town', plantation: 'Plantation' },
  countyScope: 'All county funds, including the jail, sheriff and registry of deeds',
  countyNote: (g) => `${g.display}'s cities, towns and plantations collect the county tax with their own property tax bills and pay it over. Public schools are run by school districts and municipal school departments, so they are not included.`,
  sharesText: 'the school district and the county',
  memberNote: (g) => (g.kind === 'Plantation' ? 'Plantations are a simpler form of town government with fewer officers; the county and state provide some services that towns provide for themselves.' : null),
  politicalNote: (isCounty) => `Political money is not scored: ${isCounty ? 'contributions to Maine county candidates were not loaded' : 'Maine city, town and plantation candidates file campaign finance reports with their municipal clerk, not with the state'}.`,
});
