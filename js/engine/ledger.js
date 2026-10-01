// Ledger utilities: filtering, summarizing, CSV export and dataset validation.

import { REVENUE_CATEGORIES, SPENDING_CATEGORIES, INFLUENCE_CATEGORIES } from './categories.js';

const LABELS = Object.fromEntries(
  [...REVENUE_CATEGORIES, ...SPENDING_CATEGORIES, ...INFLUENCE_CATEGORIES].map((c) => [c.key, c.label]),
);

export const categoryLabel = (key) => LABELS[key] || key;

// Flow kinds: money into the treasury, money out of it, and political money
// around the town that never touches the treasury.
export const FLOWS = { in: 'Money in', out: 'Money out', influence: 'Political money' };

export function filterLedger(entries, { flow = 'all', category = 'all', query = '' } = {}) {
  const q = query.trim().toLowerCase();
  return entries.filter(
    (e) =>
      (flow === 'all' || e.flow === flow) &&
      (category === 'all' || e.category === category) &&
      (!q ||
        e.counterparty.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q) ||
        categoryLabel(e.category).toLowerCase().includes(q)),
  );
}

export function summarizeLedger(entries) {
  const out = { in: 0, out: 0, influence: 0, count: entries.length };
  for (const e of entries) out[e.flow] = (out[e.flow] || 0) + e.amount;
  return out;
}

export function sortLedger(entries, key = 'date', dir = 'desc') {
  const sign = dir === 'asc' ? 1 : -1;
  return [...entries].sort((a, b) => (a[key] > b[key] ? sign : a[key] < b[key] ? -sign : 0));
}

function csvCell(v) {
  const s = String(v ?? '');
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(rows, columns) {
  const head = columns.map((c) => csvCell(c.label)).join(',');
  const body = rows.map((r) => columns.map((c) => csvCell(c.get(r))).join(','));
  return [head, ...body].join('\n');
}

export function ledgerToCSV(town, entries) {
  return toCSV(entries, [
    { label: 'Town', get: () => `${town.name}, ${town.state}` },
    { label: 'Date', get: (e) => e.date },
    { label: 'Flow', get: (e) => FLOWS[e.flow] },
    { label: 'Category', get: (e) => categoryLabel(e.category) },
    { label: 'Counterparty', get: (e) => e.counterparty },
    { label: 'Description', get: (e) => e.description },
    { label: 'Amount (USD)', get: (e) => e.amount.toFixed(2) },
    { label: 'Source', get: (e) => e.source || '' },
  ]);
}

// Validates a dataset someone imports. Returns a list of human-readable problems.
export function validateDataset(data) {
  const errors = [];
  if (!data || !Array.isArray(data.towns)) return ['File must be a JSON object with a "towns" array.'];
  data.towns.forEach((t, i) => {
    const where = `Town #${i + 1}${t?.name ? ` (${t.name})` : ''}`;
    for (const f of ['id', 'name', 'state']) if (!t?.[f]) errors.push(`${where}: missing "${f}".`);
    if (typeof t?.lat !== 'number' || typeof t?.lng !== 'number') errors.push(`${where}: needs numeric "lat" and "lng".`);
    if (!(t?.population > 0)) errors.push(`${where}: "population" must be a positive number.`);
    if (!t?.revenue || typeof t.revenue !== 'object') errors.push(`${where}: missing "revenue" object.`);
    if (!t?.spending || typeof t.spending !== 'object') errors.push(`${where}: missing "spending" object.`);
  });
  return errors.slice(0, 20);
}
