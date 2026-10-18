// Turns Nebraska Accountability and Disclosure Commission (NADC) contributions into TownView
// political-money fields.
//
// County and city candidates file with the NADC once they raise or spend more than $5,000. The bulk
// contribution files name the candidate but not the office, so each committee is placed by the
// jurisdiction on its registration page (type "County" or "Municipal", then the county or city).
// Rows use scripts/common/civix.mjs parseCivix keys.

import { summarizeContributions } from '../common/political.mjs';
import { classifyContributor, normPlace, isoDate } from '../common/civix.mjs';

export const NADC = 'https://nadc-e.nebraska.gov';
export const NADC_PAGE = `${NADC}/PublicSite/DataDownload.aspx`;
export const NADC_FILE = (year) => `${NADC}/PublicSite/Docs/BulkDataDownloads/${year}_ContributionLoanExtract.csv.zip`;

// A committee's registration -> { level, name } of its government, or null for state, school,
// public power and other district races.
export function placeCommittee(org) {
  const type = String(org?.jurisdictionType || '').trim();
  const j = String(org?.jurisdiction || '').trim();
  if (/^county$/i.test(type)) return { level: 'county', name: normPlace(j) };
  // Municipal races include airport authorities and other boards; only mayor and council count.
  if (/^municipal$/i.test(type) && /mayor|council/i.test(org.office || '')) return { level: 'city', name: normPlace(j) };
  return null;
}

const contributorName = (r) => [r['first name'], r['contributor or source name (individual last name)']].map((s) => String(s || '').trim()).filter(Boolean).join(' ');

export function classifyNe(r) {
  if (String(r.amended).trim() === 'Y') return null;
  if (String(r['receipt transaction/contribution type']).trim() !== 'Monetary') return null;
  return classifyContributor(r['contributor or transaction source type'], contributorName(r));
}

const title = (s) => String(s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function summarizeNeContributions(rows, since) {
  const kept = [];
  for (const r of rows) {
    const date = isoDate(r['receipt date']);
    const amount = Number(r['receipt amount']) || 0;
    if (!date || date < since || amount <= 0) continue;
    const c = classifyNe(r);
    if (!c) continue;
    const recipient = `${title(r['candidate name'])} (${title(r.office)})`;
    kept.push({ date, amount, key: c.key, contributor: contributorName(r), recipient, description: `Contribution to ${recipient}`, source: NADC_PAGE });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}
