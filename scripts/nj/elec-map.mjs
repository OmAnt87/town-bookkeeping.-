// Turns NJ ELEC contribution records into Town Ledger political-money fields.
//
// Counted as outside political money (ELEC contributor type codes):
//   PACs:       F business/corp assoc PAC, J ideological PAC, V professional PAC,
//               G professional/trade assoc PAC, X regulated industries PAC,
//               W trade association PAC, R legislative leadership committee
//   Business:   B business/corporation
//   Unions:     H union, I union PAC
// Name rules (party/candidate exclusions, donor grouping) live in scripts/common/political.mjs.
// Not counted: individuals, candidates' own committees and funds, party and
// political committees (mostly a party moving money between its own candidates),
// political clubs, interest, transfers from prior elections, and "not provided".

import { title, isPartyOrCandidate, summarizeContributions } from '../common/political.mjs';
export { donorKey } from '../common/political.mjs';

export const ELEC_TYPE_CATEGORY = {
  F: 'pacContributions', J: 'pacContributions', V: 'pacContributions', G: 'pacContributions',
  X: 'pacContributions', W: 'pacContributions', R: 'pacContributions',
  B: 'developerContributions',
  H: 'unionContributions', I: 'unionContributions',
};

export const ELEC_SEARCH_URL = 'https://www.njelecefilesearch.com/SearchContributionToEntity';

// ELEC lists candidates as "LAST, FIRST".
const candidate = (s) => { const [last, first] = String(s || '').split(','); return title(first ? `${first.trim()} ${last}` : last); };

// rows: cached ELEC records for one municipality. since: ISO date (inclusive).
export function summarizeElec(rows, since) {
  const kept = [];
  let individuals = 0;
  for (const r of rows) {
    const date = String(r.CONT_DATE || '').slice(0, 10);
    if (!date || date < since) continue;
    const amount = Number(r.CONT_AMT) || 0;
    if (amount <= 0) continue;
    if (r.CONT_TYPE === 'A') individuals += amount;
    const key = ELEC_TYPE_CATEGORY[r.CONT_TYPE];
    if (!key || isPartyOrCandidate(r.CONTRIBUTOR)) continue;
    kept.push({
      date, amount, key, contributor: r.CONTRIBUTOR, recipient: candidate(r.CAND_NAME), source: ELEC_SEARCH_URL,
      description: `${title(r.ContributionType)} contribution to ${candidate(r.CAND_NAME)} (${title(r.OFFICE)}, ${r.ELECTIONYEAR} ${title(r.ELECTIONTYPE)})`,
    });
  }
  return { ...summarizeContributions(kept), counted: kept.length, individuals: Math.round(individuals) };
}
