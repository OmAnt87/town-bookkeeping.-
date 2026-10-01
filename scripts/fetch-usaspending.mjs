#!/usr/bin/env node
// Pulls federal grants awarded to a town government from USAspending.gov and
// writes them into a Town Ledger dataset file (revenue.federalGrants + ledger rows).
//
//   node scripts/fetch-usaspending.mjs --state NJ --city "Cherry Hill" \
//     --recipient "CHERRY HILL" --id cherry-hill-township-nj --name "Cherry Hill Township" \
//     --fy 2026 --out data/cherry-hill-township-nj.json
//
// --recipient filters to awards whose recipient name contains this text, so grants
// to private businesses located in the same city are excluded. No API key needed.

import { parseArgs, openTown, addSource, usage } from './lib.mjs';

const args = parseArgs();
if (!args.state || !args.city || !args.id) {
  usage(`
Usage: node scripts/fetch-usaspending.mjs --state XX --city "City" --id town-id
         [--recipient "NAME FRAGMENT"] [--name "Town Name"] [--fy 2026] [--out data/<id>.json]`);
}

const fy = Number(args.fy) || new Date().getFullYear();
// Federal fiscal years run Oct 1 - Sep 30.
const start = `${fy - 1}-10-01`;
const end = `${fy}-09-30`;
const out = args.out || `data/${args.id}.json`;
const API = 'https://api.usaspending.gov/api/v2/search/spending_by_award/';
const GRANT_CODES = ['02', '03', '04', '05']; // block, formula, project grants, cooperative agreements

async function fetchPage(page) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      filters: {
        award_type_codes: GRANT_CODES,
        time_period: [{ start_date: start, end_date: end }],
        recipient_locations: [{ country: 'USA', state: args.state.toUpperCase(), city: args.city.toUpperCase() }],
      },
      fields: ['Award ID', 'Recipient Name', 'Award Amount', 'Awarding Agency', 'Start Date', 'Description', 'generated_internal_id'],
      sort: 'Award Amount',
      order: 'desc',
      limit: 100,
      page,
    }),
  });
  if (!res.ok) throw new Error(`USAspending returned ${res.status}: ${await res.text()}`);
  return res.json();
}

const awards = [];
for (let page = 1; page <= 20; page++) {
  const json = await fetchPage(page);
  awards.push(...json.results);
  if (!json.page_metadata?.hasNext) break;
}

const needle = args.recipient ? String(args.recipient).toUpperCase() : null;
const mine = awards.filter((a) => !needle || (a['Recipient Name'] || '').toUpperCase().includes(needle));
const total = mine.reduce((s, a) => s + (Number(a['Award Amount']) || 0), 0);

const { town, save } = openTown(out, { id: args.id, name: args.name, state: args.state.toUpperCase(), fiscalYear: fy });
town.revenue.federalGrants = Math.round(total);
town.ledger = town.ledger.filter((e) => !(e.flow === 'in' && e.category === 'federalGrants'));
for (const a of mine) {
  town.ledger.push({
    date: a['Start Date'] || start,
    flow: 'in',
    category: 'federalGrants',
    counterparty: a['Awarding Agency'] || 'Federal agency',
    description: (a.Description || a['Award ID'] || 'Federal award').slice(0, 140),
    amount: Math.round(Number(a['Award Amount']) || 0),
    source: a.generated_internal_id ? `https://www.usaspending.gov/award/${a.generated_internal_id}` : 'https://www.usaspending.gov',
  });
}
addSource(town, `USAspending.gov federal grants, FY${fy}`, 'https://www.usaspending.gov');
save();
console.log(`${mine.length} of ${awards.length} awards matched; federal grants = $${Math.round(total).toLocaleString('en-US')}. Wrote ${out}`);
