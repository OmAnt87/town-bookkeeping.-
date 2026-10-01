#!/usr/bin/env node
// Imports one government's revenue and spending from a Census of Governments /
// Annual Survey of Local Government Finances "Individual Unit" file.
//
//   node scripts/import-census-finance.mjs --file 2022FinEstDAT.txt --gov-id 39203101300000 \
//     --id example-township-oh --name "Example Township" --state OH --population 12000 \
//     --lat 40.1 --lng -82.9 --year 2022 --out data/example-township-oh.json
//
// Input formats accepted:
//   - Fixed-width text: government ID (14 chars), item code (3), amount in $1,000s (12), year (4)
//   - CSV with headers: id,item_code,amount   (amount in $1,000s)
// Download from https://www.census.gov/programs-surveys/gov-finances/data/datasets.html

import { readFileSync } from 'node:fs';
import { parseArgs, parseCSV, openTown, addSource, usage } from './lib.mjs';
import { mapCensusItem } from './census-codes.mjs';

const args = parseArgs();
if (!args.file || !args['gov-id'] || !args.id) {
  usage(`
Usage: node scripts/import-census-finance.mjs --file <path> --gov-id <14-digit id> --id <town-id>
         [--name] [--state] [--county] [--population] [--lat] [--lng] [--year] [--out data/<id>.json]`);
}

const govId = String(args['gov-id']).trim();
const text = readFileSync(args.file, 'utf8');
const rows = args.file.toLowerCase().endsWith('.csv')
  ? parseCSV(text).map((r) => ({ id: r.id, code: r.item_code, amount: Number(r.amount) }))
  : text.split(/\r?\n/).filter(Boolean).map((l) => ({ id: l.slice(0, 14), code: l.slice(14, 17), amount: Number(l.slice(17, 29)) }));

const mine = rows.filter((r) => r.id.trim() === govId);
if (!mine.length) usage(`No rows found for government ID ${govId}.`);

const revenue = {};
const spending = {};
let skipped = 0;
for (const r of mine) {
  const m = mapCensusItem(r.code);
  if (!m || !Number.isFinite(r.amount)) { skipped++; continue; }
  const bucket = m.group === 'revenue' ? revenue : spending;
  bucket[m.key] = (bucket[m.key] || 0) + r.amount * 1000;
}

const { town, save } = openTown(args.out || `data/${args.id}.json`, {
  id: args.id, name: args.name, state: args.state, county: args.county,
  population: args.population, lat: args.lat, lng: args.lng, fiscalYear: args.year,
});
// Keep any federal grants already pulled from USAspending (more detailed).
town.revenue = { ...revenue, ...(town.revenue.federalGrants ? { federalGrants: town.revenue.federalGrants } : {}) };
town.spending = spending;
const year = Number(args.year) || town.fiscalYear;
const rTotal = Object.values(town.revenue).reduce((a, b) => a + b, 0);
const sTotal = Object.values(spending).reduce((a, b) => a + b, 0);
town.history = [...town.history.filter((h) => h.year !== year), { year, revenue: rTotal, spending: sTotal }].sort((a, b) => a.year - b.year);
addSource(town, `U.S. Census Bureau, Annual Survey of Local Government Finances ${year}`, 'https://www.census.gov/programs-surveys/gov-finances.html');
save();
console.log(`Imported ${mine.length - skipped} line items (${skipped} balance-sheet or unmapped codes skipped). Revenue $${Math.round(rTotal).toLocaleString('en-US')}, spending $${Math.round(sTotal).toLocaleString('en-US')}.`);
