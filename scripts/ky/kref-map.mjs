// Turns Kentucky Registry of Election Finance search results into TownView political-money fields.
//
// Every candidate for county and city office in Kentucky files with the Registry (those who
// raise and spend $3,000 or less file only an exemption form). The search lists each candidate's
// office and location: a county name for county offices ("Floyd"), "City-County" for city offices
// ("Bowling Green-Warren"). Contributions name only the candidate they were made to, so they are
// placed by matching that name to a candidate in the same elections; a name filed for more than
// one place is skipped.
// Kentucky bans contributions from corporations, so outside money comes from PACs (state, federal
// and out-of-state) and organizations such as unions. Individuals, candidates' own money and party
// and candidate committees are not counted.

import { isPartyOrCandidate, summarizeContributions, UNION_NAME } from '../common/political.mjs';

export const KREF_SEARCH = 'https://secure.kentucky.gov/kref/publicsearch';
export const KREF_PAGE = 'https://secure.kentucky.gov/kref/publicsearch/ToCandidateSearch';
// Contribution types fetched: PACs and other contributing organizations.
export const CONTRIBUTION_TYPES = ['KYPAC', 'FEDERALPAC', 'OUT_OF_STATE_PACS', 'CONTRIBUTINGORGANIZATION'];

const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// The data rows (<td> cells) of a search results page.
export function parseResultRows(html) {
  return [...html.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => decode(c[1])))
    .filter((cells) => cells.length >= 4);
}

// Offices counted, by level. Circuit clerks, commonwealth's attorneys and judges serve the courts;
// school board and soil conservation members serve other governments.
export const COUNTY_OFFICES = new Set(['county judge executive', 'magistrate/justice of the peace', 'county commissioner', 'sheriff', 'jailer', 'county clerk', 'coroner', 'property valuation administrator', 'county attorney', 'surveyor', 'constable']);
export const CITY_OFFICE = /^(mayor|city council member|city commissioner|legislative council|council-at-large)\b/i;
// Louisville and Lexington are merged city-county governments: county offices there, their
// legislative councils and their mayors all belong to the merged government.
export const MERGED = { jefferson: 'louisville', fayette: 'lexington' };

const key = (s) => String(s || '').toLowerCase().replace(/\bst\.?\s/g, 'saint ').replace(/[^a-z0-9]+/g, ' ').trim();

// Where a candidate's office belongs: { level: 'county', county } or { level: 'city', city, county },
// with names normalized; null for offices that are not counted.
export function placeCandidate(c) {
  const office = key(c.office);
  const loc = String(c.location || '').split('-').map((s) => s.trim());
  if (COUNTY_OFFICES.has(String(c.office).toLowerCase())) {
    const county = key(loc[0]);
    return MERGED[county] ? { level: 'merged', county } : { level: 'county', county };
  }
  if (!CITY_OFFICE.test(c.office)) return null;
  const county = key(loc.at(-1).replace(/^Dist\b.*/i, '') || loc[0]);
  // "Jefferson-Dist 4" (Louisville Metro Council), "Louisville-Greater-Jefferson", "Lexington-Urban County-Fayette"
  if (/^legislative council/i.test(office) || /^(Louisville-Greater|Lexington-Urban County)/i.test(c.location)) {
    const merged = Object.keys(MERGED).find((k) => key(c.location).includes(k));
    return merged ? { level: 'merged', county: merged } : null;
  }
  return { level: 'city', city: key(loc.slice(0, -1).join(' ')), county };
}

// Returns { key } for counted contributions, or null.
export function classifyKy(row) {
  const name = String(row.contributor || '').trim();
  if (!name || isPartyOrCandidate(name) || /\b(republican|democrat|women'?s (club|political fund)|men'?s .*club)\b/i.test(name)) return null;
  if (UNION_NAME.test(name)) return { key: 'unionContributions' };
  if (/pac$/i.test(row.contributionType) || /\bpac\b|political (action|fund)|good government/i.test(name)) return { key: 'pacContributions' };
  return { key: 'developerContributions' };
}

export function summarizeKyContributions(rows, since) {
  const seen = new Set();
  const kept = [];
  for (const r of rows) {
    const [m, d, y] = String(r.date).split('/');
    const date = y ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : '';
    if (!date || date < since || !(r.amount > 0)) continue;
    const id = [r.madeTo, r.contributor, r.amount, r.date, r.report].join('|');
    if (seen.has(id)) continue;
    seen.add(id);
    const c = classifyKy(r);
    if (!c) continue;
    kept.push({ date, amount: r.amount, key: c.key, contributor: r.contributor, recipient: r.recipient, description: `Contribution to ${r.recipient}`, source: KREF_PAGE });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}

export { key as normPlace };
