#!/usr/bin/env node
// Maps license-plate cameras recorded in OpenStreetMap (the data DeFlock shows) into the
// real town files for states outside New Jersey (scripts/nj/red-flags.mjs does NJ). Run it
// after scripts/red-flags.mjs, which adds the Atlas of Surveillance records. Safe to
// re-run: it replaces what an earlier run added.
//
//   node scripts/cameras.mjs --download --all      # Census boundaries and camera locations
//   node scripts/cameras.mjs --all                 # or --state NY; then scripts/build-summary.mjs
//
// A camera counts for the town or village whose Census boundary contains it (NY villages and
// cities are Census places inside towns; the place wins). Any Flock camera is scored as a
// "Flock camera network" red flag; other brands only when the town is the recorded operator.
// Cameras tagged as run by stores, malls, schools or state and regional agencies are left out.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw');
const OUT = join(ROOT, 'data', 'real');
const MARK = 'scripts/cameras.mjs';
const TIGER = 'https://www2.census.gov/geo/tiger/TIGER2024';
const OSM_PAGE = 'https://deflock.org/';
const DEFLOCK_INDEX = 'https://cdn.deflock.me/regions/index.json';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const TODAY = new Date().toISOString().slice(0, 10);
const STATES = { NY: '36', PA: '42', CT: '09', MA: '25' };

const args = parseArgs();
const picked = args.all ? Object.keys(STATES) : [String(args.state || '').toUpperCase()];
if (!picked.every((s) => STATES[s])) {
  console.error(`Usage: node scripts/cameras.mjs [--download] --state <${Object.keys(STATES).join('|')}> | --all`);
  process.exit(1);
}
const rawDir = (st) => join(RAW, st.toLowerCase());

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

if (args.download) {
  const curl = (...a) => execFileSync('curl', ['-sSfL', '-m', '600', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });
  for (const st of picked) {
    const dir = rawDir(st);
    mkdirSync(dir, { recursive: true });
    for (const layer of ['cousub', 'place']) {
      const zip = join(dir, `tl_2024_${STATES[st]}_${layer}.zip`);
      curl('-o', zip, `${TIGER}/${layer.toUpperCase()}/tl_2024_${STATES[st]}_${layer}.zip`);
      execFileSync('unzip', ['-o', '-q', zip, '-d', dir], { stdio: 'inherit' });
    }
    // Overpass mirrors are often busy; take the first that answers.
    const query = `[out:json][timeout:300];area["ISO3166-2"="US-${st}"]->.a;node(area.a)["surveillance:type"="ALPR"];out tags center;`;
    const ok = OVERPASS.some((url) => {
      try { curl('-G', url, '--data-urlencode', `data=${query}`, '-o', join(dir, 'osm-alpr.json')); return true; } catch { return false; }
    });
    if (!ok) {
      // Fallback: DeFlock publishes the same OpenStreetMap camera nodes as 20-degree tiles.
      // Take every tile that overlaps the state's Census bounding box; cameras outside the
      // state's towns are dropped when they are placed.
      try {
        const shp = readFileSync(join(dir, `tl_2024_${STATES[st]}_cousub.shp`));
        const [x0, y0, x1, y1] = [36, 44, 52, 60].map((o) => shp.readDoubleLE(o));
        const tile = (v) => Math.floor(v / 20) * 20;
        const index = JSON.parse(execFileSync('curl', ['-sSfL', '-m', '120', DEFLOCK_INDEX]).toString());
        const elements = [];
        for (let lat = tile(y0); lat <= tile(y1); lat += 20) {
          for (let lon = tile(x0); lon <= tile(x1); lon += 20) {
            if (!index.regions.includes(`${lat}/${lon}`)) continue;
            const url = index.tile_url.replace('{lat}', lat).replace('{lon}', lon);
            const nodes = JSON.parse(execFileSync('curl', ['-sSfL', '-m', '600', url], { maxBuffer: 1 << 30 }).toString());
            elements.push(...nodes.filter((n) => n.lat >= y0 && n.lat <= y1 && n.lon >= x0 && n.lon <= x1));
          }
        }
        writeFileSync(join(dir, 'osm-alpr.json'), JSON.stringify({ source: 'DeFlock region tiles', osm3s: { timestamp_osm_base: `${TODAY}T00:00:00Z` }, elements }));
        console.log(`${st}: no Overpass mirror answered; took ${elements.length} cameras from DeFlock's copy of OpenStreetMap.`);
      } catch (e) {
        console.warn(`${st}: no Overpass mirror or DeFlock tile answered (${e.message.split('\n')[0]}); cameras will be skipped.`);
      }
    }
    console.log(`${st}: downloaded`);
  }
  process.exit(0);
}

// "Town of Colonie", "Colonie Town" and "Colonie" all become "colonie".
const normName = (s) => String(s).toLowerCase().replace(/[.'’]/g, '').replace(/\b(township|borough|city|town|village|of)\b/g, '')
  .replace(/\bmount\b/g, 'mt').replace(/\bsaint\b/g, 'st').replace(/\s+/g, ' ').trim();
const NOT_TOWN = /home depot|lowe|simon|mall|port authority|panynj|turnpike|parkway|thruway|school|university|college|transit|mbta|state police|county/i;

const { files } = JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8'));
for (const st of picked) {
  const dir = rawDir(st);
  const osmFile = join(dir, 'osm-alpr.json');
  const layers = ['place', 'cousub'].map((l) => join(dir, `tl_2024_${STATES[st]}_${l}`)).filter((p) => existsSync(`${p}.shp`));
  if (!existsSync(osmFile) || !layers.length) { console.warn(`${st}: no camera file or Census boundaries in ${dir}; run with --download.`); continue; }
  const datasets = files.filter((f) => f.startsWith(`${st.toLowerCase()}-`)).map((file) => ({ file, data: JSON.parse(readFileSync(join(OUT, file), 'utf8')) }));
  const towns = datasets.flatMap((d) => d.data.towns);
  for (const t of towns) {
    t.redFlags = (t.redFlags || []).filter((f) => f.addedBy !== MARK);
    t.sources = (t.sources || []).filter((s) => s.addedBy !== MARK);
    t.notes = (t.notes || []).filter((n) => !n.startsWith('Cameras:'));
    delete t.surveillanceMap;
  }
  const byGeoid = new Map(towns.filter((t) => t.censusGeoid).map((t) => [t.censusGeoid, t]));
  const areas = layers.flatMap((p) => {
    const shapes = readShp(readFileSync(`${p}.shp`));
    return readDbf(readFileSync(`${p}.dbf`)).map((r, i) => ({ town: byGeoid.get(r.GEOID), shape: shapes[i] })).filter((a) => a.town && a.shape);
  });
  const osm = JSON.parse(readFileSync(osmFile, 'utf8'));
  const osmDate = osm.osm3s?.timestamp_osm_base?.slice(0, 10) || TODAY;
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
  for (const t of towns) {
    t.redFlags.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    if (!counts.has(t)) t.notes.push(`Cameras: no license-plate cameras are mapped inside ${t.name}'s borders in OpenStreetMap as of ${osmDate}.`);
  }
  for (const d of datasets) writeFileSync(join(OUT, d.file), `${JSON.stringify(d.data, null, 1)}\n`);
  console.log(`${st}: ${total} cameras${osm.source ? ` (${osm.source})` : ''}, ${placed} placed inside towns; ${counts.size} towns with mapped cameras, ${towns.filter((t) => t.redFlags.some((f) => f.addedBy === MARK)).length} with a camera red flag`);
}
