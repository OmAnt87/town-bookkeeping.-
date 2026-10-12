#!/usr/bin/env node
// Builds real Town Ledger records for Louisiana's parishes, cities, towns and villages from the
// Census individual unit files (see scripts/common/town-census-build.mjs). Each parish's file
// holds the parish and the municipalities whose people mostly live in it.
//
//   node scripts/la/download.mjs
//   node scripts/la/fetch-ethics.mjs                     # campaign finance (optional)
//   node scripts/la/build-county.mjs --all
//
// Parish sheriffs collect property taxes in Louisiana, so the levy rules for northern New
// England are off.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV } from '../lib.mjs';
import { buildState } from '../common/town-census-build.mjs';
import { CONTRIBUTION_FILES, placeOffice, nameKey, norm, summarizeLaContributions, ETHICS_PAGE } from './ethics-map.mjs';

const ETHICS = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'la', 'ethics');
const FIRST_YEAR = new Date().getFullYear() - 3;
const SINCE = `${FIRST_YEAR}-01-01`;

// Places each e-filing candidate by the office they filed for, then gathers contributions to them
// from businesses, unions and PACs (matched by the filer's name).
function politics(geo) {
  if (!existsSync(join(ETHICS, 'filers.json'))) return null;
  const parishName = (g) => norm(String(g.county || g.display).replace(/ Parish$/, ''));
  const places = { parishes: new Map(), munis: [] };
  for (const g of geo.values()) {
    if (g.kind === 'County') places.parishes.set(parishName(g), g.key);
    else places.munis.push({ name: norm(g.base), key: g.key, parish: parishName(g) });
  }
  const placed = new Map();
  for (const f of JSON.parse(readFileSync(join(ETHICS, 'filers.json'), 'utf8'))) {
    if (f.type !== 'Candidate') continue;
    const name = nameKey(f.name);
    if (!name) continue;
    if (!placed.has(name)) placed.set(name, { keys: new Set(), label: `${f.name} (${f.office.split('/')[0].trim()})` });
    placed.get(name).keys.add(placeOffice(f.office, places) || 'elsewhere');
  }
  const receiptsBy = new Map();
  for (const file of CONTRIBUTION_FILES(FIRST_YEAR)) {
    if (!existsSync(join(ETHICS, file.name))) continue;
    for (const r of parseCSV(readFileSync(join(ETHICS, file.name), 'utf8').replace(/^\uFEFF/, ''))) {
      const p = placed.get(nameKey(r.filerfirstname, r.filerlastname));
      if (!p || p.keys.size !== 1) continue;
      const [k] = p.keys;
      if (!geo.has(k)) continue;
      (receiptsBy.get(k) || receiptsBy.set(k, []).get(k)).push({ ...r, recipient: p.label });
    }
  }
  const results = new Map([...receiptsBy].map(([k, rows]) => [k, summarizeLaContributions(rows, SINCE)]));
  const officeText = (isCounty) => (isCounty ? 'parish president, council or police jury, sheriff, assessor and coroner candidates' : 'candidates for mayor, council or board of aldermen and chief of police');
  return {
    results,
    filers: new Set(receiptsBy.keys()),
    since: SINCE,
    sourceUrl: ETHICS_PAGE,
    sourceLabel: (g) => `Louisiana Board of Ethics e-filed contributions to ${g.display}'s candidates since ${FIRST_YEAR}`,
    scope: (isCounty) => (isCounty ? 'Parish candidates: president, council or police jury, sheriff, assessor, coroner, constables and justices of the peace' : 'Municipal candidates: mayor, council or aldermen, chief of police'),
    note: (g, isCounty, pol) => `Political money counts contributions from businesses, unions and PACs to ${officeText(isCounty)}, e-filed with the Board of Ethics since ${FIRST_YEAR}${pol.counted ? '' : ' (none were found)'}. Candidates are matched to the office they typed when filing; reports filed on paper are not included. Louisiana allows business and union contributions. Individuals, candidates' own money, in-kind gifts, and party and candidate committees are not counted.`,
    noneNote: (g, isCounty) => `Political money is not scored: no ${officeText(isCounty)} of ${g.display} e-filed contributions with the Board of Ethics since ${FIRST_YEAR}.`,
  };
}

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
  politicalNote: () => 'Political money is not scored: Board of Ethics data was not loaded.',
  politics,
});
