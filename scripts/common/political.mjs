// Name rules shared by the state campaign-finance importers.

const UPPER = new Set(['nj', 'ny', 'nyc', 'nys', 'pac', 'llc', 'llp', 'pllc', 'pc', 'pa', 'inc', 'ibew', 'pba', 'fop', 'njea', 'nysut', 'cwa', 'uaw', 'seiu', 'csea', 'mta', 'afscme', 'iaff', 'iuoe', 'ufcw', 'iatse', 'usw', 'nage', 'btu', 'ma', 'ne', 'ii', 'iii', 'usa', 'us']);
export const title = (s) => String(s || '').toLowerCase().replace(/[a-z0-9']+/g, (w) => (UPPER.has(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)));

// Party organizations are sometimes filed under a business or PAC type; they are
// excluded like other party committees.
export const PARTY_NAME = /(\b(republicans?|democrats?|gop|part(y|ies)|county committee|municipal committee|state committee|town committee|political club)\b|democratic)/i;
// Candidates' own committees filed under another type ("Smith for Council").
export const CANDIDATE_NAME = /\bfor (senate|assembly|congress|governor|mayor|council|committee|freeholder|commissioner|sheriff|clerk|surrogate|office|supervisor|trustee|town board|judge|justice)\b|\b(friends of|elect|re-?elect)\b/i;

export const isPartyOrCandidate = (name) => PARTY_NAME.test(name || '') || CANDIDATE_NAME.test(name || '');

// Groups spelling variants of the same donor ("T&M" / "T And M", "Collier" / "Colliers").
export const donorKey = (s) => String(s || '').toLowerCase()
  .replace(/&/g, ' and ')
  .replace(/\b(and|the|llc|pllc|inc|corp|corporation|co|company|pc|pa|llp|ltd)\b/g, ' ')
  .replace(/[^a-z0-9 ]/g, ' ')
  .split(/\s+/).filter(Boolean).map((w) => w.replace(/s$/, '')).join(' ');

export const TYPE_LABEL = { pacContributions: 'PAC', developerContributions: 'Business', unionContributions: 'Union', corporateLobbying: 'Lobbyist' };

// Shared summary: rows are already normalized to { date, amount, key, contributor, recipient, description, source }.
export function summarizeContributions(rows) {
  const influence = { pacContributions: 0, developerContributions: 0, unionContributions: 0 };
  const donors = new Map();
  const ledger = [];
  for (const r of rows) {
    influence[r.key] = (influence[r.key] || 0) + r.amount;
    const dk = donorKey(r.contributor);
    const d = donors.get(dk) || { name: title(r.contributor), type: TYPE_LABEL[r.key], recipients: new Set(), amount: 0 };
    d.amount += r.amount;
    d.recipients.add(r.recipient);
    donors.set(dk, d);
    ledger.push({ date: r.date, flow: 'influence', category: r.key, counterparty: title(r.contributor), description: r.description, amount: Math.round(r.amount * 100) / 100, source: r.source });
  }
  for (const k of Object.keys(influence)) influence[k] = Math.round(influence[k]);
  const topDonors = [...donors.values()].sort((a, b) => b.amount - a.amount).slice(0, 10).map((d) => ({
    name: d.name,
    type: d.type,
    recipient: d.recipients.size > 2 ? `${d.recipients.size} candidates` : [...d.recipients].join(', '),
    amount: Math.round(d.amount),
  }));
  ledger.sort((a, b) => (a.date < b.date ? 1 : -1));
  return { influence, topDonors, ledger };
}
