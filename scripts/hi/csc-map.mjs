// Turns Hawaii Campaign Spending Commission contributions into TownView political-money fields.
//
// Every candidate for state and county office files with the Commission, so county races (mayor,
// council, prosecuting attorney) are all here. Each row names the office; council offices name
// the county, and mayor and prosecuting attorney rows usually carry it in the County column
// (a candidate's other rows fill it in when one is blank).
// Hawaii allows contributions from businesses and unions. Noncandidate committees count as PACs,
// other entities as unions or businesses by name. Individuals, candidates' own money, family,
// and party and candidate committees are not counted. Rows use scripts/lib.mjs parseCSV keys.

import { isPartyOrCandidate, summarizeContributions, UNION_NAME } from '../common/political.mjs';

export const CSC_PAGE = 'https://opendata.hawaii.gov/organization/campaign-spending-commission';
export const CSC_URL = 'https://opendata.hawaii.gov/dataset/216f2bc1-0e32-4ce3-811a-27cc443827f1/resource/443bd998-1ef3-47da-9170-c2c376b2e41c/download/ccscha.csv';
export const COUNTY_OFFICES = { Mayor: 'mayor', 'Prosecuting Attorney': 'prosecuting attorney' };
export const COUNTIES = ['Hawaii', 'Honolulu', 'Kauai', 'Maui'];

// "6/16/2016 23:43:05" -> "2016-06-16"
export const isoDate = (s) => {
  const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
};

// The county of a county-office row, or null for state offices. `known` maps a candidate's
// registration number to a county seen on their other rows.
export function countyFor(r, known = new Map()) {
  const office = String(r.office || '').trim();
  const council = office.match(/^(Hawaii|Honolulu|Kauai|Maui) Council$/);
  if (council) return council[1];
  if (!COUNTY_OFFICES[office]) return null;
  const county = String(r.county || '').trim();
  return COUNTIES.includes(county) ? county : known.get(r.reg_no) || null;
}

// Returns { key } for counted contributions, or null.
export function classifyHi(r) {
  const name = String(r.contributor_name || '').trim();
  if (String(r['non-monetary_(yes_or_no)']).trim() === 'Y') return null;
  if (isPartyOrCandidate(name)) return null;
  const type = String(r.contributor_type || '').trim();
  if (type === 'Noncandidate Committee') return { key: UNION_NAME.test(name) ? 'unionContributions' : 'pacContributions' };
  if (type === 'Other Entity') return { key: UNION_NAME.test(name) ? 'unionContributions' : /\bpac\b|political action/i.test(name) ? 'pacContributions' : 'developerContributions' };
  return null;
}

export function summarizeHiContributions(rows, since) {
  const kept = [];
  for (const r of rows) {
    const date = isoDate(r.date);
    const amount = Number(r.amount) || 0;
    if (!date || date < since || amount <= 0) continue;
    const c = classifyHi(r);
    if (!c) continue;
    const office = String(r.office).trim();
    const recipient = `${String(r.candidate_name).trim()} (${office.replace(/^(Hawaii|Honolulu|Kauai|Maui) /, '')})`;
    kept.push({ date, amount, key: c.key, contributor: String(r.contributor_name).trim(), recipient, description: `Contribution to ${recipient}`, source: CSC_PAGE });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}
