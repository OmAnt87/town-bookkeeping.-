#!/usr/bin/env node
// Builds real TownView records for Washington's counties, cities and towns from the Census
// individual unit files (see scripts/common/town-census-build.mjs). Each county's file holds the
// county and the cities and towns whose people mostly live in it. Washington has no townships.
//
//   node scripts/wa/download.mjs
//   node scripts/wa/fetch-pdc.mjs                        # campaign finance (optional)
//   node scripts/wa/build-county.mjs --county King      (or --all)
//
// County treasurers or tax collectors gather every property tax in Washington, so the levy rules for
// northern New England are off.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildState } from '../common/town-census-build.mjs';
import { placeJurisdiction, normPlace, summarizeWaContributions, PDC_PAGE } from './pdc-map.mjs';

const PDC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'wa', 'pdc', 'contributions.json');
const SINCE = `${new Date().getFullYear() - 3}-01-01`;

// Places each contribution by the jurisdiction of the candidate's office. City names that match
// more than one city or town in the state are skipped.
function politics(geo) {
  if (!existsSync(PDC)) return null;
  const counties = new Map();
  const cities = new Map();
  for (const g of geo.values()) {
    if (g.kind === 'County') counties.set(normPlace(g.base), g.key);
    else if (g.key.startsWith('Place|')) {
      const n = normPlace(g.base);
      cities.set(n, cities.has(n) ? null : g.key);
    }
  }
  const byKey = new Map();
  for (const r of JSON.parse(readFileSync(PDC, 'utf8'))) {
    const p = placeJurisdiction(r.jurisdiction);
    const key = !p ? null : p.level === 'county' ? counties.get(p.name) : cities.get(p.name);
    if (key) (byKey.get(key) || byKey.set(key, []).get(key)).push(r);
  }
  const results = new Map([...byKey].map(([k, rows]) => [k, summarizeWaContributions(rows, SINCE)]));
  const officeText = (isCounty) => (isCounty ? 'county commissioner, council, executive, sheriff, prosecutor and other county office candidates' : 'candidates for mayor and council');
  return {
    results,
    filers: new Set(byKey.keys()),
    since: SINCE,
    sourceUrl: PDC_PAGE,
    sourceLabel: (g) => `Washington Public Disclosure Commission: contributions to ${g.display}'s candidates since ${SINCE.slice(0, 4)}`,
    scope: (isCounty) => (isCounty ? 'County candidates: commissioners or council, executive, sheriff, prosecutor, assessor, auditor, clerk, treasurer' : 'City and town candidates: mayor and council'),
    note: (g, isCounty, pol) => `Political money counts cash contributions from businesses, unions and PACs to ${officeText(isCounty)}, reported to the Public Disclosure Commission since ${SINCE.slice(0, 4)}${pol.counted ? '' : ' (none were found)'}. Washington allows business and union contributions to local candidates. Individuals, candidates' own money, in-kind gifts, and party and caucus committees are not counted.`,
    noneNote: (g, isCounty) => `Political money is not scored: no ${officeText(isCounty)} of ${g.display} reported business, union or PAC contributions to the Public Disclosure Commission since ${SINCE.slice(0, 4)}.`,
  };
}

buildState({
  code: 'WA',
  name: 'Washington',
  fips: '53',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City', town: 'Town' },
  countyScope: 'All county funds, including the sheriff, jail, courts, public health, human services and county roads',
  countyNote: () => 'Public schools are run by separate school districts, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts, so they are not included. Residents also pay ${g.county}.`,
  politicalNote: () => 'Political money is not scored: Public Disclosure Commission data was not loaded.',
  politics,
});
