// Turns Louisiana Board of Ethics campaign finance data into Town Ledger political-money fields.
//
// Every candidate for parish and municipal office in Louisiana files with the Board of Ethics.
// The bulk contribution files name the filer but not the office, so each filer is matched by name
// to the Board's e-filer search, which lists the office filed for each election ("Police Juror /
// Calcasieu/Lake Charles / 5", "Mayor / City of Ruston"). A name filed for local offices in more
// than one place is skipped.
// Louisiana allows contributions from businesses and unions; the Board marks each contributor's
// type (business, PAC, other). Individuals, candidates' own money, and party and candidate
// committees are not counted.

import { isPartyOrCandidate, summarizeContributions, UNION_NAME } from '../common/political.mjs';

export const ETHICS_PAGE = 'https://ethics.la.gov/CampaignFinanceSearch/ShowPremadereports.aspx';
const DOWNLOAD = 'https://www.ethics.la.gov/Pub/CampFinan/DataDownload/ContributionReports';

// The Board publishes contributions in four-year files (2020_to_2023, 2024_to_2027, ...).
export const CONTRIBUTION_FILES = (firstYear, lastYear = new Date().getFullYear()) => {
  const starts = new Set();
  for (let y = firstYear; y <= lastYear; y++) starts.add(y - (y % 4));
  return [...starts].map((s) => ({ name: `Contributions_${s}_to_${s + 3}.csv`, url: `${DOWNLOAD}/Contributions_${s}_to_${s + 3}.csv` }));
};

const decode = (s) => s.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// Rows of the e-filer search results: { name, type, election, office }.
export function parseFilerRows(html) {
  return [...html.matchAll(/<tr>\s*<td[^>]*>\s*<a id="[^"]*FullNameLinkButton"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<span[^>]*>([\s\S]*?)<\/span>[\s\S]*?<td[^>]*>([\s\S]*?)<\/td><td[^>]*>([\s\S]*?)<\/td>/g)]
    .map((m) => ({ name: decode(m[1]), type: decode(m[2]), election: decode(m[3]), office: decode(m[4]) }));
}

// Offices typed by filers, by level. Courts, district attorneys, clerks of court, marshals,
// school boards, port and levee boards, and state and federal offices are not counted.
const NOT_COUNTED = /judge|\bjdc\b|judicial|court|district attorney|\bd\.?a\.?\b|school|\bbese\b|state|senat|represent|\bhouse\b|\bhd\b|congress|governo|lieutenant|secretary of state|attorney general|treasurer|insurance|agricult|public service|\bpsc\b|port commission|levee|clerk|marshal|any other/i;
const PARISH_OFFICE = /police jur|parish (council|president|commission)|sheriff|assessor|accessor|coroner|corner|constable|justice of the peace|\bjop\b/i;
const CITY_OFFICE = /\b(mayor|major|alderm[ae]n|city|council\w*|selectm[ae]n|chief of police|metro)\b/i;

export const norm = (s) => ` ${String(s || '').toLowerCase().replace(/\bst\.?\s*/g, 'saint ').replace(/\bebrp?\b/g, 'east baton rouge').replace(/\bjeff davis\b/g, 'jefferson davis')
  .replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()} `;

// Where a filer's office belongs. places: { parishes: Map(norm name -> key), munis: [{ name: norm
// name, key, parish: norm name }] }. Returns a government key or null.
export function placeOffice(office, places) {
  if (!office || NOT_COUNTED.test(office)) return null;
  const text = norm(office);
  const parish = [...places.parishes.keys()].filter((p) => text.includes(p)).sort((a, b) => b.length - a.length)[0];
  // The longest municipality named, in the parish when one is named too.
  const munis = places.munis.filter((m) => text.includes(m.name) && (!parish || m.parish === parish || !text.includes(` ${m.parish.trim()} `)));
  const longest = munis.sort((a, b) => b.name.length - a.name.length);
  const muni = longest.length && (longest.length === 1 || longest[0].name.length > longest[1].name.length) ? longest[0] : null;
  const head = office.split('/')[0];
  if (PARISH_OFFICE.test(head) || /\bparish\b/i.test(head)) return parish ? places.parishes.get(parish) : null;
  if (!CITY_OFFICE.test(head)) return null;
  if (muni) return muni.key;
  // A council with no municipality named is the parish council.
  return /council/i.test(head) && parish ? places.parishes.get(parish) : null;
}

// "Kristopher W." + "Cloessner" or "Kristopher W. Cloessner" -> "kristopher cloessner"
export const nameKey = (first, last) => {
  const words = `${first || ''} ${last || ''}`.toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, ' ').replace(/[^a-z ]+/g, ' ').split(/\s+/).filter(Boolean);
  return words.length >= 2 ? `${words[0]} ${words.at(-1)}` : null;
};

const TYPE_KEY = { BUS: 'developerContributions', FIN: 'developerContributions', LEG: 'developerContributions', 'R/E': 'developerContributions', PAC: 'pacContributions', ORG: 'developerContributions' };

// row: one contribution, keyed as scripts/lib.mjs parseCSV gives them. Returns { key } or null.
export function classifyLa(row) {
  if (String(row.contributiontype).trim() !== 'CONTRIB') return null;
  const name = String(row.contributorname || '').trim();
  const type = String(row.contributortypecode || '').trim();
  if (!TYPE_KEY[type] || !name || isPartyOrCandidate(name) || /\bparish\b.*\b(clerk|sheriff|assessor)\b|\bclerk of court\b/i.test(name)) return null;
  if (UNION_NAME.test(name)) return { key: 'unionContributions' };
  // Organizations other than businesses and unions (clubs, governments' own offices) are not counted.
  if (type === 'ORG') return /\b(llc|inc|corp|company|co|bank|l\.?p\.?)\b/i.test(name) ? { key: 'developerContributions' } : null;
  return { key: TYPE_KEY[type] };
}

export function summarizeLaContributions(rows, since) {
  const seen = new Set();
  const kept = [];
  for (const r of rows) {
    const [m, d, y] = String(r.contributiondate || '').split(' ')[0].split('/');
    const date = y ? `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}` : '';
    const amount = Number(r.contributionamt) || 0;
    if (!date || date < since || amount <= 0) continue;
    // Amended reports repeat their contributions.
    const id = [r.filernumber, r.contributorname, date, amount].join('|');
    if (seen.has(id)) continue;
    seen.add(id);
    const c = classifyLa(r);
    if (!c) continue;
    kept.push({ date, amount, key: c.key, contributor: String(r.contributorname).trim(), recipient: r.recipient, description: `Contribution to ${r.recipient}`, source: ETHICS_PAGE });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}
