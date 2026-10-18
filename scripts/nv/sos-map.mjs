// Turns Nevada Secretary of State campaign finance data into Town Ledger political-money fields.
//
// County and city candidates file Contributions and Expenses reports with the Secretary of State.
// The candidate search lists each county's and city's candidates by election year, and each
// candidate's page names the office ("Clark County Commissioner, District A"). The contribution
// export names the recipient but not the office, so contributions are joined to candidates by
// name within the jurisdiction they filed with. A name filed in more than one place is skipped.
// The export has no contributor type, so organizations are recognized by name (LLC, Inc, PAC,
// union locals). Individuals, in-kind gifts, interest, and party and candidate committees are not
// counted.

import { isPartyOrCandidate, summarizeContributions, UNION_NAME } from '../common/political.mjs';

export const SOS_SEARCH = 'https://www.nvsos.gov/SOSCandidateServices/AnonymousAccess/CEFDSearchUU/Search.aspx';

const decode = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// Candidate links in the results grid: [{ name, href }].
export const parseCandidateLinks = (html) => [...html.matchAll(/<a[^>]*href="(CandidateDetails\.aspx\?[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)]
  .map((m) => ({ href: m[1].replace(/&amp;/g, '&'), name: decode(m[2]) }));

export const parseOffice = (html) => decode(html.match(/id="ctl00_MainContent_lblOffice"[^>]*>([\s\S]*?)<\/span>/)?.[1]);

// Offices of a county or city government. Judges, justices of the peace, constables, district
// attorneys, school trustees and other districts' boards are not counted.
const NOT_COUNTED = /judge|justice|court|constable|district attorney|school|trustee|regent|education|hospital|water|fire protection|general improvement|assembly|senat|congress|governor|state|university/i;
const COUNTY_OFFICE = /commission|sheriff|assessor|treasurer|recorder|clerk|comptroller|auditor|public administrator|public guardian|supervisor|mayor/i;
const CITY_OFFICE = /mayor|council|supervisor|city attorney|municipal/i;

// Where a candidate belongs: 'county' or 'city' (the jurisdiction they filed with), or null.
export function officeLevel(office, jurisdiction) {
  if (!office || NOT_COUNTED.test(office)) return null;
  if (/county|carson city/i.test(jurisdiction)) return COUNTY_OFFICE.test(office) ? 'county' : null;
  return CITY_OFFICE.test(office) ? 'city' : null;
}

// "CITY OF NORTH LAS VEGAS" / "CLARK COUNTY" / "BOULDER CITY" -> "north las vegas" / "clark" / "boulder"
export const norm = (s) => String(s || '').toLowerCase().replace(/^city of /, '').replace(/\s+(county|city)$/, '').replace(/[^a-z0-9]+/g, ' ').trim();

// "Michael Corey Thomas" / "Thomas, Michael C." -> "michael thomas"
export const nameKey = (s) => {
  let t = String(s || '').toLowerCase();
  if (t.includes(',')) { const [last, first] = t.split(','); t = `${first} ${last}`; }
  const words = t.replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, ' ').replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean);
  return words.length >= 2 ? `${words[0]} ${words.at(-1)}` : null;
};

const BUSINESS = /\b(llc|l\.l\.c|inc|corp|corporation|company|co|ltd|lp|llp|pllc|pc|p\.c|chtd|chartered|group|holdings|partners|properties|enterprises|associates|bank|resorts?|casino|hotel|development|construction|law firm|consulting)\b/i;

// row: one contribution, keyed as the export names them. Returns { key } or null.
export function classifyNv(row) {
  if (!/monetary/i.test(row.Type || '')) return null;
  const name = String(row.Contributor || '').trim();
  if (!name || isPartyOrCandidate(name) || /interest|dividend|refund|anonymous|unitemized|aggregate/i.test(name)) return null;
  if (UNION_NAME.test(name)) return { key: 'unionContributions' };
  if (/\b(pac|political action|committee|caucus)\b/i.test(name)) return { key: 'pacContributions' };
  if (BUSINESS.test(name)) return { key: 'developerContributions' };
  return null;
}

export function summarizeNvContributions(rows, since) {
  const seen = new Set();
  const kept = [];
  for (const r of rows) {
    const [m, d, y] = String(r.Date || '').split('/');
    const date = y ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : '';
    const amount = Number(String(r.Amount || '').replace(/[$,]/g, '')) || 0;
    if (!date || date < since || amount <= 0) continue;
    // Amended reports repeat their contributions.
    const id = [r.Recipient, r.Contributor, date, amount].join('|').toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const c = classifyNv(r);
    if (!c) continue;
    kept.push({ date, amount, key: c.key, contributor: String(r.Contributor).trim(), recipient: r.recipientLabel, description: `Contribution to ${r.recipientLabel}`, source: SOS_SEARCH });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}
