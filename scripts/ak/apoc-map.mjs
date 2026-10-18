// Turns Alaska Public Offices Commission (APOC) campaign disclosure income into TownView
// political-money fields.
//
// Candidates for municipal office (borough and city mayors, assemblies and councils) report to
// APOC, and each report names the municipality ("Fairbanks, City of", "Kenai Peninsula Borough")
// and the office. Some municipalities run their own disclosure instead, so a borough or city with
// no APOC reports may still have candidates who raised money.
// Alaska bars businesses and unions from giving to candidates directly; they give through
// registered groups (PACs). Contributions with no first name are treated as organizations.
// Individuals, in-kind gifts, interest, and party and candidate committees are not counted.

import { isPartyOrCandidate, summarizeContributions, UNION_NAME } from '../common/political.mjs';

export const APOC_INCOME = 'https://aws.state.ak.us/ApocReports/CampaignDisclosure/CDIncome.aspx';

// Offices of a borough or city government. School boards and state offices are not counted.
export const LOCAL_OFFICE = /^(mayor|assembly|city council|borough assembly|council)$/i;

// "Fairbanks, City of" / "Anchorage, City and Borough" / "Fairbanks Northstar Borough" ->
// "fairbanks" / "anchorage" / "fairbanks north star"
export const norm = (s) => String(s || '').trim().toLowerCase()
  .replace(/,\s*(city and borough|city|municipality)( of)?$/, '')
  .replace(/^(city and borough|municipality|city|borough) of /, '')
  .replace(/\s+(city and borough|borough|municipality|census area)$/, '')
  .replace(/northstar/, 'north star').replace(/[^a-z0-9]+/g, ' ').trim();

// Where a report's municipality belongs. places: { boroughs: Map(norm name -> key), cities:
// Map(norm name -> key) }. "City of" names are cities; everything else is a borough (or a
// consolidated city and borough, which places.boroughs lists under its own name).
export function placeMunicipality(municipality, places) {
  const name = norm(municipality);
  if (/,\s*city of$/i.test(String(municipality).trim())) return places.cities.get(name) || null;
  return places.boroughs.get(name) || null;
}

const BUSINESS = /\b(llc|l\.l\.c|inc|corp|corporation|company|co|bank|associates|ltd|lp|llp|pc|p\.c|enterprises|consulting|services)\b/i;
const GROUP = /\b(pac|pace|political|committee|fund|account|local|association|assoc|union|club|council|alliance|coalition|league|federation|caucus|citizens|voters|alaskans|alive|epic|teamsters?|laborers|afl|cio)\b/i;
// A candidate's own committee or future campaign account ("Smith for FNSB Mayor 2024 Future Campaign Account").
const CANDIDATE_ACCOUNT = /campaign account|\bfor\b.*\b(mayor|assembly|council)\b/i;
// Occupations that organizations type for themselves; anything else is a person's job.
const ORG_OCCUPATION = /^(|n\/?a|none|pac.*|political.*|business|group|organization|club|.*union.*|.*association.*|.*contribution.*|iuoe|women's club)$/i;

// row: one APOC income row, as exported. Returns { key } or null.
export function classifyAk(row) {
  const payment = String(row['Payment Type'] || '').trim();
  if (/interest|non-monetary|exempt/i.test(payment)) return null;
  const name = String(row['Last/Business Name'] || '').trim();
  const occupation = String(row.Occupation || '').trim();
  if (!name || String(row['First Name'] || '').trim()) return null;
  if (isPartyOrCandidate(name) || CANDIDATE_ACCOUNT.test(name) || /party|candidate/i.test(occupation)) return null;
  // Banks' and credit unions' dividends on campaign accounts, and filers' balancing entries.
  if (/credit union|\bfcu\b|\bbank\b|unknown|dividend|interest/i.test(`${name} ${occupation}`)) return null;
  // A person who typed their whole name in the last-name field ("Stu Graham", occupation "Retired").
  if (!GROUP.test(name) && !BUSINESS.test(name) && !ORG_OCCUPATION.test(occupation)) return null;
  if (UNION_NAME.test(name)) return { key: 'unionContributions' };
  if (/\b(pac|political)\b/i.test(name)) return { key: 'pacContributions' };
  if (BUSINESS.test(name) || /^business$/i.test(occupation)) return { key: 'developerContributions' };
  // Anything else giving with no first name is a registered group.
  return { key: 'pacContributions' };
}

const isoDate = (us) => {
  const [m, d, y] = String(us || '').split('/');
  return y ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : '';
};

export function summarizeAkContributions(rows, since) {
  const seen = new Set();
  const kept = [];
  for (const r of rows) {
    const date = isoDate(r.Date);
    const amount = Number(String(r.Amount || '').replace(/[$,]/g, '')) || 0;
    if (!date || date < since || amount <= 0) continue;
    // Amended reports repeat their contributions.
    const id = [r.Name, r['Last/Business Name'], date, amount].join('|').toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const c = classifyAk(r);
    if (!c) continue;
    const recipient = `${r.Name} (${r.Office})`;
    kept.push({ date, amount, key: c.key, contributor: String(r['Last/Business Name']).trim(), recipient, description: `Contribution to ${recipient}`, source: APOC_INCOME });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}
