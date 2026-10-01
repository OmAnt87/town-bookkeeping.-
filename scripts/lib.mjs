// Helpers shared by the data pipeline scripts.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

export function slugify(s) {
  return String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// RFC 4180-style CSV parser (quoted fields, escaped quotes, CRLF). Returns objects keyed by header.
export function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  const [head = [], ...body] = rows;
  const keys = head.map((h) => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

export const emptyTown = (o = {}) => ({
  id: o.id,
  name: o.name || o.id,
  state: o.state || '',
  stateName: o.stateName || '',
  county: o.county || '',
  type: o.type || 'Township',
  lat: Number(o.lat) || 0,
  lng: Number(o.lng) || 0,
  population: Number(o.population) || 1,
  fiscalYear: Number(o.fiscalYear) || new Date().getFullYear(),
  asOf: new Date().toISOString().slice(0, 10),
  revenue: {},
  spending: {},
  influence: {},
  topDonors: [],
  transparency: {},
  debt: 0,
  history: [],
  ledger: [],
  sources: [],
});

// Opens (or creates) a dataset file and returns { data, town, save }.
// `opts` must include `id`; other fields seed a new town record.
export function openTown(file, opts) {
  const data = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { towns: [] };
  data.towns ||= [];
  let town = data.towns.find((t) => t.id === opts.id);
  if (!town) {
    town = emptyTown(opts);
    data.towns.push(town);
  }
  for (const k of ['name', 'state', 'county', 'type']) if (opts[k]) town[k] = opts[k];
  for (const k of ['lat', 'lng', 'population', 'fiscalYear']) if (opts[k] !== undefined && opts[k] !== true) town[k] = Number(opts[k]);
  const save = () => {
    mkdirSync(dirname(file), { recursive: true });
    town.asOf = new Date().toISOString().slice(0, 10);
    writeFileSync(file, JSON.stringify(data, null, 2));
  };
  return { data, town, save };
}

export function addSource(town, label, url) {
  if (!town.sources.some((s) => s.label === label && s.url === url)) town.sources.push({ label, url });
}

export function usage(text) {
  console.error(text.trim());
  process.exit(1);
}
