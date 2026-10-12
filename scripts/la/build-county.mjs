#!/usr/bin/env node
// Builds real Town Ledger records for Louisiana's parishes, cities, towns and villages from the
// Census individual unit files (see scripts/common/town-census-build.mjs). Each parish's file
// holds the parish and the municipalities whose people mostly live in it.
//
//   node scripts/la/download.mjs
//   node scripts/la/build-county.mjs --all
//
// Parish sheriffs collect property taxes in Louisiana, so the levy rules for northern New
// England are off.

import { buildState } from '../common/town-census-build.mjs';

buildState({
  code: 'LA',
  name: 'Louisiana',
  fips: '22',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City', town: 'Town', village: 'Village' },
  countyScope: 'All parish funds (police jury or parish council), including parish roads, drainage and solid waste',
  countyNote: () => 'Public schools are run by parish school boards, which are separate governments, so they are not included. Sheriffs, assessors and clerks of court are separate offices and are not included either.',
  memberSchoolNote: (g) => `Public schools are run by parish school boards, which are separate governments, so they are not included. Residents also pay ${g.county}.`,
  politicalNote: (isCounty) => `Political money is not scored: contributions to Louisiana ${isCounty ? 'parish' : 'city'} candidates were not loaded.`,
});
