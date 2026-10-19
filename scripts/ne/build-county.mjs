#!/usr/bin/env node
// Builds real TownView records for Nebraska's counties, cities and villages from the Census
// individual unit files (see scripts/common/town-census-build.mjs). Each county's file holds the
// county and the governments whose people mostly live in it.
//
//   node scripts/ne/download.mjs
//   node scripts/ne/build-county.mjs --county Lancaster      (or --all)
//
// County treasurers collect every property tax in Nebraska, so the levy rules for northern New
// England are off. Townships are left out: their Census records show road spending about twice
// their reported revenue, so their revenue appears incomplete.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildState } from '../common/town-census-build.mjs';
import { receiptsByGovernment } from '../common/civix.mjs';
import { placeCommittee, summarizeNeContributions, NADC_PAGE } from './nadc-map.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'ne', 'nadc');
const SINCE = `${new Date().getFullYear() - 3}-01-01`;

// Each candidate committee is placed by the jurisdiction on its NADC registration page.
function politics(geo) {
  if (!existsSync(join(RAW, 'committees.json')) || !existsSync(join(RAW, 'contributions.json'))) return null;
  const orgs = JSON.parse(readFileSync(join(RAW, 'committees.json'), 'utf8'));
  const receipts = JSON.parse(readFileSync(join(RAW, 'contributions.json'), 'utf8')).map((r) => ({ ...r, office: orgs[r['org id']]?.office || '' }));
  const byKey = receiptsByGovernment(geo, receipts, (r) => placeCommittee(orgs[r['org id']]));
  const results = new Map([...byKey].map(([k, rows]) => [k, summarizeNeContributions(rows, SINCE)]));
  const officeText = (isCounty) => (isCounty ? 'county commissioner, sheriff, attorney and other county office candidates' : 'candidates for mayor and city council');
  return {
    results,
    filers: new Set(byKey.keys()),
    since: SINCE,
    sourceUrl: NADC_PAGE,
    sourceLabel: (g) => `Nebraska Accountability and Disclosure Commission: contributions to ${g.display}'s candidates since ${SINCE.slice(0, 4)}`,
    scope: (isCounty) => (isCounty ? 'County candidates: commissioners or supervisors, sheriff, attorney, clerk, treasurer, assessor' : 'City candidates: mayor and council'),
    note: (g, isCounty, pol) => `Political money counts cash contributions from businesses, unions and PACs to ${officeText(isCounty)} who filed with the NADC since ${SINCE.slice(0, 4)}${pol.counted ? '' : ' (none were found)'}. Candidates file with the NADC once they raise or spend more than $5,000, so smaller races are not included. The NADC files nonprofits with businesses, so both are counted as business money. Individuals, candidates' own money, in-kind gifts and party and candidate committees are not counted.`,
    noneNote: (g, isCounty) => `Political money is not scored: no ${officeText(isCounty)} of ${g.display} reported to the NADC since ${SINCE.slice(0, 4)}.`,
  };
}

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
  politicalNote: () => 'Political money is not scored: NADC data was not loaded.',
  politics,
});
