// Turns NY State Board of Elections contribution records (data.ny.gov) into
// Town Ledger political-money fields.
//
// Counted (contributor type):
//   PAC:       "Political Action Committee (PAC)", "Association" (trade and professional groups)
//   Business:  "Corporation", "Professional/Limited Liability Company (PLLC/LLC)",
//              "Partnership including LLPs", "Sole Proprietorship"
//   Union:     "Union"
// Not counted: individuals, candidates and their families, political committees
// (party and candidate committees), "Other" and blank types, plus any contributor
// whose name marks it as a party or candidate committee (scripts/common/political.mjs).

import { title, isPartyOrCandidate, summarizeContributions } from '../common/political.mjs';

export const NY_CF_URL = 'https://data.ny.gov/Transparency/Campaign-Finance-Disclosure-Reports-Contributions-/4j2b-6a2j';

export const NY_TYPE_CATEGORY = {
  'Political Action Committee (PAC)': 'pacContributions',
  Association: 'pacContributions',
  Corporation: 'developerContributions',
  'Professional/Limited Liability Company (PLLC/LLC)': 'developerContributions',
  'Partnership including LLPs': 'developerContributions',
  'Sole Proprietorship': 'developerContributions',
  Union: 'unionContributions',
};

// Offices whose candidates are counted: elected municipal offices, except judges.
export const isCountedOffice = (office) => !/justice|judge|court/i.test(office || '');

// Filer committee types that belong to a candidate (counted as recipients).
export const isCandidateFiler = (f) => f.compliance_type_desc === 'CANDIDATE'
  || /^Authorized (Single|Multi)[- ]Candidate Committee$/.test(f.committee_type_desc || '');

const contributorName = (r) => r.flng_ent_name || [r.flng_ent_first_name, r.flng_ent_last_name].filter(Boolean).join(' ');

// rows: cached contribution records for one government. since: ISO date.
export function summarizeNyContributions(rows, since) {
  const kept = [];
  let individuals = 0;
  for (const r of rows) {
    const date = String(r.sched_date || '').slice(0, 10);
    if (!date || date < since) continue;
    const amount = Number(r.org_amt) || 0;
    if (amount <= 0) continue;
    // Judicial campaigns are not municipal officials, even when a committee has no office listed.
    if (/\b(judge|justice|court)\b/i.test(r.cand_comm_name || '')) continue;
    if (r.cntrbr_type_desc === 'Individual') { individuals += amount; continue; }
    // Corporate gifts are often filed with no contributor type, only on the corporation schedule.
    const type = r.cntrbr_type_desc || (/From Corporation/i.test(r.filing_sched_desc || '') ? 'Corporation' : '');
    const key = NY_TYPE_CATEGORY[type];
    const name = contributorName(r);
    if (!key || !name || isPartyOrCandidate(name)) continue;
    const recipient = title(r.cand_comm_name);
    kept.push({
      date, amount, key, contributor: name, recipient, source: NY_CF_URL,
      description: `Contribution to ${recipient}${r.office_desc ? ` (${r.office_desc})` : ''}, ${r.election_year} ${title(r.election_type || '')}`.trim(),
    });
  }
  return { ...summarizeContributions(kept), counted: kept.length, individuals: Math.round(individuals) };
}
