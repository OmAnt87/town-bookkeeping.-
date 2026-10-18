// Turns Illinois State Board of Elections (ISBE) campaign disclosure data into TownView
// political-money fields.
//
// Every Illinois political committee files with the State Board, local candidates included, so
// county, city, village and township candidates can be placed by the office each candidate filed
// for (Candidates.txt: office, district type, district, residence county) and linked to their
// committees (CmteCandidateLinks.txt). Receipts (Receipts.txt) are classified by schedule and
// name: contributions (1A) and in-kind contributions (5A) from organizations (no first name) count
// as business money unless the name says PAC or union, and transfers in (2A) from other
// committees count as PAC money; Illinois allows business contributions. Individuals, party and
// candidate committees, loans (3A), other receipts (4A) and archived (amended) entries are not
// counted.

import { summarizeContributions, isPartyOrCandidate } from '../common/political.mjs';

export const ISBE_PAGE = 'https://www.elections.il.gov/campaigndisclosure/downloadcddatafiles.aspx';
export const ISBE_FILES = 'https://www.elections.il.gov/CampaignDisclosureDataFiles/';

export const norm = (s) => String(s || '').toLowerCase()
  .replace(/['’.]/g, '')
  .replace(/[^a-z0-9]+/g, ' ')
  .replace(/\bmt\b/g, 'mount')
  .replace(/\bft\b/g, 'fort')
  .trim();

// District name without a ward or board district number ("Chicago 24" -> "chicago").
const districtName = (s) => norm(s).replace(/(\s+(ward|district|dist))?(\s+\d+[a-z]?)+$/, '').trim();

export const LEVEL = { Village: 'municipal', City: 'municipal', Ward: 'municipal', Township: 'township', County: 'county', 'County Board': 'county' };

// places: [{ key, level: 'municipal'|'township'|'county', name, county }] (county without
// " County"). Returns candidate -> { key, level } or null.
export function candidatePlacer(places) {
  const by = { municipal: new Map(), township: new Map(), county: new Map() };
  for (const p of places) {
    const m = by[p.level];
    const k = norm(p.name);
    (m.get(k) || m.set(k, []).get(k)).push(p);
  }
  return (c) => {
    const level = LEVEL[String(c.DistrictType || '').trim()];
    if (!level) return null;
    const name = districtName(c.District);
    const hits = by[level].get(name) || [];
    if (hits.length === 1) return { key: hits[0].key, level };
    // Same-named townships or municipalities: the candidate's residence county decides.
    const county = norm(c.ResidenceCounty);
    const inCounty = hits.filter((p) => norm(p.county) === county);
    return inCounty.length === 1 ? { key: inCounty[0].key, level } : null;
  };
}

// Legislative caucus funds, known by their initials in receipts.
const CAUCUS = /\b(isdf|hdf|hrcc|srcc)\b|\b(senate|house) (democratic|republican)\b|\b(democratic|republican) majority\b/i;
const PARTY = /\b(dem|dems|rep|reps|gop)\b.*\b(cmte|committee|central|org|organization|club)\b|\b(central (cmte|committee)|township (democratic|republican) organization|ward (democratic|republican) organization)\b/i;
const UNION = /\b(local \d+|union|brotherhood|afl-?cio|teamsters|ibew|seiu|afscme|iuoe|firefighters|fraternal order of police|fop|laborers|carpenters|pipefitters|plumbers|operating engineers|sheet metal|ironworkers|electrical workers|building (and|&) construction trades|education association|federation of teachers)\b/i;

// Committees.txt rows -> Map(normalized name -> committee type), for telling a transfer's source
// apart: candidate and party committees are not counted, PACs are.
export function committeeTypes(committees) {
  const types = new Map();
  for (const c of committees) {
    const type = String(c.TypeOfCommittee || '').trim();
    if (type) types.set(norm(c.Name), type);
  }
  return types;
}

// row: one ISBE receipt (header keys); types: committeeTypes(). Returns { key } or null.
export function classifyIl(row, types = new Map()) {
  if (String(row.Archived).trim() === 'True') return null;
  const part = String(row.D2Part || '').trim();
  if (!['1A', '2A', '5A'].includes(part)) return null;
  if (String(row.FirstName || '').trim()) return null; // an individual
  const name = String(row.LastOnlyName || '').trim();
  if (!name) return null;
  const type = types.get(norm(name));
  if (type === 'Candidate' || type === 'Political Party') return null;
  if (PARTY.test(name) || CAUCUS.test(name) || isPartyOrCandidate(name) || /\b(citizens (for|to elect)|friends (of|for))\b/i.test(name)) return null;
  if (/\b(pac|political action|pol action)\b/i.test(name)) return { key: 'pacContributions' };
  if (UNION.test(name) && !/credit union/i.test(name)) return { key: 'unionContributions' };
  if (type === 'Political Action' || type === 'Independent Expenditure') return { key: 'pacContributions' };
  return { key: part === '2A' ? 'pacContributions' : 'developerContributions' };
}

// rows: receipts to one government's candidates' committees, each with .recipient (label).
export function summarizeIlReceipts(rows, since, types = new Map()) {
  const seen = new Set();
  const kept = [];
  for (const r of rows) {
    const date = String(r.RcvDate || '').slice(0, 10);
    const amount = Number(r.Amount) || 0;
    if (!date || date < since || amount <= 0) continue;
    const c = classifyIl(r, types);
    if (!c) continue;
    if (seen.has(r.ID)) continue;
    seen.add(r.ID);
    kept.push({ date, amount, key: c.key, contributor: String(r.LastOnlyName).trim(), recipient: r.recipient, description: `Contribution to ${r.recipient}`, source: ISBE_PAGE });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}
