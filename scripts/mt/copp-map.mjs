// Turns Montana Commissioner of Political Practices (COPP) campaign finance data into Town Ledger
// political-money fields.
//
// Every county and city candidate in Montana files with COPP. The candidate list gives each one's
// office and county of residence but not the city they ran in, so city candidates are placed by
// the city of their mailing address (within their county). Contributions are joined to candidates
// by candidate ID.
// Montana bars corporations from giving to candidates directly, so organizational money comes
// through political committees; filers sort each contribution by kind (individual, party,
// independent, incidental or other committee, federal PAC). Individuals, in-kind gifts, and party
// and candidate committees are not counted. COPP lists many contributions under the first day of
// their reporting period rather than the day received.

import { isPartyOrCandidate, summarizeContributions, UNION_NAME } from '../common/political.mjs';

export const COPP_PUBLIC = 'https://cers-ext.mt.gov/CampaignTracker/public';
export const COPP_PAGE = `${COPP_PUBLIC}/search`;

// Offices of a county or city government. County attorneys, judges, justices of the peace,
// clerks of district court and school superintendents are not counted.
const NOT_COUNTED = /judge|justice|court|attorney|school|superintendent|trustee/i;
const COUNTY_OFFICE = /commission|sheriff|clerk|recorder|treasurer|assessor|coroner|public administrator|auditor|chief executive|council/i;
const CITY_OFFICE = /mayor|council|alderm|commission|chief executive/i;

export const isLocalOffice = (title, type) => !!title && !NOT_COUNTED.test(title) && (type === 'CN' ? COUNTY_OFFICE : CITY_OFFICE).test(title);

export const norm = (s) => String(s || '').toLowerCase().replace(/\bst\.?\s+/g, 'saint ').replace(/\bft\.?\s+/g, 'fort ').replace(/[^a-z0-9]+/g, ' ').trim();

// "PO BOX 6156, GREAT FALLS, MT 59406" -> "great falls"
export const mailingCity = (address) => {
  const parts = String(address || '').split(',').map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? norm(parts.at(-2)) : '';
};

// Where a candidate belongs. places: { counties: Map(norm county -> key), cities: Map(norm city ->
// [{ key, county: norm county }]) }. Returns a government key or null.
export function placeCandidate(c, type, places) {
  if (!isLocalOffice(c.officeTitle, type)) return null;
  const county = norm(c.resCountyDescr);
  // Consolidated city-counties are listed under both levels.
  if (type === 'CN' || places.consolidated.has(county)) return places.counties.get(county) || null;
  const matches = places.cities.get(mailingCity(c.candidateAddress)) || [];
  const inCounty = matches.filter((m) => m.county === county);
  const pick = inCounty.length ? inCounty : matches;
  return pick.length === 1 ? pick[0].key : null;
}

// The download: pipe-delimited, unquoted, and a description can run onto following lines, so
// each row starts at a line beginning with a candidate ID.
export function parsePipes(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const head = lines.shift().split('|').map((h) => h.trim());
  const rows = [];
  for (const line of lines) {
    if (/^\d+\|/.test(line) || !rows.length) rows.push(line);
    else rows[rows.length - 1] += ` ${line}`;
  }
  return rows.map((l) => l.split('|')).filter((c) => c.length === head.length).map((c) => Object.fromEntries(head.map((h, i) => [h, c[i].trim()])));
}

// "STALEY, MARK " -> "Mark Staley"
export const displayName = (s) => {
  const [last, first] = String(s || '').split(',').map((p) => p.trim());
  return first ? `${first} ${last}` : last;
};

const COMMITTEE_LINE = /independent committee|incidental committee|other political committee|federal pac/i;
const BUSINESS = /\b(llc|l\.l\.c|inc|corp|corporation|company|co|ltd|lp|llp|pllc|pc|p\.c|group|holdings|partners|properties|enterprises|associates|bank|construction|consulting|realty|ranch(es)?)\b/i;

// row: one contribution, keyed as the download names them. Returns { key } or null.
export function classifyMt(row) {
  if (!/cash/i.test(row['Amount Subtype'] || '')) return null;
  const name = String(row['Contributor Name'] || '').trim();
  const line = String(row['Line Item'] || '');
  if (!name || isPartyOrCandidate(name)) return null;
  if (COMMITTEE_LINE.test(line)) return { key: UNION_NAME.test(name) ? 'unionContributions' : 'pacContributions' };
  // Businesses (sole proprietors, partnerships, ranches) filed as individuals.
  if (/individual/i.test(line) && BUSINESS.test(name) && !name.includes(',')) return { key: 'developerContributions' };
  return null;
}

export function summarizeMtContributions(rows, since) {
  const seen = new Set();
  const kept = [];
  for (const r of rows) {
    const [m, d, y] = String(r['Date Paid'] || '').split('/');
    const date = y ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : '';
    const amount = Number(String(r.Amount || '').replace(/[$,]/g, '')) || 0;
    if (!date || date < since || amount <= 0) continue;
    // The same contribution can appear on an original and an amended report.
    const id = [r['Candidate ID'], r['Contributor Name'], date, amount, r['Reporting Date Range']].join('|').toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const c = classifyMt(r);
    if (!c) continue;
    kept.push({ date, amount, key: c.key, contributor: String(r['Contributor Name']).trim(), recipient: r.recipient, description: `Contribution to ${r.recipient}`, source: COPP_PAGE });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}
