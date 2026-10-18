#!/usr/bin/env node
// Builds real Town Ledger records for Vermont's counties, cities, towns and incorporated villages
// from the Census individual unit files (see scripts/common/town-census-build.mjs). Each county's
// file holds the county and the governments in it.
//
//   node scripts/vt/download.mjs
//   node scripts/vt/build-county.mjs --county Chittenden      (or --all)
//
// Towns and cities bill the state education property tax with their own. The Department of
// Taxes lists both for every town, so where a town reported the education tax as its own, that
// amount is taken out (see scripts/common/levy.mjs).

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildState } from '../common/town-census-build.mjs';
import { taxesFor } from './taxes.mjs';

const taxes = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'vt', 'taxrates.json'), 'utf8'));

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
  levyTaxes: (u) => taxesFor(taxes, u.name, u.fyEnd),
  levyTaxesSource: (tax) => ({ label: `Vermont Department of Taxes, Property Valuation and Review annual report data: taxes and tax rates by town (tax year ${tax.taxYear})`, url: 'https://tax.vermont.gov/pvr-annual-report' }),
  memberNote: (g) => (g.kind === 'Village' ? 'Village residents also pay the town the village is part of, which is listed separately.' : null),
  politicalNote: (isCounty) => `Political money is not scored: ${isCounty ? 'contributions to Vermont county candidates were not loaded' : 'Vermont city, town and village candidates do not file campaign finance reports with the state'}.`,
});
