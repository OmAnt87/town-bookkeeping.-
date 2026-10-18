#!/usr/bin/env node
// Builds real Town Ledger records for Washington's counties, cities and towns from the Census
// individual unit files (see scripts/common/town-census-build.mjs). Each county's file holds the
// county and the cities and towns whose people mostly live in it. Washington has no townships.
//
//   node scripts/wa/download.mjs
//   node scripts/wa/fetch-pdc.mjs                       # campaign finance (optional)
//   node scripts/wa/build-county.mjs --county King      (or --all)
//
// County treasurers or tax collectors gather every property tax in Washington, so the levy rules for
// northern New England are off.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildState } from '../common/town-census-build.mjs';
import { placeReceipt, summarizeWaReceipts, normPlace, PDC_PAGE } from './pdc-map.mjs';

const PDC = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'wa', 'pdc.json');

// Places each receipt by its candidate's jurisdiction (a city or town by name and county, or a
// county) and gathers the business, PAC and union money given to each government's candidates.
function politics(geo) {
  if (!existsSync(PDC)) return null;
  const { since, rows } = JSON.parse(readFileSync(PDC, 'utf8'));
  const counties = new Map();
  const cities = new Map();
  for (const g of geo.values()) {
    const county = normPlace(String(g.county || '').replace(/ County$/, ''));
    if (g.kind === 'County') counties.set(county, g.key);
    else if (g.key.startsWith('Place|')) {
      const k = normPlace(g.base);
      (cities.get(k) || cities.set(k, []).get(k)).push({ key: g.key, county });
    }
  }
  const by = new Map();
  for (const r of rows) {
    const p = placeReceipt(r);
    if (!p) continue;
    let k = null;
    if (p.level === 'county') k = counties.get(p.county);
    else {
      const named = cities.get(p.city) || [];
      k = (named.length === 1 ? named[0] : named.find((c) => c.county === p.county))?.key;
    }
    if (!k) continue;
    (by.get(k) || by.set(k, []).get(k)).push(r);
  }
  const results = new Map([...by].map(([k, rs]) => [k, summarizeWaReceipts(rs, since)]));
  const officeText = (isCounty) => (isCounty ? 'county executive, council, commission, sheriff and other county office candidates' : 'candidates for mayor and city or town council');
  return {
    results,
    filers: new Set([...results].filter(([, r]) => r.counted).map(([k]) => k)),
    since,
    sourceUrl: PDC_PAGE,
    sourceLabel: (g) => `Washington Public Disclosure Commission: business, PAC and union contributions to ${g.display}'s candidates since ${since.slice(0, 4)}`,
    scope: (isCounty) => (isCounty ? 'County candidates: executive, council or commissioners, sheriff, assessor, auditor, clerk, coroner, prosecutor, treasurer' : 'City candidates: mayor, council, city attorney'),
    note: (g, isCounty, pol) => `Political money counts contributions from businesses, PACs and unions to ${officeText(isCounty)}, reported to the Public Disclosure Commission since ${since.slice(0, 4)} (${pol.counted} receipts). Individuals, candidates' own money, parties and unidentified small gifts are not counted. Candidates who raise little can use mini-reporting and itemize nothing, so some money may be missing.`,
    noneNote: (g, isCounty) => `Political money is not scored: no ${officeText(isCounty)} of ${g.display} reported business, PAC or union contributions to the Public Disclosure Commission since ${since.slice(0, 4)}. Candidates who raise little can use mini-reporting and itemize nothing.`,
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
  politicalNote: (isCounty) => `Political money is not scored: contributions to Washington ${isCounty ? 'county' : 'city'} candidates were not loaded.`,
  politics,
});
