#!/usr/bin/env node
// Imports a New Jersey municipal budget (or User Friendly Budget) into a Town Ledger
// dataset file, one ledger row per budget line.
//
//   node scripts/import-nj-budget.mjs --csv holmdel-2025-budget.csv --id holmdel-township-nj \
//     --name "Holmdel Township" --county "Monmouth County" --population 17400 \
//     --lat 40.3449 --lng -74.1840 --year 2025 \
//     --source-url "https://www.holmdeltownship.com/439/Budget-Financial-Info" \
//     --out data/real/holmdel-township-nj.json
//
// CSV headers: section,line,amount
//   section = revenue | appropriation;  line = the budget line's label as printed;
//   amount  = dollars for the budget year.

import { readFileSync } from 'node:fs';
import { parseArgs, parseCSV, openTown, addSource, usage } from './lib.mjs';
import { aggregateNJBudget, mapNJLine } from './nj-budget-map.mjs';

const args = parseArgs();
if (!args.csv || !args.id) {
  usage('Usage: node scripts/import-nj-budget.mjs --csv <file> --id <town-id> [--name] [--county] [--population] [--lat] [--lng] [--year] [--source-url] [--out]');
}

const lines = parseCSV(readFileSync(args.csv, 'utf8')).map((r) => ({
  section: r.section.toLowerCase().startsWith('rev') ? 'revenue' : 'appropriation',
  line: r.line,
  amount: Number(String(r.amount).replace(/[$,\s]/g, '')),
}));
const { revenue, spending, shared, excluded } = aggregateNJBudget(lines);
const year = Number(args.year) || new Date().getFullYear();
const url = args['source-url'] || '';

const { town, save } = openTown(args.out || `data/real/${args.id}.json`, {
  id: args.id, name: args.name, state: 'NJ', county: args.county, type: 'Township',
  population: args.population, lat: args.lat, lng: args.lng, fiscalYear: year,
});
town.stateName = 'New Jersey';
town.revenue = revenue;
town.spending = spending;
town.ledger = [
  ...town.ledger.filter((e) => !e.budgetLine),
  ...lines.filter((l) => l.amount).map((l) => ({
    date: `${year}-01-01`,
    flow: l.section === 'revenue' ? 'in' : 'out',
    category: (() => { const k = mapNJLine(l.line, l.section); return k === 'shared' || k === 'exclude' ? 'administration' : k; })(),
    counterparty: l.section === 'revenue' ? 'Budgeted revenue' : 'Budgeted appropriation',
    description: l.line,
    amount: l.amount,
    source: url,
    budgetLine: true,
  })),
];
const rTotal = Object.values(revenue).reduce((a, b) => a + b, 0);
const sTotal = Object.values(spending).reduce((a, b) => a + b, 0);
town.history = [...town.history.filter((h) => h.year !== year), { year, revenue: rTotal, spending: sTotal + excluded }].sort((a, b) => a.year - b.year);
addSource(town, `${args.name || town.name} ${year} municipal budget`, url);
save();
console.log(`Revenue $${rTotal.toLocaleString('en-US')}; spending $${sTotal.toLocaleString('en-US')} (pensions/insurance of $${Math.round(shared).toLocaleString('en-US')} spread across departments; $${excluded.toLocaleString('en-US')} in reserves excluded).`);
