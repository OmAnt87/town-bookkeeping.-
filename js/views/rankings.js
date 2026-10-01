import { money, number, escapeHTML } from '../engine/format.js';
import { toCSV } from '../engine/ledger.js';
import { gradeBadge, verifiedPill, isVerified, downloadFile, ICONS } from '../charts.js';

const COLS = [
  { key: 'score', label: 'Score', get: (t) => t.s.score, fmt: (v) => v.toFixed(0) },
  { key: 'population', label: 'Population', get: (t) => t.town.population, fmt: number },
  { key: 'direct', label: 'Services / resident', get: (t) => t.s.totals.directPerResident, fmt: (v) => money(v) },
  { key: 'directShare', label: 'To services', get: (t) => t.s.totals.directShare, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'nonProp', label: 'Not property tax', get: (t) => t.s.totals.nonPropertyShare, fmt: (v) => `${Math.round(v * 100)}%` },
  { key: 'influence', label: 'Political $ / resident', get: (t) => t.s.totals.influencePerResident, fmt: (v) => `$${v.toFixed(2)}` },
  { key: 'debt', label: 'Debt / resident', get: (t) => t.s.totals.debtPerResident, fmt: (v) => money(v) },
];

const ui = { sort: 'score', dir: 'desc', state: 'all', grade: 'all', q: '', realOnly: null };

export function renderRankings(root, state) {
  // Show only real towns by default once any are loaded; the checkbox shows demo towns too.
  if (ui.realOnly === null) ui.realOnly = state.towns.some((t) => isVerified(t.town));
  const states = [...new Set(state.towns.map((t) => t.town.state))].sort();
  root.innerHTML = `
  <div class="page">
    <div class="page-head">
      <div><h1>Rankings</h1><p>Every town in the dataset, ranked by its Community Return Score. Select a column to sort.</p></div>
      <button class="btn" id="r-dl" type="button">${ICONS.download} Export CSV</button>
    </div>
    <div class="toolbar">
      <div class="field"><label for="r-q">Search</label><input id="r-q" class="input" type="search" placeholder="Town or county" value="${escapeHTML(ui.q)}"></div>
      <div class="field"><label for="r-state">State</label><select id="r-state" class="select"><option value="all">All states</option>${states.map((s) => `<option ${s === ui.state ? 'selected' : ''}>${s}</option>`).join('')}</select></div>
      <div class="field"><label for="r-grade">Grade</label><select id="r-grade" class="select"><option value="all">All grades</option>${['A', 'B', 'C', 'D', 'F'].map((g) => `<option ${g === ui.grade ? 'selected' : ''}>${g}</option>`).join('')}</select></div>
      ${state.towns.some((t) => isVerified(t.town)) ? `<label class="check" style="align-self:center"><input type="checkbox" id="r-real" ${ui.realOnly ? 'checked' : ''}> Verified data only</label>` : ''}
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>#</th><th>Town</th>${COLS.map((c) => `<th class="r"><button type="button" data-sort="${c.key}" aria-label="Sort by ${c.label}">${c.label} ${ICONS.sort}</button></th>`).join('')}</tr></thead>
      <tbody id="r-body"></tbody>
    </table></div>
    <p class="small muted" id="r-count" style="margin-top:10px"></p>
  </div>`;
  const $ = (sel) => root.querySelector(sel);

  function rows() {
    const q = ui.q.trim().toLowerCase();
    const col = COLS.find((c) => c.key === ui.sort);
    return state.towns
      .filter((t) => (ui.state === 'all' || t.town.state === ui.state) && (ui.grade === 'all' || t.s.grade === ui.grade) && (!ui.realOnly || isVerified(t.town)) &&
        (!q || `${t.town.name} ${t.town.county}`.toLowerCase().includes(q)))
      .sort((a, b) => (ui.sort === 'score' ? (a.s.grade === '?') - (b.s.grade === '?') : 0) || (ui.dir === 'asc' ? 1 : -1) * (col.get(a) - col.get(b)));
  }
  function draw() {
    const list = rows();
    root.querySelectorAll('[data-sort]').forEach((b) => b.closest('th').setAttribute('aria-sort', b.dataset.sort === ui.sort ? (ui.dir === 'asc' ? 'ascending' : 'descending') : 'none'));
    $('#r-body').innerHTML = list.length
      ? list.map((t, i) => `<tr>
          <td class="num muted">${i + 1}</td>
          <td><div style="display:flex;gap:10px;align-items:center">${gradeBadge(t.s.grade)}<div><a href="#/town/${encodeURIComponent(t.town.id)}">${escapeHTML(t.town.name)}</a> ${verifiedPill(t.town)}<div class="small muted">${escapeHTML(t.town.county)}, ${t.town.state}</div></div></div></td>
          ${COLS.map((c) => `<td class="r num">${c.fmt(c.get(t))}</td>`).join('')}</tr>`).join('')
      : `<tr><td colspan="${COLS.length + 2}" class="empty">No towns match.</td></tr>`;
    $('#r-count').textContent = `Showing ${list.length} of ${state.towns.length} towns.`;
  }
  $('#r-q').addEventListener('input', (e) => { ui.q = e.target.value; draw(); });
  $('#r-state').addEventListener('change', (e) => { ui.state = e.target.value; draw(); });
  $('#r-real')?.addEventListener('change', (e) => { ui.realOnly = e.target.checked; draw(); });
  $('#r-grade').addEventListener('change', (e) => { ui.grade = e.target.value; draw(); });
  root.querySelectorAll('[data-sort]').forEach((b) => b.addEventListener('click', () => {
    ui.dir = ui.sort === b.dataset.sort && ui.dir === 'desc' ? 'asc' : 'desc';
    ui.sort = b.dataset.sort;
    draw();
  }));
  $('#r-dl').addEventListener('click', () => downloadFile('town-rankings.csv', toCSV(rows(), [
    { label: 'Town', get: (t) => t.town.name },
    { label: 'County', get: (t) => t.town.county },
    { label: 'State', get: (t) => t.town.state },
    { label: 'Grade', get: (t) => t.s.grade },
    ...COLS.map((c) => ({ label: c.label, get: (t) => c.get(t) })),
  ])));
  draw();
}
