import { escapeHTML } from '../engine/format.js';
import { metric, metricText, coverageText, comparable } from '../engine/metrics.js';
import { reportingText } from '../engine/reporting.js';
import { gradeBadge, countUp } from '../charts.js';

let picks = ['', '', ''];
const ROWS = [
  ['score', 'Community Return Score', 'high'], ['population', 'Population'],
  ['revenue', 'Total money in'], ['nonPropertyShare', 'Share not from property tax'],
  ['spending', 'Total money out'], ['passThroughIn', 'Of which taxes passed to schools & county'],
  ['directPerResident', 'Service dollars per resident', 'high'],
  ['directShare', 'Share of spending on services', 'high'], ['adminShare', 'Administration & consultants', 'low'],
  ['redFlagPerResident', 'Surveillance & corporate giveaways per resident', 'low'],
  ['redFlagCount', 'Documented red flags', 'low'], ['taxBreaks', 'Corporate tax breaks', 'low'],
  ['corporateMoney', 'Corporate lobbying & business donations', 'low'],
  ['influencePerResident', 'Political money per resident', 'low'], ['debtPerResident', 'Debt per resident', 'low'],
];
export function renderCompare(root, state, arg) {
  picks = picks.map((id) => state.byId.has(id) ? id : '');
  if (arg && state.byId.has(arg) && !picks.includes(arg)) picks = [arg, ...picks].slice(0, 3);
  const options = [...state.towns].sort((a, b) => a.town.name.localeCompare(b.town.name));
  const label = (t) => `${t.name}, ${t.county || 'County not recorded'}, ${t.state}`;
  root.innerHTML = `<div class="page compare">
    <div class="page-head"><div><h1>Compare towns</h1><p>Choose up to three towns. Highlights appear only for available values with matching reporting context.</p></div></div>
    <div class="compare-pickers">${[0, 1, 2].map((i) => `<div class="field" style="--i:${i}">
      <label for="c-search-${i}">Find town ${i + 1}</label><input id="c-search-${i}" class="input" type="search" placeholder="Town, county or state">
      <label for="c-${i}">Town ${i + 1}</label><select class="select" id="c-${i}" data-slot="${i}"></select></div>`).join('')}</div>
    <div id="c-out"></div></div>`;
  // Each list shows the current pick plus up to MAX matches once two letters are typed:
  // tens of thousands of options per list make the page slow to build and to open.
  const MAX = 50;
  function choices() {
    for (let i = 0; i < 3; i++) {
      const q = root.querySelector(`#c-search-${i}`).value.trim().toLowerCase();
      const matches = q.length < 2 ? [] : options.filter(({ town }) => town.id !== picks[i] && !picks.includes(town.id) && label(town).toLowerCase().includes(q));
      const current = picks[i] ? [state.byId.get(picks[i])] : [];
      const hint = q.length < 2 ? 'Type two or more letters to search' : matches.length > MAX ? `${matches.length} matches; showing ${MAX}, keep typing` : `${matches.length} match${matches.length === 1 ? '' : 'es'}`;
      root.querySelector(`#c-${i}`).innerHTML = `<option value="">${picks[i] ? 'None' : hint}</option>` + [...current, ...matches.slice(0, MAX)]
        .map(({ town }) => `<option value="${escapeHTML(town.id)}" ${town.id === picks[i] ? 'selected' : ''}>${escapeHTML(label(town))}</option>`).join('');
      root.querySelector(`#c-search-${i}`).title = hint;
    }
  }
  // Town ids in the table on screen: after the first draw, only a newly picked town's column animates.
  let shown = [];
  function draw() {
    const ids = picks.filter(Boolean);
    const entries = ids.map((id) => state.byId.get(id));
    const out = root.querySelector('#c-out');
    if (!entries.length) { shown = []; out.classList.remove('update'); out.innerHTML = '<div class="card empty">Find and select a town above to start.</div>'; return; }
    const update = shown.length > 0;
    const fresh = ids.map((id) => (update && !shown.includes(id) ? ' col-new' : ''));
    shown = ids;
    out.classList.toggle('update', update);
    const rows = ROWS.map(([key, title, better]) => {
      const values = entries.map((e) => metric(e, key));
      const best = better && comparable(entries, key) ? Math[better === 'high' ? 'max' : 'min'](...values.map((m) => m.value)) : null;
      return `<tr><th scope="row">${title}</th>${entries.map((e, i) => `<td class="num${best !== null && values[i].value === best ? ' best' : ''}${fresh[i]}" title="${escapeHTML(values[i].reason)}">${metricText(e, key)}</td>`).join('')}</tr>`;
    }).join('');
    out.innerHTML = `<p class="small muted">Different years, reporting scopes, missing metadata, or incomplete measures can prevent a fair comparison. No highlight means no winner is established.</p>
      <p class="small scroll-cue">Scroll horizontally to compare all towns →</p>
      <div class="table-wrap compare-table" tabindex="0" role="region" aria-label="Town comparison, scroll horizontally"><table>
        <thead><tr><th scope="col">Measure</th>${entries.map((e, i) => `<th scope="col" class="${fresh[i]}">${gradeBadge(e.s.grade)} <a href="#/town/${encodeURIComponent(e.town.id)}">${escapeHTML(label(e.town))}</a><p class="small muted">${escapeHTML(coverageText(e))}</p></th>`).join('')}</tr></thead>
        <tbody><tr><th scope="row">Reporting context</th>${entries.map((e, i) => `<td class="wrap small${fresh[i]}">${escapeHTML(reportingText(e.town))}</td>`).join('')}</tr>${rows}
        <tr><th colspan="${entries.length + 1}">Score breakdown (original component points)</th></tr>
        ${entries[0].s.components.map((c, i) => `<tr><th scope="row">${c.penalty ? `${c.label} (penalty)` : c.label}</th>${entries.map((e, j) => { const x = e.s.components[i]; return `<td class="${fresh[j]}">${!x.available ? (c.penalty ? 'Not checked' : 'Not scored') : c.penalty ? (x.points ? `−${Math.abs(x.points)}` : 'No penalty') : `${x.points} / ${c.max}`}</td>`; }).join('')}</tr>`).join('')}
        </tbody></table></div>`;
    // On a fresh table every row slides in; on an update only the new column's cells do, staggered down the rows.
    out.querySelectorAll('tbody tr').forEach((tr, n) => {
      const i = Math.min(n, 12);
      tr.classList.toggle('in', !update);
      tr.style.setProperty('--i', String(i));
      // Measure values count up as their row (or, on an update, the new column) slides in.
      tr.querySelectorAll(update ? 'td.num.col-new' : 'td.num').forEach((td) => countUp(td, i * (update ? 15 : 18) + 100));
    });
  }
  for (let i = 0; i < 3; i++) {
    root.querySelector(`#c-search-${i}`).addEventListener('input', choices);
    root.querySelector(`#c-${i}`).addEventListener('change', (event) => {
      picks[i] = event.target.value;
      choices();
      draw();
      // The picked town slides into its box (same as the map's filters).
      const sel = event.target;
      sel.classList.remove('changed');
      void sel.offsetWidth;
      sel.classList.add('changed');
    });
  }
  choices(); draw();
}
