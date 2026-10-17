import { metric, metricText, coverageText, compareValues } from '../engine/metrics.js';
import { escapeHTML } from '../engine/format.js';
import { toCSV } from '../engine/ledger.js';
import { gradeBadge, verifiedPill, isVerified, downloadFile, ICONS } from '../charts.js';

const COLS = [
  ['score', 'Score'], ['population', 'Population'], ['direct', 'Services / resident'],
  ['directShare', 'To services'], ['nonProp', 'Not property tax'], ['redFlags', 'Red flags'],
  ['corporate', 'Corporate lobbying & donations'], ['influence', 'Political $ / resident'], ['debt', 'Debt / resident'],
].map(([key, label]) => ({ key, label }));
const PAGE = 50;
let lastDataset;
const ui = { sort: 'score', dir: 'desc', state: 'all', grade: 'all', q: '', realOnly: null };

export function renderRankings(root, state) {
  if (lastDataset !== state.dataset) {
    ui.realOnly = state.towns.some((t) => isVerified(t.town));
    ui.state = 'all'; ui.q = ''; ui.grade = 'all';
    lastDataset = state.dataset;
  }
  // Show only real towns by default once any are loaded; the checkbox shows demo towns too.
  if (ui.realOnly === null) ui.realOnly = state.towns.some((t) => isVerified(t.town));
  let page = 0;
  const availableStates = () => [...new Set(state.towns.filter((t) => !ui.realOnly || isVerified(t.town)).map((t) => t.town.state))].sort();
  const states = availableStates();
  if (!states.includes(ui.state)) ui.state = 'all';
  root.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h1>Rankings</h1><p>Every town in the dataset, ranked by its Community Return Score. Select a column to sort.</p></div>
      <button class="btn" id="r-dl" type="button">${ICONS.download} Export CSV</button>
    </div>
    <div class="toolbar">
      <div class="field"><label for="r-q">Search</label><input id="r-q" class="input" type="search" placeholder="Town or county" value="${escapeHTML(ui.q)}"></div>
      <div class="field"><label for="r-state">State</label><select id="r-state" class="select"><option value="all">All states</option>${states.map((s) => `<option ${s === ui.state ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label for="r-grade">Grade</label><select id="r-grade" class="select"><option value="all">All grades</option>${['A', 'B', 'C', 'D', 'F', '?'].map((g) => `<option ${g === ui.grade ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
      ${state.towns.some((t) => isVerified(t.town)) ? `<label class="check" style="align-self:center"><input type="checkbox" id="r-real" ${ui.realOnly ? 'checked' : ''}> Public-record data only</label>` : ''}
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Town</th>${COLS.map((c) => `<th class="r"><button type="button" data-sort="${c.key}" aria-label="Sort by ${c.label}">${c.label} ${ICONS.sort}</button></th>`).join('')}</tr></thead>
      <tbody id="r-body"></tbody>
    </table></div>
    <div class="pager"><p class="small muted" id="r-count" aria-live="polite"></p><span><button class="btn" id="r-prev">Previous</button> <button class="btn" id="r-next">Next</button></span></div>
  </div>`;
  const $ = (sel) => root.querySelector(sel);

  function rows() {
    const q = ui.q.trim().toLowerCase();
    const col = COLS.find((c) => c.key === ui.sort);
    return state.towns
      .filter((t) => (ui.state === 'all' || t.town.state === ui.state) && (ui.grade === 'all' || t.s.grade === ui.grade) && (!ui.realOnly || isVerified(t.town)) &&
        (!q || `${t.town.name} ${t.town.county}`.toLowerCase().includes(q)))
      .sort((a, b) => compareValues(metric(a, col.key).value, metric(b, col.key).value, ui.dir));
  }
  function draw() {
    const list = rows();
    page = Math.min(page, Math.max(0, Math.ceil(list.length / PAGE) - 1));
    root.querySelectorAll('[data-sort]').forEach((b) => b.closest('th').setAttribute('aria-sort', b.dataset.sort === ui.sort ? (ui.dir === 'asc' ? 'ascending' : 'descending') : 'none'));
    $('#r-body').innerHTML = list.length
      ? list.slice(page * PAGE, (page + 1) * PAGE).map((t, i) => `<tr>
          <td class="num muted">${page * PAGE + i + 1}</td>
          <td><div style="display:flex;gap:10px;align-items:center">${gradeBadge(t.s.grade)}<div><a href="#/town/${encodeURIComponent(t.town.id)}">${escapeHTML(t.town.name)}</a> ${verifiedPill(t.town)}<div class="small muted">${escapeHTML(t.town.county)}, ${t.town.state}</div><div class="small muted">${escapeHTML(coverageText(t))}</div></div></div></td>
          ${COLS.map((c) => `<td class="r num" title="${escapeHTML(metric(t, c.key).reason)}">${metricText(t, c.key)}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${COLS.length + 2}" class="empty">No towns match.</td></tr>`;
    $('#r-prev').disabled = page === 0;
    $('#r-next').disabled = (page + 1) * PAGE >= list.length;
    $('#r-count').textContent = `Showing ${list.length ? page * PAGE + 1 : 0}–${Math.min((page + 1) * PAGE, list.length)} of ${list.length} matching towns. Missing values sort last. States without loaded coverage are not listed.`;
  }
  $('#r-q').addEventListener('input', (e) => { ui.q = e.target.value; page = 0; draw(); });
  $('#r-state').addEventListener('change', (e) => { ui.state = e.target.value; page = 0; draw(); });
  $('#r-real')?.addEventListener('change', (e) => { ui.realOnly = e.target.checked; page = 0;
    const states = availableStates();
    if (!states.includes(ui.state)) ui.state = 'all';
    $('#r-state').innerHTML = '<option value="all">All states</option>' + states.map((s) => `<option ${s === ui.state ? 'selected' : ''}>${escapeHTML(s)}</option>`).join('');
    draw(); });
  $('#r-grade').addEventListener('change', (e) => { ui.grade = e.target.value; page = 0; draw(); });
  root.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    ui.dir = ui.sort === b.dataset.sort && ui.dir === 'desc' ? 'asc' : 'desc';
    ui.sort = b.dataset.sort;
    page = 0;
    draw();
  }));
  $('#r-prev').onclick = () => { page--; draw(); };
  $('#r-next').onclick = () => { page++; draw(); };
  $('#r-dl').addEventListener('click', () => downloadFile('town-rankings.csv', toCSV(rows(), [
    { label: 'Town', get: (t) => t.town.name },
    { label: 'County', get: (t) => t.town.county },
    { label: 'State', get: (t) => t.town.state },
    { label: 'Grade', get: (t) => t.s.grade },
    { label: 'Coverage', get: coverageText },
    ...COLS.flatMap((c) => [{ label: c.label, get: (t) => metric(t, c.key).value ?? metricText(t, c.key) }, { label: `${c.label} availability`, get: (t) => metric(t, c.key).reason || 'Available' }]),
  ])));
  draw();
}
