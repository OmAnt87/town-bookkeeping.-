import { setDataset, persistDataset, resetToDemo, loadLedger } from '../app.js';
import { downloadFile, ICONS } from '../charts.js';
import { escapeHTML } from '../engine/format.js';

const SAMPLE = {
  towns: [{
    id: 'example-township-pa', name: 'Example Township', state: 'PA', stateName: 'Pennsylvania', county: 'Example County',
    type: 'Township', lat: 40.8, lng: -77.7, population: 12000, fiscalYear: 2026, asOf: '2026-09-30',
    revenue: { propertyTax: 5200000, salesTax: 0, stateAid: 1400000, federalGrants: 300000, feesPermits: 450000, utilityCharges: 900000, finesForfeitures: 60000, borrowing: 0, otherRevenue: 80000 },
    spending: { publicSafety: 3100000, roads: 1500000, utilities: 950000, parks: 420000, healthServices: 150000, administration: 900000, consultants: 180000, debtService: 650000 },
    influence: { pacContributions: 8000, developerContributions: 5000, unionContributions: 2000, lobbyingPaid: 0 },
    topDonors: [{ name: 'Example PAC', type: 'PAC', recipient: 'Township supervisor', amount: 5000 }],
    transparency: { budgetOnline: true, openCheckbook: false, auditOnTime: true, competitiveBidding: true, meetingsRecorded: true, conflictDisclosures: false },
    debt: 9000000,
    history: [{ year: 2025, revenue: 8100000, spending: 7900000 }, { year: 2026, revenue: 8390000, spending: 7850000 }],
    ledger: [{ date: '2026-03-01', flow: 'in', category: 'stateAid', counterparty: 'State Treasury', description: 'Municipal aid', amount: 700000, source: 'https://example.gov/budget.pdf' }],
    sources: [{ label: 'FY2026 adopted budget', url: 'https://example.gov/budget.pdf' }],
  }],
};

export function renderData(root, state) {
  root.innerHTML = `
  <div class="page">
    <div class="page-head"><div><h1>Data</h1><p>Load your own town's numbers, download what is loaded now, or learn where real figures come from.</p></div></div>
    <div class="grid grid-2">
      <section class="card">
        <h2 style="margin-bottom:6px">Load a dataset</h2>
        <p class="small muted">A JSON file with a <code>towns</code> array in the format below. It stays in this browser tab and is not uploaded anywhere.</p>
        <label class="drop" id="drop" for="file">
          <strong>Choose a JSON file</strong> or drop it here
          <input id="file" type="file" accept="application/json,.json" hidden>
        </label>
        <div id="msg" role="status"></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:14px">
          <button class="btn" id="dl-all" type="button">${ICONS.download} Download loaded data</button>
          <button class="btn" id="dl-sample" type="button">${ICONS.download} Sample file</button>
          <button class="btn" id="reset" type="button">Restore demo data</button>
        </div>
        <p class="small muted" style="margin:14px 0 0">Loaded now: <strong>${state.towns.length} towns</strong> (${{ demo: 'fictional demo data', mixed: 'demo towns plus verified real towns', import: 'your imported file' }[state.source] || state.source}).</p>
      </section>
      <section class="card prose">
        <h2 style="margin:0 0 8px">Where real numbers come from</h2>
        <ul class="small">
          <li><strong>Budgets and audits:</strong> each town's adopted budget and annual audit (ACFR), usually on the town website or the state comptroller's local-government portal.</li>
          <li><strong>Census of Governments finance data:</strong> <a href="https://www.census.gov/programs-surveys/gov-finances.html" target="_blank" rel="noopener">census.gov/gov-finances</a>. Revenue and spending by category for every local government. Import with <code>scripts/import-census-finance.mjs</code>.</li>
          <li><strong>Federal grants:</strong> <a href="https://www.usaspending.gov" target="_blank" rel="noopener">USAspending.gov</a>. Pull with <code>scripts/fetch-usaspending.mjs</code>.</li>
          <li><strong>Campaign and PAC money:</strong> local races are filed with state election offices or county clerks. Federal PACs are on <a href="https://www.fec.gov/data/" target="_blank" rel="noopener">fec.gov/data</a>. Import a contributions CSV with <code>scripts/import-contributions.mjs</code>.</li>
        </ul>
        <p class="small muted">Full field reference: <code>docs/DATA_SCHEMA.md</code> in the repository.</p>
      </section>
    </div>
    <section class="card" style="margin-top:16px">
      <details>
        <summary><h2 style="display:inline">File format</h2> <span class="small muted">(show example)</span></summary>
        <pre>${escapeHTML(JSON.stringify(SAMPLE, null, 2))}</pre>
      </details>
    </section>
  </div>`;

  const $ = (sel) => root.querySelector(sel);
  const say = (html, ok) => { $('#msg').innerHTML = `<div class="notice ${ok ? 'ok' : 'err'}">${html}</div>`; };

  async function load(file) {
    try {
      const data = JSON.parse(await file.text());
      const errors = setDataset(data, 'import');
      if (errors.length) return say(`This file has problems:<ul>${errors.map((e) => `<li>${escapeHTML(e)}</li>`).join('')}</ul>`, false);
      persistDataset(data);
      say(`Loaded ${data.towns.length} town${data.towns.length === 1 ? '' : 's'}. <a href="#/map">View the map</a>.`, true);
    } catch (err) {
      say(`Could not read that file: ${escapeHTML(err.message)}`, false);
    }
  }
  $('#file').addEventListener('change', (e) => e.target.files[0] && load(e.target.files[0]));
  const drop = $('#drop');
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); if (e.dataTransfer.files[0]) load(e.dataTransfer.files[0]); });
  $('#dl-all').addEventListener('click', async () => {
    await Promise.all(state.dataset.towns.map((t) => loadLedger(t).catch(() => [])));
    downloadFile('town-ledger-data.json', JSON.stringify({ towns: state.dataset.towns.map(({ ledgerCount, ...t }) => t) }, null, 2), 'application/json');
  });
  $('#dl-sample').addEventListener('click', () => downloadFile('town-ledger-sample.json', JSON.stringify(SAMPLE, null, 2), 'application/json'));
  $('#reset').addEventListener('click', async () => {
    await resetToDemo();
    say('Demo data restored.', true);
  });
}
