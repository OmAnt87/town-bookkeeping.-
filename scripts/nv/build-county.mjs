#!/usr/bin/env node
// Builds real Town Ledger records for Nevada's counties and cities from the Census individual
// unit files (see scripts/common/town-census-build.mjs). Each county's file holds the county and
// the cities whose people mostly live in it.
//
//   node scripts/nv/download.mjs
//   node scripts/nv/fetch-sos.mjs                       # campaign finance (optional; needs Playwright)
//   node scripts/nv/build-county.mjs --all
//
// County treasurers collect every property tax in Nevada, so the levy rules for northern New
// England are off.

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildState } from '../common/town-census-build.mjs';
import { parseCSVRows } from '../common/atlas.mjs';
import { officeLevel, norm, nameKey, summarizeNvContributions, SOS_SEARCH } from './sos-map.mjs';

const SOS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'nv', 'sos');
const FIRST_YEAR = new Date().getFullYear() - 3;
const SINCE = `${FIRST_YEAR}-01-01`;

// Places each county and city candidate by the jurisdiction they filed with and the office on
// their candidate page, then gathers contributions to them from businesses, unions and PACs
// (matched by the recipient's name).
function politics(geo) {
  if (!existsSync(join(SOS, 'candidates.json'))) return null;
  const counties = new Map();
  const cities = new Map();
  for (const g of geo.values()) {
    if (g.kind === 'County') counties.set(norm(String(g.county || g.display).replace(/ County$/, '')), g.key);
    else cities.set(norm(g.base), g.key);
  }
  // Carson City is a consolidated city and county: its candidates file under "CARSON CITY".
  for (const g of geo.values()) if (g.key.startsWith('Consolidated|')) { counties.set(norm(g.display), g.key); cities.set(norm(g.display), g.key); }
  const byFull = new Map();
  const byKey = new Map();
  const add = (map, k, v) => k && (map.get(k) || map.set(k, new Map()).get(k)).set(v.key, v);
  for (const c of JSON.parse(readFileSync(join(SOS, 'candidates.json'), 'utf8'))) {
    const level = officeLevel(c.office, c.jurisdiction);
    const key = level === 'county' ? counties.get(norm(c.jurisdiction)) : level === 'city' ? cities.get(norm(c.jurisdiction)) : null;
    const v = { key: key || 'elsewhere', label: `${c.name} (${c.office || 'candidate'})` };
    add(byFull, c.name.toLowerCase().trim(), v);
    add(byKey, nameKey(c.name), v);
  }
  // A recipient filed in exactly one place, by full name, or by first and last name when that is unique.
  const placeOf = (recipient) => {
    const hit = byFull.get(String(recipient).toLowerCase().trim()) || byKey.get(nameKey(recipient));
    if (!hit || hit.size !== 1) return null;
    const [v] = hit.values();
    return geo.has(v.key) ? v : null;
  };
  const receiptsBy = new Map();
  for (const f of readdirSync(SOS).filter((x) => /^contributions-\d{4}-\d{2}\.csv$/.test(x)).sort()) {
    for (const r of parseCSVRows(readFileSync(join(SOS, f), 'utf8').replace(/^\uFEFF/, ''))) {
      const v = placeOf(r.Recipient);
      if (!v) continue;
      (receiptsBy.get(v.key) || receiptsBy.set(v.key, []).get(v.key)).push({ ...r, recipientLabel: v.label });
    }
  }
  const results = new Map([...receiptsBy].map(([k, rows]) => [k, summarizeNvContributions(rows, SINCE)]));
  const officeText = (isCounty) => (isCounty ? 'county commission, sheriff, assessor, treasurer, recorder and clerk candidates' : 'candidates for mayor and city council');
  return {
    results,
    filers: new Set(receiptsBy.keys()),
    since: SINCE,
    sourceUrl: SOS_SEARCH,
    sourceLabel: (g) => `Nevada Secretary of State contributions to ${g.display}'s candidates since ${FIRST_YEAR}`,
    scope: (isCounty) => (isCounty ? 'County candidates: commission, sheriff, assessor, treasurer, recorder, clerk, public administrator' : 'Municipal candidates: mayor and city council'),
    note: (g, isCounty, pol) => `Political money counts monetary contributions from businesses, unions and PACs to ${officeText(isCounty)}, reported to the Secretary of State since ${FIRST_YEAR}${pol.counted ? '' : ' (none were found)'}. The Secretary of State's export has no contributor type, so organizations are recognized by name (LLC, Inc, PAC, union locals) and some are missed; contributions are matched to candidates by name. Nevada allows business and union contributions. Individuals, in-kind gifts, and party and candidate committees are not counted.`,
    noneNote: (g, isCounty) => `Political money is not scored: no ${officeText(isCounty)} of ${g.display} reported contributions to the Secretary of State since ${FIRST_YEAR}.`,
  };
}

buildState({
  code: 'NV',
  name: 'Nevada',
  fips: '32',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City' },
  countyScope: 'All county funds, including the sheriff or metropolitan police, courts, social services and county roads',
  countyNote: () => 'Public schools are run by separate school districts, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts, so they are not included. Residents also pay ${g.county}.`,
  politicalNote: () => 'Political money is not scored: Secretary of State campaign finance data was not loaded.',
  politics,
  consolidated: {
    '09700': { county: '510', display: 'Carson City' },
  },
});
