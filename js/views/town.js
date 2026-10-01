import { revenueRows, spendingRows, influenceRows, transparencyCount } from '../engine/scoring.js';
import { TRANSPARENCY_CHECKS, REVENUE_CATEGORIES, SPENDING_CATEGORIES, INFLUENCE_CATEGORIES } from '../engine/categories.js';
import { filterLedger, summarizeLedger, sortLedger, ledgerToCSV, categoryLabel, FLOWS } from '../engine/ledger.js';
import { money, number, escapeHTML, formatDate } from '../engine/format.js';
import { loadLedger } from '../app.js';
import { gradeBadge, verifiedPill, isVerified, barList, splitBar, legendKey, lineChart, downloadFile, ICONS } from '../charts.js';

const PAGE = 15;

export function renderTown(root, state, id) {
  const entry = state.byId.get(id);
  if (!entry) {
    root.innerHTML = `<div class="page"><div class="card empty"><h2>Town not found</h2><p>It may not be in the loaded dataset.</p><a class="btn" href="#/rankings">Browse all towns</a></div></div>`;
    return;
  }
  const { town, s } = entry;
  const t = s.totals;
  // Real towns are ranked only against other real towns, demo towns against demo towns.
  const peers = state.towns.filter((x) => isVerified(x.town) === isVerified(town) && x.s.grade !== '?');
  const rank = [...peers].sort((a, b) => b.s.score - a.s.score).findIndex((x) => x.town.id === id) + 1;
  const peerLabel = isVerified(town) ? 'towns with verified data' : 'demo towns';

  const rev = revenueRows(town).map((r) => ({ ...r, color: r.propertyTax ? 'var(--series-property)' : r.reserve ? 'var(--baseline)' : 'var(--series-in)' }));
  const revOrder = (r) => (r.propertyTax ? 0 : r.reserve ? 2 : 1);
  rev.sort((a, b) => revOrder(a) - revOrder(b) || b.amount - a.amount);
  const spend = spendingRows(town)
    .map((r) => ({ ...r, color: r.direct ? 'var(--series-in)' : 'var(--series-overhead)' }))
    .sort((a, b) => (a.direct === b.direct ? b.amount - a.amount : a.direct ? -1 : 1));
  const hasInfluence = town.influence && Object.keys(town.influence).length > 0;
  const hasDebt = typeof town.debt === 'number';
  const NA = '<div class="v muted" style="font-size:18px">Not available</div>';
  const infl = influenceRows(town).filter((r) => r.key in (town.influence || {})).map((r) => ({ ...r, color: 'var(--grade-f)' }));
  const pctOf = (v) => `${Math.round(v * 100)}%`;
  const biggestNonProp = rev.filter((r) => !r.propertyTax && !r.reserve).sort((a, b) => b.amount - a.amount)[0];

  root.innerHTML = `
  <div class="page">
    <div class="report-head">
      <div>
        <div class="crumbs"><a href="#/map">Map</a> / <a href="#/rankings">Rankings</a> / ${escapeHTML(town.name)}</div>
        <h1>${escapeHTML(town.name)} ${verifiedPill(town)}</h1>
        <div class="meta-row">
          <span>${escapeHTML([town.county, town.stateName || town.state].filter(Boolean).join(', '))}</span>
          <span>${escapeHTML(town.type || 'Municipality')}</span>
          <span>Population ${number(town.population)}</span>
          <span>Fiscal year ${town.fiscalYear}</span>
          <span>Data as of ${town.asOf ? formatDate(town.asOf) : 'n/a'}</span>
        </div>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a class="btn" href="#/compare/${encodeURIComponent(town.id)}">Compare</a>
        <button class="btn" id="dl-report" type="button">${ICONS.download} Download data</button>
      </div>
    </div>

    <section class="scorecard" aria-label="Score">
      <div class="card">
        <div class="eyebrow">Community Return Score</div>
        <div class="score-main" style="margin-top:12px">
          ${gradeBadge(s.grade, 'lg')}
          <div class="score-text">
            <div class="score-value num">${s.score.toFixed(1)}<small> / 100</small></div>
            <div class="track g-${s.grade}" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${s.score}" aria-label="Score"><span style="width:${s.score}%"></span></div>
            ${s.grade === '?' ? '<div class="small muted"><strong>Not graded yet:</strong> a letter grade needs data for at least half of the score.</div>' : `<div class="small muted">Ranked ${rank} of ${peers.length} ${peerLabel}</div>`}
          </div>
        </div>
        <p class="basis">Based on how much spending reaches residents as services, overhead, outside political money, transparency practices, and debt.${s.coverage.scored < s.coverage.total ? ` <strong>Scored on ${s.coverage.scored} of ${s.coverage.total} parts</strong>; parts without data are left out rather than guessed.` : ''}</p>
        <div class="callout">${plainSummary(town, s)}</div>
      </div>
      <div class="card">
        <div class="card-head"><h2>What makes up the score</h2><a class="small" href="#/method">How it works</a></div>
        <div class="components">${s.components
          .map(
            (c) => `<div class="component-row">
              <div class="top"><strong>${c.label}</strong><span class="num ${c.available ? '' : 'muted'}">${c.available ? `${c.points} / ${c.max}` : 'Not scored'}</span></div>
              <div class="track" aria-hidden="true"><span style="width:${c.ratio * 100}%"></span></div>
              <p>${escapeHTML(c.detail)}</p></div>`,
          )
          .join('')}</div>
      </div>
    </section>

    <section class="tiles" aria-label="Key numbers">
      <div class="tile"><div class="k">Total money in</div><div class="v num">${money(t.revenue, { compact: true })}</div><div class="s">${money(t.revenue / town.population)} per resident</div></div>
      <div class="tile"><div class="k">Not from property tax</div><div class="v num">${money(t.nonPropertyRevenue, { compact: true })}</div><div class="s">${pctOf(t.nonPropertyShare)} of all revenue</div></div>
      <div class="tile"><div class="k">Services per resident</div><div class="v num">${money(t.directPerResident)}</div><div class="s">${pctOf(t.directShare)} of spending</div></div>
      <div class="tile"><div class="k">Political money</div>${hasInfluence ? `<div class="v num">${money(t.influence, { compact: true })}</div><div class="s">${money(t.influencePerResident)} per resident</div>` : `${NA}<div class="s">No filings loaded yet</div>`}</div>
      <div class="tile"><div class="k">Debt</div>${hasDebt ? `<div class="v num">${money(town.debt, { compact: true })}</div><div class="s">${money(t.debtPerResident)} per resident</div>` : `${NA}<div class="s">No debt statement loaded</div>`}</div>
    </section>

    <div class="grid grid-2" style="margin-bottom:16px">
      <section class="card" aria-labelledby="h-in">
        <div class="card-head"><div><h2 id="h-in">Money in</h2><p>Every revenue stream, with property tax set apart.</p></div><span class="num muted small">${money(t.revenue)}</span></div>
        ${splitBar([{ label: 'Property tax', amount: t.propertyTax, color: 'var(--series-property)' }, { label: 'Other sources', amount: t.nonPropertyRevenue, color: 'var(--series-in)' }, ...(t.reserves ? [{ label: 'Surplus from prior years', amount: t.reserves, color: 'var(--baseline)' }] : [])])}
        ${legendKey([{ label: `Property tax ${pctOf(t.propertyTax / (t.revenue || 1))}`, color: 'var(--series-property)' }, { label: `Other sources ${pctOf(t.nonPropertyShare)}`, color: 'var(--series-in)' }, ...(t.reserves ? [{ label: `Surplus from prior years ${pctOf(t.reserves / t.revenue)}`, color: 'var(--baseline)' }] : [])])}
        ${barList(rev, { total: t.revenue })}
        ${biggestNonProp ? `<p class="small muted" style="margin:14px 0 0">Largest source besides property tax: <strong>${biggestNonProp.label.toLowerCase()}</strong> (${money(biggestNonProp.amount, { compact: true })}).${town.revenue.borrowing ? ` Borrowing brought in ${money(town.revenue.borrowing, { compact: true })} that must be repaid with interest.` : ''}</p>` : ''}
      </section>
      <section class="card" aria-labelledby="h-out">
        <div class="card-head"><div><h2 id="h-out">Money out</h2><p>Direct services versus overhead and debt.</p></div><span class="num muted small">${money(t.spending)}</span></div>
        ${splitBar([{ label: 'Direct services', amount: t.directSpending, color: 'var(--series-in)' }, { label: 'Overhead & debt', amount: t.spending - t.directSpending, color: 'var(--series-overhead)' }])}
        ${legendKey([{ label: `Direct services ${pctOf(t.directShare)}`, color: 'var(--series-in)' }, { label: `Overhead & debt ${pctOf(1 - t.directShare)}`, color: 'var(--series-overhead)' }])}
        ${barList(spend, { total: t.spending })}
        <p class="small muted" style="margin:14px 0 0">${t.balance >= 0 ? `The town took in ${money(t.balance, { compact: true })} more than it spent.` : `The town spent ${money(-t.balance, { compact: true })} more than it took in.`}</p>
      </section>
    </div>

    <div class="grid grid-2" style="margin-bottom:16px">
      <section class="card" aria-labelledby="h-pol">
        <div class="card-head"><div><h2 id="h-pol">Political money</h2><p>PAC, business and union contributions to local officials, plus lobbying the town pays for. This money does not pass through the town budget.</p></div></div>
        ${hasInfluence ? barList(infl) : '<p class="muted small">No campaign-finance filings have been loaded for this town yet, so political money is unknown. It is not counted in the score.</p>'}
        <h3 style="margin:18px 0 8px">Top contributors</h3>
        ${town.topDonors?.length ? `<div class="table-wrap"><table><thead><tr><th>Contributor</th><th>Type</th><th>Recipient</th><th class="r">Amount</th></tr></thead><tbody>${town.topDonors
          .map((d) => `<tr><td class="wrap">${escapeHTML(d.name)}</td><td><span class="pill">${escapeHTML(d.type)}</span></td><td class="wrap">${escapeHTML(d.recipient || '')}</td><td class="r num">${money(d.amount)}</td></tr>`)
          .join('')}</tbody></table></div>` : '<p class="muted small">No contributor records loaded.</p>'}
      </section>
      <section class="card" aria-labelledby="h-tr">
        <div class="card-head"><div><h2 id="h-tr">Transparency check</h2><p>${Object.values(town.transparency || {}).some((v) => typeof v === 'boolean') ? `${transparencyCount(town)} of ${TRANSPARENCY_CHECKS.length} good-government practices confirmed.` : 'Not checked yet for this town.'}</p></div></div>
        <ul class="checklist">${TRANSPARENCY_CHECKS.map((c) => {
          const v = town.transparency?.[c.key];
          const [cls, icon, word] = v === true ? ['yes', ICONS.check, 'Yes'] : v === false ? ['no', ICONS.cross, 'No'] : ['unk', ICONS.unknown, 'Unknown'];
          return `<li><span class="${cls}">${icon}</span><span>${c.label}</span><span class="state ${cls}">${word}</span></li>`;
        }).join('')}</ul>
        <h3 style="margin:22px 0 8px">Trend over time</h3>
        ${legendKey([{ label: 'Money in', color: 'var(--series-in)' }, { label: 'Money out', color: 'var(--series-out)' }])}
        <div id="trend"></div>
      </section>
    </div>

    <section class="card" aria-labelledby="h-ledger" style="margin-bottom:16px">
      <div class="card-head"><div><h2 id="h-ledger">Ledger</h2><p>Individual transactions for fiscal year ${town.fiscalYear}. Search, filter, or export to a spreadsheet.</p></div>
        <button class="btn" id="dl-ledger" type="button">${ICONS.download} Export CSV</button></div>
      <div class="toolbar">
        <div class="field"><label for="l-q">Search</label><input id="l-q" class="input" type="search" placeholder="Vendor, donor or description"></div>
        <div class="field"><label for="l-flow">Type</label><select id="l-flow" class="select"><option value="all">All types</option>${Object.entries(FLOWS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div class="field"><label for="l-cat">Category</label><select id="l-cat" class="select"><option value="all">All categories</option></select></div>
      </div>
      <div class="table-wrap"><table>
        <thead><tr>
          <th><button type="button" data-sort="date">Date ${ICONS.sort}</button></th>
          <th>Type</th><th>Category</th><th>Counterparty</th><th>Description</th>
          <th class="r"><button type="button" data-sort="amount">Amount ${ICONS.sort}</button></th>
        </tr></thead>
        <tbody id="l-body"><tr><td colspan="6" class="empty">Loading transactions…</td></tr></tbody>
      </table></div>
      <div class="pager"><span id="l-sum"></span><span style="display:flex;gap:8px"><button class="btn" id="l-prev" type="button">Previous</button><button class="btn" id="l-next" type="button">Next</button></span></div>
    </section>

    <section class="card" aria-labelledby="h-src">
      <h2 id="h-src" style="margin-bottom:8px">Sources</h2>
      <ul class="small" style="margin:0;padding-left:18px">${(town.sources || [])
        .map((src) => `<li>${src.url ? `<a href="${escapeHTML(src.url)}" target="_blank" rel="noopener">${escapeHTML(src.label)}</a>` : escapeHTML(src.label)}</li>`)
        .join('') || '<li>No sources listed.</li>'}</ul>
      ${(town.notes || []).length ? `<h3 style="margin:16px 0 6px">How these figures were prepared</h3><ul class="small muted" style="margin:0;padding-left:18px">${town.notes.map((n) => `<li>${escapeHTML(n)}</li>`).join('')}</ul>` : ''}
    </section>
  </div>`;

  if (town.history?.length > 1) {
    lineChart(root.querySelector('#trend'), [
      { label: 'Money in', color: 'var(--series-in)', values: town.history.map((h) => ({ x: h.year, y: h.revenue })) },
      { label: 'Money out', color: 'var(--series-out)', values: town.history.map((h) => ({ x: h.year, y: h.spending })) },
    ]);
  } else {
    root.querySelector('#trend').innerHTML = '<p class="muted small">No multi-year history loaded.</p>';
  }

  // Ledger table state
  const L = { q: '', flow: 'all', category: 'all', sort: 'date', dir: 'desc', page: 0 };
  const $ = (sel) => root.querySelector(sel);
  const current = () => sortLedger(filterLedger(town.ledger || [], { flow: L.flow, category: L.category, query: L.q }), L.sort, L.dir);
  function drawLedger() {
    const rows = current();
    const pages = Math.max(1, Math.ceil(rows.length / PAGE));
    L.page = Math.min(L.page, pages - 1);
    const slice = rows.slice(L.page * PAGE, L.page * PAGE + PAGE);
    $('#l-body').innerHTML = slice.length
      ? slice
          .map((e) => `<tr>
            <td class="num">${formatDate(e.date)}</td>
            <td><span class="pill pill-${e.flow}">${FLOWS[e.flow]}</span></td>
            <td class="wrap">${escapeHTML(categoryLabel(e.category))}</td>
            <td class="wrap">${escapeHTML(e.counterparty)}</td>
            <td class="muted wrap">${escapeHTML(e.description)}</td>
            <td class="r num">${e.flow === 'out' ? '-' : ''}${money(e.amount)}</td></tr>`)
          .join('')
      : '<tr><td colspan="6" class="empty">No transactions match these filters.</td></tr>';
    const sum = summarizeLedger(rows);
    $('#l-sum').innerHTML = `${rows.length} transactions &middot; In ${money(sum.in, { compact: true })} &middot; Out ${money(sum.out, { compact: true })} &middot; Political ${money(sum.influence, { compact: true })} &middot; Page ${L.page + 1} of ${pages}`;
    $('#l-prev').disabled = L.page === 0;
    $('#l-next').disabled = L.page >= pages - 1;
  }
  $('#l-q').addEventListener('input', (e) => { L.q = e.target.value; L.page = 0; drawLedger(); });
  $('#l-flow').addEventListener('change', (e) => { L.flow = e.target.value; L.page = 0; drawLedger(); });
  $('#l-cat').addEventListener('change', (e) => { L.category = e.target.value; L.page = 0; drawLedger(); });
  $('#l-prev').addEventListener('click', () => { L.page--; drawLedger(); });
  $('#l-next').addEventListener('click', () => { L.page++; drawLedger(); });
  root.querySelectorAll('[data-sort]').forEach((b) =>
    b.addEventListener('click', () => {
      const k = b.dataset.sort;
      L.dir = L.sort === k && L.dir === 'desc' ? 'asc' : 'desc';
      L.sort = k;
      drawLedger();
    }),
  );
  $('#dl-ledger').addEventListener('click', () => downloadFile(`${town.id}-ledger.csv`, ledgerToCSV(town, current())));
  $('#dl-report').addEventListener('click', async () => {
    await loadLedger(town).catch(() => []);
    const { ledgerCount, ...full } = town;
    downloadFile(`${town.id}.json`, JSON.stringify({ towns: [full] }, null, 2), 'application/json');
  });
  let gone = false;
  loadLedger(town)
    .then((entries) => {
      if (gone) return;
      const have = new Set(entries.map((e) => e.category));
      $('#l-cat').insertAdjacentHTML('beforeend', [...REVENUE_CATEGORIES, ...SPENDING_CATEGORIES, ...INFLUENCE_CATEGORIES]
        .filter((c) => have.has(c.key))
        .map((c) => `<option value="${c.key}">${c.label}</option>`).join(''));
      drawLedger();
    })
    .catch(() => { if (!gone) $('#l-body').innerHTML = '<tr><td colspan="6" class="empty">Could not load transactions. Check your connection and reload.</td></tr>'; });
  return () => { gone = true; };
}

function plainSummary(town, s) {
  const t = s.totals;
  const scored = s.components.filter((c) => c.available);
  if (!scored.length) return '<strong>In plain terms:</strong> not enough data is loaded to judge this town yet.';
  const strongest = [...scored].sort((a, b) => b.ratio - a.ratio)[0];
  const weakest = [...scored].sort((a, b) => a.ratio - b.ratio)[0];
  const per100 = Math.round(t.directShare * 100);
  return `<strong>In plain terms:</strong> for every $100 ${escapeHTML(town.name)} spends, about $${per100} pays for services residents use directly.
    Its strongest area is <strong>${strongest.label.toLowerCase()}</strong>; its weakest is <strong>${weakest.label.toLowerCase()}</strong>.`;
}
