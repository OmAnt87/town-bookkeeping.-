// Turns Delaware Campaign Finance Reporting System (CFRS) data into Town Ledger political-money
// fields.
//
// County office candidates file with the Department of Elections, and so do municipal candidates
// who raise or spend more than $5,000 (others file a Certification of Intention instead). Each
// committee's office names its county or municipality ("County Office - Sussex County - County
// Council - District 3", "Municipal Office - Newark - City Council - District 03"), so local
// candidates are placed by committee. CFRS labels each contributor's type, which classifies the
// money directly: businesses (Delaware allows business contributions), labor unions, and PACs,
// non-profits and other committees. Individuals, the candidate's own money, candidate and party
// committees and lump sums under $100 are not counted.

import { summarizeContributions } from '../common/political.mjs';

export const CFRS_PAGE = 'https://cfrs.elections.delaware.gov/Public/ViewReceiptsMain';

const norm = (s) => String(s || '').toLowerCase().replace(/['’.]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export { norm };

// committee office -> { level: 'county'|'municipal', place, office } or null.
export function parseCommitteeOffice(office) {
  const parts = String(office || '').split(/\s+-\s+/).map((s) => s.trim());
  if (parts[0] === 'County Office' && parts[1]) return { level: 'county', place: parts[1].replace(/ County$/i, ''), office: (parts[2] || 'county office').toLowerCase() };
  if (parts[0] === 'Municipal Office' && parts[1]) return { level: 'municipal', place: parts[1], office: (parts[2] || 'council').toLowerCase() };
  return null;
}

const typeLabel = (s) => String(s || '').replace(/[,\s]+/g, ' ').trim();
const TYPE_KEY = Object.fromEntries(Object.entries({
  'Corporation, Partnership, and Other Entity': 'developerContributions',
  'Financial Institution': 'developerContributions',
  'Labor Union': 'unionContributions',
  'Political Action Committee': 'pacContributions',
  'Non-Profit Organization': 'pacContributions',
  'Out-of-State or Federal Committee': 'pacContributions',
  '3rd Party Advertiser': 'pacContributions',
}).map(([k, v]) => [typeLabel(k), v]));

// row: one CFRS contribution (parseCSV keys). Returns { key } or null.
export function classifyDe(row) {
  // The CSV export turns commas into spaces ("Corporation  Partnership  and Other Entity").
  const key = TYPE_KEY[typeLabel(row.contributor_type)];
  if (!key) return null;
  // Filers sometimes pick the wrong type; a name that plainly says PAC or union wins.
  const name = String(row.contributor_name || '');
  if (/\b(pac|political action)\b/i.test(name)) return { key: 'pacContributions' };
  if (/\b(local \d+|union|brotherhood|afl-?cio|teamsters|ibew|seiu|afscme|firefighters|fraternal order of police|building (and|&) construction trades)\b/i.test(name) && !/credit union/i.test(name)) return { key: 'unionContributions' };
  if (/^(RE|RC|LP|CLP)$/.test(String(row.contribution_type || '')) || /refund|returned|loan/i.test(String(row.contribution_type || ''))) return null;
  return { key };
}

const isoDate = (d) => {
  const m = String(d || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
};

// rows: contributions to one government's candidates, each with .recipient (label). Amended
// reports repeat earlier contributions, so duplicates are dropped.
export function summarizeDeReceipts(rows, since) {
  const seen = new Set();
  const kept = [];
  for (const r of rows) {
    const date = isoDate(r.contribution_date);
    const amount = Number(r.contribution_amount) || 0;
    if (!date || date < since || amount <= 0) continue;
    const c = classifyDe(r);
    if (!c) continue;
    const contributor = String(r.contributor_name || '').trim();
    const k = [r.cf_id, norm(contributor), date, amount].join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    kept.push({ date, amount, key: c.key, contributor, recipient: r.recipient, description: `Contribution to ${r.recipient}`, source: CFRS_PAGE });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}
