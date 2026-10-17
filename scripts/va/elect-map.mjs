// Turns Virginia Department of Elections receipts into Town Ledger political-money fields.
//
// Local candidates file with the state: board of supervisors, city and town council, mayor,
// school board and the constitutional officers (sheriff, Commonwealth's attorney, treasurer,
// commissioner of revenue, clerk of court). Reports do not name the locality, so a committee is
// placed by its "Town - X" district or office, or else by its address: the ZIP code's county or
// independent city (the one covering most of the ZIP's land area).
// Virginia allows contributions from businesses, so non-individual receipts count as union,
// PAC or business money. Individuals and party and candidate committees are not counted.

import { isPartyOrCandidate, summarizeContributions } from '../common/political.mjs';

export const ELECT_PAGE = 'https://www.elections.virginia.gov/candidatepac-info/campaign-finance-reports/';

const STATE_OFFICE = /delegate|senate|senator|state|governor|attorney general|soil and water|congress/i;
export const isLocalReport = (r) => r.islocal === 'True' && !STATE_OFFICE.test(`${r.officesought} ${r.district}`);

const norm = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();

// zctaRows: Census ZCTA-to-county relationship rows for Virginia. Returns zip -> county GEOID.
export function zipCounties(zctaRows) {
  const best = new Map();
  for (const r of zctaRows) {
    const zip = r.zip;
    const area = Number(r.area) || 0;
    if (!best.has(zip) || best.get(zip).area < area) best.set(zip, { geoid: r.county, area });
  }
  return new Map([...best].map(([z, v]) => [z, v.geoid]));
}

// ctx: { zipCounty: Map(zip -> GEOID), countyKey: Map(GEOID -> 'County|Fairfax' | 'City|Richmond'),
//        towns: Map(norm(name) -> 'Town|Leesburg'), byName: Map(norm(name) -> city or county key),
//        placeCounty: Map(norm(place) -> county GEOID) }. Returns a locality key or null.
export { norm };
export function localityFor(r, ctx) {
  const office = String(r.officesought || '');
  const district = String(r.district || '');
  const townFrom = (s) => ctx.towns.get(norm(s));
  if (/town council|^mayor/i.test(office) || /^Town - /i.test(district)) {
    const t = townFrom(district.replace(/^Town - /i, '')) || townFrom(office.replace(/^.*town council\s*-?\s*/i, '')) || townFrom(r.city);
    if (t) return t;
    if (/town council/i.test(office) || /^Town - /i.test(district)) return null; // a town that does not report
  }
  const zip = String(r.zipcode || '').slice(0, 5);
  const byZip = ctx.countyKey.get(ctx.zipCounty.get(zip));
  if (byZip) return byZip;
  // PO box ZIP codes have no Census ZIP area: fall back to the mailing city, an independent
  // city or county by name, or a town (or other Census place) in its county.
  const city = norm(r.city);
  return ctx.byName?.get(city) || ctx.countyKey.get(ctx.placeCounty?.get(city)) || null;
}

const UNION = /\b(unions?|local\s*#?\s*\d+|brotherhood|workers|federation|afl[- ]?cio|teamsters|ibew|seiu|afscme|iaff|iuoe|ufcw|uaw|aft|vea|nea|carpenters|laborers?'?s?|plumbers|pipefitters|ironworkers|electricians|firefighters?|fire fighters|police|fop|pba|deputies|teachers|educators|education association|nurses|employees|painters|sheet metal|operating engineers|cope|1199)\b/i;
const PAC = /\b(pac|political action|committee|fund|caucus|club|league|alliance|association|coalition|council|federation|victory|majority|action|project|network|votes|citizens|people|clean (virginia|va)|forward)\b/i;
// Candidate committees as Virginia names them ("Kannan for Delegate", "Friends for Jane Doe").
const VA_CANDIDATE = /\b(for|4) (delegate|supervisor|board|council|school board|sheriff|mayor|treasurer|clerk|commonwealth'?s attorney|commissioner|virginia|governor|lt\.? governor|attorney general|senate|congress)\b|\bfriends (for|to elect)\b|\b(re-?elect|elect) [a-z]+|\bcampaign\b|house of delegates/i;

// row: one ELECT Schedule A row (parseCSV keys). Returns { key } or null.
export function classifyVa(row) {
  if (row.isindividual === 'True') return null;
  const name = `${row.firstname || ''} ${row.lastorcompanyname || ''}`.trim();
  if (UNION.test(name)) return { key: 'unionContributions' };
  if (isPartyOrCandidate(name) || VA_CANDIDATE.test(name)) return null;
  if (PAC.test(name)) return { key: 'pacContributions' };
  return { key: 'developerContributions' };
}

const isoDate = (d) => {
  const m = String(d || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
};

// rows: receipts to one locality's committees, each with .recipient (committee label).
// Amended reports repeat earlier receipts, so duplicates are dropped.
export function summarizeVaReceipts(rows, since) {
  const seen = new Set();
  const kept = [];
  for (const r of rows) {
    const date = isoDate(r.transactiondate);
    const amount = Number(r.amount) || 0;
    if (!date || date < since || amount <= 0) continue;
    const c = classifyVa(r);
    if (!c) continue;
    const contributor = `${r.firstname || ''} ${r.lastorcompanyname || ''}`.trim();
    const k = [r.recipient, norm(contributor), date, amount].join('|');
    if (seen.has(k)) continue;
    seen.add(k);
    kept.push({ date, amount, key: c.key, contributor, recipient: r.recipient, description: `Contribution to ${r.recipient}`, source: ELECT_PAGE });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}
