// Turns Alabama Fair Campaign Practices Act (FCPA) data into TownView political-money fields.
//
// Every candidate for county and municipal office in Alabama forms a principal campaign committee
// with the Secretary of State. The committee list names the office and, for county offices, the
// county; municipal candidates are listed with no municipality, so they are placed by the city of
// their mailing address. Contributions are joined to committees by committee ID.
// Alabama allows contributions from businesses and unions; filers mark each contributor's type
// (business, PAC, individual). Individuals, in-kind gifts, and party and candidate committees are
// not counted.

import { isPartyOrCandidate, summarizeContributions, UNION_NAME } from '../common/political.mjs';

export const FCPA_SITE = 'https://fcpa.alabamavotes.gov';
export const FCPA_PAGE = `${FCPA_SITE}/page.request.do?page=page.acfPublicSearchTheFcpaReportingSystemDatabase`;

// Offices that belong to a county government. Judges, clerks, district attorneys and school
// boards are not counted.
export const COUNTY_OFFICES = new Set(['County Commissioner', 'County Commission Chair', 'County Commission President', 'Sheriff', 'Revenue Commissioner',
  'Tax Assessor', 'Tax Collector', 'Tax Assessor/Collector', 'Assistant Tax Assessor', 'Assistant Tax Collector', 'License Commissioner', 'County Treasurer',
  'Deputy Treasurer', 'County Coroner', 'County Constable']);
export const CITY_OFFICES = new Set(['Mayor', 'City Council']);

export const norm = (s) => String(s || '').toLowerCase().replace(/,.*$/, '').replace(/\bst\.?\s*/g, 'saint ').replace(/\bmt\.?\s*/g, 'mount ')
  .replace(/\bft\.?\s*/g, 'fort ').replace(/[^a-z0-9]+/g, ' ').trim();

// Where a committee's candidate belongs. places: { counties: Map(norm county name -> key),
// cities: Map(norm city name -> [keys]) }. Returns a government key or null.
export function placeCommittee(c, places) {
  if (COUNTY_OFFICES.has(c.office)) {
    const county = /county$/i.test(c.jurisdiction || '') ? norm(c.jurisdiction.replace(/\s+county$/i, '')) : null;
    return (county && places.counties.get(county)) || null;
  }
  if (!CITY_OFFICES.has(c.office)) return null;
  const keys = places.cities.get(norm(c.city)) || [];
  // Two municipalities with the same name: the candidate's cannot be told apart.
  return keys.length === 1 ? keys[0] : null;
}

// "JACK ALLEN BAILEY (County Commissioner)"
export const committeeLabel = (c) => `${[c.candidateFirstName, c.candidateLastName].filter(Boolean).join(' ')} (${c.office})`;

const TYPE_KEY = { 'Group/Business/Corporation': 'developerContributions', PAC: 'pacContributions' };

// row: one contribution, keyed as scripts/lib.mjs parseCSV gives them. Returns { key } or null.
export function classifyAl(row) {
  if (String(row.contributiontype).trim() !== 'Cash (Itemized)') return null;
  const name = String(row.lastname || '').trim();
  const type = TYPE_KEY[String(row.contributortype || '').trim()];
  if (!type || !name || isPartyOrCandidate(name)) return null;
  // A candidate's own campaign ("Team Drummond") filed as a business.
  const last = String(row.candidatelast || '').toLowerCase();
  if (last.length > 2 && name.toLowerCase().split(/[^a-z']+/).includes(last) && !/\b(llc|inc|corp|company|co|pc|p\.c|llp|pllc|bank|associates|group)\b/i.test(name)) return null;
  if (UNION_NAME.test(name)) return { key: 'unionContributions' };
  // PACs filed as businesses.
  if (/\bpac\b|political action|good government/i.test(name)) return { key: 'pacContributions' };
  return { key: type };
}

export function summarizeAlContributions(rows, since) {
  const seen = new Set();
  const kept = [];
  for (const r of rows) {
    const [m, d, y] = String(r.contributiondate || '').split('/');
    const date = y ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : '';
    const amount = Number(r.contributionamount) || 0;
    if (!date || date < since || amount <= 0) continue;
    // Amended reports repeat their contributions under new IDs.
    const id = [r.committeeid, String(r.lastname).trim().toLowerCase(), date, amount].join('|');
    if (seen.has(id)) continue;
    seen.add(id);
    const c = classifyAl(r);
    if (!c) continue;
    kept.push({ date, amount, key: c.key, contributor: String(r.lastname).trim(), recipient: r.recipient, description: `Contribution to ${r.recipient}`, source: FCPA_PAGE });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}
