// Turns Massachusetts Office of Campaign and Political Finance (OCPF) receipts into Town
// Ledger political-money fields.
//
// Local filers with OCPF: party town, city and ward committees ("Marblehead DEMTC") and
// candidates for mayor and city council, who file bank depository reports. Candidates for
// other town offices (select board, town meeting) file with their town clerk and are not
// included. Corporate contributions are banned in Massachusetts, so organized money arrives as:
//   Union:  union/association contributions, and committee contributions from union funds
//   PAC:    committee contributions from registered PACs
// Not counted: individuals, and money from other candidate and party committees.

import { isPartyOrCandidate, summarizeContributions, title } from '../common/political.mjs';

export const OCPF_URL = 'https://www.ocpf.us/Reports/SearchItems';

const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
// OCPF spells a few towns differently from DLS.
const ALIASES = { manchester: 'manchester by the sea' };

// towns: DLS municipality names. Returns name -> DLS name or null.
export function townMatcher(towns) {
  const byNorm = new Map(towns.map((t) => [norm(t), t]));
  return (name) => byNorm.get(ALIASES[norm(name)] || norm(name)) || null;
}

const PARTY = { DEM: 'Democratic', REP: 'Republican' };
const LEVEL = { TC: 'Town Committee', CC: 'City Committee', WC: 'Ward Committee' };

// lists: { lpc: [...], mayoral: [...], cc: [...] } rows from fetch-ocpf.mjs, any years.
// Returns cpfId -> { town, label }.
export function localFilers(lists, match) {
  const out = new Map();
  for (const r of lists.lpc || []) {
    const m = String(r.filerName).trim().match(/^(.+?)( Ward \d+[A-Z]?)? (DEM|REP)(TC|CC|WC)$/i);
    const town = m && match(m[1]);
    if (town) out.set(r.cpfId, { town, label: `${town}${m[2] || ''} ${PARTY[m[3].toUpperCase()]} ${LEVEL[m[4].toUpperCase()]}` });
  }
  for (const [rows, office] of [[lists.mayoral, 'mayor'], [lists.cc, 'city council']]) {
    for (const r of rows || []) {
      const town = match(String(r.officeSought).split(', ').slice(1).join(', '));
      const [last, first] = String(r.filerName).split(', ');
      if (town) out.set(r.cpfId, { town, label: `${first ? `${first} ${last}` : last} (candidate for ${office})` });
    }
  }
  return out;
}

const UNION = /\b(unions?|local\s*(union\s*)?(no\.?\s*|#\s*)?\d+|brotherhood|workers|federation|afl[- ]?cio|teamsters|ibew|seiu|afscme|iaff|iuoe|i\.u\.o\.e|ufcw|iatse|usw|nage|carpenters|laborers?'?s?|plumbers|pipefitters|bricklayers|ironworkers|electricians|firefighters|fifefighters|police|patrolmen|detectives|teachers|nurses|educators|employees|moses|1199|32bj|cope|smart|brick ?layers|painters|roofers|sheet metal|pile drivers|elevator constructors|floorcoverers|interns and residents)\b/i;
const PAC = /\b(pac|political action|pol action)\b/i;

// item: one OCPF receipt (search/items). pacIds: ids of items OCPF lists as from registered PACs.
export function classifyOcpf(item, pacIds) {
  const name = item.fullNameReverse || '';
  if (item.recordTypeId === 203) {
    if (isPartyOrCandidate(name) && !UNION.test(name)) return null;
    return { key: 'unionContributions' };
  }
  if (item.recordTypeId === 202) {
    if (UNION.test(name)) return { key: 'unionContributions' };
    if ((pacIds.has(item.id) || PAC.test(name)) && !isPartyOrCandidate(name)) return { key: 'pacContributions' };
  }
  return null;
}

const isoDate = (d) => {
  const m = String(d || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
};
const amountOf = (s) => Number(String(s || '').replace(/[$,]/g, '')) || 0;

// items: receipts to one town's local filers; filers: localFilers() map; since: ISO date.
export function summarizeMaReceipts(items, filers, pacIds, since) {
  const kept = [];
  for (const i of items) {
    const date = isoDate(i.date);
    const amount = amountOf(i.amount);
    if (!date || date < since || amount <= 0) continue;
    const c = classifyOcpf(i, pacIds);
    if (!c) continue;
    const recipient = filers.get(i.filerCpfId)?.label || title(i.filerFullNameReverse);
    kept.push({
      date, amount, key: c.key, contributor: i.fullNameReverse, recipient,
      description: `Contribution to ${recipient}`,
      source: i.reportId ? `https://www.ocpf.us/Reports/DisplayReport?menuHidden=true&id=${i.reportId}` : OCPF_URL,
    });
  }
  return { ...summarizeContributions(kept), counted: kept.length };
}
