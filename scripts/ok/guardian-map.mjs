// Turns Oklahoma Ethics Commission ("Guardian") contributions into TownView political-money fields.
//
// County and municipal candidates file with the Ethics Commission. The bulk contribution files
// name the candidate but not the office, so each committee is placed by the jurisdiction on its
// registration page ("OKLAHOMA COUNTY", "CITY OF NORMAN").
// Rows use scripts/common/civix.mjs parseCivix keys.

import { summarizeContributions } from '../common/political.mjs';
import { classifyContributor, normPlace, isoDate } from '../common/civix.mjs';

export const GUARDIAN = 'https://guardian.ok.gov';
export const GUARDIAN_PAGE = `${GUARDIAN}/PublicSite/DataDownload.aspx`;
export const GUARDIAN_FILE = (year) => `${GUARDIAN}/PublicSite/Docs/BulkDataDownloads/${year}_ContributionLoanExtract.csv.zip`;


// A committee's registration -> { level, name } of its government, or null for state, school,
// tech-center and judicial races.
export function placeCommittee(org) {
  const j = String(org?.jurisdiction || '').trim();
  if (/ county$/i.test(j) && /^county /i.test(org.office || '')) return { level: 'county', name: normPlace(j) };
  const m = j.match(/^(city|town|village) of (.+)$/i);
  if (m) return { level: 'city', name: normPlace(m[2]) };
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
    const date = isoDate(r['receipt date']);
    const amount = Number(r['receipt amount']) || 0;
    if (!date || date < since || amount <= 0) continue;
    const c = classifyOk(r);
    if (!c) continue;
    const recipient = `${title(r['candidate name'])} (${title(r.office)})`;
    kept.push({ date, amount, key: c.key, contributor: contributorName(r), recipient, description: `Contribution to ${recipient}`, source: GUARDIAN_PAGE });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}

