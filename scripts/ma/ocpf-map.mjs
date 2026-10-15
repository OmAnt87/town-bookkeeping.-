// Turns Massachusetts OCPF receipts for municipal candidates into Town Ledger
// political-money fields.
//
// Only candidates for mayor, and for city council in the cities whose council
// candidates file with the state, report to OCPF; other candidates for city and
// town office file with the city or town clerk. Business and corporate
// contributions to candidates are banned in Massachusetts, so organized money
// reaches candidates as:
//   PAC:    receipts from other committees, not counting party and candidate committees
//   Union:  receipts from unions and associations (and union PACs)
// Not counted: individuals, unitemized receipts, transfers, loans and refunds.

import { isPartyOrCandidate, summarizeContributions, title, UNION, NOT_A_PAC } from '../common/political.mjs';

export const OCPF_URL = 'https://www.ocpf.us/';

const isoDate = (d) => {
  const m = String(d || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
};

export function classifyOcpf(item) {
  const name = item.fullNameReverse || '';
  if (item.isTransfer) return null;
  if (/^Union\/Association$/i.test(item.recordTypeDescription)) return { key: 'unionContributions' };
  if (/^Committee$/i.test(item.recordTypeDescription)) {
    if (UNION.test(name)) return { key: 'unionContributions' };
    // Committees that name themselves PACs count even when the name reads like a
    // party or candidate ("Democracy for Cambridge PAC"); party city and ward committees don't.
    if (/\b(pac|political action|pol\.? action)\b/i.test(name) && !/\b(state|city|town|ward) committee\b/i.test(name)) return { key: 'pacContributions' };
    if (isPartyOrCandidate(name) || NOT_A_PAC.test(name) || /\bcommittee to elect\b|\bcampaign\b/i.test(name)) return null;
    return { key: 'pacContributions' };
  }
  if (/^Business|Corporation/i.test(item.recordTypeDescription)) return { key: 'developerContributions' };
  return null;
}

// filers: [{ cpfId, name, office, items: [...] }] for one city's candidates. since: ISO date.
export function summarizeMaReceipts(filers, since) {
  const kept = [];
  let individuals = 0;
  const seen = new Set();
  for (const f of filers) {
    const recipient = `${title(f.name.split(',').reverse().join(' ').trim())} (${f.office === 'Mayoral' ? 'mayor' : 'city council'})`;
    for (const it of f.items) {
      if (seen.has(it.id)) continue;
      seen.add(it.id);
      const date = isoDate(it.date);
      const amount = Number(it.amount) || 0;
      if (!date || date < since || amount <= 0) continue;
      const c = classifyOcpf(it);
      if (!c) { if (/^Individual$/i.test(it.recordTypeDescription)) individuals += amount; continue; }
      kept.push({
        date, amount, key: c.key, contributor: it.fullNameReverse, recipient,
        description: `Contribution to ${recipient}`,
        source: `https://www.ocpf.us/Reports/DisplayReport?menuHidden=true&id=${it.reportId}`,
      });
    }
  }
  return { ...summarizeContributions(kept), counted: kept.length, individuals: Math.round(individuals), candidates: filers.length };
}
