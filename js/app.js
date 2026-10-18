import { reportingFor } from './engine/reporting.js';
import { createDetailLoader } from './data/loading.js';
import { escapeHTML } from './engine/format.js';
import { scoreTown } from './engine/scoring.js';
import { assignPeers } from './engine/peers.js';
import { validateDataset } from './engine/ledger.js';
import { renderMap } from './views/map.js';
import { renderTown } from './views/town.js';
import { renderRankings } from './views/rankings.js';
import { renderStates } from './views/states.js';
import { renderCompare } from './views/compare.js';
import { renderMethod } from './views/method.js';
import { renderData } from './views/data.js';

const STORAGE_KEY = 'tl-dataset';
const main = document.getElementById('main');

// Shared app state passed to every view.
export const state = {
  dataset: null,
  towns: [], // [{ town, s, peer, provisional, completeness }] where s = scoreTown(town)
  byId: new Map(),
  source: 'real',
  routeRevision: 0,
};

export function setDataset(dataset, source) {
  const errors = validateDataset(dataset);
  if (errors.length) return errors;
  if (dataset.demo === true) dataset = { ...dataset, towns: dataset.towns.map((town) => ({ ...town, demo: true })) };
  loadDetail = createDetailLoader();
  state.dataset = dataset;
  state.source = source;
  // Each entry also gets its peer group, percentile and completeness (engine/peers.js).
  state.towns = assignPeers(dataset.towns.map((town) => ({ town, s: scoreTown(town) })));
  state.byId = new Map(state.towns.map((t) => [t.town.id, t]));
  const demoCount = dataset.towns.filter((t) => t.demo === true).length;
  const realCount = dataset.towns.length - demoCount;
  const banner = document.getElementById('demo-banner');
  banner.hidden = demoCount === 0;
  if (demoCount) {
    banner.innerHTML = realCount
      ? `<strong>${realCount} town${realCount === 1 ? '' : 's'} use${realCount === 1 ? 's' : ''} real public records</strong> (marked Public-record data). The other ${demoCount} are <strong>fictional demo towns</strong> with illustrative figures.`
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

export function resetToDefault() {
  try { sessionStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  return loadDefault();
}

// Real towns live in data/real/, listed in data/real/index.json. When any are
// present the site shows only them.
async function loadRealTowns() {
  const summary = await fetch('data/real/summary.json');
  if (summary.ok) {
    const data = await summary.json();
    if (!data.towns?.length) throw new Error('Public-record summary is empty');
    const errors = validateDataset(data);
    if (errors.length) throw new Error(errors.join(' '));
    return data.towns.map((t) => ({ ...t, demo: false }));
  }
  const res = await fetch('data/real/index.json');
  if (!res.ok) throw new Error(`Public-record index unavailable (${res.status})`);
  const { files } = await res.json();
  if (!Array.isArray(files) || !files.length) throw new Error('Public-record index is empty');
  const sets = await Promise.all(files.map(async (f) => {
    const response = await fetch(`data/real/${f}`);
    if (!response.ok) throw new Error(`Could not load ${f} (${response.status})`);
    return response.json();
  }));
  for (const data of sets) {
    const errors = validateDataset(data);
    if (errors.length) throw new Error(errors.join(' '));
  }
  return sets.flatMap((d) => d.towns).map((t) => ({ ...t, reporting: reportingFor(t), demo: false }));
}

let loadDetail = createDetailLoader();
export async function loadTownDetail(town) {
  const dataset = state.dataset;
  const full = await loadDetail(town);
  if (state.dataset === dataset && state.byId.get(town.id)?.town === town) {
    Object.assign(town, full);
    state.byId.get(town.id).s = scoreTown(town);
  }
  return full;
}

async function loadDefault() {
  const previousDataset = state.dataset;
  const real = await loadRealTowns();
  if (state.dataset !== previousDataset) return false;
  const errors = setDataset({ towns: real }, 'real');
  if (errors.length) throw new Error(errors.join(' '));
  return true;
}

async function init() {
  let restored = false;
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY);
    if (saved) restored = setDataset(JSON.parse(saved), 'import').length === 0;
  } catch { /* ignore */ }
  if (!restored) {
    try {
      await loadDefault();
    } catch (err) {
      main.innerHTML = `<div class="page"><div class="card"><h2>Could not load data</h2>
        <p class="muted">${escapeHTML(err.message)}. Serve this folder with <code>npm start</code> instead of opening the file directly.</p></div></div>`;
      return;
    }
  }
  window.addEventListener('hashchange', route);
  route();
}

let cleanup = null;
export function route() {
  state.routeRevision++;
  const [hash, search = ''] = (location.hash.replace(/^#\/?/, '') || 'map').split('?');
  const query = new URLSearchParams(search);
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
    states: renderStates,
    compare: renderCompare,
    method: renderMethod,
    data: renderData,
  };
  const render = views[view] || renderMap;
  cleanup = render(main, state, arg, query);
  if (view !== 'map') window.scrollTo(0, 0);
  const titles = { map: 'Map', rankings: 'Rankings', states: 'States', compare: 'Compare', method: 'How scores work', data: 'Data' };
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
