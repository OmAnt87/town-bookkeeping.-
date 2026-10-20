import { metric as displayMetric, metricText, coverageText, compareValues } from '../engine/metrics.js';
import { MAP_METRICS } from '../engine/scoring.js';
import { money, number, escapeHTML } from '../engine/format.js';
import { gradeBadge, verifiedPill, isVerified, ICONS, cssVar } from '../charts.js';
import { isDark } from '../app.js';

// Diverging scale (poor = red, middle = gray, good = teal) and a navy
// sequential scale for metrics that are neither good nor bad.
const DIVERGING = ['#d03b3b', '#e98a7f', '#b8bab6', '#5cbfb1', '#0e7a6c'];
const SEQUENTIAL = ['#d4e1f4', '#8fb0e0', '#4a7fcb', '#24508f', '#132a52'];

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

// Esri's gray canvas basemaps need no API key (CARTO's now do).
const TILE_URL = (dark) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${dark ? 'World_Dark_Gray_Base' : 'World_Light_Gray_Base'}/MapServer/tile/{z}/{y}/{x}`;

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

let lastDataset;
const ui = { metric: 'score', layer: 'towns', state: 'all', query: '', realOnly: null };

export function renderMap(root, state, _arg, query) {
  if (lastDataset !== state.dataset) {
    ui.realOnly = state.towns.some((t) => isVerified(t.town));
    ui.state = 'all'; ui.query = '';
    lastDataset = state.dataset;
  }
  // Show only real towns by default once any are loaded; the checkbox shows demo towns too.
  if (ui.realOnly === null) ui.realOnly = state.towns.some((t) => isVerified(t.town));
  const availableStates = () => [...new Set(state.towns.filter((t) => !ui.realOnly || isVerified(t.town)).map((t) => t.town.state))].sort();
  const states = availableStates();
  // #/map?state=MA opens filtered to one state (the States page links here).
  const wanted = query?.get('state')?.toUpperCase();
  if (wanted && states.includes(wanted)) ui.state = wanted;
  if (!states.includes(ui.state)) ui.state = 'all';
  const verified = state.towns.filter((t) => isVerified(t.town));
  const realStates = new Set(verified.map((t) => t.town.state));
  const residents = verified.reduce((sum, t) => sum + (Number(t.town.population) || 0), 0);
  root.innerHTML = `
  <div class="map-layout">
    <aside class="map-side">
      <div>
        <div class="eyebrow">Open data · Public records</div>
        <h1>See where your town’s money really goes</h1>
        <p class="intro">Each dot is a town. Color shows how well it turns tax and other revenue into services residents actually use. Pick a town for its full ledger and report card.</p>
        <div class="hero-stats">
          <div><strong>${number(verified.length)}</strong><span>governments</span></div>
          <div><strong>${realStates.size - (realStates.has('DC') ? 1 : 0)}</strong><span>states${realStates.has('DC') ? ' + DC' : ''}</span></div>
          <div><strong>${residents >= 1e6 ? `${Math.round(residents / 1e6)}M` : number(residents)}</strong><span>residents</span></div>
        </div>
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
      ${state.towns.some((t) => isVerified(t.town)) ? `<label class="check"><input type="checkbox" id="m-real" ${ui.realOnly ? 'checked' : ''}> Only towns with public-record data</label>` : ''}
      <div class="field">
        <label for="m-metric">Color towns by</label>
        <select id="m-metric" class="select">${MAP_METRICS.map(
          (m) => `<option value="${m.key}" ${m.key === ui.metric ? 'selected' : ''}>${m.label}</option>`,
        ).join('')}</select>
      </div>
      <div class="legend" id="m-legend"></div><p class="small muted">States without loaded coverage are not listed. Unavailable measures are not treated as zero.</p>
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
  let gridLayer;
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
    // Postal codes when zoomed out, full names when zoomed in; none at all on a small screen
    // zoomed out so far that even the codes would pile on top of each other.
    const syncLabels = () => {
      const el = map.getContainer();
      el.classList.toggle('labels-short', map.getZoom() < FULL_NAME_ZOOM);
      el.classList.toggle('labels-none', map.getZoom() < 3.5 && map.getSize().x < 600);
    };
    map.on('zoomend', syncLabels);
    syncLabels();
    dotLayer = L.layerGroup().addTo(map);
    gridLayer = L.layerGroup().addTo(map);
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
    const vals = visible().map((t) => displayMetric(t, m.key).value).filter((v) => v !== null).sort((a, b) => a - b);
    // Scores and percentiles have fixed ranges, so colors mean the same thing in every state.
    const lo = m.key === 'score' ? 20 : m.key === 'peerPercentile' ? 0 : quantile(vals, 0.05);
    const hi = m.key === 'score' ? 95 : m.key === 'peerPercentile' ? 100 : quantile(vals, 0.95);
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
      <div class="legend-bar" style="background:linear-gradient(90deg, ${scale.stops.join(',')})" aria-hidden="true"></div>
      <div class="legend-ends"><span>${m.format(scale.lo)} &middot; ${label[0]}</span><span>${label[1]} &middot; ${m.format(scale.hi)}</span></div>
      ${ui.layer === 'heat' ? '<p class="small muted" style="margin:4px 0 0">Each square averages the towns inside it. Zoom in for finer squares, or switch to dots to read single towns.</p>' : ''}`;
  }

  function draw(keepLimit) {
    if (keepLimit !== true) listLimit = LIST_PAGE;
    const m = metric();
    const scale = colorScale();
    const list = visible();
    drawLegend(scale);
    root.querySelectorAll('[data-layer]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.layer === ui.layer)));

    const sorted = [...list].sort((a, b) => compareValues(displayMetric(a, m.key).value, displayMetric(b, m.key).value, m.higherIsBetter === false ? 'asc' : 'desc'));
    $('#m-count').textContent = `${sorted.length} towns · ${list.filter((e) => !displayMetric(e, m.key).available).length} unavailable (gray, excluded from heat)`;
    // Render the list in pages: thousands of rows in the DOM make the page slow to paint and scroll.
    const shownRows = sorted.slice(0, listLimit);
    // New rows slide in (a short stagger for the first dozen); after "Show more" only the added rows do.
    const firstNew = keepLimit === true ? listLimit - LIST_PAGE : 0;
    const rowAttrs = (i) => (i >= firstNew ? ` class="in" style="--i:${Math.min(i - firstNew, 12)}"` : '');
    $('#m-list').innerHTML = sorted.length
      ? shownRows
          .map(
            (e, i) => `<li${rowAttrs(i)}><button type="button" data-id="${e.town.id}">
              ${gradeBadge(e.s.grade)}
              <span><span class="t-name">${escapeHTML(e.town.name)}</span><br><span class="t-sub">${escapeHTML(e.town.county)}, ${e.town.state}</span></span>
              <span class="t-val num">${metricText(e, m.key)}</span></button></li>`,
          )
          .join('') +
        (sorted.length > shownRows.length
          ? `<li><button type="button" class="btn" data-more style="width:100%;justify-content:center">Show more (${sorted.length - shownRows.length} left)</button></li>`
          : '')
      : '<li class="empty small">No towns match.</li>';

    if (!map) return;
    dotLayer.clearLayers();
    markers.clear();
    drawGrid(list, scale);
    if (ui.layer === 'heat') return;
    const ring = isDark() ? '#111c2f' : '#ffffff';
    for (const e of list) {
      const { town, s } = e;
      const small = map.getSize().x < 600;
      const radius = Math.max(small ? 2 : 3, Math.min(small ? 5 : 9, Math.sqrt(town.population) / (small ? 50 : 32)));
      const mk = L.circleMarker([town.lat, town.lng], {
        radius,
        color: ring,
        weight: 1,
        fillColor: !displayMetric(e, m.key).available ? '#9a9890' : scale.color(displayMetric(e, m.key).value),
        fillOpacity: 0.7,
      })
        .bindTooltip(`<strong>${escapeHTML(town.name)}</strong>, ${town.state}<br>Grade ${s.grade} &middot; ${m.label}: ${metricText(e, m.key)}`, { direction: 'top', offset: [0, -6] })
        .on('click', () => openCard(town.id));
      mk.addTo(dotLayer);
      markers.set(town.id, mk);
    }
  }

  // Heat mode: a grid of squares, each colored by the average of the towns inside it.
  // (Summing towns, as a classic heat map does, only shows where towns are dense.)
  function drawGrid(list, scale) {
    gridLayer.clearLayers();
    if (ui.layer !== 'heat') return;
    const m = metric();
    // About 24 screen pixels per square at any zoom.
    const size = Math.min(2, Math.max(0.01, 34 / 2 ** map.getZoom()));
    const cells = new Map();
    for (const e of list) {
      const { available, value } = displayMetric(e, m.key);
      if (!available) continue;
      const key = `${Math.floor(e.town.lat / size)},${Math.floor(e.town.lng / size)}`;
      const c = cells.get(key) || cells.set(key, { sum: 0, n: 0 }).get(key);
      c.sum += value;
      c.n += 1;
    }
    for (const [key, { sum, n }] of cells) {
      const [i, j] = key.split(',').map(Number);
      const avg = sum / n;
      const bounds = [[i * size, j * size], [(i + 1) * size, (j + 1) * size]];
      L.rectangle(bounds, { stroke: false, fillColor: scale.color(avg), fillOpacity: 0.78 })
        .bindTooltip(`${n} town${n === 1 ? '' : 's'} &middot; average ${m.label}: ${m.format(avg)}`, { direction: 'top' })
        .on('click', () => map.flyToBounds(bounds, { maxZoom: map.getZoom() + 2, duration: 0.5 }))
        .addTo(gridLayer);
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
      <p class="small muted">${escapeHTML(coverageText({ town, s }))}</p><div class="map-stats">
        <div><span>Community Return Score</span><strong class="num">${metricText({ town, s }, 'score')}</strong></div>
        ${t.peer?.percentile != null ? `<div><span>Among ${escapeHTML(t.peer.label)}</span><strong class="num">${metricText(t, 'peerPercentile')}</strong></div>` : ''}
        <div><span>Service $ per resident</span><strong class="num">${metricText({ town, s }, 'directPerResident')}</strong></div>
        <div><span>Not from property tax</span><strong class="num">${Math.round(s.totals.nonPropertyShare * 100)}%</strong></div>
        <div><span>Political money</span><strong class="num">${metricText({ town, s }, 'politicalTotal')}</strong></div>
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
  $('#m-real')?.addEventListener('change', (e) => { ui.realOnly = e.target.checked;
    const states = availableStates();
    if (!states.includes(ui.state)) ui.state = 'all';
    $('#m-state').innerHTML = '<option value="all">All states</option>' + states.map((s) => `<option ${s === ui.state ? 'selected' : ''}>${escapeHTML(s)}</option>`).join('');
    draw(); });
  $('#m-metric').addEventListener('change', (e) => { ui.metric = e.target.value; draw(); });
  root.querySelectorAll('[data-layer]').forEach((b) => b.addEventListener('click', () => { ui.layer = b.dataset.layer; draw(); }));
  $('#m-list').addEventListener('click', (e) => {
    if (e.target.closest('[data-more]')) { listLimit += LIST_PAGE; draw(true); return; }
    const b = e.target.closest('button[data-id]');
    if (b) openCard(b.dataset.id);
  });

  const onZoom = () => { if (ui.layer === 'heat') drawGrid(visible(), colorScale()); };
  if (map) map.on('zoomend', onZoom);

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
  // Open on the towns being shown. With every state loaded, that is the lower 48 (Alaska and
  // Hawaii would shrink the rest to a sliver on a phone); a picked state opens on its towns.
  if (map && ui.state !== 'all') {
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
