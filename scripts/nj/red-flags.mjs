#!/usr/bin/env node
// Adds red-flag records (surveillance tech, data center deals, corporate
// lobbying) to the NJ town files in data/real/. Safe to re-run: it replaces
// what an earlier run added.
//
//   node scripts/nj/red-flags.mjs --download   # Atlas of Surveillance, OSM cameras, Census boundaries
//   node scripts/nj/red-flags.mjs              # apply to data/real/nj-*.json
//
// Sources:
//   - EFF Atlas of Surveillance: which police departments use plate readers,
//     drones, gunshot detection, face recognition and so on. Scored.
//   - OpenStreetMap license-plate cameras (the data DeFlock maps), placed in
//     towns with Census boundaries. Shown as context; scored only when the
//     camera's recorded operator is the town itself.
//   - scripts/nj/corporate-deals.json: hand-checked data center deals and
//     corporate lobbying, each with its sources. Scored.
// Nothing is estimated. Records rarely carry dollar amounts, so red flags are
// stored as documented programs, not as spending.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';
import { normName } from './ufb-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'nj');
const OUT = join(ROOT, 'data', 'real');
const ATLAS_URL = 'https://atlasofsurveillance.org/download.csv';
const ATLAS_PAGE = 'https://atlasofsurveillance.org/';
const TIGER_URL = 'https://www2.census.gov/geo/tiger/TIGER2024/COUSUB/tl_2024_34_cousub.zip';
const OSM_PAGE = 'https://deflock.org/';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const OVERPASS_QUERY = '[out:json][timeout:100];area["ISO3166-2"="US-NJ"]->.nj;node(area.nj)["surveillance:type"="ALPR"];out tags center;';
const TODAY = new Date().toISOString().slice(0, 10);

const args = parseArgs();

if (args.download) {
  mkdirSync(RAW, { recursive: true });
  const curl = (...a) => execFileSync('curl', ['-sSfL', '-m', '180', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });
  curl('-o', join(RAW, 'atlas.csv'), ATLAS_URL);
  curl('-o', join(RAW, 'cousub.zip'), TIGER_URL);
  execFileSync('unzip', ['-o', '-q', join(RAW, 'cousub.zip'), '-d', RAW], { stdio: 'inherit' });
  // Overpass mirrors are often busy; take the first that answers.
  const ok = OVERPASS.some((url) => {
    try { curl('-G', url, '--data-urlencode', `data=${OVERPASS_QUERY}`, '-o', join(RAW, 'osm-alpr.json')); return true; } catch { return false; }
  });
  if (!ok) console.warn('No Overpass mirror answered; OSM cameras will be skipped.');
  console.log('Downloaded. Now run: node scripts/nj/red-flags.mjs');
  process.exit(0);
}

// ---------- Census municipal boundaries (shapefile, polygons only) ----------
function readDbf(buf) {
  const n = buf.readUInt32LE(4);
  const headerLen = buf.readUInt16LE(8);
  const recLen = buf.readUInt16LE(10);
  const fields = [];
  for (let o = 32; buf[o] !== 0x0d; o += 32) {
    fields.push({ name: buf.toString('latin1', o, o + 11).replace(/\0.*$/, ''), len: buf[o + 16] });
  }
  const rows = [];
  for (let i = 0; i < n; i++) {
    let o = headerLen + i * recLen + 1;
    const row = {};
    for (const f of fields) { row[f.name] = buf.toString('latin1', o, o + f.len).trim(); o += f.len; }
    rows.push(row);
  }
  return rows;
}

function readShp(buf) {
  const shapes = [];
  let o = 100;
  while (o < buf.length) {
    const len = buf.readInt32BE(o + 4) * 2;
    const type = buf.readInt32LE(o + 8);
    if (type === 5) {
      const b = o + 12;
      const box = [buf.readDoubleLE(b), buf.readDoubleLE(b + 8), buf.readDoubleLE(b + 16), buf.readDoubleLE(b + 24)];
      const nParts = buf.readInt32LE(b + 32);
      const nPts = buf.readInt32LE(b + 36);
      const parts = Array.from({ length: nParts }, (_, i) => buf.readInt32LE(b + 40 + i * 4));
      const p0 = b + 40 + nParts * 4;
      const pts = Array.from({ length: nPts }, (_, i) => [buf.readDoubleLE(p0 + i * 16), buf.readDoubleLE(p0 + i * 16 + 8)]);
      shapes.push({ box, rings: parts.map((s, i) => pts.slice(s, parts[i + 1] ?? nPts)) });
    } else shapes.push(null);
    o += 8 + len;
  }
  return shapes;
}

// Even-odd rule across all rings handles holes and multi-part towns.
function contains(shape, x, y) {
  if (!shape || x < shape.box[0] || x > shape.box[2] || y < shape.box[1] || y > shape.box[3]) return false;
  let inside = false;
  for (const ring of shape.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i];
      const [xj, yj] = ring[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

// ---------- CSV (quoted fields, embedded newlines) ----------
function parseCSVRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// ---------- Load towns ----------
const index = JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8'));
const files = index.files.filter((f) => f.startsWith('nj-'));
const datasets = files.map((f) => ({ file: f, data: JSON.parse(readFileSync(join(OUT, f), 'utf8')) }));
const towns = datasets.flatMap((d) => d.data.towns);
const countyOf = (t) => t.county.replace(/ County$/, '');
const report = { atlas: 0, atlasUnmatched: [], cameras: 0, camerasPlaced: 0, deals: 0 };

// Previous runs' additions are cleared first, so re-running never doubles up.
const MARK = 'red-flags.mjs';
for (const t of towns) {
  t.redFlags = [];
  delete t.surveillanceMap;
  t.sources = (t.sources || []).filter((s) => !s.addedBy?.includes(MARK));
  t.notes = (t.notes || []).filter((n) => !n.startsWith('Red flags:'));
}

// ---------- Atlas of Surveillance ----------
// Body-worn cameras are left out: they record police, not the public at large.
const ATLAS_LABELS = {
  'Automated License Plate Readers': 'License-plate readers',
  'Face Recognition': 'Face recognition',
  'Gunshot Detection': 'Gunshot detection (ShotSpotter)',
  Drones: 'Police drones',
  'Camera Registry': 'Private camera registry',
  'Real-Time Crime Center': 'Real-time crime center',
  'Predictive Policing': 'Predictive policing',
  'Video Analytics': 'Video analytics',
  'Third-party Investigative Platforms': 'Third-party investigative platform',
  'Cell-site Simulator': 'Cell-site simulator',
  'Fusion Center': 'Fusion center',
};
const agencyTown = (agency) => agency
  .replace(/[’']/g, '')
  .replace(/\b(police department|police dept\.?|department of police|police division|division of police|department of public safety|public safety department|police)\b/gi, '')
  .replace(/\bboro\b/gi, 'Borough')
  .replace(/\btwp\b/gi, 'Township')
  .replace(/\s+/g, ' ').trim();
const TYPE_RX = /\b(township|borough|city|town|village)\b/i;

// Agency spellings that differ from the state's municipal names.
const ALIASES = { 'bayhead borough|ocean': 'Bay Head Borough', 'neptune city|monmouth': 'Neptune City Borough', 'orange|essex': 'City of Orange Township' };

function matchTown(name, county, city) {
  const alias = ALIASES[`${name.toLowerCase()}|${county.toLowerCase()}`];
  if (alias) name = alias;
  const pool = towns.filter((t) => countyOf(t).toLowerCase() === county.toLowerCase());
  // "Township of Lakewood" -> "Lakewood Township"
  const flipped = name.replace(/^(township|borough|city|town|village) of (.+)$/i, '$2 $1');
  for (const n of [flipped, city].filter(Boolean)) {
    const exact = pool.filter((t) => t.name.toLowerCase() === n.toLowerCase());
    if (exact.length === 1) return exact[0];
    const loose = pool.filter((t) => normName(t.name) === normName(n));
    const type = n.match(TYPE_RX)?.[1]?.toLowerCase();
    const typed = type ? loose.filter((t) => t.name.toLowerCase().endsWith(type)) : loose;
    if (typed.length === 1) return typed[0];
    if (!type && loose.length === 1) return loose[0];
    if (loose.length > 1) return null; // e.g. Franklin Borough vs Franklin Township: don't guess
  }
  return null;
}

const atlasFile = join(RAW, 'atlas.csv');
if (existsSync(atlasFile)) {
  const rows = parseCSVRows(readFileSync(atlasFile, 'utf8'))
    .filter((r) => r.State === 'NJ' && r['Type of Juris'] === 'Municipal' && ATLAS_LABELS[r.Technology]);
  for (const r of rows) {
    const county = r.County.replace(/ County$/, '');
    const town = matchTown(agencyTown(r.Agency), county, r.City);
    if (!town) { report.atlasUnmatched.push(`${r.Agency} (${r.County})`); continue; }
    report.atlas++;
    town.redFlags.push({
      kind: 'surveillance',
      label: ATLAS_LABELS[r.Technology],
      vendor: r.Vendor || '',
      agency: r.Agency,
      date: usDate(r['Link 1 Date']),
      detail: r.Summary,
      source: { label: `EFF Atlas of Surveillance ${r.AOSNUMBER}${r['Link 1 Source'] ? `, citing ${r['Link 1 Source']}` : ''}`, url: r['Link 1'] || ATLAS_PAGE },
    });
  }
}

function usDate(s) {
  const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
}

// ---------- OpenStreetMap license-plate cameras ----------
// Cameras run by stores, malls, the Port Authority, toll roads or schools are not the town's.
const NOT_TOWN = /home depot|lowe|simon|mall|port authority|panynj|turnpike|parkway|school|university|college|nj transit|state police|county/i;
const osmFile = join(RAW, 'osm-alpr.json');
const shpFile = join(RAW, 'tl_2024_34_cousub.shp');
if (existsSync(osmFile) && existsSync(shpFile)) {
  const shapes = readShp(readFileSync(shpFile));
  const dbf = readDbf(readFileSync(join(RAW, 'tl_2024_34_cousub.dbf')));
  const byGeoid = new Map(towns.map((t) => [t.censusGeoid, t]));
  const areas = dbf.map((r, i) => ({ town: byGeoid.get(r.GEOID), shape: shapes[i] })).filter((a) => a.town && a.shape);
  const osm = JSON.parse(readFileSync(osmFile, 'utf8'));
  const osmDate = osm.osm3s?.timestamp_osm_base?.slice(0, 10) || TODAY;
  const counts = new Map();
  for (const e of osm.elements || []) {
    report.cameras++;
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    const hit = areas.find((a) => contains(a.shape, lon, lat));
    if (!hit) continue;
    const op = e.tags?.operator || '';
    if (NOT_TOWN.test(op)) continue;
    report.camerasPlaced++;
    const c = counts.get(hit.town) || { cameras: 0, flock: 0, townOperated: 0 };
    c.cameras++;
    if (/flock/i.test(`${e.tags?.manufacturer || ''} ${e.tags?.brand || ''}`)) c.flock++;
    if (op && normName(op.replace(/police department|police|pd\b|\btwp\b|^(township|borough|city|town) of /gi, ' ')).includes(normName(hit.town.name))) c.townOperated++;
    counts.set(hit.town, c);
  }
  for (const [town, c] of counts) {
    town.surveillanceMap = { ...c, asOf: osmDate, source: { label: 'OpenStreetMap license-plate cameras (as mapped by DeFlock and other contributors)', url: OSM_PAGE } };
    // Scored only when OSM records the town itself as the operator and Atlas doesn't already cover it.
    if (c.townOperated && !town.redFlags.some((f) => f.label === 'License-plate readers')) {
      town.redFlags.push({
        kind: 'surveillance', label: 'License-plate readers', vendor: c.flock ? 'Flock Safety' : '', agency: town.name, date: osmDate,
        detail: `${c.townOperated} license-plate camera${c.townOperated === 1 ? ' is' : 's are'} mapped in OpenStreetMap with ${town.name} recorded as the operator.`,
        source: { label: 'OpenStreetMap license-plate cameras', url: OSM_PAGE },
      });
    }
  }
}

// ---------- Hand-checked corporate deals ----------
const deals = JSON.parse(readFileSync(join(ROOT, 'scripts', 'nj', 'corporate-deals.json'), 'utf8'));
for (const d of deals.deals) {
  const town = towns.find((t) => t.name === d.town && countyOf(t) === d.county);
  if (!town) { console.warn(`corporate-deals.json: no town "${d.town}" in ${d.county}`); continue; }
  report.deals++;
  town.redFlags.push({ kind: d.kind, label: d.label, vendor: d.vendor, date: d.date, detail: d.detail, sources: d.sources });
}

// ---------- Sources, notes, write ----------
for (const t of towns) {
  t.redFlags.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  t.sources.push({ label: 'EFF Atlas of Surveillance (police surveillance technology, searched by department)', url: ATLAS_PAGE, addedBy: MARK });
  if (t.surveillanceMap) t.sources.push({ ...t.surveillanceMap.source, addedBy: MARK });
  if (t.redFlags.some((f) => f.sources)) t.sources.push({ label: 'Data center deals and corporate lobbying: hand-checked news and public records (scripts/nj/corporate-deals.json)', url: '', addedBy: MARK });
  t.notes.push(`Red flags: surveillance programs come from the EFF Atlas of Surveillance, a public database of news reports and public records, searched on ${TODAY}. Data center deals and corporate lobbying come from a hand-checked list of news reports and public records. A town with none listed may still have programs nobody has reported. Most records carry no dollar amount, so each documented program costs a quarter of the red-flag points instead of being counted as spending.`);
  if (t.surveillanceMap) t.notes.push(`Red flags: ${t.surveillanceMap.cameras} license-plate camera${t.surveillanceMap.cameras === 1 ? ' is' : 's are'} mapped inside ${t.name}'s borders in OpenStreetMap (${t.surveillanceMap.flock} made by Flock Safety), not counting cameras tagged as run by stores, malls, schools or state and regional agencies. Many have no operator recorded, so they are shown for context and not scored unless the town is the recorded operator.`);
}
for (const d of datasets) writeFileSync(join(OUT, d.file), JSON.stringify(d.data, null, 1));

const flagged = towns.filter((t) => t.redFlags.length).length;
console.log(`Atlas records matched: ${report.atlas} (${report.atlasUnmatched.length} unmatched)`);
console.log(`OSM cameras: ${report.cameras}, placed in towns: ${report.camerasPlaced}; towns with mapped cameras: ${towns.filter((t) => t.surveillanceMap).length}`);
console.log(`Hand-checked deals applied: ${report.deals}`);
console.log(`Towns with at least one red flag: ${flagged} of ${towns.length}`);
if (args.verbose) console.log('Unmatched Atlas agencies:\n  ' + report.atlasUnmatched.join('\n  '));
