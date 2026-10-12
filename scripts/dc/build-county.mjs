#!/usr/bin/env node
// Builds the real Town Ledger record for the District of Columbia from the Census
// individual unit files (see scripts/common/town-census-build.mjs). Its file holds the District
// alone.
//
//   node scripts/dc/download.mjs
//   node scripts/dc/fetch-ocf.mjs                        # campaign finance (optional)
//   node scripts/dc/build-county.mjs --all
//
// The District collects its own property tax, so the levy rules for northern New England are off.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV } from '../lib.mjs';
import { buildState } from '../common/town-census-build.mjs';
import { summarizeDcContributions, OCF_PAGE } from './ocf-map.mjs';

const OCF = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'dc', 'ocf', 'contributions.csv');
const SINCE = `${new Date().getFullYear() - 3}-01-01`;

// Every District candidate's contributions belong to the one government.
function politics(geo) {
  if (!existsSync(OCF)) return null;
  const key = [...geo.keys()].find((k) => k.startsWith('Place|'));
  const results = new Map([[key, summarizeDcContributions(parseCSV(readFileSync(OCF, 'utf8')), SINCE)]]);
  return {
    results,
    filers: new Set([key]),
    since: SINCE,
    sourceUrl: OCF_PAGE,
    sourceLabel: () => `DC Office of Campaign Finance: contributions to candidates for mayor, council and attorney general since ${SINCE.slice(0, 4)}`,
    scope: () => 'District candidates: mayor, council and attorney general (shadow congressional and school board seats left out)',
    note: (g, isCounty, pol) => `Political money counts contributions from businesses, unions and PACs to candidates for mayor, council and attorney general, reported to the Office of Campaign Finance since ${SINCE.slice(0, 4)}${pol.counted ? '' : ' (none were found)'}. Candidates in the Fair Elections public financing program may not accept business or PAC money. Individuals, candidates' own money, in-kind gifts, party committees, and committees for the shadow congressional seats and the State Board of Education are not counted.`,
    noneNote: () => `Political money is not scored: no contributions to District candidates were found since ${SINCE.slice(0, 4)}.`,
  };
}

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
  politicalNote: () => 'Political money is not scored: Office of Campaign Finance data was not loaded.',
  politics,
});
