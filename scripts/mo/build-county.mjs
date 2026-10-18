#!/usr/bin/env node
// Builds real Town Ledger records for Missouri's counties, cities, towns, villages and townships
// from the Census individual unit files (see scripts/common/town-census-build.mjs). Each
// county's file holds the county and the governments whose people mostly live in it. St. Louis
// is an independent city outside any county.
//
//   node scripts/mo/download.mjs
//   node scripts/mo/build-county.mjs --county Greene      (or --all)
//
// County collectors gather every property tax in Missouri, so the levy rules for northern New
// England are off.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildState } from '../common/town-census-build.mjs';
import { placeOffice, norm, summarizeMoContributions, MEC_PAGE } from './mec-map.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'mo', 'mec');
const SINCE = `${new Date().getFullYear() - 3}-01-01`;

// Each candidate committee is placed by the office it last ran for, as listed on its MEC page
// ("Mayor City of Creve Coeur", "Sheriff Greene County"). City names shared by two places are skipped.
function politics(geo) {
  if (!existsSync(join(RAW, 'committees.json')) || !existsSync(join(RAW, 'contributions.json'))) return null;
  const counties = new Map();
  const cities = new Map();
  for (const g of geo.values()) {
    if (g.kind === 'County') counties.set(norm(g.base.replace(/ County$/, '')), g.key);
    else if (g.key.startsWith('Place|')) {
      const n = norm(g.base);
      cities.set(n, cities.has(n) ? null : g.key);
    }
  }
  const countyNames = [...counties.keys()].sort((a, b) => b.length - a.length);
  const committees = JSON.parse(readFileSync(join(RAW, 'committees.json'), 'utf8'));
  const placeOf = new Map(Object.entries(committees).map(([id, c]) => {
    const office = c.elections?.[0]?.office || '';
    const p = placeOffice(office, countyNames);
    // The independent City of St. Louis is listed as a county ("St. Louis city").
    const key = !p ? null : p.level === 'county' ? counties.get(p.name) : cities.get(p.name) || counties.get(`${p.name} city`);
    return [id, { key, office }];
  }));
  const byKey = new Map();
  for (const r of JSON.parse(readFileSync(join(RAW, 'contributions.json'), 'utf8'))) {
    const p = placeOf.get(r.mecid);
    if (p?.key && geo.has(p.key)) (byKey.get(p.key) || byKey.set(p.key, []).get(p.key)).push({ ...r, office: p.office });
  }
  const results = new Map([...byKey].map(([k, rows]) => [k, summarizeMoContributions(rows, SINCE)]));
  const officeText = (isCounty) => (isCounty ? 'county commission, sheriff, prosecutor, assessor and other county office candidates' : 'candidates for mayor, aldermen and council');
  return {
    results,
    filers: new Set(byKey.keys()),
    since: SINCE,
    sourceUrl: MEC_PAGE,
    sourceLabel: (g) => `Missouri Ethics Commission: contributions to ${g.display}'s candidates since ${SINCE.slice(0, 4)}`,
    scope: (isCounty) => (isCounty ? 'County candidates: commissioners or county executive and council, sheriff, prosecutor, assessor, collector, clerk, treasurer' : 'City candidates: mayor, aldermen or council'),
    note: (g, isCounty, pol) => `Political money counts itemized cash contributions from businesses, PACs, unions and other committees to ${officeText(isCounty)}, reported to the Missouri Ethics Commission since ${SINCE.slice(0, 4)}${pol.counted ? '' : ' (none were found)'}. Each committee is placed by the office it last ran for. Individuals, in-kind gifts and party and candidate committees are not counted; contributions of $100 or less are not itemized.`,
    noneNote: (g, isCounty) => `Political money is not scored: no ${officeText(isCounty)} of ${g.display} reported business or committee contributions to the Missouri Ethics Commission since ${SINCE.slice(0, 4)}.`,
  };
}

buildState({
  code: 'MO',
  name: 'Missouri',
  fips: '29',
  levy: false,
  cousubKinds: { township: 'Township' },
  placeKinds: { city: 'City', town: 'Town', village: 'Village' },
  countyScope: 'All county funds, including the sheriff, jail, courts and county roads',
  countyNote: () => 'Public schools are run by separate school districts with their own taxes, so they are not included.',
  memberSchoolNote: (g) => `Public schools are run by separate school districts with their own taxes, so they are not included.${g.county && !/ city$/.test(g.county) ? ` Residents also pay ${g.county}${g.kind === 'Township' ? '' : ' and, in the counties that have them, the township they live in'}.` : ''}`,
  memberNote: (g) => (g.kind === 'Township' ? 'Missouri has townships in about 20 counties; they mainly maintain township roads.' : null),
  politicalNote: () => 'Political money is not scored: Missouri Ethics Commission data was not loaded.',
  politics,
});
