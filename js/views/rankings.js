import { metric, metricText, coverageText, compareValues } from '../engine/metrics.js';
import { escapeHTML, number } from '../engine/format.js';
import { toCSV } from '../engine/ledger.js';
import { POP_BANDS, GOV_KINDS, govKind, popBand, percentileText, PROVISIONAL_BELOW } from '../engine/peers.js';
import { gradeBadge, verifiedPill, isVerified, downloadFile, ICONS } from '../charts.js';

const COLS = [
  ['score', 'Score'], ['peer', 'Among peers'], ['population', 'Population'], ['direct', 'Services / resident'],
  ['directShare', 'To services'], ['nonProp', 'Not property tax'], ['redFlags', 'Red flags'],
  ['corporate', 'Corporate lobbying & donations'], ['influence', 'Political $ / resident'], ['debt', 'Debt / resident'],
].map(([key, label]) => ({ key, label }));
const PAGE = 50;
const DEFAULTS = { sort: 'score', dir: 'desc', state: 'all', grade: 'all', kind: 'all', band: 'all', q: '', page: 0 };
let lastDataset;
const ui = { ...DEFAULTS, realOnly: null };

// Peer percentile is not a scoring measure, so it is read here rather than in metrics.js.
const value = (e, key) => (key === 'peer' ? e.peer?.percentile ?? null : metric(e, key).value);
const cellText = (e, key) => (key === 'peer'
  ? (e.peer?.percentile == null ? 'Not ranked' : `${percentileText(e.peer.percentile).replace(' percentile', '')} pct · ${e.peer.rank} of ${e.peer.size}`)
  : metricText(e, key));
const cellTitle = (e, key) => (key === 'peer'
  ? (e.peer?.percentile == null ? (e.s.grade === '?' ? 'Not graded, so not ranked' : `Fewer than 8 graded ${e.peer?.label || 'peers'}`) : `Compared with ${e.peer.size} ${e.peer.label}; peer median ${e.peer.median.toFixed(1)}`)
  : metric(e, key).reason);

// Filters live in the address (#/rankings?state=NJ&sort=peer) so a view can be linked and
// survives the back button.
function readHash() {
  const query = location.hash.split('?')[1];
  if (!query) return false;
  const p = new URLSearchParams(query);
  for (const k of Object.keys(DEFAULTS)) if (p.has(k)) ui[k] = k === 'page' ? Math.max(0, Number(p.get(k)) - 1 || 0) : p.get(k);
  if (p.has('real')) ui.realOnly = p.get('real') !== '0';
  return true;
}
function writeHash() {
  const p = new URLSearchParams();
  for (const [k, d] of Object.entries(DEFAULTS)) if (ui[k] !== d) p.set(k, k === 'page' ? ui[k] + 1 : ui[k]);
  if (ui.realOnly === false) p.set('real', '0');
  const next = `#/rankings${p.toString() ? `?${p}` : ''}`;
  if (location.hash !== next) history.replaceState(null, '', next);
}

export function renderRankings(root, state, _arg, query) {
  const anyReal = state.towns.some((t) => isVerified(t.town));
  if (lastDataset !== state.dataset) {
    Object.assign(ui, DEFAULTS, { realOnly: anyReal });
    lastDataset = state.dataset;
  }
  readHash();
  // Show only real towns by default once any are loaded; the checkbox shows demo towns too.
  if (ui.realOnly === null) ui.realOnly = anyReal;
  if (!COLS.some((c) => c.key === ui.sort)) ui.sort = 'score';
  const availableStates = () => [...new Set(state.towns.filter((t) => !ui.realOnly || isVerified(t.town)).map((t) => t.town.state))].sort();
  const states = availableStates();
  // #/rankings?state=MA opens filtered to one state (the States page links here).
  const wanted = query?.get('state')?.toUpperCase();
  if (wanted && states.includes(wanted)) ui.state = wanted;
  if (!states.includes(ui.state)) ui.state = 'all';
  const option = (v, label, current) => `<option value="${escapeHTML(v)}" ${v === current ? 'selected' : ''}>${escapeHTML(label)}</option>`;
  root.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h1>Rankings</h1><p>Every town ranked by its Community Return Score. <strong>Among peers</strong> compares each town only with towns in the same state, of the same kind and size, which share its data sources. Select a column to sort.</p></div>
      <button class="btn" id="r-dl" type="button">${ICONS.download} Export CSV</button>
    </div>
    <div class="toolbar">
      <div class="field field-wide"><label for="r-q">Search</label><input id="r-q" class="input" type="search" placeholder="Town or county" value="${escapeHTML(ui.q)}"></div>
      <div class="field"><label for="r-state">State</label><select id="r-state" class="select">${option('all', 'All states', ui.state)}${states.map((s) => option(s, s, ui.state)).join('')}</select></div>
      <div class="field"><label for="r-kind">Government</label><select id="r-kind" class="select">${option('all', 'All kinds', ui.kind)}${GOV_KINDS.map((k) => option(k.key, k.label, ui.kind)).join('')}</select></div>
      <div class="field"><label for="r-band">Population</label><select id="r-band" class="select">${option('all', 'Any size', ui.band)}${POP_BANDS.map((b) => option(b.key, b.label, ui.band)).join('')}</select></div>
      <div class="field"><label for="r-grade">Grade</label><select id="r-grade" class="select">${option('all', 'All grades', ui.grade)}${['A', 'B', 'C', 'D', 'F', '?'].map((g) => option(g, g === '?' ? 'Not graded' : g, ui.grade)).join('')}</select></div>
    </div>
    <div class="toolbar toolbar-row">
      <div class="segmented" role="group" aria-label="Rank by">
        <button type="button" data-rank="score" aria-pressed="${ui.sort === 'score'}">Rank by score</button>
        <button type="button" data-rank="peer" aria-pressed="${ui.sort === 'peer'}">Rank among peers</button>
      </div>
      ${anyReal ? `<label class="check"><input type="checkbox" id="r-real" ${ui.realOnly ? 'checked' : ''}> Public-record data only</label>` : ''}
      <button class="btn btn-quiet" id="r-reset" type="button">Clear filters</button>
    </div>
    <p class="small muted" id="r-note"></p>
    <div class="table-wrap table-tall"><table class="rank-table">
      <thead><tr><th scope="col">#</th><th scope="col">Town</th>${COLS.map((c) => `<th scope="col" class="r"><button type="button" data-sort="${c.key}" aria-label="Sort by ${c.label}">${c.label} ${ICONS.sort}</button></th>`).join('')}</tr></thead>
      <tbody id="r-body"></tbody>
    </table></div>
    <div class="pager">
      <p class="small muted" id="r-count" aria-live="polite"></p>
      <span class="pager-controls">
        <button class="btn" id="r-prev" type="button">Previous</button>
        <label class="small">Page <input id="r-page" class="input input-page" type="number" min="1" inputmode="numeric" aria-label="Page number"> of <span id="r-pages"></span></label>
        <button class="btn" id="r-next" type="button">Next</button>
      </span>
    </div>
  </div>`;
  const $ = (sel) => root.querySelector(sel);

  function rows() {
    const q = ui.q.trim().toLowerCase();
    // Provisional scores (little data behind them) sort after complete ones whenever
    // the table is ranked by score or among peers, so they never top a list on thin data.
    const ranked = ui.sort === 'score' || ui.sort === 'peer';
    return state.towns
      .filter((t) => (ui.state === 'all' || t.town.state === ui.state) && (ui.grade === 'all' || t.s.grade === ui.grade) && (!ui.realOnly || isVerified(t.town))
        && (ui.kind === 'all' || govKind(t.town) === ui.kind) && (ui.band === 'all' || popBand(t.town.population).key === ui.band)
        && (!q || `${t.town.name} ${t.town.county}`.toLowerCase().includes(q)))
      .sort((a, b) => (ranked ? Number(a.provisional) - Number(b.provisional) : 0)
        || compareValues(value(a, ui.sort), value(b, ui.sort), ui.dir)
        || (ui.sort === 'peer' ? compareValues(a.s.score, b.s.score, 'desc') : 0));
  }
  function draw() {
    const list = rows();
    const pages = Math.max(1, Math.ceil(list.length / PAGE));
    ui.page = Math.min(Math.max(0, ui.page), pages - 1);
    writeHash();
    root.querySelectorAll('[data-sort]').forEach((b) => b.closest('th').setAttribute('aria-sort', b.dataset.sort === ui.sort ? (ui.dir === 'asc' ? 'ascending' : 'descending') : 'none'));
    root.querySelectorAll('[data-rank]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.rank === ui.sort)));
    const start = ui.page * PAGE;
    $('#r-body').innerHTML = list.length
      ? list.slice(start, start + PAGE).map((t, i) => `<tr${t.provisional ? ' class="row-provisional"' : ''}>
          <td class="num muted">${start + i + 1}</td>
          <td><div class="town-cell">${gradeBadge(t.s.grade)}<div><a href="#/town/${encodeURIComponent(t.town.id)}">${escapeHTML(t.town.name)}</a> ${verifiedPill(t.town)}${t.provisional ? ` <span class="pill pill-provisional" title="Scored on ${t.s.coverage.possible} of 100 points of data; ranked after towns with at least ${PROVISIONAL_BELOW}">Provisional</span>` : ''}<div class="small muted">${escapeHTML(t.town.county)}, ${t.town.state} · ${escapeHTML(t.town.type || '')} · ${number(t.town.population)} people</div><div class="small muted">${escapeHTML(coverageText(t))}</div></div></div></td>
          ${COLS.map((c) => `<td class="r num${c.key === 'peer' ? ' peer-cell' : ''}" title="${escapeHTML(cellTitle(t, c.key))}">${cellText(t, c.key)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${COLS.length + 2}" class="empty">No towns match. <button class="btn btn-quiet" type="button" data-clear>Clear filters</button></td></tr>`;
    root.querySelector('[data-clear]')?.addEventListener('click', reset);
    $('#r-prev').disabled = ui.page === 0;
    $('#r-next').disabled = ui.page >= pages - 1;
    $('#r-page').value = String(ui.page + 1);
    $('#r-page').max = String(pages);
    $('#r-pages').textContent = number(pages);
    const provisional = list.filter((t) => t.provisional).length;
    $('#r-count').textContent = `Showing ${list.length ? start + 1 : 0}–${Math.min(start + PAGE, list.length)} of ${number(list.length)} matching towns. Missing values sort last.`;
    $('#r-note').textContent = ui.sort === 'peer'
      ? `Ranked by percentile among peers: 90th means a town scores higher than 90% of comparable towns. Peers share state, kind of government and population band; groups under 8 graded towns are widened.${provisional ? ` ${number(provisional)} provisional towns (less than ${PROVISIONAL_BELOW} of 100 points of data) are listed last.` : ''}`
      : provisional && ui.sort === 'score' ? `${number(provisional)} provisional towns (scored on less than ${PROVISIONAL_BELOW} of 100 points of data) are listed after the rest.` : '';
  }
  function reset() {
    Object.assign(ui, DEFAULTS, { realOnly: anyReal });
    renderRankings(root, state);
  }
  const on = (sel, ev, fn) => $(sel)?.addEventListener(ev, (e) => { fn(e); draw(); });
  on('#r-q', 'input', (e) => { ui.q = e.target.value; ui.page = 0; });
  on('#r-state', 'change', (e) => { ui.state = e.target.value; ui.page = 0; });
  on('#r-kind', 'change', (e) => { ui.kind = e.target.value; ui.page = 0; });
  on('#r-band', 'change', (e) => { ui.band = e.target.value; ui.page = 0; });
  on('#r-grade', 'change', (e) => { ui.grade = e.target.value; ui.page = 0; });
  $('#r-real')?.addEventListener('change', (e) => {
    ui.realOnly = e.target.checked; ui.page = 0;
    const list = availableStates();
    if (!list.includes(ui.state)) ui.state = 'all';
    $('#r-state').innerHTML = option('all', 'All states', ui.state) + list.map((s) => option(s, s, ui.state)).join('');
    draw();
  });
  $('#r-reset').addEventListener('click', reset);
  root.querySelectorAll('[data-rank]').forEach((b) => b.addEventListener('click', () => { ui.sort = b.dataset.rank; ui.dir = 'desc'; ui.page = 0; draw(); }));
  root.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    ui.dir = ui.sort === b.dataset.sort && ui.dir === 'desc' ? 'asc' : 'desc';
    ui.sort = b.dataset.sort;
    ui.page = 0;
    draw();
  }));
  $('#r-prev').onclick = () => { ui.page--; draw(); $('.table-wrap').scrollTop = 0; };
  $('#r-next').onclick = () => { ui.page++; draw(); $('.table-wrap').scrollTop = 0; };
  $('#r-page').addEventListener('change', (e) => { ui.page = (Number(e.target.value) || 1) - 1; draw(); $('.table-wrap').scrollTop = 0; });
  $('#r-dl').addEventListener('click', () => downloadFile('town-rankings.csv', toCSV(rows(), [
    { label: 'Town', get: (t) => t.town.name },
    { label: 'County', get: (t) => t.town.county },
    { label: 'State', get: (t) => t.town.state },
    { label: 'Type', get: (t) => t.town.type },
    { label: 'Grade', get: (t) => t.s.grade },
    { label: 'Provisional', get: (t) => (t.provisional ? 'Yes' : 'No') },
    { label: 'Coverage', get: coverageText },
    { label: 'Peer group', get: (t) => t.peer?.label || '' },
    { label: 'Peer group size', get: (t) => t.peer?.size ?? '' },
    { label: 'Peer rank', get: (t) => t.peer?.rank ?? '' },
    { label: 'Peer percentile', get: (t) => t.peer?.percentile ?? '' },
    ...COLS.filter((c) => c.key !== 'peer').flatMap((c) => [{ label: c.label, get: (t) => metric(t, c.key).value ?? metricText(t, c.key) }, { label: `${c.label} availability`, get: (t) => metric(t, c.key).reason || 'Available' }]),
  ])));
  draw();
}
