#!/usr/bin/env node
// Builds real TownView records for Kentucky's counties and cities from the Census individual
// unit files (see scripts/common/town-census-build.mjs). Each county's file holds the county and
// the cities whose people mostly live in it.
//
//   node scripts/ky/download.mjs
//   node scripts/ky/fetch-kref.mjs                       # campaign finance (optional)
//   node scripts/ky/build-county.mjs --all
//
// County sheriffs collect property taxes for counties, schools and the state in Kentucky; cities
// may collect their own, so the levy rules for northern New England are off.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildState } from '../common/town-census-build.mjs';
import { placeCandidate, summarizeKyContributions, normPlace, KREF_PAGE } from './kref-map.mjs';

const KREF = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'ky', 'kref');
const SINCE = `${new Date().getFullYear() - 3}-01-01`;
const MERGED_KEY = { jefferson: 'Consolidated|48003', fayette: 'Consolidated|46027' };

// Places each local candidate by office and location, then gathers the PAC and organization
// contributions made to them (matched by candidate name).
function politics(geo) {
  if (!existsSync(join(KREF, 'contributions.json'))) return null;
  const counties = new Map();
  const cities = new Map();
  for (const g of geo.values()) {
    const county = normPlace(String(g.county || '').replace(/ County$/, ''));
    if (g.kind === 'County') counties.set(county, g.key);
    else if (g.key.startsWith('Place|')) cities.set(`${normPlace(g.base)}|${county}`, g.key);
  }
  // Candidate name -> government key; names placed in more than one government are dropped.
  const placed = new Map();
  for (const c of JSON.parse(readFileSync(join(KREF, 'candidates.json'), 'utf8'))) {
    const p = placeCandidate(c);
    const k = !p ? null : p.level === 'merged' ? MERGED_KEY[p.county] : p.level === 'county' ? counties.get(p.county) : cities.get(`${p.city}|${p.county}`);
    const name = normPlace(c.name);
    if (!placed.has(name)) placed.set(name, { keys: new Set(), label: `${c.name} (${c.office.replace(/\s*\(.*\)$/, '')})` });
    placed.get(name).keys.add(k || 'elsewhere');
  }
  const receiptsBy = new Map();
  for (const r of JSON.parse(readFileSync(join(KREF, 'contributions.json'), 'utf8'))) {
    const p = placed.get(normPlace(r.madeTo));
    if (!p || p.keys.size !== 1) continue;
    const [k] = p.keys;
    if (!geo.has(k)) continue;
    (receiptsBy.get(k) || receiptsBy.set(k, []).get(k)).push({ ...r, recipient: p.label });
  }
  const results = new Map([...receiptsBy].map(([k, rows]) => [k, summarizeKyContributions(rows, SINCE)]));
  const officeText = (isCounty) => (isCounty ? 'county judge-executive, magistrate, sheriff and other county office candidates' : 'candidates for mayor, council and commission');
  return {
    results,
    filers: new Set(receiptsBy.keys()),
    since: SINCE,
    sourceUrl: KREF_PAGE,
    sourceLabel: (g) => `Kentucky Registry of Election Finance: contributions to ${g.display}'s candidates since ${SINCE.slice(0, 4)}`,
    scope: (isCounty) => (isCounty ? 'County candidates: judge-executive, magistrates or commissioners, sheriff, jailer, clerk, attorney, coroner, PVA' : 'City candidates: mayor, council or commission'),
    note: (g, isCounty, pol) => `Political money counts contributions from PACs and organizations to ${officeText(isCounty)}, reported to the Registry of Election Finance since ${SINCE.slice(0, 4)}${pol.counted ? '' : ' (none were found)'}. Kentucky bans corporate contributions, so outside money comes through PACs and organizations such as unions. Candidates who raise and spend $3,000 or less file only an exemption and are not included. Individuals, candidates' own money and party committees are not counted.`,
    noneNote: (g, isCounty) => `Political money is not scored: no ${officeText(isCounty)} of ${g.display} reported PAC or organization contributions to the Registry of Election Finance since ${SINCE.slice(0, 4)}.`,
  };
}

buildState({
  code: 'KY',
  name: 'Kentucky',
  fips: '21',
  levy: false,
  cousubKinds: {},
  placeKinds: { city: 'City' },
  countyScope: 'All fiscal court funds, including the sheriff, jail, county roads and solid waste',
  countyNote: () => 'Public schools are run by separate school districts, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts, so they are not included. Residents also pay ${g.county}.`,
  politicalNote: () => 'Political money is not scored: Registry of Election Finance data was not loaded.',
  politics,
  consolidated: {
    '46027': { county: '067', display: 'Lexington-Fayette Urban County' },
    '48003': { county: '111', display: 'Louisville Metro' },
  },
});
