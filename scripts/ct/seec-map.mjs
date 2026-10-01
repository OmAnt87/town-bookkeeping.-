// Turns Connecticut State Elections Enforcement Commission (SEEC) receipts for town
// party committees into Town Ledger political-money fields.
//
// Candidates for town office file with their town clerk, so the state has no
// statewide record of their money. Town party committees ("Greenwich Republican
// Town Committee") do file with SEEC. Corporate contributions are banned in CT, so
// organized money reaches them as:
//   PAC / union:  "Contributions from Other Committees" (party and candidate committees excluded)
//   Business:     "Advertising Book Proceeds" (program-book ads) from names that are clearly businesses
//   Lobbyists and state contractors: itemized contributions SEEC flags as from a
//                 registered lobbyist or a state contractor
// Not counted: other individuals, raffles, interest, in-kind gifts from people.

import { isPartyOrCandidate, summarizeContributions, title } from '../common/political.mjs';

export const SEEC_URL = 'https://seec.ct.gov/Portal/eCRIS/CurPreYears';

const norm = (s) => String(s || '').toLowerCase().replace(/[.'’,]/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

// towns: the state's town names ("WEST HARTFORD"). Longest names first, so
// "West Hartford" wins over "Hartford" and "Windsor Locks" over "Windsor".
export function committeeMatcher(towns) {
  const list = [...towns].map((t) => [t, new RegExp(`(^|\\s)${norm(t).replace(/\s/g, '\\s')}(\\s|$)`)])
    .sort((a, b) => b[0].length - a[0].length);
  return (committee) => {
    const c = norm(committee);
    if (!/town committee/.test(c)) return null;
    // Committees for a borough or other district inside a town are not the town's.
    if (/\bborough\b/.test(c)) return null;
    const hit = list.find(([, re]) => re.test(c));
    return hit ? hit[0] : null;
  };
}

const UNION = /\b(unions?|local\s*#?\s*\d+|brotherhood|workers|federation|afl[- ]?cio|teamsters|ibew|seiu|afscme|uaw|iuoe|aft|carpenters|laborers?'?s?|plumbers|pipefitters|machinists|electricians|firefighters|employees assoc(iation)?|education association|teachers|1199|32bj|cope|opc)\b/i;
const NOT_A_PAC = /\b(senatorial|town|district|state central|county) committee\b|\bfor\b|\b4 (mayor|council|selectm[ae]n|board)\b|\b20\d\d\b/i;
const BUSINESS = /\b(inc|llc|l l c|co|corp|corporation|company|companies|ltd|llp|pc|pllc|group|associates|services?|store|shop|market|restaurant|pizza|pizzeria|cafe|diner|bakery|deli|bank|insurance|agency|realty|real estate|realtors?|construction|contractors?|builders?|engineering|engineers|law (office|firm|offices)|dental|funeral home|motors|auto|automotive|garage|farms?|oil|fuel|plumbing|heating|electric|landscaping|enterprises|industries|properties|partners|studio|salon|tavern|inn|grill|pub|package|liquors?|wines?|spirits|hardware|lumber|supply|clinic|pharmacy|hotel|management|consulting|holdings|marina|nursery|florist|printing|towing|paving|excavating|trucking|sons)\b/i;

// row: one SEEC receipt, with headers as scripts/lib.mjs parseCSV gives them (receipt_type, ...). Returns { key, kind } or null when not counted.
export function classifyReceipt(row) {
  const type = row.receipt_type || '';
  const name = row.contributor_name || '';
  if (/^Contributions from Other Committees$/i.test(type)) {
    if (UNION.test(name)) return { key: 'unionContributions', kind: 'union committee' };
    if (isPartyOrCandidate(name) || NOT_A_PAC.test(name)) return null;
    return { key: 'pacContributions', kind: 'PAC' };
  }
  if (/^Advertising Book Proceeds$/i.test(type)) {
    if (UNION.test(name)) return { key: 'unionContributions', kind: 'program-book ad' };
    if (BUSINESS.test(name)) return { key: 'developerContributions', kind: 'program-book ad' };
    return null;
  }
  if (/^Itemized Contributions/i.test(type)) {
    if (/^yes$/i.test(row.lobbyist || '')) return { key: 'corporateLobbying', kind: 'registered lobbyist' };
    if (/^yes$/i.test(row.contractor || '')) return { key: 'developerContributions', kind: 'state contractor' };
  }
  return null;
}

const isoDate = (d) => {
  const m = String(d || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
};

// rows: all SEEC receipts for one town's committees. since: ISO date.
export function summarizeCtReceipts(rows, since) {
  // Amended copies of a receipt that is also on file as an original are dropped.
  const key = (r) => [r.committee, r.contributor_name, r.transaction_date, r.amount, r.receipt_type].join('|');
  const originals = new Set(rows.filter((r) => r.receipt_state !== 'Amended').map(key));
  const kept = [];
  let individuals = 0;
  for (const r of rows) {
    if (r.receipt_state === 'Amended' && originals.has(key(r))) continue;
    const date = isoDate(r.transaction_date);
    const amount = Number(r.amount) || 0;
    if (!date || date < since || amount <= 0) continue;
    const c = classifyReceipt(r);
    if (!c) { if (/^Itemized Contributions from Individuals/i.test(r.receipt_type)) individuals += amount; continue; }
    const recipient = title(r.committee);
    kept.push({
      date, amount, key: c.key, contributor: r.contributor_name, recipient, source: SEEC_URL,
      description: `${c.kind === 'program-book ad' ? 'Program-book ad' : 'Contribution'} to ${recipient}${c.kind === 'registered lobbyist' || c.kind === 'state contractor' ? ` (${c.kind})` : ''}`,
    });
  }
  return { ...summarizeContributions(kept), counted: kept.length, individuals: Math.round(individuals) };
}
