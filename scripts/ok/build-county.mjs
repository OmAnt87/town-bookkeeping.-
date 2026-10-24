#!/usr/bin/env node
// Builds real TownView records for Oklahoma's counties, cities and towns from the Census
// individual unit files (see scripts/common/town-census-build.mjs). Each county's file holds the
// county and the cities and towns whose people mostly live in it.
//
//   node scripts/ok/download.mjs
//   node scripts/ok/build-county.mjs --all
//
// County treasurers collect every property tax in Oklahoma; cities rely mainly on sales tax, so
// the levy rules for northern New England are off.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildState } from '../common/town-census-build.mjs';
import { receiptsByGovernment } from '../common/civix.mjs';
import { placeCommittee, summarizeOkContributions, GUARDIAN_PAGE } from './guardian-map.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'ok', 'guardian');
const SINCE = `${new Date().getFullYear() - 3}-01-01`;

// Each committee is placed by the jurisdiction on its registration page
// (scripts/common/civix.mjs receiptsByGovernment).
function politics(geo) {
  if (!existsSync(join(RAW, 'committees.json')) || !existsSync(join(RAW, 'contributions.json'))) return null;
  const orgs = JSON.parse(readFileSync(join(RAW, 'committees.json'), 'utf8'));
  const receipts = JSON.parse(readFileSync(join(RAW, 'contributions.json'), 'utf8')).map((r) => ({ ...r, office: orgs[r['org id']]?.office || '' }));
  const byKey = receiptsByGovernment(geo, receipts, (r) => placeCommittee(orgs[r['org id']]));
  const results = new Map([...byKey].map(([k, rows]) => [k, summarizeOkContributions(rows, SINCE)]));
  const officeText = (isCounty) => (isCounty ? 'county commissioner, sheriff, clerk, assessor and treasurer candidates' : 'candidates for mayor and council');
  return {
    results,
    filers: new Set(byKey.keys()),
    since: SINCE,
    sourceUrl: GUARDIAN_PAGE,
    sourceLabel: (g) => `Oklahoma Ethics Commission: contributions to ${g.display}'s candidates since ${SINCE.slice(0, 4)}`,
    scope: (isCounty) => (isCounty ? 'County candidates: commissioners, sheriff, clerk, court clerk, assessor, treasurer' : 'Municipal candidates: mayor and council'),
    note: (g, isCounty, pol) => `Political money counts cash contributions from PACs, unions and businesses to ${officeText(isCounty)}, reported to the Oklahoma Ethics Commission since ${SINCE.slice(0, 4)}${pol.counted ? '' : ' (none were found)'}. Oklahoma bans corporate contributions to candidates, so most outside money comes through PACs. Individuals, candidates' own money, tribes, in-kind gifts and party and candidate committees are not counted.`,
    noneNote: (g, isCounty) => `Political money is not scored: no ${officeText(isCounty)} of ${g.display} were matched to contributions reported to the Ethics Commission since ${SINCE.slice(0, 4)}.`,
  };
}

buildState({
  code: 'OK',
  name: 'Oklahoma',
  fips: '40',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City', town: 'Town' },
  countyScope: 'All county funds, including the sheriff, jail, courts and county roads',
  countyNote: () => 'Public schools are run by separate school districts, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts, so they are not included. Residents also pay ${g.county}.`,
  politicalNote: () => 'Political money is not scored: Ethics Commission data was not loaded.',
  politics,
});
