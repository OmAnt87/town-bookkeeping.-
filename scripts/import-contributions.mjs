#!/usr/bin/env node
// Imports campaign contributions to local officials (and lobbying the town pays for)
// from a CSV export of a state or county campaign-finance portal.
//
//   node scripts/import-contributions.mjs --csv contributions.csv --id example-township-pa
//
// Expected CSV headers (case-insensitive): date, contributor, contributor_type, recipient, amount
// contributor_type examples: PAC, Developer, Contractor, Union, Individual,
// Corporate lobbying (a company lobbying town officials), Town-paid lobbying
// Individual contributions are skipped: the score tracks organized outside money.

import { readFileSync } from 'node:fs';
import { parseArgs, parseCSV, openTown, addSource, usage } from './lib.mjs';
import { classifyContributor } from './contributor-types.mjs';

const args = parseArgs();
if (!args.csv || !args.id) {
  usage('Usage: node scripts/import-contributions.mjs --csv <file> --id <town-id> [--out data/<id>.json] [--source-url <portal url>]');
}

const rows = parseCSV(readFileSync(args.csv, 'utf8'));
const { town, save } = openTown(args.out || `data/${args.id}.json`, { id: args.id });

const influence = { pacContributions: 0, developerContributions: 0, unionContributions: 0, corporateLobbying: 0, lobbyingPaid: 0 };
const donors = new Map();
const entries = [];
let skipped = 0;
for (const r of rows) {
  const amount = Number(String(r.amount).replace(/[$,]/g, ''));
  const key = classifyContributor(r.contributor_type, r.contributor);
  if (!key || !Number.isFinite(amount) || amount <= 0) { skipped++; continue; }
  influence[key] += amount;
  entries.push({
    date: r.date, flow: 'influence', category: key, counterparty: r.contributor,
    description: key === 'lobbyingPaid' ? 'Town-paid lobbying'
      : key === 'corporateLobbying' ? `Lobbying ${r.recipient || 'town officials'}`
      : `Contribution to ${r.recipient || 'local official'}`,
    amount, source: args['source-url'] || '',
  });
  if (key !== 'lobbyingPaid') {
    const d = donors.get(r.contributor) || { name: r.contributor, type: r.contributor_type || 'Organization', recipient: r.recipient || '', amount: 0 };
    d.amount += amount;
    donors.set(r.contributor, d);
  }
}

town.influence = influence;
town.topDonors = [...donors.values()].sort((a, b) => b.amount - a.amount).slice(0, 10);
town.ledger = [...town.ledger.filter((e) => e.flow !== 'influence'), ...entries];
addSource(town, 'Campaign-finance filings (imported CSV)', args['source-url'] || '');
save();
console.log(`Imported ${entries.length} contributions (${skipped} individual or invalid rows skipped).`);
