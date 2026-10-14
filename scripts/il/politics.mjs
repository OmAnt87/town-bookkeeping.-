// Political money for Illinois governments: contributions from businesses, unions and PACs to
// county, municipal and township candidates, from Illinois State Board of Elections campaign
// disclosure data (scripts/il/fetch-isbe.mjs), placed by the office each candidate filed for.
//
// politics(geo): geo is a Map of geography key -> { key, kind, base, county, display }. Returns
// null when the ISBE files are not loaded, else { results: Map(key -> summary), filers, since,
// sourceUrl, sourceLabel(g), scope(isCounty), note(g, isCounty, pol), noneNote(g, isCounty) }.

import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { candidatePlacer, committeeTypes, summarizeIlReceipts, ISBE_PAGE } from './isbe-map.mjs';

const ISBE = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'il', 'isbe');
const readTsv = (file) => {
  const [head, ...rows] = readFileSync(join(ISBE, file), 'utf8').split(/\r?\n/).filter(Boolean);
  const keys = head.split('\t');
  return rows.map((l) => Object.fromEntries(l.split('\t').map((v, i) => [keys[i], v])));
};
const SINCE = `${new Date().getFullYear() - 3}-01-01`;
const LEVEL_OF = { County: 'county', Township: 'township', City: 'municipal', Village: 'municipal', Town: 'municipal' };

// Places each local candidate by the office filed for and gathers their committees' receipts.
export function politics(geo) {
  if (!existsSync(join(ISBE, 'receipts-local.tsv'))) return null;
  const place = candidatePlacer([...geo.values()].map((g) => ({ key: g.key, level: LEVEL_OF[g.kind], name: g.base, county: String(g.county || '').replace(/ County$/, '') })));
  const candidates = new Map();
  for (const c of readTsv('Candidates.txt')) {
    const p = place(c);
    if (p) candidates.set(c.ID, { ...p, label: `${c.FirstName} ${c.LastName}`.replace(/"/g, '').trim() + ` (${c.Office})` });
  }
  const committees = new Map();
  for (const l of readTsv('CmteCandidateLinks.txt')) {
    const c = candidates.get(l.CandidateID);
    if (c && !committees.has(l.CommitteeID)) committees.set(l.CommitteeID, c);
  }
  const receiptsBy = new Map();
  const filers = new Set();
  for (const r of readTsv('receipts-local.tsv')) {
    const c = committees.get(r.CommitteeID);
    if (!c) continue;
    filers.add(c.key);
    (receiptsBy.get(c.key) || receiptsBy.set(c.key, []).get(c.key)).push({ ...r, recipient: c.label });
  }
  const types = committeeTypes(readTsv('Committees.txt'));
  const results = new Map([...filers].map((k) => [k, summarizeIlReceipts(receiptsBy.get(k) || [], SINCE, types)]));
  const officeText = (isCounty) => (isCounty ? 'county board and county office candidates' : 'candidates for mayor or village president, council or board, clerk and other local offices');
  return {
    results,
    filers,
    since: SINCE,
    sourceUrl: ISBE_PAGE,
    sourceLabel: (g) => `Illinois State Board of Elections campaign disclosure data: contributions to ${g.display}'s candidates since ${SINCE.slice(0, 4)}`,
    scope: (isCounty) => (isCounty ? 'County candidates: county board, clerk, sheriff, state\'s attorney and other county offices' : 'Local candidates: mayor or president, council or board, clerk and other offices'),
    note: (g, isCounty, pol) => `Political money counts contributions from businesses, unions and PACs to ${officeText(isCounty)}, reported to the State Board of Elections since ${SINCE.slice(0, 4)}${pol.counted ? '' : ' (none were found)'}. Illinois allows business contributions. Individuals, candidates' own money, party and candidate committees, loans and other receipts are not counted.`,
    noneNote: (g, isCounty) => `Political money is not scored: no ${officeText(isCounty)} of ${g.display} reported contributions to the State Board of Elections since ${SINCE.slice(0, 4)}.`,
  };
}
