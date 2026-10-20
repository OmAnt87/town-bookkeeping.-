// Turns District of Columbia Office of Campaign Finance contributions into TownView
// political-money fields.
//
// Every principal campaign committee for District office (mayor, council, attorney general,
// State Board of Education, shadow senator and representative) files with OCF. Committees for
// the shadow congressional seats and the school board are left out: they are not part of the
// District government's budget. The District allows contributions from businesses and unions.
// Individuals, candidates' own money and party committees are not counted.

import { isPartyOrCandidate, summarizeContributions } from '../common/political.mjs';

export const OCF_PAGE = 'https://efiling.ocf.dc.gov/DataDownload';

// Committees for offices outside the District government ("Ankit Jain for Senate", "Kinlow for US Senator").
export const NOT_DISTRICT_OFFICE = /\b(senat\w*|u\.?\s?s\.? rep\w*|representative|delegate|shadow|board of education|sboe|school board|slate)\b/i;
// Candidate committees as District candidates name them ("Cynthia Phillips 4 DC"), which move
// money between a candidate's own committees.
const DC_CANDIDATE = /\b(4|for) (dc|ward|mayor|council|chair\w*|attorney general|at[- ]large)\b|\bslate\b/i;

const TYPE_KEY = {
  Corporation: 'developerContributions',
  'Limited Liability Company': 'developerContributions',
  'Sole Proprietorship': 'developerContributions',
  Labor: 'unionContributions',
  'Labor Sponsored PAC': 'unionContributions',
  'Corporate Sponsored PAC': 'pacContributions',
  'Other PAC or Committee': 'pacContributions',
  Committee: 'pacContributions',
};

// "10/06/2026" -> "2026-10-06"
const isoDate = (s) => {
  const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
};

// row: one OCF contribution, keyed as scripts/lib.mjs parseCSV gives them. Returns { key } or null.
export function classifyDc(row) {
  if (NOT_DISTRICT_OFFICE.test(row.committee_name || '')) return null;
  if (row.contribution_type === 'InKind') return null;
  const key = TYPE_KEY[String(row.contributor_type || '').trim()];
  const name = String(row.contributor_organization_name || '').trim();
  if (!key || !name || isPartyOrCandidate(name) || DC_CANDIDATE.test(name)) return null;
  return { key };
}

export function summarizeDcContributions(rows, since) {
  const kept = [];
  for (const r of rows) {
    const date = isoDate(r.receipt_date);
    const amount = Number(String(r.amount || '').replace(/[$,]/g, '')) || 0;
    if (!date || date < since || amount <= 0) continue;
    const c = classifyDc(r);
    if (!c) continue;
    const recipient = String(r.committee_name).trim();
    kept.push({ date, amount, key: c.key, contributor: String(r.contributor_organization_name).trim(), recipient, description: `Contribution to ${recipient}`, source: OCF_PAGE });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}
