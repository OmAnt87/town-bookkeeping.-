// Turns NJ ELEC contribution records into Town Ledger political-money fields.
//
// Counted as outside political money (ELEC contributor type codes):
//   PACs:       F business/corp assoc PAC, J ideological PAC, V professional PAC,
//               G professional/trade assoc PAC, X regulated industries PAC,
//               W trade association PAC, R legislative leadership committee
//   Business:   B business/corporation
//   Unions:     H union, I union PAC
// Not counted: individuals, candidates' own committees and funds, party and
// political committees (mostly a party moving money between its own candidates),
// political clubs, interest, transfers from prior elections, and "not provided".

export const ELEC_TYPE_CATEGORY = {
  F: 'pacContributions', J: 'pacContributions', V: 'pacContributions', G: 'pacContributions',
  X: 'pacContributions', W: 'pacContributions', R: 'pacContributions',
  B: 'developerContributions',
  H: 'unionContributions', I: 'unionContributions',
};

const TYPE_LABEL = { pacContributions: 'PAC', developerContributions: 'Business', unionContributions: 'Union' };

export const ELEC_SEARCH_URL = 'https://www.njelecefilesearch.com/SearchContributionToEntity';

const UPPER = new Set(['nj', 'pac', 'llc', 'llp', 'pc', 'pa', 'inc', 'ibew', 'pba', 'fop', 'njea', 'cwa', 'uaw', 'seiu', 'ii', 'iii', 'usa', 'us']);
const title = (s) => String(s || '').toLowerCase().replace(/[a-z0-9']+/g, (w) => (UPPER.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)));

// Party organizations are sometimes filed under a business or PAC type; they are
// excluded like other party committees.
const PARTY_NAME = /\b(republican|democratic|democrat|party|county committee|municipal committee|political club)\b/i;

// Groups spelling variants of the same donor ("T&M" / "T And M", "Collier" / "Colliers").
export const donorKey = (s) => String(s || '').toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/\b(and|the|llc|inc|corp|corporation|co|company|pc|pa|llp|ltd)\b/g, ' ')
  .replace(/[^a-z0-9 ]/g, ' ')
  .split(/\s+/).filter(Boolean).map((w) => w.replace(/s$/, '')).join(' ');
// ELEC lists candidates as "LAST, FIRST".
const candidate = (s) => { const [last, first] = String(s || '').split(','); return title(first ? `${first.trim()} ${last}` : last); };

// rows: cached ELEC records for one municipality. since: ISO date (inclusive).
export function summarizeElec(rows, since) {
  const influence = { pacContributions: 0, developerContributions: 0, unionContributions: 0 };
  const donors = new Map();
  const ledger = [];
  let individuals = 0;
  let counted = 0;
  for (const r of rows) {
    const date = String(r.CONT_DATE || '').slice(0, 10);
    if (!date || date < since) continue;
    const amount = Number(r.CONT_AMT) || 0;
    if (amount <= 0) continue;
    if (r.CONT_TYPE === 'A') individuals += amount;
    const key = ELEC_TYPE_CATEGORY[r.CONT_TYPE];
    if (!key || PARTY_NAME.test(r.CONTRIBUTOR)) continue;
    counted++;
    influence[key] += amount;
    const name = title(r.CONTRIBUTOR);
    const dk = donorKey(r.CONTRIBUTOR);
    const d = donors.get(dk) || { name, type: TYPE_LABEL[key], recipients: new Set(), amount: 0 };
    d.amount += amount;
    d.recipients.add(candidate(r.CAND_NAME));
    donors.set(dk, d);
    ledger.push({
      date,
      flow: 'influence',
      category: key,
      counterparty: name,
      description: `${title(r.ContributionType)} contribution to ${candidate(r.CAND_NAME)} (${title(r.OFFICE)}, ${r.ELECTIONYEAR} ${title(r.ELECTIONTYPE)})`,
      amount: Math.round(amount * 100) / 100,
      source: ELEC_SEARCH_URL,
    });
  }
  for (const k of Object.keys(influence)) influence[k] = Math.round(influence[k]);
  const topDonors = [...donors.values()]
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10)
    .map((d) => ({
      name: d.name,
      type: d.type,
      recipient: d.recipients.size > 2 ? `${d.recipients.size} candidates` : [...d.recipients].join(', '),
      amount: Math.round(d.amount),
    }));
  ledger.sort((a, b) => (a.date < b.date ? 1 : -1));
  return { influence, topDonors, ledger, counted, individuals: Math.round(individuals) };
}
