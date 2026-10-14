// Turns Oklahoma Ethics Commission ("Guardian") contributions into Town Ledger political-money fields.
//
// County and municipal candidates file with the Ethics Commission. The bulk contribution files
// name the candidate but not the office, so each candidate is placed with the Commission's
// candidate search export (jurisdiction and office for every county and municipal candidate).
// Rows use scripts/common/civix.mjs parseCivix keys.

import { summarizeContributions } from '../common/political.mjs';
import { classifyContributor, personKey } from '../common/civix.mjs';

export const GUARDIAN = 'https://guardian.ok.gov';
export const GUARDIAN_PAGE = `${GUARDIAN}/PublicSite/DataDownload.aspx`;
export const GUARDIAN_FILE = (year) => `${GUARDIAN}/PublicSite/Docs/BulkDataDownloads/${year}_ContributionLoanExtract.csv.zip`;

export const normPlace = (s) => String(s || '').toLowerCase().replace(/\b(county|city|town) of\b/g, '').replace(/\b(county|city|town)\b/g, '')
  .replace(/\bst\.?\s/g, 'saint ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// A candidate export row -> { level, name } of the government, or null for school, tech-center
// and state races. Municipal jurisdictions read "CITY OF NORMAN" or "TOWN OF JONES".
export function placeCandidate(c) {
  const j = String(c.jurisdiction || '').trim();
  if (/ county$/i.test(j)) return { level: 'county', name: normPlace(j) };
  if (/^(city|town) of /i.test(j) || /municipal/i.test(c.office || '') || /mayor|council|alder|ward|trustee|commissioner/i.test(c.office || '')) {
    if (/ county$/i.test(j)) return null;
    return { level: 'city', name: normPlace(j) };
  }
  return null;
}

const contributorName = (r) => [r['first name'], r['last name']].map((s) => String(s || '').trim()).filter(Boolean).join(' ');

export function classifyOk(r) {
  if (String(r.amended).trim() === 'Y') return null;
  if (String(r['receipt type']).trim() !== 'Monetary') return null;
  return classifyContributor(r['receipt source type'], contributorName(r));
}

const title = (s) => String(s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function summarizeOkContributions(rows, since) {
  const kept = [];
  for (const r of rows) {
    const date = String(r['receipt date'] || '').slice(0, 10);
    const amount = Number(r['receipt amount']) || 0;
    if (!date || date < since || amount <= 0) continue;
    const c = classifyOk(r);
    if (!c) continue;
    const recipient = `${title(r['candidate name'])} (${title(r.office)})`;
    kept.push({ date, amount, key: c.key, contributor: contributorName(r), recipient, description: `Contribution to ${recipient}`, source: GUARDIAN_PAGE });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}

export { personKey };
