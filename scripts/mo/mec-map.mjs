// Turns Missouri Ethics Commission (MEC) contributions into TownView political-money fields.
//
// Candidates for county and municipal office file with the MEC. Its itemized-contribution export
// names the receiving committee (MECID) but not the office; each candidate committee's page lists
// the office sought in each election, ending with the jurisdiction ("Mayor City of Creve Coeur",
// "Presiding Commissioner Jackson County"). Contributions from businesses ("Company") and other
// committees are counted; individuals are not. Rows use scripts/lib.mjs parseCSV keys.

import { summarizeContributions, isPartyOrCandidate, UNION_NAME } from '../common/political.mjs';
import { isoDate } from '../common/civix.mjs';

export const MEC_PAGE = 'https://mec.mo.gov/MEC/Campaign_Finance/CF_ContrCSV.aspx';
export const MEC_COMMITTEE = (id) => `https://mec.mo.gov/MEC/Campaign_Finance/CommInfo.aspx?MECID=${id}`;

// Offices that are not county or city government.
const OTHER = /judge|school|board of education|college|fire|ambulance|library|water|sewer|hospital|port authority|road district|levee|drainage|state |missouri house|missouri senate|congress|committeeman|committeewoman/i;

export const norm = (s) => String(s || '').toLowerCase().replace(/\bst\.?\s/g, 'saint ').replace(/\bste\.?\s/g, 'sainte ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// The latest office a committee ran for -> { level, name } or null. `counties` is the list of
// normalized county names (without "county"), longest first, so "saint charles" wins over "charles".
export function placeOffice(office, counties) {
  const o = String(office || '').trim();
  if (!o || OTHER.test(o)) return null;
  const city = o.match(/\b(?:city|town|village) of (.+)$/i);
  if (city) return { level: 'city', name: norm(city[1]) };
  const text = norm(o);
  if (/ county$/.test(text)) {
    const name = counties.find((c) => text.endsWith(` ${c} county`));
    if (name) return { level: 'county', name };
  }
  return null;
}

const contributorName = (r) => (String(r.company || '').trim() || String(r.committee || '').trim());

// Returns { key } for counted contributions, or null. The export has no contributor type: a
// "Company" is a business, a "Committee" a PAC, union, party or candidate committee by its name.
export function classifyMo(r) {
  if (String(r.contribution_type || '').trim() !== 'Monetary') return null;
  const company = String(r.company || '').trim();
  const committee = String(r.committee || '').trim();
  if (committee) {
    if (isPartyOrCandidate(committee) || /\b(friends|citizens|committee) (of|for|to elect)\b/i.test(committee)) return null;
    return { key: UNION_NAME.test(committee) ? 'unionContributions' : 'pacContributions' };
  }
  if (company) return isPartyOrCandidate(company) ? null : { key: UNION_NAME.test(company) ? 'unionContributions' : 'developerContributions' };
  return null;
}

export function summarizeMoContributions(rows, since) {
  const kept = [];
  for (const r of rows) {
    const date = isoDate(r.date);
    const amount = Number(r.amount) || 0;
    if (!date || date < since || amount <= 0) continue;
    const c = classifyMo(r);
    if (!c) continue;
    const recipient = `${String(r.committee_name).trim()} (${r.office})`;
    kept.push({ date, amount, key: c.key, contributor: contributorName(r), recipient, description: `Contribution to ${recipient}`, source: MEC_COMMITTEE(r.mecid) });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}
