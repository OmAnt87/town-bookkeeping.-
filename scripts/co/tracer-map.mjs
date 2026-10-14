// Turns Colorado Secretary of State TRACER contributions into Town Ledger political-money fields.
//
// County candidates file with the Secretary of State; city and town candidates file with their
// municipal clerk and are not in TRACER. TRACER's bulk files give each candidate committee's
// jurisdiction (the county) but not the office, and school board candidates file the same way, so a
// committee counts for its county only when its name names a county office ("ANGELA THOMAS 4
// COMMISSIONER", "CANDACE RIVERA 4 COUNTY CLERK", "CLAIRE FOR BOULDER COUNTY", "WYATT FOR LARIMER"). Names that also
// mention a school, fire or other district, or name no office, are skipped, not guessed.
// Rows use scripts/lib.mjs parseCSV keys; amended rows (replaced by a later amendment) are skipped.

import { isPartyOrCandidate, summarizeContributions, UNION_NAME } from '../common/political.mjs';

export const TRACER_PAGE = 'https://tracer.sos.colorado.gov/PublicSite/DataDownload.aspx';
export const TRACER_FILE = (year) => `https://Tracer.sos.colorado.gov/PublicSite/Docs/BulkDataDownloads/${year}_ContributionData.csv.zip`;

// TRACER's files quote every field but leave stray quotes inside some ("12" PIPE"), which a general
// CSV parser misreads; fields are split on '","' instead, joining lines a field breaks across.
// Keys are lower-cased like scripts/lib.mjs parseCSV.
export function parseTracer(text) {
  const lines = text.split(/\r?\n/);
  const split = (l) => l.replace(/^"/, '').replace(/"$/, '').split('","');
  const keys = split(lines[0]).map((h) => h.trim().toLowerCase());
  const rows = [];
  let buf = '';
  for (const line of lines.slice(1)) {
    buf = buf ? `${buf} ${line}` : line;
    const cells = split(buf);
    if (cells.length < keys.length) continue;
    if (cells.length === keys.length) rows.push(Object.fromEntries(keys.map((k, i) => [k, cells[i].trim()])));
    buf = '';
  }
  return rows;
}

const OTHER_RACE = /SCHOOL|\bDPS\b|\b[A-Z]*SD\b|\bBOE\b|EDUCATION|KIDS|STUDENTS|\bRE-?\d|\bD-?\d+ SCHOOL|\bD(ISTRICT )?\d+ KIDS|FIRE|LIBRARY|WATER|SANITATION|HOSPITAL|REGENT|DISTRICT ATTORNEY|\bDA\b|JUDGE|SENATE|\bHOUSE\b|CONGRESS|STATE BOARD|CITY COUNCIL|MAYOR/;
const COUNTY_OFFICE = /\b(COMMISSIONER|COMMISSIONERS|SHERIFF|CLERK|TREASURER|ASSESSOR|CORONER|SURVEYOR)\b/;

// True when a candidate committee's name shows it is running for county office.
export function isCountyRace(committee, county) {
  const name = String(committee || '').toUpperCase();
  if (OTHER_RACE.test(name)) return false;
  if (COUNTY_OFFICE.test(name)) return true;
  const c = String(county || '').toUpperCase();
  // "FOR BOULDER COUNTY" anywhere, or a name ending "FOR LARIMER".
  return Boolean(c) && new RegExp(`\\b(FOR|4) ${c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( COUNTY\\b|$)`).test(name);
}

const contributorName = (r) => [r.firstname, r.lastname].map((s) => String(s || '').trim()).filter(Boolean).join(' ');

// Returns { key } for counted contributions, or null.
export function classifyCo(r) {
  if (String(r.amended).trim() === 'Y') return null;
  if (!/^Monetary \(Itemized\)$/.test(String(r.contributiontype || '').trim())) return null;
  const name = contributorName(r);
  if (!name || isPartyOrCandidate(name)) return null;
  const type = String(r.contributortype || '').trim();
  if (type === 'Labor Union') return { key: 'unionContributions' };
  if (['Political Committee', 'Small Donor Committee', '527 Political Organization', 'Federal PAC', 'Independent Expenditure Committee'].includes(type)) return { key: UNION_NAME.test(name) ? 'unionContributions' : 'pacContributions' };
  if (['Business', 'Corporation', 'Partnership'].includes(type)) return { key: UNION_NAME.test(name) ? 'unionContributions' : 'developerContributions' };
  if (type === 'Other') return UNION_NAME.test(name) ? { key: 'unionContributions' } : /\bpac\b|political action/i.test(name) ? { key: 'pacContributions' } : null;
  return null;
}

const title = (s) => String(s || '').toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase());

export function summarizeCoContributions(rows, since) {
  const kept = [];
  for (const r of rows) {
    const date = String(r.contributiondate || '').slice(0, 10);
    const amount = Number(r.contributionamount) || 0;
    if (!date || date < since || amount <= 0) continue;
    const c = classifyCo(r);
    if (!c) continue;
    const recipient = `${title(r.candidatename)} (${title(r.committeename)})`;
    kept.push({ date, amount, key: c.key, contributor: contributorName(r), recipient, description: `Contribution to ${recipient}`, source: TRACER_PAGE });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}
