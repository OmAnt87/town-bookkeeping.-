#!/usr/bin/env node
// Maps license-plate cameras recorded in OpenStreetMap (the data DeFlock shows) into the
// real town files for every state except New Jersey (scripts/nj/red-flags.mjs does NJ).
// Safe to re-run: it replaces what an earlier run added. Run scripts/red-flags.mjs after it
// so the Atlas note knows cameras were checked, then scripts/build-summary.mjs.
//
//   node scripts/cameras.mjs --all            # or --state GA,TX
//   node scripts/cameras.mjs --all --refresh  # fetch DeFlock's camera tiles again
//
// Camera locations come from DeFlock's published tiles of OpenStreetMap's license-plate
// camera nodes (cached in data/raw/cameras/). Each state's Census 2024 place and county
// subdivision boundaries are downloaded, used and deleted (--keep keeps them).
// A camera counts for the city, town or village whose Census boundary contains it; a Census
// place (a city or village) wins over the county subdivision (a town or township) around it.
// County records are not placed: their areas overlap their towns. Any Flock camera is scored
// as a "Flock camera network" red flag; other brands only when the town is the recorded
// operator. Cameras tagged as run by stores, malls, schools or state and regional agencies
// are left out.

import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw', 'cameras');
const OUT = join(ROOT, 'data', 'real');
const MARK = 'scripts/cameras.mjs';
const TIGER = 'https://www2.census.gov/geo/tiger/TIGER2024';
const OSM_PAGE = 'https://deflock.org/';
const DEFLOCK_INDEX = 'https://cdn.deflock.me/regions/index.json';
const TODAY = new Date().toISOString().slice(0, 10);

const args = parseArgs();
const { files } = JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8'));
const loaded = [...new Set(files.map((f) => f.slice(0, 2).toUpperCase()))].filter((s) => s !== 'NJ').sort();
const picked = args.all ? loaded : String(args.state || '').toUpperCase().split(',').filter(Boolean);
if (!picked.length || !picked.every((s) => loaded.includes(s))) {
  console.error(`Usage: node scripts/cameras.mjs --all | --state <${loaded.join('|')}>[,..] [--refresh] [--keep]`);
  process.exit(1);
}
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '--retry-all-errors', '-m', '900', '-A', 'Mozilla/5.0', ...a], { maxBuffer: 1 << 30 });

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

// ---------- Camera locations: DeFlock's tiles, cached once for every state ----------
mkdirSync(RAW, { recursive: true });
const indexFile = join(RAW, 'deflock-index.json');
if (args.refresh || !existsSync(indexFile)) writeFileSync(indexFile, curl(DEFLOCK_INDEX));
const deflock = JSON.parse(readFileSync(indexFile, 'utf8'));
const tileDate = (existsSync(join(RAW, 'fetched.txt')) && !args.refresh ? readFileSync(join(RAW, 'fetched.txt'), 'utf8').trim() : TODAY);
function tile(lat, lon) {
  const file = join(RAW, `deflock_${lat}_${lon}.json`);
  if (args.refresh || !existsSync(file)) {
    curl('-o', file, deflock.tile_url.replace('{lat}', lat).replace('{lon}', lon));
    writeFileSync(join(RAW, 'fetched.txt'), TODAY);
  }
  return JSON.parse(readFileSync(file, 'utf8'));
}
const tileCache = new Map();
function camerasIn([x0, y0, x1, y1]) {
  const t = (v) => Math.floor(v / 20) * 20;
  const out = [];
  for (let lat = t(y0); lat <= t(y1); lat += 20) {
    for (let lon = t(x0); lon <= t(x1); lon += 20) {
      if (!deflock.regions.includes(`${lat}/${lon}`)) continue;
      const key = `${lat}/${lon}`;
      if (!tileCache.has(key)) tileCache.set(key, tile(lat, lon));
      out.push(...tileCache.get(key).filter((n) => n.lat >= y0 && n.lat <= y1 && n.lon >= x0 && n.lon <= x1));
    }
  }
  return out;
}

// ---------- Census boundaries: per state, downloaded when needed ----------
function boundaries(fips) {
  const dir = join(RAW, `tiger_${fips}`);
  mkdirSync(dir, { recursive: true });
  return ['place', 'cousub'].map((layer) => {
    const base = join(dir, `tl_2024_${fips}_${layer}`);
    if (!existsSync(`${base}.shp`)) {
      curl('-o', `${base}.zip`, `${TIGER}/${layer.toUpperCase()}/tl_2024_${fips}_${layer}.zip`);
      execFileSync('unzip', ['-o', '-q', `${base}.zip`, '-d', dir]);
      rmSync(`${base}.zip`);
    }
    return base;
  });
}

// The national county layer, for city-counties and independent cities (and Hawaii's counties).
function countyLayer() {
  const base = join(RAW, 'tl_2024_us_county');
  if (!existsSync(`${base}.shp`)) {
    curl('-o', `${base}.zip`, `${TIGER}/COUNTY/tl_2024_us_county.zip`);
    execFileSync('unzip', ['-o', '-q', `${base}.zip`, '-d', RAW]);
    rmSync(`${base}.zip`);
  }
  return base;
}

// "Town of Colonie", "Colonie Town" and "Colonie" all become "colonie".
const normName = (s) => String(s).toLowerCase().replace(/[.'’]/g, '').replace(/\b(township|borough|city|town|village|of)\b/g, '')
  .replace(/\bmount\b/g, 'mt').replace(/\bsaint\b/g, 'st').replace(/\s+/g, ' ').trim();
const NOT_TOWN = /home depot|lowe|simon|mall|port authority|panynj|turnpike|parkway|thruway|school|university|college|transit|mbta|state police|county/i;

for (const st of picked) {
  const datasets = files.filter((f) => f.startsWith(`${st.toLowerCase()}-`)).map((file) => ({ file, data: JSON.parse(readFileSync(join(OUT, file), 'utf8')) }));
  const towns = datasets.flatMap((d) => d.data.towns);
  for (const t of towns) {
    t.redFlags = (t.redFlags || []).filter((f) => f.addedBy !== MARK);
    t.sources = (t.sources || []).filter((s) => s.addedBy !== MARK);
    t.notes = (t.notes || []).filter((n) => !n.startsWith('Cameras:'));
    delete t.surveillanceMap;
  }
  // Cities, towns and villages; plus county-level governments that are cities (independent cities,
  // city-counties, unified governments), and counties where a state has no municipalities (Hawaii).
  // Ordinary counties overlap the towns inside them, so they are not placed.
  const local = towns.filter((t) => t.censusGeoid?.length > 5);
  const placeable = [...local, ...towns.filter((t) => t.censusGeoid?.length === 5 && (t.type !== 'County' || !local.length))];
  if (!placeable.length) { console.warn(`${st}: no towns with Census ids`); continue; }
  const fips = placeable[0].censusGeoid.slice(0, 2);
  const layers = [...(local.length ? boundaries(fips) : []), ...(placeable.length > local.length ? [countyLayer()] : [])];
  const byGeoid = new Map(placeable.map((t) => [t.censusGeoid, t]));
  const areas = layers.flatMap((p) => {
    const shapes = readShp(readFileSync(`${p}.shp`));
    return readDbf(readFileSync(`${p}.dbf`)).map((r, i) => ({ town: byGeoid.get(r.GEOID), shape: shapes[i] })).filter((a) => a.town && a.shape);
  });
  const bbox = areas.map((a) => a.shape.box).reduce((a, b) => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])]);
  const osm = { elements: camerasIn(bbox) };
  const osmDate = tileDate;
  const counts = new Map();
  let total = 0;
  let placed = 0;
  for (const e of osm.elements || []) {
    total++;
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    const hit = areas.find((a) => contains(a.shape, lon, lat));
    if (!hit) continue;
    const op = e.tags?.operator || '';
    if (NOT_TOWN.test(op)) continue;
    placed++;
    const c = counts.get(hit.town) || { cameras: 0, flock: 0, townOperated: 0 };
    c.cameras++;
    if (/flock/i.test(`${e.tags?.manufacturer || ''} ${e.tags?.brand || ''}`)) c.flock++;
    if (op && normName(op.replace(/police department|police|pd\b|\btwp\b/gi, ' ')).includes(normName(hit.town.name))) c.townOperated++;
    counts.set(hit.town, c);
  }
  const source = { label: 'OpenStreetMap license-plate cameras (as mapped by DeFlock and other contributors)', url: OSM_PAGE };
  for (const [town, c] of counts) {
    town.surveillanceMap = { ...c, asOf: osmDate, source };
    town.sources.push({ ...source, addedBy: MARK });
    // Flock cameras are scored as their own flag even when no operator is recorded:
    // Flock pools plate scans into a network shared with agencies nationwide.
    if (c.flock) {
      town.redFlags.push({
        kind: 'surveillance', label: 'Flock camera network', vendor: 'Flock Safety', agency: '', date: osmDate,
        detail: `${c.flock} Flock Safety license-plate camera${c.flock === 1 ? ' is' : 's are'} mapped inside ${town.name}'s borders in OpenStreetMap. Flock cameras photograph every passing car and feed a search network shared with police agencies across the country. Who runs each camera is ${c.townOperated ? 'recorded for some' : 'not recorded'}; cameras tagged as run by stores, malls, schools or state and regional agencies are not counted.`,
        source: { label: 'OpenStreetMap license-plate cameras (as mapped by DeFlock)', url: OSM_PAGE },
        addedBy: MARK,
      });
    }
    // Other brands count only when OSM records the town itself as the operator and the Atlas doesn't already cover it.
    if (!c.flock && c.townOperated && !town.redFlags.some((f) => f.label === 'License-plate readers')) {
      town.redFlags.push({
        kind: 'surveillance', label: 'License-plate readers', vendor: '', agency: town.name, date: osmDate,
        detail: `${c.townOperated} license-plate camera${c.townOperated === 1 ? ' is' : 's are'} mapped in OpenStreetMap with ${town.name} recorded as the operator.`,
        source: { label: 'OpenStreetMap license-plate cameras', url: OSM_PAGE },
        addedBy: MARK,
      });
    }
    town.notes.push(`Cameras: ${c.cameras} license-plate camera${c.cameras === 1 ? ' is' : 's are'} mapped inside ${town.name}'s borders in OpenStreetMap (${c.flock} made by Flock Safety), not counting cameras tagged as run by stores, malls, schools or state and regional agencies. Flock cameras count as a red flag whoever runs them. Other brands count only when the government is the recorded operator, since many have no operator recorded.`);
  }
  for (const t of placeable) {
    t.redFlags.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (!counts.has(t)) t.notes.push(`Cameras: no license-plate cameras are mapped inside ${t.name}'s borders in OpenStreetMap as of ${osmDate}.`);
  }
  for (const d of datasets) writeFileSync(join(OUT, d.file), `${JSON.stringify(d.data, null, 1)}\n`);
  if (!args.keep) rmSync(join(RAW, `tiger_${fips}`), { recursive: true, force: true });
  console.log(`${st}: ${total} cameras in the state's bounding box, ${placed} placed inside towns; ${counts.size} towns with mapped cameras, ${towns.filter((t) => t.redFlags.some((f) => f.addedBy === MARK)).length} with a camera red flag`);
}
