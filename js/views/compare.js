import { money, number, escapeHTML } from '../engine/format.js';
import { gradeBadge } from '../charts.js';

let picks = [];

const ROWS = [
  { label: 'Community Return Score', get: (e) => e.s.score, fmt: (v) => `${v.toFixed(1)} / 100`, better: 'high' },
  { label: 'Population', get: (e) => e.town.population, fmt: number },
  { label: 'Total money in', get: (e) => e.s.totals.revenue, fmt: (v) => money(v, { compact: true }) },
  { label: 'Share not from property tax', get: (e) => e.s.totals.nonPropertyShare, fmt: (v) => `${Math.round(v * 100)}%` },
  { label: 'Total money out', get: (e) => e.s.totals.spending, fmt: (v) => money(v, { compact: true }) },
  { label: 'Service dollars per resident', get: (e) => e.s.totals.directPerResident, fmt: (v) => money(v), better: 'high' },
  { label: 'Share of spending on services', get: (e) => e.s.totals.directShare, fmt: (v) => `${Math.round(v * 100)}%`, better: 'high' },
  { label: 'Administration & consultants', get: (e) => e.s.totals.adminShare, fmt: (v) => `${Math.round(v * 100)}%`, better: 'low' },
  { label: 'Surveillance & corporate giveaways per resident', get: (e) => (e.s.totals.redFlagKnown ? e.s.totals.redFlagPerResident : null), fmt: (v) => (v == null ? 'Not checked' : `$${v.toFixed(2)}`), better: 'low' },
  { label: 'Red flags (surveillance programs, corporate deals)', get: (e) => (e.s.totals.redFlagKnown ? e.s.totals.redFlagCount : null), fmt: (v) => (v == null ? 'Not checked' : String(v)), better: 'low' },
  { label: 'Corporate tax breaks', get: (e) => e.s.totals.taxBreaks, fmt: (v) => money(v, { compact: true }), better: 'low' },
  { label: 'Corporate lobbying & business donations', get: (e) => e.s.totals.corporateMoney, fmt: (v) => money(v, { compact: true }), better: 'low' },
  { label: 'Political money per resident', get: (e) => e.s.totals.influencePerResident, fmt: (v) => `$${v.toFixed(2)}`, better: 'low' },
  { label: 'Debt per resident', get: (e) => e.s.totals.debtPerResident, fmt: (v) => money(v), better: 'low' },
];

export function renderCompare(root, state, arg) {
  if (arg && state.byId.has(arg) && !picks.includes(arg)) picks = [arg, ...picks].slice(0, 3);
  picks = picks.filter((id) => state.byId.has(id));
  if (!picks.length) picks = [...state.towns].sort((a, b) => b.s.score - a.s.score).filter((_, i) => i === 0 || i === state.towns.length - 1).map((t) => t.town.id);
  const options = [...state.towns].sort((a, b) => a.town.name.localeCompare(b.town.name));

  root.innerHTML = `
  <div class="page">
    <div class="page-head"><div><h1>Compare towns</h1><p>Pick up to three towns to see them side by side. The best value in each row is highlighted.</p></div></div>
    <div class="compare-pickers">${[0, 1, 2].map((i) => `
      <div class="field"><label for="c-${i}">Town ${i + 1}</label>
        <select id="c-${i}" class="select" data-slot="${i}"><option value="">None</option>${options
          .map((o) => `<option value="${o.town.id}" ${picks[i] === o.town.id ? 'selected' : ''}>${escapeHTML(o.town.name)}, ${o.town.state}</option>`).join('')}</select></div>`).join('')}
    </div>
    <div id="c-out"></div>
  </div>`;

  function draw() {
    const entries = picks.map((id) => state.byId.get(id)).filter(Boolean);
    const out = root.querySelector('#c-out');
    if (!entries.length) { out.innerHTML = '<div class="card empty">Choose a town above to start.</div>'; return; }
    const compRows = entries[0].s.components.map((c, idx) => ({
      label: c.label, get: (e) => e.s.components[idx].points, fmt: (v) => (v == null ? 'Not scored' : `${v} / ${c.max}`), better: 'high',
    }));
    const row = (r) => {
      const vals = entries.map(r.get);
      const nums = vals.filter((v) => v != null);
      const best = r.better && nums.length > 1 ? (r.better === 'high' ? Math.max(...nums) : Math.min(...nums)) : null;
      return `<tr><td>${r.label}</td>${vals.map((v) => `<td class="num ${best !== null && v === best ? 'best' : ''}">${r.fmt(v)}</td>`).join('')}</tr>`;
    };
    out.innerHTML = `<div class="table-wrap compare-table"><table>
      <thead><tr><th></th>${entries.map((e) => `<th><div style="display:flex;gap:10px;align-items:center">${gradeBadge(e.s.grade)}<a href="#/town/${encodeURIComponent(e.town.id)}" style="font-size:14px">${escapeHTML(e.town.name)}, ${e.town.state}</a></div></th>`).join('')}</tr></thead>
      <tbody>${ROWS.map(row).join('')}
        <tr><td colspan="${entries.length + 1}" class="eyebrow" style="background:var(--surface-2)">Score breakdown</td></tr>
        ${compRows.map(row).join('')}</tbody></table></div>`;
  }
  root.querySelectorAll('[data-slot]').forEach((sel) => sel.addEventListener('change', () => {
    picks = [0, 1, 2].map((i) => root.querySelector(`#c-${i}`).value).filter(Boolean);
    picks = [...new Set(picks)];
    draw();
  }));
  draw();
}
