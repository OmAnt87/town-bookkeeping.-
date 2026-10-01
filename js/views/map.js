import { MAP_METRICS } from '../engine/scoring.js';
import { money, number, escapeHTML } from '../engine/format.js';
import { gradeBadge, verifiedPill, isVerified, ICONS, cssVar } from '../charts.js';
import { isDark } from '../app.js';

// Diverging scale (poor = red, middle = gray, good = blue) and a one-hue
// sequential scale for metrics that are neither good nor bad.
const DIVERGING = ['#d03b3b', '#e98a7f', '#b9b8b0', '#6da7ec', '#1c5cab'];
const SEQUENTIAL = ['#cde2fb', '#86b6ef', '#3987e5', '#1c5cab', '#0d366b'];

function lerpColor(stops, t) {
  const c = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(stops.length - 2, Math.floor(c));
  const f = c - i;
  const a = stops[i].match(/\w\w/g).map((h) => parseInt(h, 16));
  const b = stops[i + 1].match(/\w\w/g).map((h) => parseInt(h, 16));
  return `#${a.map((v, k) => Math.round(v + (b[k] - v) * f).toString(16).padStart(2, '0')).join('')}`;
}

function quantile(sorted, q) {
  if (!sorted.length) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (pos - lo);
}

const TILE_URL = (dark) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${dark ? 'World_Dark_Gray_Base' : 'World_Light_Gray_Base'}/MapServer/tile/{z}/{y}/{x}`;

const HEAT_GRADIENT = { 0.2: '#cde2fb', 0.45: '#6da7ec', 0.7: '#2a78d6', 1: '#0d366b' };
const US_BOUNDS = [[25.5, -123.5], [48.5, -68]];

// State outlines sit underneath the tile layer, so the map stays readable
// when tiles can't load (offline, blocked hosts).
let statesGeo = null;
async function loadStates() {
  if (!statesGeo) {
    const res = await fetch('data/us-states.json');
    if (!res.ok) throw new Error(`us-states.json ${res.status}`);
    statesGeo = await res.json();
  }
  return statesGeo;
}

// County and state lines are drawn above the tiles (which would otherwise hide them).
const borderCache = {};
function loadBorders(name) {
  borderCache[name] ||= fetch(`data/us-${name}-borders.json`).then((r) => {
    if (!r.ok) throw new Error(`${name} borders ${r.status}`);
    return r.json();
  });
  return borderCache[name];
}
const STATE_ABBR = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE',
  Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY',
  Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO',
  Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
  'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI',
  'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA',
  Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY',
};
// Below this zoom, state labels switch from full names to postal codes so they don't collide.
const FULL_NAME_ZOOM = 6;

// Crowded Northeast/Mid-Atlantic states get hand-placed labels (often just offshore) so names don't collide.
const LABEL_OVERRIDES = {
  'Rhode Island': [41.2, -70.6],
  'Connecticut': [41.45, -72.75],
  'Massachusetts': [42.35, -72.1],
  'New Hampshire': [43.95, -71.55],
  'Vermont': [44.1, -72.75],
  'New Jersey': [40.2, -74.1],
  'Delaware': [38.55, -74.7],
  'Maryland': [39.35, -77.4],
};

// Label point for each state: centroid of its largest polygon's outer ring.
function stateLabelPoints(geo) {
  return geo.features.filter((f) => f.properties.name !== 'District of Columbia').map((f) => {
    const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
    let best = null;
    let bestArea = -1;
    for (const poly of polys) {
      const ring = poly[0];
      let a = 0, cx = 0, cy = 0;
      for (let i = 0; i < ring.length - 1; i++) {
        const [x0, y0] = ring[i];
        const [x1, y1] = ring[i + 1];
        const k = x0 * y1 - x1 * y0;
        a += k; cx += (x0 + x1) * k; cy += (y0 + y1) * k;
      }
      if (Math.abs(a) > bestArea) { bestArea = Math.abs(a); best = [cy / (3 * a), cx / (3 * a)]; }
    }
    return { name: f.properties.name, latlng: LABEL_OVERRIDES[f.properties.name] || best };
  });
}
const countyLineStyle = () => ({ color: isDark() ? '#8a8a82' : '#8d8c82', weight: 0.8, opacity: 0.55 });
const stateLineStyle = () => ({ color: isDark() ? '#d8d8d0' : '#3d3d38', weight: 2, opacity: 0.9 });
const stateStyle = () => ({ color: cssVar('--baseline'), weight: 1, fillColor: cssVar('--surface'), fillOpacity: 1 });

const ui = { metric: 'score', layer: 'towns', state: 'all', query: '', realOnly: null };

export function renderMap(root, state) {
  // Show only real towns by default once any are loaded; the checkbox shows demo towns too.
  if (ui.realOnly === null) ui.realOnly = state.towns.some((t) => isVerified(t.town));
  const states = [...new Set(state.towns.map((t) => t.town.state))].sort();
  root.innerHTML = `
  <div class="map-layout">
    <aside class="map-side">
      <div>
        <h1>Where town money reaches people</h1>
        <p class="intro">Each dot is a town. Color shows how well it turns tax and other revenue into services residents actually use. Pick a town for its full ledger and report card.</p>
      </div>
      <div class="field">
        <label for="m-search">Find a town</label>
        <input id="m-search" class="input" type="search" placeholder="Town, county or state" value="${escapeHTML(ui.query)}">
      </div>
      <div class="grid grid-2" style="gap:10px">
        <div class="field">
          <label for="m-state">State</label>
          <select id="m-state" class="select"><option value="all">All states</option>${states
            .map((s) => `<option ${ui.state === s ? 'selected' : ''}>${s}</option>`)
            .join('')}</select>
        </div>
        <div class="field">
          <span class="label" id="m-layer-l">Show as</span>
          <div class="segmented" role="group" aria-labelledby="m-layer-l">
            <button type="button" data-layer="towns">Dots</button>
            <button type="button" data-layer="heat">Heat</button>
          </div>
        </div>
      </div>
      ${state.towns.some((t) => isVerified(t.town)) ? `<label class="check"><input type="checkbox" id="m-real" ${ui.realOnly ? 'checked' : ''}> Only towns with verified data</label>` : ''}
      <div class="field">
        <label for="m-metric">Color towns by</label>
        <select id="m-metric" class="select">${MAP_METRICS.map(
          (m) => `<option value="${m.key}" ${m.key === ui.metric ? 'selected' : ''}>${m.label}</option>`,
        ).join('')}</select>
      </div>
      <div class="legend" id="m-legend"></div>
      <div>
        <div class="eyebrow" id="m-count" style="margin-bottom:6px"></div>
        <ul class="town-list" id="m-list"></ul>
      </div>
    </aside>
    <div class="map-wrap">
      <div id="map" role="region" aria-label="Map of towns"></div>
      <div class="card map-card" id="m-card" hidden></div>
    </div>
  </div>`;

  if (!window.L) {
    root.querySelector('#map').innerHTML = '<div class="empty">The map library could not load. Check your connection; the list and reports still work.</div>';
  }
  const L = window.L;
  let map;
  let tiles;
  let dotLayer;
  let heatLayer;
  let statesLayer;
  let countyLines;
  let stateLines;
  const markers = new Map();
  const LIST_PAGE = 100;
  let listLimit = LIST_PAGE;
  if (L) {
    map = L.map('map', { zoomControl: true, minZoom: 2, zoomSnap: 0.25, worldCopyJump: true, preferCanvas: true });
    map.fitBounds(US_BOUNDS);
    tiles = L.tileLayer(TILE_URL(isDark()), {
      attribution: 'Tiles &copy; Esri &mdash; Esri, HERE, Garmin, OpenStreetMap contributors',
      maxNativeZoom: 16,
      maxZoom: 18,
    }).addTo(map);
    map.createPane('states').style.zIndex = 150;
    loadStates()
      .then((geo) => { if (map) statesLayer = L.geoJSON(geo, { pane: 'states', interactive: false, style: stateStyle }).addTo(map); })
      .catch(() => { /* outlines are optional */ });
    map.createPane('borders').style.zIndex = 640;
    map.getPane('borders').style.pointerEvents = 'none';
    map.createPane('labels').style.zIndex = 650;
    map.getPane('labels').style.pointerEvents = 'none';
    const addBorders = (name, style) => loadBorders(name)
      .then((geo) => (map ? L.geoJSON(geo, { pane: 'borders', interactive: false, style }).addTo(map) : null))
      .catch(() => null);
    addBorders('county', countyLineStyle).then((l) => { countyLines = l; });
    addBorders('state', stateLineStyle).then((l) => { stateLines = l; });
    loadStates()
      .then((geo) => {
        if (!map) return;
        const group = L.layerGroup().addTo(map);
        for (const { name, latlng } of stateLabelPoints(geo)) {
          L.marker(latlng, { pane: 'labels', interactive: false, keyboard: false, icon: L.divIcon({ className: 'state-label', html: `<span><b class="full">${escapeHTML(name)}</b><b class="abbr">${STATE_ABBR[name] || ''}</b></span>`, iconSize: [0, 0] }) }).addTo(group);
        }
      })
      .catch(() => { /* labels are optional */ });
    const syncLabels = () => map.getContainer().classList.toggle('labels-short', map.getZoom() < FULL_NAME_ZOOM);
    map.on('zoomend', syncLabels);
    syncLabels();
    dotLayer = L.layerGroup().addTo(map);
  }

  const $ = (sel) => root.querySelector(sel);
  const metric = () => MAP_METRICS.find((m) => m.key === ui.metric);

  function visible() {
    const q = ui.query.trim().toLowerCase();
    return state.towns.filter(
      ({ town }) =>
        (ui.state === 'all' || town.state === ui.state) &&
        (!ui.realOnly || isVerified(town)) &&
        (!q || `${town.name} ${town.county} ${town.state} ${town.stateName || ''}`.toLowerCase().includes(q)),
    );
  }

  function colorScale() {
    const m = metric();
    const vals = state.towns.map((t) => m.value(t.s)).sort((a, b) => a - b);
    const lo = m.key === 'score' ? 20 : quantile(vals, 0.05);
    const hi = m.key === 'score' ? 95 : quantile(vals, 0.95);
    const norm = (v) => (v - lo) / (hi - lo || 1);
    if (m.higherIsBetter === null) return { lo, hi, stops: SEQUENTIAL, color: (v) => lerpColor(SEQUENTIAL, norm(v)), good: (v) => norm(v) };
    const good = (v) => (m.higherIsBetter ? norm(v) : 1 - norm(v));
    const stops = m.higherIsBetter ? DIVERGING : [...DIVERGING].reverse();
    return { lo, hi, stops, color: (v) => lerpColor(DIVERGING, good(v)), good };
  }

  function drawLegend(scale) {
    const m = metric();
    const label = m.higherIsBetter === null ? ['Lower', 'Higher'] : m.higherIsBetter ? ['Worse', 'Better'] : ['Better', 'Worse'];
    $('#m-legend').innerHTML = `
      ${ui.layer === 'heat'
        ? `<div class="legend-bar" style="background:linear-gradient(90deg, ${Object.entries(HEAT_GRADIENT).sort((a, b) => a[0] - b[0]).map(([k, c]) => `${c} ${k * 100}%`).join(", ")})" aria-hidden="true"></div>
      <div class="legend-ends"><span>Weaker</span><span>Stronger performance</span></div>`
        : `<div class="legend-bar" style="background:linear-gradient(90deg, ${scale.stops.join(',')})" aria-hidden="true"></div>
      <div class="legend-ends"><span>${m.format(scale.lo)} &middot; ${label[0]}</span><span>${label[1]} &middot; ${m.format(scale.hi)}</span></div>`}
      ${ui.layer === 'heat' ? '<p class="small muted" style="margin:4px 0 0">Heat glows brighter where towns perform better on this measure. Switch to dots to read single towns.</p>' : ''}`;
  }

  function draw(keepLimit) {
    if (keepLimit !== true) listLimit = LIST_PAGE;
    const m = metric();
    const scale = colorScale();
    const list = visible();
    drawLegend(scale);
    root.querySelectorAll('[data-layer]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layer === ui.layer)));

    // Towns without enough data for a grade go last when ranking by score.
    const ungraded = (x) => (m.key === 'score' && x.s.grade === '?' ? 1 : 0);
    const sorted = [...list].sort((a, b) => ungraded(a) - ungraded(b) || (m.higherIsBetter === false ? m.value(a.s) - m.value(b.s) : m.value(b.s) - m.value(a.s)));
    $('#m-count').textContent = `${sorted.length} town${sorted.length === 1 ? '' : 's'} · ${m.higherIsBetter === false ? 'lowest' : 'highest'} first`;
    // Render the list in pages: thousands of rows in the DOM make the page slow to paint and scroll.
    const shownRows = sorted.slice(0, listLimit);
    $('#m-list').innerHTML = sorted.length
      ? shownRows
          .map(
            ({ town, s }) => `<li><button type="button" data-id="${town.id}">
              ${gradeBadge(s.grade)}
              <span><span class="t-name">${escapeHTML(town.name)}</span><br><span class="t-sub">${escapeHTML(town.county)}, ${town.state}</span></span>
              <span class="t-val num">${m.format(m.value(s))}</span></button></li>`,
          )
          .join('') +
        (sorted.length > shownRows.length
          ? `<li><button type="button" class="btn" data-more style="width:100%;justify-content:center">Show more (${sorted.length - shownRows.length} left)</button></li>`
          : '')
      : '<li class="empty small">No towns match.</li>';

    if (!map) return;
    dotLayer.clearLayers();
    markers.clear();
    if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
    const ring = isDark() ? '#1a1a19' : '#ffffff';
    if (ui.layer === 'heat' && L.heatLayer) {
      heatLayer = L.heatLayer(
        list.map(({ town, s }) => [town.lat, town.lng, Math.max(0.05, scale.good(m.value(s)))]),
        { radius: 34, blur: 26, maxZoom: 3, max: 1, minOpacity: 0.3, gradient: HEAT_GRADIENT },
      ).addTo(map);
    }
    for (const { town, s } of list) {
      const small = map.getSize().x < 600;
      const radius = Math.max(small ? 2 : 3, Math.min(small ? 5 : 9, Math.sqrt(town.population) / (small ? 50 : 32)));
      const mk = L.circleMarker([town.lat, town.lng], {
        radius: ui.layer === 'heat' ? 4 : radius,
        color: ring,
        weight: 1,
        fillColor: ui.layer === 'heat' ? (isDark() ? '#f4f4f1' : '#121211') : m.key === 'score' && s.grade === '?' ? '#9a9890' : scale.color(m.value(s)),
        fillOpacity: ui.layer === 'heat' ? 0.55 : 0.7,
      })
        .bindTooltip(`<strong>${escapeHTML(town.name)}</strong>, ${town.state}<br>Grade ${s.grade} &middot; ${m.label}: ${m.format(m.value(s))}`, { direction: 'top', offset: [0, -6] })
        .on('click', () => openCard(town.id));
      mk.addTo(dotLayer);
      markers.set(town.id, mk);
    }
  }

  function openCard(id) {
    const t = state.byId.get(id);
    if (!t) return;
    const { town, s } = t;
    const card = $('#m-card');
    card.hidden = false;
    card.innerHTML = `
      <button class="icon-btn close" type="button" aria-label="Close">${ICONS.close}</button>
      <div style="display:flex;gap:12px;align-items:center;padding-right:40px">
        ${gradeBadge(s.grade, 'md')}
        <div><h2>${escapeHTML(town.name)}</h2>${verifiedPill(town)}<div class="small muted">${escapeHTML(town.county)}, ${town.stateName || town.state} &middot; pop. ${number(town.population)}</div></div>
      </div>
      <div class="map-stats">
        <div><span>Community Return Score</span><strong class="num">${s.score.toFixed(0)} / 100</strong></div>
        <div><span>Service $ per resident</span><strong class="num">${money(s.totals.directPerResident)}</strong></div>
        <div><span>Not from property tax</span><strong class="num">${Math.round(s.totals.nonPropertyShare * 100)}%</strong></div>
        <div><span>Political money</span><strong class="num">${money(s.totals.influence, { compact: true })}</strong></div>
        ${s.totals.redFlagCount ? `<div><span>Red flags (surveillance, corporate deals)</span><strong class="num" style="color:var(--bad)">${s.totals.redFlagCount}</strong></div>` : ''}
        ${s.totals.corporateMoney > 0 ? `<div><span>Corporate lobbying & donations</span><strong class="num" style="color:var(--bad)">${money(s.totals.corporateMoney, { compact: true })}</strong></div>` : ''}
      </div>
      <a class="btn btn-primary" style="width:100%" href="#/town/${encodeURIComponent(town.id)}">Open full report ${ICONS.arrow}</a>`;
    card.querySelector('.close').addEventListener('click', () => { card.hidden = true; });
    root.querySelectorAll('#m-list button').forEach((b) => b.classList.toggle('active', b.dataset.id === id));
    if (map) map.flyTo([town.lat, town.lng], Math.max(map.getZoom(), 6), { duration: 0.6 });
  }

  let searchTimer;
  $('#m-search').addEventListener('input', (e) => {
    ui.query = e.target.value;
    clearTimeout(searchTimer);
    searchTimer = setTimeout(draw, 150);
  });
  $('#m-state').addEventListener('change', (e) => {
    ui.state = e.target.value;
    draw();
    if (map) {
      const pts = visible().map(({ town }) => [town.lat, town.lng]);
      if (ui.state === 'all') map.flyToBounds(US_BOUNDS, { duration: 0.6 });
      else if (pts.length) map.flyToBounds(pts, { padding: [60, 60], maxZoom: 9, duration: 0.6 });
    }
  });
  $('#m-real')?.addEventListener('change', (e) => { ui.realOnly = e.target.checked; draw(); });
  $('#m-metric').addEventListener('change', (e) => { ui.metric = e.target.value; draw(); });
  root.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => { ui.layer = b.dataset.layer; draw(); }));
  $('#m-list').addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) { listLimit += LIST_PAGE; draw(true); return; }
    const b = e.target.closest('button[data-id]');
    if (b) openCard(b.dataset.id);
  });

  const onTheme = () => {
    if (tiles) tiles.setUrl(TILE_URL(isDark()));
    if (statesLayer) statesLayer.setStyle(stateStyle());
    if (countyLines) countyLines.setStyle(countyLineStyle());
    if (stateLines) stateLines.setStyle(stateLineStyle());
    draw();
  };
  window.addEventListener('themechange', onTheme);
  const mq = matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', onTheme);

  draw();
  // Open on the towns being shown: with verified data loaded, that's where the real records are.
  if (map && (ui.realOnly || ui.state !== 'all')) {
    const pts = visible().map(({ town }) => [town.lat, town.lng]);
    if (pts.length) map.fitBounds(pts, { padding: [40, 40], maxZoom: 9 });
  }
  return () => {
    clearTimeout(searchTimer);
    window.removeEventListener('themechange', onTheme);
    mq.removeEventListener('change', onTheme);
    if (map) { map.remove(); map = null; }
  };
}
