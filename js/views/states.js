import { number, escapeHTML } from '../engine/format.js';
import { stateSummary, GRADES } from '../engine/states.js';
import { isVerified } from '../charts.js';

const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`);
const plural = (n, one, many = `${one}s`) => `${number(n)} ${n === 1 ? one : many}`;

export function renderStates(root, state) {
  const real = state.towns.filter((t) => isVerified(t.town));
  const list = stateSummary(real.length ? real : state.towns);
  root.innerHTML = `
  <div class="page">
    <div class="page-head"><div><h1>States</h1><p>${real.length
      ? `Every state with verified data: how many governments are loaded, how they grade, and which parts of the score have data behind them. ${plural(real.length, 'government')} in ${plural(list.filter((x) => x.state !== 'DC').length, 'state')}${list.some((x) => x.state === 'DC') ? ' and DC' : ''}.`
      : 'No verified data is loaded, so this shows the fictional demo towns by state.'}</p></div></div>
    <div class="grid grid-2 states-grid">${list.map(card).join('')}</div>
  </div>`;

  // Cards slide in as they scroll into view; cards arriving together are staggered.
  const cards = root.querySelectorAll('.state-card.reveal');
  if (!('IntersectionObserver' in window)) { cards.forEach((c) => c.classList.add('in')); return; }
  const observer = new IntersectionObserver((entries) => {
    entries.filter((e) => e.isIntersecting).forEach((e, i) => {
      e.target.style.setProperty('--i', String(Math.min(i, 6)));
      e.target.classList.add('in');
      observer.unobserve(e.target);
    });
  }, { rootMargin: '0px 0px -40px 0px' });
  cards.forEach((c) => observer.observe(c));
  return () => observer.disconnect();
}

function card(s) {
  const types = Object.entries(s.types).sort((a, b) => b[1] - a[1]).map(([k, n]) => plural(n, k.toLowerCase(), k.toLowerCase().replace(/y$/, 'ie') + 's')).join(', ');
  const graded = GRADES.filter((g) => s.grades[g]);
  const q = `state=${encodeURIComponent(s.state)}`;
  return `
  <section class="card state-card reveal" aria-labelledby="st-${s.state}">
    <div class="card-head"><div><h2 id="st-${s.state}">${escapeHTML(s.stateName)}</h2>
      <p>${plural(s.towns, 'government')} (${types}) &middot; pop. ${number(s.population)} &middot; FY ${s.fiscalYears.length > 2 ? `${s.fiscalYears[0]}–${s.fiscalYears.at(-1)}` : s.fiscalYears.join(', ')}</p></div></div>
    <div class="state-stats">
      <div><div class="k">Median score</div><div class="v">${s.medianScore == null ? '—' : s.medianScore.toFixed(0)}</div></div>
      <div><div class="k">Median spent on services</div><div class="v">${pct(s.medianDirectShare)}</div></div>
      <div><div class="k">Median political $ / resident</div><div class="v">${s.medianInfluencePerResident == null ? '—' : `$${s.medianInfluencePerResident.toFixed(2)}`}</div></div>
      <div><div class="k">With red flags</div><div class="v">${s.redFlagTowns == null ? '—' : number(s.redFlagTowns)}</div><div class="s">${s.redFlagTowns == null ? 'not checked' : `of ${number(s.redFlagChecked)} checked`}</div></div>
      <div><div class="k">Late annual reports</div><div class="v">${s.lateFilers == null ? '—' : number(s.lateFilers)}</div><div class="s">${s.lateFilers == null ? 'not checked' : `of ${number(s.filingChecked)} checked`}</div></div>
    </div>
    <h3 class="state-sub">Grades</h3>
    <div class="grade-dist" role="img" aria-label="${graded.map((g) => `${s.grades[g]} graded ${g === '?' ? 'not graded' : g}`).join(', ')}">${graded
      .map((g) => `<span class="${g === '?' ? 'g-none' : `g-${g}`}" style="flex:${s.grades[g]}" title="${g === '?' ? 'Not graded' : `Grade ${g}`}: ${number(s.grades[g])}">${s.grades[g] / s.towns >= 0.06 ? g : ''}</span>`).join('')}</div>
    <div class="grade-key small muted">${graded.map((g) => `${g === '?' ? 'Not graded' : g} ${number(s.grades[g])}`).join(' &middot; ')}</div>
    <h3 class="state-sub">Data behind each part of the score</h3>
    <ul class="coverage">${s.coverage.map((c) => `<li><span>${escapeHTML(c.label)}</span><span class="cov-bar" aria-hidden="true"><span style="width:${Math.round(c.share * 100)}%"></span></span><span class="num">${pct(c.share)}</span></li>`).join('')}</ul>
    <div class="state-links"><a class="btn" href="#/map?${q}">Map</a><a class="btn" href="#/rankings?${q}">Rankings</a></div>
  </section>`;
}
