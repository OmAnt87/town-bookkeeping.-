// Turns North Carolina State Board of Elections receipts into Town Ledger political-money fields.
//
// Local candidates file with the State Board: county commissioners, sheriffs, registers of
// deeds, school boards, mayors and municipal councils. Receipts do not name the jurisdiction, so
// a committee is placed by its office and address: a municipal candidate in the municipality
// named by the committee's mailing city (or its committee name), a county candidate in the county
// covering most of the committee's ZIP code (or its mailing city's county).
// North Carolina bans contributions from corporations, so non-individual receipts count as union
// or PAC money. Individuals and party and candidate committees are not counted.

import { isPartyOrCandidate, summarizeContributions } from '../common/political.mjs';

export const NCSBE_PAGE = 'https://cf.ncsbe.gov/CFTxnLkup/';

// State Board office codes for local offices: 'county' or 'municipal'.
export const LOCAL_OFFICES = {
  CYCM: 'county', SHER: 'county', REGD: 'county', SBCY: 'county', CYTR: 'county', CORO: 'county', TAXC: 'county',
  MAY: 'municipal', COUM: 'municipal', ALDR: 'municipal', TCCM: 'municipal', SBMU: 'municipal',
};
export const OFFICE_LABEL = {
  CYCM: 'county commissioner', SHER: 'sheriff', REGD: 'register of deeds', SBCY: 'county school board', CYTR: 'county treasurer', CORO: 'coroner', TAXC: 'tax collector',
  MAY: 'mayor', COUM: 'council', ALDR: 'alderman', TCCM: 'town or city commissioner', SBMU: 'city school board',
};

export const norm = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

// r: one receipt; ctx: { zipCounty: Map(zip -> county GEOID), countyKey: Map(GEOID -> key),
//   munis: Map(norm(name) -> [{ key, county }]), placeCounty: Map(norm(place) -> GEOID) }.
// Returns a locality key ('County|Wake', 'City|Raleigh') or null.
export function localityFor(r, ctx) {
  const level = LOCAL_OFFICES[r.CandOfficeCode];
  if (!level) return null;
  const zip = String(r.CommZip || '').slice(0, 5);
  const zipCounty = ctx.zipCounty.get(zip);
  const city = norm(r.CommCity);
  if (level === 'municipal') {
    const pick = (list) => (list && (list.find((m) => m.county === zipCounty) || (list.length === 1 ? list[0] : null)))?.key;
    const byCity = pick(ctx.munis.get(city));
    if (byCity) return byCity;
    // "Committee to Elect Jane Doe for Cary Town Council": the longest municipality named.
    const name = ` ${norm(r.CommName)} `;
    const named = [...ctx.munis.keys()].filter((k) => k.length > 3 && name.includes(` ${k} `)).sort((a, b) => b.length - a.length)[0];
    return named ? pick(ctx.munis.get(named)) || null : null;
  }
  return ctx.countyKey.get(zipCounty) || ctx.countyKey.get(ctx.placeCounty.get(city)) || null;
}

const UNION = /\b(unions?|local\s*#?\s*\d+|brotherhood|workers|federation|afl[- ]?cio|teamsters|ibew|seiu|afscme|iaff|iuoe|ufcw|uaw|aft|ncae|nea|carpenters|laborers?'?s?|plumbers|pipefitters|ironworkers|electricians|firefighters?|fire fighters|police|fop|pba|deputies|sheriffs'? association|teachers|educators|education association|nurses|employees|seanc|painters|sheet metal|operating engineers|cope)\b/i;
// Candidate committees as North Carolina names them ("Committee to Elect Jane Doe").
const NC_CANDIDATE = /\b(committee to (re-?)?elect|friends (of|for|to elect)|citizens (for|to elect) [a-z]+ [a-z]+$|(re-?)?elect [a-z]+|for (sheriff|mayor|council|commissioner|school board|register of deeds|nc house|nc senate|n\.?c\.? (house|senate)|congress|governor|judge|district attorney|clerk|district|distict|ward|seat|(new )?north carolina|[a-z]+ county))\b|\bcampaign\b/i;
// "Frank Williams Committee": a person's committee, unless it reads like a PAC.
const PERSON_COMMITTEE = /^[a-z.' ]+ committee$/i;
const PAC_WORDS = /\b(pac|political|action|fund|association|alliance|realtors|league|caucus|council|coalition|chamber|builders|network|citizens|people|progress|future|forward|good government)\b/i;

// Receipt types counted: contributions from political committees, non-profits and general.
export const CONTRIBUTION_TYPES = new Set(['CPCM', 'NFPC', 'GEN']);

// row: one receipt. Returns { key } or null.
export function classifyNc(row) {
  // Outside sources are interest, refunds and payment processors, not contributions.
  if (!CONTRIBUTION_TYPES.has(row.TransSubTypeCode)) return null;
  const name = String(row.OrgName || row.FullName || '').trim();
  if (!name) return null;
  if (UNION.test(name) && !/credit union/i.test(name)) return { key: 'unionContributions' };
  if (isPartyOrCandidate(name) || NC_CANDIDATE.test(name) || (PERSON_COMMITTEE.test(name) && !PAC_WORDS.test(name))) return null;
  return { key: 'pacContributions' };
}

const isoDate = (d) => {
  const m = String(d || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
};

// rows: receipts to one locality's committees, each with .recipient (committee label).
// Amended reports repeat earlier receipts, so duplicates are dropped.
export function summarizeNcReceipts(rows, since) {
  const seen = new Set();
  const kept = [];
  for (const r of rows) {
    const date = isoDate(r.OccurDate);
    const amount = Number(r.Amount) || 0;
    if (!date || date < since || amount <= 0) continue;
    const c = classifyNc(r);
    if (!c) continue;
    const contributor = String(r.OrgName || r.FullName).trim();
    const k = [r.SboeID, norm(contributor), date, amount].join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    kept.push({ date, amount, key: c.key, contributor, recipient: r.recipient, description: `Contribution to ${r.recipient}`, source: NCSBE_PAGE });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}
