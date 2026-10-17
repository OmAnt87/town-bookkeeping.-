// Turns South Carolina State Ethics Commission contributions into Town Ledger political-money
// fields.
//
// Every candidate files with the Ethics Commission, and each contribution names the office
// sought ("Charleston City Council District 3", "Spartanburg Sheriff", "Horry County Council
// Chairman/Supervisor"), so local candidates are placed by office. Solicitors (judicial
// circuits), school boards and special purpose districts are left out.
// South Carolina allows contributions from businesses, so group (non-individual) contributions
// count as union, PAC or business money. Individuals and party and candidate committees are not
// counted.

import { isPartyOrCandidate, summarizeContributions } from '../common/political.mjs';

export const ETHICS_PAGE = 'https://ethicsfiling.sc.gov/public/campaign-reports/contributions';
export const ETHICS_API = 'https://ethicsfiling.sc.gov/api/Candidate/Contribution/Search/';

export const norm = (s) => String(s || '').toLowerCase().replace(/['\u2019]/g, '').replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()
  .replace(/^mt /, 'mount ');

const COUNTY_OFFICE = /^(.+?) (?:County )?(Sheriff|Coroner|Auditor|Treasurer|Clerk of Court|Probate Judge|Register of Deeds)\b/i;

// Returns { level: 'county'|'municipal', name, office } or null for offices that are not a
// county's or municipality's.
export function parseOffice(officeName) {
  const o = String(officeName || '').trim().replace(/\s+/g, ' ');
  if (/solicitor|school|special purpose|public service/i.test(o) || /^(SC|State|US|U\.S\.) /i.test(o)) return null;
  let m = o.match(/^(.+?) County Council\b/i);
  if (m) return { level: 'county', name: m[1], office: 'county council' };
  m = o.match(/^(.+?) (?:City|Town) Council\b/i);
  if (m) return { level: 'municipal', name: m[1], office: 'council' };
  m = o.match(/^(.+?) Mayor\b/i);
  if (m && !/^SC /.test(o)) return { level: 'municipal', name: m[1], office: 'mayor' };
  m = o.match(COUNTY_OFFICE);
  if (m) return { level: 'county', name: m[1], office: m[2].toLowerCase() };
  return null;
}

// ctx: { counties: Map(norm(name) -> key), munis: Map(norm(name) -> key) }.
export function localityFor(officeName, ctx) {
  const p = parseOffice(officeName);
  if (!p) return null;
  return (p.level === 'county' ? ctx.counties : ctx.munis).get(norm(p.name)) || null;
}

const UNION = /\b(unions?|local\s*#?\s*\d+|brotherhood|workers|federation|afl[- ]?cio|teamsters|ibew|seiu|afscme|iaff|iuoe|ufcw|uaw|aft|nea|carpenters|laborers?'?s?|plumbers|pipefitters|ironworkers|electricians|firefighters?|fire fighters|police|fop|deputies|teachers|educators|education association|nurses|employees|painters|sheet metal|operating engineers|longshore(men|man)?'?s?|steel ?workers)\b/i;
// Business is the default in South Carolina, so only clear PAC and association names count as PACs.
const PAC = /\b(pac|political action|committee|fund|caucus|league|alliance|association|assn|coalition|council|federation|chamber|realtors)\b/i;
const BUSINESS = /\b(llc|l\.l\.c|inc|incorporated|corp|corporation|co|company|lp|llp|pllc|p\.a|pa|ltd)\b\.?\s*$|\b(llc|inc|corp)\b/i;
// Candidate committees as South Carolina names them ("Friends of Jane Doe", "Doe for Council").
const SC_CANDIDATE = /\b(for|4) ((city|town|county) council|council|mayor|sheriff|senate|house|congress|governor|sc|south carolina|county|coroner|auditor|treasurer|solicitor|school board|clerk|probate)\b|\bfriends (of|for|to elect)\b|\b(re-?)?elect [a-z]+|\bcampaign\b/i;

// row: one Ethics Commission contribution. Returns { key } or null.
export function classifySc(row) {
  if (row.group !== 'Yes') return null;
  const name = String(row.contributorName || '').trim();
  if (!name) return null;
  if (isPartyOrCandidate(name) || SC_CANDIDATE.test(name)) return null;
  if (/credit union/i.test(name)) return { key: 'developerContributions' };
  // Not unions: places named Union (Union County, Union Heights).
  if (UNION.test(name.replace(/union (county|heights|street|square|bank)/gi, ''))) return { key: 'unionContributions' };
  // "Ripley Yacht Club Investors, LLC" is a business, not a club.
  if (BUSINESS.test(name) && !/\bpac\b|political action/i.test(name)) return { key: 'developerContributions' };
  if (PAC.test(name)) return { key: 'pacContributions' };
  return { key: 'developerContributions' };
}

// rows: contributions to one government's candidates, each with .recipient (label).
export function summarizeScReceipts(rows, since) {
  const seen = new Set();
  const kept = [];
  for (const r of rows) {
    const date = String(r.date || '').slice(0, 10);
    const amount = Number(r.amount) || 0;
    if (!/^\d{4}-\d\d-\d\d$/.test(date) || date < since || amount <= 0) continue;
    if (seen.has(r.contributionId)) continue;
    seen.add(r.contributionId);
    const c = classifySc(r);
    if (!c) continue;
    const contributor = String(r.contributorName).trim();
    kept.push({ date, amount, key: c.key, contributor, recipient: r.recipient, description: `Contribution to ${r.recipient}`, source: ETHICS_PAGE });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}
