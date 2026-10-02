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
  const object = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
  const string = (v) => typeof v === 'string' && v.trim().length > 0;
  const finite = (v) => typeof v === 'number' && Number.isFinite(v);
  const safeURL = (v) => typeof v === 'string' && /^https?:\/\//i.test(v);
  if (!object(data) || !Array.isArray(data.towns)) return ['File must be a JSON object with a "towns" array.'];
  if (data.demo !== undefined && typeof data.demo !== 'boolean') errors.push('Dataset demo flag must be boolean.');
  const ids = new Set();
  for (const [i, t] of data.towns.entries()) {
    const where = `Town #${i + 1}`;
    const fail = (message) => { if (errors.length < 20) errors.push(`${where}: ${message}`); };
    if (!object(t)) { fail('must be an object.'); continue; }
    for (const f of ['id', 'name', 'state']) if (!string(t[f])) fail(`needs a nonempty "${f}" string.`);
    if (string(t.id) && (!/^[a-zA-Z0-9_-]+$/.test(t.id) || ids.has(t.id))) fail('ID must be unique and URL-safe.');
    ids.add(t.id);
    if (typeof t.state !== 'string' || !/^[A-Z]{2}$/.test(t.state)) fail('state must be a two-letter uppercase code.');
    for (const f of ['county', 'stateName', 'type']) if (t[f] !== undefined && typeof t[f] !== 'string') fail(`${f} must be a string.`);
    if (!finite(t.lat) || t.lat < -90 || t.lat > 90 || !finite(t.lng) || t.lng < -180 || t.lng > 180) fail('needs finite coordinates within latitude/longitude bounds.');
    if (!finite(t.population) || t.population <= 0) fail('"population" must be a positive finite number.');
    for (const f of ['revenue', 'spending', 'influence', 'taxBreaks']) {
      if (t[f] === undefined && !['revenue', 'spending'].includes(f)) continue;
      if (!object(t[f]) || Object.values(t[f]).some((v) => !finite(v))) fail(`"${f}" must be an object of finite numbers.`);
    }
    if (t.debt !== undefined && !finite(t.debt)) fail('"debt" must be finite.');
    if (t.fiscalYear !== undefined && (!Number.isInteger(t.fiscalYear) || t.fiscalYear < 1800 || t.fiscalYear > 3000)) fail('invalid fiscal year.');
    if (t.asOf !== undefined && (!string(t.asOf) || !/^\d{4}-\d{2}-\d{2}$/.test(t.asOf))) fail('invalid retrieval date.');
    if (t.demo !== undefined && typeof t.demo !== 'boolean') fail('"demo" must be boolean.');
    if (t.detailFile !== undefined && (!string(t.detailFile) || !/^[a-z0-9-]+\.json$/.test(t.detailFile))) fail('invalid county detail filename.');
    if (t.reporting !== undefined && (!object(t.reporting) || Object.values(t.reporting).some((v) => !string(v)))) fail('reporting metadata must contain nonempty strings.');
    if (t.transparency !== undefined && (!object(t.transparency) || Object.values(t.transparency).some((v) => v !== null && typeof v !== 'boolean'))) fail('transparency checks must be boolean or null.');
    for (const f of ['ledger', 'redFlagLedger']) {
      if (t[f] === undefined) continue;
      if (!Array.isArray(t[f])) { fail(`"${f}" must be an array.`); continue; }
      for (const e of t[f]) {
        if (!object(e) || !Object.hasOwn(FLOWS, e.flow) || !string(e.category) || typeof e.counterparty !== 'string' || typeof e.description !== 'string' || !string(e.date) || !/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !finite(e.amount)) { fail(`invalid ${f} entry: date, flow, category, text and finite amount are required.`); break; }
        if (e.source && !safeURL(e.source)) fail('ledger source must be an HTTP(S) URL.');
      }
    }
    for (const f of ['sources', 'history', 'topDonors', 'redFlags']) {
      if (t[f] !== undefined && (!Array.isArray(t[f]) || t[f].some((v) => !object(v)))) fail(`"${f}" must be an array of objects.`);
    }
    if (Array.isArray(t.sources) && t.sources.some((v) => !object(v) || !string(v.label) || (v.url && !safeURL(v.url)))) fail('sources need labels and HTTP(S) URLs.');
    if (Array.isArray(t.history) && t.history.some((v) => !object(v) || !Number.isInteger(v.year) || !finite(v.revenue) || !finite(v.spending))) fail('history needs a year and finite totals.');
    if (Array.isArray(t.topDonors) && t.topDonors.some((v) => !object(v) || !string(v.name) || !finite(v.amount))) fail('donors need names and finite amounts.');
    const validSource = (v) => object(v) && string(v.label) && (!v.url || safeURL(v.url));
    if (Array.isArray(t.redFlags)) for (const flag of t.redFlags) {
      if (!object(flag) || !string(flag.kind) || !string(flag.label)) { fail('red flags need a kind and label.'); continue; }
      if (flag.scored !== undefined && typeof flag.scored !== 'boolean') fail('red flag scored must be boolean.');
      if (flag.source !== undefined && !validSource(flag.source)) fail('invalid red flag source.');
      if (flag.sources !== undefined && (!Array.isArray(flag.sources) || flag.sources.some((v) => !validSource(v)))) fail('invalid red flag sources.');
    }
    if (t.surveillanceMap !== undefined && (!object(t.surveillanceMap) || !finite(t.surveillanceMap.cameras) || !validSource(t.surveillanceMap.source))) fail('surveillance map needs a camera count and source.');
    if (t.notes !== undefined && (!Array.isArray(t.notes) || t.notes.some((v) => typeof v !== 'string'))) fail('notes must be strings.');
  }
  return errors;
}
