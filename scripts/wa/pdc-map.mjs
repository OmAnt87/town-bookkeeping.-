// Turns Washington Public Disclosure Commission (PDC) receipts into Town Ledger political-money
// fields.
//
// Candidates for city and county office file with the PDC (those in jurisdictions with fewer than
// 1,000 registered voters, and those raising little, may use mini-reporting and itemize nothing).
// Each receipt names the jurisdiction ("CITY OF BELLEVUE", "TOWN OF ELMA", "KING CO") and a
// contributor code. Counted: businesses, PACs and unions. Not counted: individuals, candidates'
// own money, parties, caucuses and "other" (often small or unidentified gifts).

import { isPartyOrCandidate, summarizeContributions, title, UNION_NAME } from '../common/political.mjs';

export const PDC_PAGE = 'https://www.pdc.wa.gov/political-disclosure-reporting-data/browse-search-data';

export const CITY_OFFICES = ['MAYOR', 'CITY COUNCIL MEMBER', 'CITY COUNCIL PRESIDENT', 'CITY ATTORNEY'];
export const COUNTY_OFFICES = ['COUNTY EXECUTIVE', 'COUNTY COMMISSIONER', 'COUNTY COUNCIL MEMBER', 'COUNTY SHERIFF', 'COUNTY ASSESSOR',
  'COUNTY ASSESSOR-TREASURER', 'COUNTY AUDITOR', 'COUNTY CLERK', 'COUNTY CORONER', 'COUNTY PROSECUTOR', 'COUNTY TREASURER', 'COUNTY DIR OF ELECTIONS'];
export const COUNTED_CODES = ['Business', 'Political Action Committee', 'Union'];

export const normPlace = (s) => String(s || '').toLowerCase().replace(/\bst\.?\s/g, 'saint ').replace(/[^a-z0-9]+/g, ' ').trim();

// Where a receipt's candidate serves: { level: 'city', city, county } or { level: 'county', county };
// null for other governments.
export function placeReceipt(r) {
  const j = String(r.jurisdiction || '').replace(/\s*\*\s*$/, '').trim();
  const county = normPlace(r.jurisdiction_county);
  if (CITY_OFFICES.includes(r.office)) {
    const m = j.match(/^(?:CITY|TOWN) OF (.+)$/i);
    return m ? { level: 'city', city: normPlace(m[1]), county } : null;
  }
  if (COUNTY_OFFICES.includes(r.office)) {
    const m = j.match(/^(.+?) CO(?:UNTY)?$/i);
    return m ? { level: 'county', county: normPlace(m[1]) } : null;
  }
  return null;
}

// Returns { key } for counted receipts, or null.
export function classifyPdc(r) {
  const name = String(r.contributor_name || '').trim();
  // Lump-sum lines ("Miscellaneous Receipts", "Small contributions") name no contributor.
  if (!name || /^(miscellaneous|misc\b|anonymous|small contributions|unitemized|various|none)\b/i.test(name)) return null;
  if (r.code === 'Union' || UNION_NAME.test(name)) return isPartyOrCandidate(name) && !UNION_NAME.test(name) ? null : { key: 'unionContributions' };
  if (r.code === 'Political Action Committee') return isPartyOrCandidate(name) ? null : { key: 'pacContributions' };
  if (r.code === 'Business') return { key: 'developerContributions' };
  return null;
}

const OFFICE_LABEL = (o) => title(o.replace(/^COUNTY DIR OF ELECTIONS$/, 'county director of elections'));

// rows: receipts to one government's candidates; since: ISO date.
export function summarizeWaReceipts(rows, since) {
  const seen = new Set();
  const kept = [];
  for (const r of rows) {
    const date = String(r.receipt_date || '').slice(0, 10);
    const amount = Number(r.amount) || 0;
    if (!date || date < since || amount <= 0 || seen.has(r.id)) continue;
    seen.add(r.id);
    const c = classifyPdc(r);
    if (!c) continue;
    const recipient = `${title(r.filer_name)} (${OFFICE_LABEL(r.office).toLowerCase()})`;
    kept.push({
      date, amount, key: c.key, contributor: r.contributor_name, recipient, description: `Contribution to ${recipient}`,
      source: r.report_number ? `https://my.pdc.wa.gov/public/registrations/campaign-finance-report/${r.report_number}` : PDC_PAGE,
    });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}
