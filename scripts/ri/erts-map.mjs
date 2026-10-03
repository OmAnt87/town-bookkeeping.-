// Turns Rhode Island Board of Elections (ERTS) PAC contributions into Town Ledger
// political-money fields.
//
// All Rhode Island candidates file with the Board of Elections, local ones included. Local
// recipients: candidates for mayor or town administrator, city or town council, school
// committee and other city or town office (placed in a town by their filing address), and
// party city and town committees ("Cranston Democratic City Committee"). Corporate
// contributions to candidates are banned in Rhode Island, so organized money arrives as
// PAC contributions, many of them from union PACs.
// Not counted: individuals, and money from party and candidate committees.

import { isPartyOrCandidate, summarizeContributions, title } from '../common/political.mjs';

export const ERTS_URL = 'https://ricampaignfinance.com/RIPublic/Contributions.aspx';

const norm = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim();

// Villages and postal place names, and misspellings seen in filings, mapped to their town.
const PLACES = {
  ALBION: 'LINCOLN', MANVILLE: 'LINCOLN', FORESTDALE: 'NORTH SMITHFIELD', SLATERSVILLE: 'NORTH SMITHFIELD', 'NORTH SMITHFILED': 'NORTH SMITHFIELD',
  'NORTH SCITUATE': 'SCITUATE', HOPE: 'SCITUATE', RUMFORD: 'EAST PROVIDENCE', RIVERSIDE: 'EAST PROVIDENCE', BRADFORD: 'WESTERLY',
  PASCOAG: 'BURRILLVILLE', HARRISVILLE: 'BURRILLVILLE', GLENDALE: 'BURRILLVILLE', MAPLEVILLE: 'BURRILLVILLE', OAKLAND: 'BURRILLVILLE',
  BURRILLVILE: 'BURRILLVILLE', BURRILLIVILLE: 'BURRILLVILLE', CHEPACHET: 'GLOCESTER', HARMONY: 'GLOCESTER',
  'BLOCK ISLAND': 'NEW SHOREHAM', 'BLCOK ISLAND': 'NEW SHOREHAM', WAKEFIELD: 'SOUTH KINGSTOWN', 'PEACE DALE': 'SOUTH KINGSTOWN', PEACEDALE: 'SOUTH KINGSTOWN',
  KINGSTON: 'SOUTH KINGSTOWN', 'WEST KINGSTON': 'SOUTH KINGSTOWN', 'SOUTH KINGSTON': 'SOUTH KINGSTOWN', WICKFORD: 'NORTH KINGSTOWN',
  SAUNDERSTOWN: 'NORTH KINGSTOWN', 'NORTH KINGSTON': 'NORTH KINGSTOWN', GREENVILLE: 'SMITHFIELD', ASHAWAY: 'HOPKINTON', 'HOPE VALLEY': 'HOPKINTON',
  ROCKVILLE: 'HOPKINTON', WYOMING: 'RICHMOND', SHANNOCK: 'RICHMOND', CAROLINA: 'RICHMOND', ADAMSVILLE: 'LITTLE COMPTON', BARRRINGTON: 'BARRINGTON',
  PRUDENCE: 'PORTSMOUTH', 'PRUDENCE ISLAND': 'PORTSMOUTH',
};

// towns: Census town names ("Providence"). Returns place -> town name or null.
export function townMatcher(towns) {
  const byNorm = new Map(towns.map((t) => [norm(t), t]));
  return (place) => byNorm.get(PLACES[norm(place)] || norm(place)) || null;
}

const PARTY_COMMITTEE = /^(.+?) (DEMOCRATIC|REPUBLICAN)( TOWN| CITY)? COMMITTEE$/;

// filers: local-office rows from fetch-erts.mjs ({ name, city, state, office, status });
// stateFilers: state-office rows. Returns recipient -> { town, label }, keyed by normalized
// name. A filer keeps one account across offices, so anyone who has also filed for state
// office is left out (their money cannot be told apart), as is a name filed from addresses
// in more than one town.
export function localFilers(filers, match, stateFilers = []) {
  const state = new Set(stateFilers.map((f) => norm(f.name)));
  const out = new Map();
  const ambiguous = new Set();
  for (const f of filers) {
    if (f.state && f.state !== 'RI') continue;
    const town = match(f.city);
    if (!town) continue;
    const key = norm(f.name);
    if (state.has(key)) continue;
    const prev = out.get(key);
    if (prev && prev.town !== town) { ambiguous.add(key); continue; }
    out.set(key, { town, label: `${title(f.name)} (${f.office.toLowerCase()} candidate)` });
  }
  for (const k of ambiguous) out.delete(k);
  return out;
}

// recipient: ERTS OrganizationName. Returns { town, label } or null.
export function recipientTown(recipient, filers, match) {
  const key = norm(recipient);
  const m = key.match(PARTY_COMMITTEE);
  if (m) {
    const town = match(m[1]);
    return town ? { town, label: `${town} ${title(m[2])}${m[3] ? title(m[3]) : ''} Committee` } : null;
  }
  return filers.get(key) || null;
}

const UNION = /\b(unions?|local\s*#?\s*\d+|brotherhood|workers|federation|afl[- ]?cio|teamsters|ibew|seiu|afscme|iaff|iuoe|ufcw|uaw|nea|neari|aft|carpenters|laborers?'?s?|plumbers|pipefitters|bricklayers|ironworkers|electricians|fire ?fighters?|ff'?s|police|fop|troopers|teachers|nurses|educators|employees|painters|roofers|sheet metal|operating engineers|cope|council 94|1199)\b/i;

// row: one ERTS contribution export row (parseCSV keys). Returns { key } or null.
export function classifyErts(row) {
  if (row.transtype && row.transtype !== 'Contribution') return null;
  const name = row.fullname || row.lastname || '';
  if (UNION.test(name)) return { key: 'unionContributions' };
  if (isPartyOrCandidate(name) || /\b(senate|house) (democrats|republicans?)\b|\bstate committee\b/i.test(name)) return null;
  return { key: 'pacContributions' };
}

const isoDate = (d) => {
  const m = String(d || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
};

// rows: PAC contributions to one town's recipients, each with .recipient = { town, label }.
export function summarizeRiReceipts(rows, since) {
  const kept = [];
  for (const r of rows) {
    const date = isoDate(r.receiptdate);
    const amount = Number(r.amount) || 0;
    if (!date || date < since || amount <= 0) continue;
    const c = classifyErts(r);
    if (!c) continue;
    kept.push({ date, amount, key: c.key, contributor: r.fullname || r.lastname, recipient: r.recipient.label, description: `Contribution to ${r.recipient.label}`, source: ERTS_URL });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}
