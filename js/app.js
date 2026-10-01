import { scoreTown } from './engine/scoring.js';
import { validateDataset } from './engine/ledger.js';
import { renderMap } from './views/map.js';
import { renderTown } from './views/town.js';
import { renderRankings } from './views/rankings.js';
import { renderCompare } from './views/compare.js';
import { renderMethod } from './views/method.js';
import { renderData } from './views/data.js';

const STORAGE_KEY = 'tl-dataset';
const main = document.getElementById('main');

// Shared app state passed to every view.
export const state = {
  dataset: null,
  towns: [], // [{ town, s }] where s = scoreTown(town)
  byId: new Map(),
  source: 'demo',
};

export function setDataset(dataset, source) {
  const errors = validateDataset(dataset);
  if (errors.length) return errors;
  state.dataset = dataset;
  state.source = source;
  state.towns = dataset.towns.map((town) => ({ town, s: scoreTown(town) }));
  state.byId = new Map(state.towns.map((t) => [t.town.id, t]));
  const demoCount = dataset.towns.filter((t) => t.demo === true).length;
  const realCount = dataset.towns.length - demoCount;
  const banner = document.getElementById('demo-banner');
  banner.hidden = demoCount === 0;
  if (demoCount) {
    banner.innerHTML = realCount
      ? `<strong>${realCount} town${realCount === 1 ? '' : 's'} use${realCount === 1 ? 's' : ''} real public records</strong> (marked Verified data). The other ${demoCount} are <strong>fictional demo towns</strong> with illustrative figures.`
      : 'Showing <strong>fictional demo towns</strong>. Figures are illustrative, not real records. Load real data on the <a href="#/data">Data</a> page.';
  }
  document.body.classList.toggle('has-banner', demoCount > 0);
  return [];
}

export function persistDataset(dataset) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(dataset));
  } catch {
    /* too large or storage blocked; keep in memory only */
  }
}

export function resetToDemo() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  return loadDemo();
}

// Real towns live in data/real/, listed in data/real/index.json. They are
// shown alongside the demo towns and replace any demo town with the same id.
async function loadRealTowns() {
  try {
    // Prefer the light summary (built by scripts/build-summary.mjs); town reports
    // fetch their county file on demand (see loadTownDetail).
    const summary = await fetch('data/real/summary.json');
    if (summary.ok) return (await summary.json()).towns.map((t) => ({ ...t, demo: false }));
    const res = await fetch('data/real/index.json');
    if (!res.ok) return [];
    const { files = [] } = await res.json();
    const sets = await Promise.all(files.map((f) => fetch(`data/real/${f}`).then((r) => (r.ok ? r.json() : { towns: [] }))));
    return sets.flatMap((d) => d.towns || []).map((t) => ({ ...t, demo: false }));
  } catch {
    return [];
  }
}

// Full records (ledger, history, donors, sources, notes) for a summary town.
const detailCache = new Map();
export async function loadTownDetail(town) {
  if (!town.detailFile || town.ledger) return town;
  if (!detailCache.has(town.detailFile)) {
    detailCache.set(town.detailFile, fetch(`data/real/${town.detailFile}`).then((r) => {
      if (!r.ok) throw new Error(`Could not load ${town.detailFile} (${r.status})`);
      return r.json();
    }));
  }
  const file = await detailCache.get(town.detailFile);
  const full = file.towns.find((t) => t.id === town.id);
  if (!full) throw new Error(`${town.name} is missing from ${town.detailFile}`);
  return Object.assign(town, full, { demo: false });
}

async function loadDemo() {
  const [res, real] = await Promise.all([fetch('data/towns.json'), loadRealTowns()]);
  if (!res.ok) throw new Error(`Could not load data/towns.json (${res.status})`);
  const demo = await res.json();
  const realIds = new Set(real.map((t) => t.id));
  const errors = setDataset({ towns: [...real, ...demo.towns.filter((t) => !realIds.has(t.id))] }, real.length ? 'mixed' : 'demo');
  if (errors.length) throw new Error(errors.join(' '));
}

async function init() {
  let restored = false;
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) restored = setDataset(JSON.parse(saved), 'import').length === 0;
  } catch { /* ignore */ }
  if (!restored) {
    try {
      await loadDemo();
    } catch (err) {
      main.innerHTML = `<div class="page"><div class="card"><h2>Could not load data</h2>
        <p class="muted">${err.message}. Serve this folder with <code>npm start</code> instead of opening the file directly.</p></div></div>`;
      return;
    }
  }
  window.addEventListener('hashchange', route);
  route();
}

let cleanup = null;
export function route() {
  const hash = location.hash.replace(/^#\/?/, '') || 'map';
  const [view, ...rest] = hash.split('/');
  const arg = decodeURIComponent(rest.join('/'));
  if (typeof cleanup === 'function') cleanup();
  cleanup = null;
  main.innerHTML = '';
  document.querySelectorAll('[data-nav]').forEach((a) => {
    const active = a.dataset.nav === view || (view === 'town' && a.dataset.nav === 'rankings');
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  const views = {
    map: renderMap,
    town: renderTown,
    rankings: renderRankings,
    compare: renderCompare,
    method: renderMethod,
    data: renderData,
  };
  const render = views[view] || renderMap;
  cleanup = render(main, state, arg);
  if (view !== 'map') window.scrollTo(0, 0);
  const titles = { map: 'Map', rankings: 'Rankings', compare: 'Compare', method: 'How scores work', data: 'Data' };
  const town = view === 'town' && state.byId.get(arg);
  document.title = town ? `${town.town.name}, ${town.town.state} - Town Ledger` : `${titles[view] || 'Map'} - Town Ledger`;
}

// Theme toggle: cycles light/dark and remembers the choice per viewer.
document.getElementById('theme-toggle').addEventListener('click', () => {
  const root = document.documentElement;
  const current = root.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
  const next = current === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  try { localStorage.setItem('tl-theme', next); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('themechange', { detail: next }));
});

export function isDark() {
  const root = document.documentElement;
  return root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}

init();
