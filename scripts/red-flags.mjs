#!/usr/bin/env node
// Adds red-flag records (surveillance tech, data center deals, corporate
// lobbying) to the real town files in data/real/, one state at a time. Safe to
// re-run: it replaces what an earlier run added.
//
//   node scripts/red-flags.mjs --download --all     # Atlas of Surveillance, OSM cameras, Census boundaries
//   node scripts/red-flags.mjs --all                # or --state NY; then run scripts/build-summary.mjs
//
// Sources:
//   - EFF Atlas of Surveillance: which police departments use plate readers,
//     drones, gunshot detection, face recognition and so on. Scored.
//   - OpenStreetMap license-plate cameras (the data DeFlock maps), placed in
//     towns with Census boundaries. Any Flock camera is scored; other brands
//     only when the camera's recorded operator is the town itself.
//   - scripts/<state>/corporate-deals.json (optional): hand-checked data center
//     deals and corporate lobbying, each with its sources. Scored.
// Nothing is estimated. Records rarely carry dollar amounts, so red flags are
// stored as documented programs, not as spending.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', 'raw');
const OUT = join(ROOT, 'data', 'real');
const ATLAS_URL = 'https://atlasofsurveillance.org/download.csv';
const ATLAS_PAGE = 'https://atlasofsurveillance.org/';
const TIGER = 'https://www2.census.gov/geo/tiger/TIGER2024';
const OSM_PAGE = 'https://deflock.org/';
const DEFLOCK_INDEX = 'https://cdn.deflock.me/regions/index.json';
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const TODAY = new Date().toISOString().slice(0, 10);

// byCounty: Atlas agencies are matched within their county where the state's town
// names repeat across counties; Connecticut and Massachusetts town names are unique
// statewide (and Connecticut's files use planning regions, not counties).
// aliases: Atlas agency spellings that differ from the state's municipal names, keyed "agency|county".
// counties: misspelled Atlas county names.
const STATES = {
  NJ: { fips: '34', byCounty: true, aliases: { 'bayhead borough|ocean': 'Bay Head Borough', 'neptune city|monmouth': 'Neptune City Borough', 'orange|essex': 'City of Orange Township' } },
  NY: { fips: '36', byCounty: true, aliases: {} },
  PA: {
    fips: '42',
    byCounty: true,
    aliases: { 'gettysberg borough|adams': 'Gettysburg Borough', 'west lampter|lancaster': 'West Lampeter Township' },
    counties: { landcaster: 'Lancaster', lawerence: 'Lawrence' },
  },
  CT: { fips: '09', byCounty: false, aliases: {} },
  MA: {
    fips: '25',
    byCounty: false,
    aliases: {
      'eashhampton|hampshire': 'City of Easthampton', 'foxboro|norfolk': 'Town of Foxborough', 'dennis ma|barnstable': 'Town of Dennis',
      'north attleboro|bristol': 'Town of North Attleborough', 'middleboro|plymouth': 'Town of Middleborough',
      'tyngsboro|middlesex': 'Town of Tyngsborough', 'lanesboro|berkshire': 'Town of Lanesborough',
    },
  },
};

const args = parseArgs();
const picked = args.all ? Object.keys(STATES) : [String(args.state || '').toUpperCase()];
if (!picked.every((s) => STATES[s])) {
  console.error(`Usage: node scripts/red-flags.mjs [--download] --state <${Object.keys(STATES).join('|')}> | --all`);
  process.exit(1);
}
const rawDir = (st) => join(RAW, st.toLowerCase());

if (args.download) {
  const curl = (...a) => execFileSync('curl', ['-sSfL', '-m', '600', '-A', 'Mozilla/5.0', ...a], { stdio: 'inherit' });
  mkdirSync(RAW, { recursive: true });
  curl('-o', join(RAW, 'atlas.csv'), ATLAS_URL);
  for (const st of picked) {
    const dir = rawDir(st);
    mkdirSync(dir, { recursive: true });
    for (const layer of ['cousub', 'place']) {
      const zip = join(dir, `tl_2024_${STATES[st].fips}_${layer}.zip`);
      curl('-o', zip, `${TIGER}/${layer.toUpperCase()}/tl_2024_${STATES[st].fips}_${layer}.zip`);
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
        const shp = readFileSync(join(dir, `tl_2024_${STATES[st].fips}_cousub.shp`));
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
        console.warn(`${st}: no Overpass mirror or DeFlock tile answered (${e.message.split('\n')[0]}); OSM cameras will be skipped.`);
      }
    }
    console.log(`${st}: downloaded`);
  }
  console.log('Now run: node scripts/red-flags.mjs ' + (args.all ? '--all' : `--state ${picked[0]}`));
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

// ---------- Matching ----------
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
// "Town of Colonie", "Colonie Town" and "Colonie" all become "colonie";
// "Mount" and "Saint" match the "Mt" and "St" some states file under.
const normName = (s) => String(s).toLowerCase().replace(/[.'’]/g, '').replace(/\b(township|borough|city|town|village|of)\b/g, '')
  .replace(/\bmount\b/g, 'mt').replace(/\bsaint\b/g, 'st').replace(/\s+/g, ' ').trim();
const usDate = (s) => {
  const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
};
const countyOf = (t) => t.county.replace(/ County$/, '');
// Cameras run by stores, malls, schools, or state and regional agencies are not the town's.
const NOT_TOWN = /home depot|lowe|simon|mall|port authority|panynj|turnpike|parkway|thruway|school|university|college|nj transit|mbta|state police|county/i;
const MARK = 'red-flags.mjs';
const STATEWIDE = /\bstatewide contract\b/i;
const atlasRows = existsSync(join(RAW, 'atlas.csv')) ? parseCSVRows(readFileSync(join(RAW, 'atlas.csv'), 'utf8')) : null;
if (!atlasRows) console.warn('data/raw/atlas.csv is missing: run with --download first. Atlas records will be skipped.');

for (const st of picked) {
  const cfg = STATES[st];
  const dir = rawDir(st);
  const index = JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8'));
  const files = index.files.filter((f) => f.startsWith(`${st.toLowerCase()}-`));
  const datasets = files.map((f) => ({ file: f, data: JSON.parse(readFileSync(join(OUT, f), 'utf8')) }));
  const towns = datasets.flatMap((d) => d.data.towns);
  const report = { atlas: 0, atlasUnmatched: [], cameras: 0, camerasPlaced: 0, deals: 0 };

  // Previous runs' additions are cleared first, so re-running never doubles up.
  for (const t of towns) {
    t.redFlags = [];
    delete t.surveillanceMap;
    t.sources = (t.sources || []).filter((s) => !s.addedBy?.includes(MARK));
    t.notes = (t.notes || []).filter((n) => !n.startsWith('Red flags:'));
  }

  const matchTown = (name, county, city) => {
    county = cfg.counties?.[county.toLowerCase()] || county;
    const alias = cfg.aliases[`${name.toLowerCase()}|${county.toLowerCase()}`];
    if (alias) name = alias;
    const pool = cfg.byCounty ? towns.filter((t) => countyOf(t).toLowerCase() === county.toLowerCase()) : towns;
    // "Township of Lakewood" -> "Lakewood Township"
    const flipped = name.replace(/^(township|borough|city|town|village) of (.+)$/i, '$2 $1');
    for (const n of [...new Set([name, flipped, city])].filter(Boolean)) {
      const exact = pool.filter((t) => t.name.toLowerCase() === n.toLowerCase());
      if (exact.length === 1) return exact[0];
      const loose = pool.filter((t) => normName(t.name) === normName(n));
      const type = n.match(TYPE_RX)?.[1]?.toLowerCase();
      const typed = type ? loose.filter((t) => t.type?.toLowerCase() === type || t.name.toLowerCase().endsWith(type)) : loose;
      if (typed.length === 1) return typed[0];
      if (!type && loose.length === 1) return loose[0];
      if (loose.length > 1) return null; // e.g. Franklin Borough vs Franklin Township, Town vs Village of Colonie: don't guess
    }
    return null;
  };

  // ---------- Atlas of Surveillance ----------
  for (const r of (atlasRows || []).filter((x) => x.State === st && x['Type of Juris'] === 'Municipal' && ATLAS_LABELS[x.Technology])) {
    const town = matchTown(agencyTown(r.Agency), r.County.replace(/ County$/, ''), r.City);
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
      // Access every department in the state gets through a state contract is shown but
      // not scored: the town didn't choose it.
      ...(STATEWIDE.test(r.Summary) ? { scored: false, unscoredReason: 'Not scored: every police department in the state has this through a statewide contract, so it is not a local decision.' } : {}),
    });
  }

  // ---------- OpenStreetMap license-plate cameras ----------
  // Towns are county subdivisions; NY villages and cities are Census places inside
  // them, so a camera in a village counts for the village, not the town around it.
  const osmFile = join(dir, 'osm-alpr.json');
  const layers = ['place', 'cousub'].map((l) => join(dir, `tl_2024_${cfg.fips}_${l}`)).filter((p) => existsSync(`${p}.shp`));
  if (existsSync(osmFile) && layers.length) {
    const byGeoid = new Map(towns.map((t) => [t.censusGeoid, t]));
    const areas = layers.flatMap((p) => {
      const shapes = readShp(readFileSync(`${p}.shp`));
      return readDbf(readFileSync(`${p}.dbf`)).map((r, i) => ({ town: byGeoid.get(r.GEOID), shape: shapes[i] })).filter((a) => a.town && a.shape);
    });
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
      if (op && normName(op.replace(/police department|police|pd\b|\btwp\b/gi, ' ')).includes(normName(hit.town.name))) c.townOperated++;
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
          kind: 'surveillance', label: 'License-plate readers', vendor: '', agency: town.name, date: osmDate,
          detail: `${c.townOperated} license-plate camera${c.townOperated === 1 ? ' is' : 's are'} mapped in OpenStreetMap with ${town.name} recorded as the operator.`,
          source: { label: 'OpenStreetMap license-plate cameras', url: OSM_PAGE },
        });
      }
    }
  } else console.warn(`${st}: no OSM camera file or Census boundaries in ${dir}; run with --download.`);

  // ---------- Hand-checked corporate deals ----------
  const dealsFile = join(ROOT, 'scripts', st.toLowerCase(), 'corporate-deals.json');
  for (const d of existsSync(dealsFile) ? JSON.parse(readFileSync(dealsFile, 'utf8')).deals : []) {
    const town = towns.find((t) => t.name === d.town && (!cfg.byCounty || countyOf(t) === d.county));
    if (!town) { console.warn(`${st} corporate-deals.json: no town "${d.town}" in ${d.county}`); continue; }
    report.deals++;
    town.redFlags.push({ kind: d.kind, label: d.label, vendor: d.vendor, date: d.date, detail: d.detail, sources: d.sources });
  }

  // ---------- Sources, notes, write ----------
  for (const t of towns) {
    t.redFlags.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
    t.sources.push({ label: 'EFF Atlas of Surveillance (police surveillance technology, searched by department)', url: ATLAS_PAGE, addedBy: MARK });
    if (t.surveillanceMap) t.sources.push({ ...t.surveillanceMap.source, addedBy: MARK });
    if (t.redFlags.some((f) => f.sources)) t.sources.push({ label: `Data center deals and corporate lobbying: hand-checked news and public records (scripts/${st.toLowerCase()}/corporate-deals.json)`, url: '', addedBy: MARK });
    t.notes.push(`Red flags: surveillance programs come from the EFF Atlas of Surveillance, a public database of news reports and public records, searched on ${TODAY}.${existsSync(dealsFile) ? ' Data center deals and corporate lobbying come from a hand-checked list of news reports and public records.' : ''} A government with none listed may still have programs nobody has reported. Most records carry no dollar amount, so each documented program costs a quarter of the red-flag points instead of being counted as spending.`);
    if (t.surveillanceMap) t.notes.push(`Red flags: ${t.surveillanceMap.cameras} license-plate camera${t.surveillanceMap.cameras === 1 ? ' is' : 's are'} mapped inside ${t.name}'s borders in OpenStreetMap (${t.surveillanceMap.flock} made by Flock Safety), not counting cameras tagged as run by stores, malls, schools or state and regional agencies. Flock cameras count as a red flag whoever runs them. Other brands count only when the government is the recorded operator, since many have no operator recorded.`);
  }
  for (const d of datasets) writeFileSync(join(OUT, d.file), `${JSON.stringify(d.data, null, 1)}\n`);

  console.log(`${st}: Atlas records matched ${report.atlas} (${report.atlasUnmatched.length} unmatched); OSM cameras ${report.cameras}, placed in towns ${report.camerasPlaced}, towns with mapped cameras ${towns.filter((t) => t.surveillanceMap).length}; deals ${report.deals}; towns with at least one scored red flag ${towns.filter((t) => t.redFlags.some((f) => f.scored !== false)).length} of ${towns.length}`);
  if (args.verbose) console.log('  Unmatched Atlas agencies:\n    ' + report.atlasUnmatched.join('\n    '));
}
