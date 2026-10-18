// Turns Washington Public Disclosure Commission contributions into TownView political-money fields.
//
// Every candidate for county and city office files with the PDC, and each contribution row names
// the candidate's office and jurisdiction ("KING CO", "CITY OF SPOKANE", "TOWN OF WINTHROP";
// a trailing "*" marks a city in more than one county). The PDC codes each contributor:
// businesses, PACs and unions are counted, and "Other" organizations only when their name shows a
// union or PAC. Individuals, candidates' own money, parties, caucuses and in-kind gifts are not.

import { isPartyOrCandidate, summarizeContributions, UNION_NAME } from '../common/political.mjs';

export const PDC_PAGE = 'https://data.wa.gov/d/kv7h-kjye';
export const PDC_API = 'https://data.wa.gov/resource/kv7h-kjye.json';

export const normPlace = (s) => String(s || '').toLowerCase().replace(/^(the )/, '').replace(/\bst\.?\s/g, 'saint ').replace(/\bmt\.?\s/g, 'mount ')
  .replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// "KING CO" -> { level: 'county', name: 'king' }; "CITY OF AUBURN *" -> { level: 'city', name: 'auburn' }.
export function placeJurisdiction(j) {
  const s = String(j || '').replace(/\*/g, '').trim();
  let m = s.match(/^(.+?) CO(UNTY)?$/i);
  if (m) return { level: 'county', name: normPlace(m[1]) };
  m = s.match(/^(CITY|TOWN) OF (.+)$/i);
  if (m) return { level: 'city', name: normPlace(m[2]) };
  return null;
}

// Returns { key } for counted contributions, or null.
export function classifyWa(r) {
  if (String(r.cash_or_in_kind || '').trim() !== 'Cash') return null;
  if (String(r.contributor_category || '').trim() !== 'Organization') return null;
  const name = String(r.contributor_name || '').trim();
  if (!name || isPartyOrCandidate(name)) return null;
  const code = String(r.code || '').trim();
  if (code === 'Union') return { key: 'unionContributions' };
  if (code === 'Political Action Committee') return { key: UNION_NAME.test(name) ? 'unionContributions' : 'pacContributions' };
  if (code === 'Business') return { key: UNION_NAME.test(name) ? 'unionContributions' : 'developerContributions' };
  if (code === 'Other') return UNION_NAME.test(name) ? { key: 'unionContributions' } : /\bpac\b|political action/i.test(name) ? { key: 'pacContributions' } : null;
  return null;
}

const title = (s) => String(s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function summarizeWaContributions(rows, since) {
  const kept = [];
  for (const r of rows) {
    const date = String(r.receipt_date || '').slice(0, 10);
    const amount = Number(r.amount) || 0;
    if (!date || date < since || amount <= 0) continue;
    const c = classifyWa(r);
    if (!c) continue;
    const recipient = `${String(r.filer_name).trim()} (${title(r.office)})`;
    kept.push({ date, amount, key: c.key, contributor: String(r.contributor_name).trim(), recipient, description: `Contribution to ${recipient}`, source: r.url?.url || PDC_PAGE });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}
