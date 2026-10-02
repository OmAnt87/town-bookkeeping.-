import { escapeHTML } from '../engine/format.js';
import { metric, metricText, coverageText, comparable } from '../engine/metrics.js';
import { reportingText } from '../engine/reporting.js';
import { gradeBadge } from '../charts.js';

let picks = ['', '', ''];
const ROWS = [
  ['score', 'Community Return Score', 'high'], ['population', 'Population'],
  ['revenue', 'Total money in'], ['nonPropertyShare', 'Share not from property tax'],
  ['spending', 'Total money out'], ['directPerResident', 'Service dollars per resident', 'high'],
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
  root.innerHTML = `<div class="page">
    <div class="page-head"><div><h1>Compare towns</h1><p>Choose up to three towns. Highlights appear only for available values with matching reporting context.</p></div></div>
    <div class="compare-pickers">${[0, 1, 2].map((i) => `<div class="field">
      <label for="c-search-${i}">Find town ${i + 1}</label><input id="c-search-${i}" class="input" type="search" placeholder="Town, county or state">
      <label for="c-${i}">Town ${i + 1}</label><select class="select" id="c-${i}" data-slot="${i}"></select></div>`).join('')}</div>
    <div id="c-out"></div></div>`;
  function choices() {
    for (let i = 0; i < 3; i++) {
      const q = root.querySelector(`#c-search-${i}`).value.trim().toLowerCase();
      root.querySelector(`#c-${i}`).innerHTML = '<option value="">None</option>' + options
        .filter(({ town }) => town.id === picks[i] || (!picks.includes(town.id) && label(town).toLowerCase().includes(q)))
        .map(({ town }) => `<option value="${escapeHTML(town.id)}" ${town.id === picks[i] ? 'selected' : ''}>${escapeHTML(label(town))}</option>`).join('');
    }
  }
  function draw() {
    const entries = picks.filter(Boolean).map((id) => state.byId.get(id));
    const out = root.querySelector('#c-out');
    if (!entries.length) { out.innerHTML = '<div class="card empty">Find and select a town above to start.</div>'; return; }
    const rows = ROWS.map(([key, title, better]) => {
      const values = entries.map((e) => metric(e, key));
      const best = better && comparable(entries, key) ? Math[better === 'high' ? 'max' : 'min'](...values.map((m) => m.value)) : null;
      return `<tr><th scope="row">${title}</th>${entries.map((e, i) => `<td class="num ${best !== null && values[i].value === best ? 'best' : ''}" title="${escapeHTML(values[i].reason)}">${metricText(e, key)}</td>`).join('')}</tr>`;
    }).join('');
    out.innerHTML = `<p class="small muted">Different years, reporting scopes, missing metadata, or incomplete measures can prevent a fair comparison. No highlight means no winner is established.</p>
      <p class="small scroll-cue">Scroll horizontally to compare all towns →</p>
      <div class="table-wrap compare-table" tabindex="0" role="region" aria-label="Town comparison, scroll horizontally"><table>
        <thead><tr><th scope="col">Measure</th>${entries.map((e) => `<th scope="col">${gradeBadge(e.s.grade)} <a href="#/town/${encodeURIComponent(e.town.id)}">${escapeHTML(label(e.town))}</a><p class="small muted">${escapeHTML(coverageText(e))}</p></th>`).join('')}</tr></thead>
        <tbody><tr><th scope="row">Reporting context</th>${entries.map((e) => `<td class="wrap small">${escapeHTML(reportingText(e.town))}</td>`).join('')}</tr>${rows}
        <tr><th colspan="${entries.length + 1}">Score breakdown (original component points)</th></tr>
        ${entries[0].s.components.map((c, i) => `<tr><th scope="row">${c.label}</th>${entries.map((e) => `<td>${e.s.components[i].available ? `${e.s.components[i].points} / ${c.max}` : 'Not scored'}</td>`).join('')}</tr>`).join('')}
        </tbody></table></div>`;
  }
  for (let i = 0; i < 3; i++) {
    root.querySelector(`#c-search-${i}`).addEventListener('input', choices);
    root.querySelector(`#c-${i}`).addEventListener('change', (event) => { picks[i] = event.target.value; choices(); draw(); });
  }
  choices(); draw();
}
