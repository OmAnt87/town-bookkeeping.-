#!/usr/bin/env node
// Adds red-flag records (surveillance tech, data center deals, corporate
// lobbying) to one state's town files in data/real/. Safe to re-run: it
// replaces what an earlier run added.
//
//   node scripts/common/red-flags.mjs --state nj --download   # Atlas of Surveillance, OSM cameras, Census boundaries
//   node scripts/common/red-flags.mjs --state nj              # apply to data/real/nj-*.json
//   node scripts/build-summary.mjs                            # then refresh the app's startup summary
//
// Sources:
//   - EFF Atlas of Surveillance: which police departments use plate readers,
//     drones, gunshot detection, face recognition and so on. Scored.
//   - OpenStreetMap license-plate cameras (the data DeFlock maps), placed in
//     towns with Census boundaries. Any Flock camera is scored; other brands
//     only when the camera's recorded operator is the town itself.
//   - scripts/<state>/corporate-deals.json: hand-checked data center deals and
//     corporate lobbying, each with its sources. Scored.
// Nothing is estimated. Records rarely carry dollar amounts, so red flags are
// stored as documented programs, not as spending.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';

// Per-state settings. `layers` are Census TIGER boundary files checked in
// order, so the most specific government wins: a NY camera inside a village
// belongs to the village, not the town around it.
const STATES = {
  nj: {
    name: 'NJ', fips: '34', layers: ['cousub'], bbox: '38.9,-75.6,41.4,-73.9',
    // Agency spellings that differ from the state's municipal names.
    aliases: { 'bayhead borough|ocean': 'Bay Head Borough', 'neptune city|monmouth': 'Neptune City Borough', 'orange|essex': 'City of Orange Township' },
  },
  ny: {
    name: 'NY', fips: '36', layers: ['place', 'cousub'], bbox: '40.47,-79.77,45.02,-71.85',
    // Departments named only for a place that is both a town and a village. Each
    // is the government that runs the department.
    aliases: {
      'colonie|albany': 'Town of Colonie', 'manlius|onondaga': 'Town of Manlius', 'lewiston|niagara': 'Town of Lewiston',
      'saugerties|ulster': 'Town of Saugerties', 'scarsdale|westchester': 'Village of Scarsdale', 'hempstead|nassau': 'Village of Hempstead',
      'amhearst|erie': 'Town of Amherst', 'southhampton town|suffolk': 'Town of Southampton',
    },
    // Atlas county misspellings.
    counties: { onandaga: 'Onondaga', wester: 'Westchester' },
    // A department named only for a place that is a city and a town ("Albany
    // Police Department") is the city's, except where the town has its own police.
    preferCity: true,
    townsWithPolice: ['tonawanda', 'newburgh', 'poughkeepsie', 'lockport'],
  },
};

const args = parseArgs();
const ST = STATES[String(args.state || '').toLowerCase()];
if (!ST) {
  console.error(`Usage: node scripts/common/red-flags.mjs --state <${Object.keys(STATES).join('|')}> [--download] [--verbose]`);
  process.exit(1);
}
const st = ST.name.toLowerCase();

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', st);
const OUT = join(ROOT, 'data', 'real');
const DEALS_FILE = `scripts/${st}/corporate-deals.json`;
const ATLAS_URL = 'https://atlasofsurveillance.org/download.csv';
const ATLAS_PAGE = 'https://atlasofsurveillance.org/';
const tigerFile = (layer) => `tl_2024_${ST.fips}_${layer}`;
const TIGER_URL = (layer) => `https://www2.census.gov/geo/tiger/TIGER2024/${layer.toUpperCase()}/${tigerFile(layer)}.zip`;
const OSM_PAGE = 'https://deflock.org/';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
// The state-area query is exact but heavy; the bounding box is lighter, and
// cameras outside the state drop out when they are placed in towns.
const OVERPASS_QUERIES = [
  `[out:json][timeout:170];area["ISO3166-2"="US-${ST.name}"]->.s;node(area.s)["surveillance:type"="ALPR"];out tags center;`,
  `[out:json][timeout:170];node["surveillance:type"="ALPR"](${ST.bbox});out tags center;`,
];
const TODAY = new Date().toISOString().slice(0, 10);

if (args.download) {
  mkdirSync(RAW, { recursive: true });
  const curl = (...a) => execFileSync('curl', ['-sSfL', '-m', '240', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });
  curl('-o', join(RAW, 'atlas.csv'), ATLAS_URL);
  for (const layer of ST.layers) {
    curl('-o', join(RAW, `${layer}.zip`), TIGER_URL(layer));
    execFileSync('unzip', ['-o', '-q', join(RAW, `${layer}.zip`), '-d', RAW], { stdio: 'inherit' });
  }
  // Overpass mirrors are often busy; take the first that answers.
  const ok = OVERPASS_QUERIES.some((q) => OVERPASS.some((url) => {
    try { curl('-G', url, '--data-urlencode', `data=${q}`, '-o', join(RAW, 'osm-alpr.json')); return true; } catch { return false; }
  }));
  if (!ok) console.warn('No Overpass mirror answered; OSM cameras will be skipped.');
  console.log(`Downloaded. Now run: node scripts/common/red-flags.mjs --state ${st}`);
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
const files = index.files.filter((f) => f.startsWith(`${st}-`));
// Each file is written back in its own format (NY's builder ends files with a newline, NJ's doesn't).
const datasets = files.map((f) => { const text = readFileSync(join(OUT, f), 'utf8'); return { file: f, data: JSON.parse(text), eol: text.endsWith('\n') ? '\n' : '' }; });
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
const TYPE_WORDS = /\b(township|borough|city|town|village)\b/g;
// "Town of Hamburg", "Hamburg Town", "hamburg" -> "hamburg"
const baseName = (s) => String(s).toLowerCase().replace(/[.'’]/g, '').replace(TYPE_WORDS, '').replace(/\bof\b/g, '').replace(/\s+/g, ' ').trim();
// A town's own type. NJ names end in it ("Bay Head Borough"), NY names start with it ("Village of Menands").
const typeOf = (t) => (t.type || t.name.match(TYPE_RX)?.[1] || '').toLowerCase();

function matchTown(name, county, city, summary = '') {
  county = ST.counties?.[county.toLowerCase()] || county;
  const alias = ST.aliases[`${name.toLowerCase()}|${county.toLowerCase()}`];
  if (alias) name = alias;
  // An untyped department ("Poughkeepsie Police Department") whose record says
  // "the Town of Poughkeepsie Police Department" takes that type.
  if (!TYPE_RX.test(name)) {
    const said = summary.match(new RegExp(`\\b(township|borough|city|town|village) of ${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i'));
    if (said) name = `${said[1]} of ${name}`;
  }
  const pool = towns.filter((t) => countyOf(t).toLowerCase() === county.toLowerCase());
  for (const n of [name, city].filter(Boolean)) {
    const exact = pool.filter((t) => t.name.toLowerCase() === n.toLowerCase());
    if (exact.length === 1) return exact[0];
    const loose = pool.filter((t) => baseName(t.name) === baseName(n));
    const type = n.match(TYPE_RX)?.[1]?.toLowerCase();
    const typed = type ? loose.filter((t) => typeOf(t) === type) : loose;
    if (typed.length === 1) return typed[0];
    // A department named only for a place ("Albany Police Department") that is both a
    // city and something else is the city's: towns and villages sharing a name are not guessed.
    if (!type && loose.length > 1) {
      const cities = loose.filter((t) => typeOf(t) === 'city');
      const othersPoliced = loose.some((t) => typeOf(t) !== 'city' && (typeOf(t) === 'village' || ST.townsWithPolice?.includes(baseName(t.name))));
      return ST.preferCity && cities.length === 1 && !othersPoliced ? cities[0] : null;
    }
    if (loose.length > 1) return null; // e.g. Franklin Borough vs Franklin Township: don't guess
  }
  return null;
}

const atlasFile = join(RAW, 'atlas.csv');
if (existsSync(atlasFile)) {
  const rows = parseCSVRows(readFileSync(atlasFile, 'utf8'))
    .filter((r) => r.State === ST.name && r['Type of Juris'] === 'Municipal' && ATLAS_LABELS[r.Technology]);
  for (const r of rows) {
    const county = r.County.replace(/ County$/, '');
    const town = matchTown(agencyTown(r.Agency), county, r.City, r.Summary);
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
const NOT_TOWN = /home depot|lowe|simon|mall|port authority|panynj|turnpike|thruway|parkway|\bmta\b|transit|dot\b|school|university|college|state police|county/i;
const osmFile = join(RAW, 'osm-alpr.json');
if (existsSync(osmFile) && ST.layers.every((l) => existsSync(join(RAW, `${tigerFile(l)}.shp`)))) {
  const byGeoid = new Map(towns.map((t) => [t.censusGeoid, t]));
  const areas = ST.layers.flatMap((l) => {
    const shapes = readShp(readFileSync(join(RAW, `${tigerFile(l)}.shp`)));
    return readDbf(readFileSync(join(RAW, `${tigerFile(l)}.dbf`))).map((r, i) => ({ town: byGeoid.get(r.GEOID), shape: shapes[i] }));
  }).filter((a) => a.town && a.shape);
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
    if (op && baseName(op.replace(/police department|police|pd\b|\btwp\b/gi, ' ')) === baseName(hit.town.name)) c.townOperated++;
    counts.set(hit.town, c);
  }
  for (const [town, c] of counts) {
    town.surveillanceMap = { ...c, asOf: osmDate, source: { label: 'OpenStreetMap license-plate cameras (as mapped by DeFlock and other contributors)', url: OSM_PAGE } };
    // Flock cameras are scored as their own flag even when no operator is recorded:
    // Flock pools plate scans into a network shared with agencies nationwide.
    if (c.flock) {
      town.redFlags.push({
        kind: 'surveillance', label: 'Flock camera network', vendor: 'Flock Safety', agency: '', date: osmDate,
        detail: `${c.flock} Flock Safety license-plate camera${c.flock === 1 ? ' is' : 's are'} mapped inside ${town.name}'s borders in OpenStreetMap. Flock cameras photograph every passing car and feed a search network shared with police agencies across the country. Who runs each camera is ${c.townOperated ? 'recorded for some' : 'not recorded'}; cameras tagged as run by stores, malls, schools or state and regional agencies are not counted.`,
        source: { label: 'OpenStreetMap license-plate cameras (as mapped by DeFlock)', url: OSM_PAGE },
      });
    }
    // Other brands are scored only when OSM records the town itself as the operator and Atlas doesn't already cover it.
    if (!c.flock && c.townOperated && !town.redFlags.some((f) => f.label === 'License-plate readers')) {
      town.redFlags.push({
        kind: 'surveillance', label: 'License-plate readers', vendor: c.flock ? 'Flock Safety' : '', agency: town.name, date: osmDate,
        detail: `${c.townOperated} license-plate camera${c.townOperated === 1 ? ' is' : 's are'} mapped in OpenStreetMap with ${town.name} recorded as the operator.`,
        source: { label: 'OpenStreetMap license-plate cameras', url: OSM_PAGE },
      });
    }
  }
}

// ---------- Hand-checked corporate deals ----------
const deals = existsSync(join(ROOT, DEALS_FILE)) ? JSON.parse(readFileSync(join(ROOT, DEALS_FILE), 'utf8')).deals : [];
for (const d of deals) {
  const town = towns.find((t) => t.name === d.town && countyOf(t) === d.county);
  if (!town) { console.warn(`${DEALS_FILE}: no town "${d.town}" in ${d.county}`); continue; }
  report.deals++;
  town.redFlags.push({ kind: d.kind, label: d.label, vendor: d.vendor, date: d.date, detail: d.detail, sources: d.sources });
}

// ---------- Sources, notes, write ----------
for (const t of towns) {
  t.redFlags.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  t.sources.push({ label: 'EFF Atlas of Surveillance (police surveillance technology, searched by department)', url: ATLAS_PAGE, addedBy: MARK });
  if (t.surveillanceMap) t.sources.push({ ...t.surveillanceMap.source, addedBy: MARK });
  if (t.redFlags.some((f) => f.sources)) t.sources.push({ label: `Data center deals and corporate lobbying: hand-checked news and public records (${DEALS_FILE})`, url: '', addedBy: MARK });
  t.notes.push(`Red flags: surveillance programs come from the EFF Atlas of Surveillance, a public database of news reports and public records, searched on ${TODAY}. Data center deals and corporate lobbying come from a hand-checked list of news reports and public records. A town with none listed may still have programs nobody has reported. Most records carry no dollar amount, so each documented program takes 2.5 points off the score (up to 10) instead of being counted as spending. Finding nothing earns no credit.`);
  if (t.surveillanceMap) t.notes.push(`Red flags: ${t.surveillanceMap.cameras} license-plate camera${t.surveillanceMap.cameras === 1 ? ' is' : 's are'} mapped inside ${t.name}'s borders in OpenStreetMap (${t.surveillanceMap.flock} made by Flock Safety), not counting cameras tagged as run by stores, malls, schools or state and regional agencies. Flock cameras count as a red flag whoever runs them. Other brands count only when the town is the recorded operator, since many have no operator recorded.`);
}
for (const d of datasets) writeFileSync(join(OUT, d.file), JSON.stringify(d.data, null, 1) + d.eol);

const flagged = towns.filter((t) => t.redFlags.length).length;
console.log(`Atlas records matched: ${report.atlas} (${report.atlasUnmatched.length} unmatched)`);
console.log(`OSM cameras: ${report.cameras}, placed in towns: ${report.camerasPlaced}; towns with mapped cameras: ${towns.filter((t) => t.surveillanceMap).length}`);
console.log(`Hand-checked deals applied: ${report.deals}`);
console.log(`Towns with at least one red flag: ${flagged} of ${towns.length}`);
if (args.verbose) console.log('Unmatched Atlas agencies:\n  ' + report.atlasUnmatched.join('\n  '));
