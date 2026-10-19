import { escapeHTML } from '../engine/format.js';
import { isDark } from '../app.js';

// Posts live in GitHub Discussions on this repo, one thread per town, via giscus.
// Get categoryId from https://giscus.app after enabling Discussions and installing the giscus app.
const GISCUS = {
  repo: 'OmAnt87/town-bookkeeping.-',
  repoId: 'R_kgDOU2FXPg',
  category: 'Town forums',
  categoryId: '',
};

const theme = () => (isDark() ? 'dark' : 'light');

export function renderForum(root, state, id) {
  const entry = state.byId.get(id);
  if (!entry) {
    root.innerHTML = `<div class="page"><div class="card empty"><h2>Town not found</h2><p>It may not be in the loaded dataset.</p><a class="btn" href="#/rankings">Browse all towns</a></div></div>`;
    return;
  }
  const { town } = entry;
  const report = `#/town/${encodeURIComponent(town.id)}`;
  root.innerHTML = `
  <div class="page">
    <div class="report-head">
      <div>
        <div class="crumbs"><a href="#/map">Map</a> / <a href="#/rankings">Rankings</a> / <a href="${report}">${escapeHTML(town.name)}</a> / Forum</div>
        <h1>${escapeHTML(town.name)} forum</h1>
        <p class="muted">Talk about this town's money with other residents. Discussion is hosted on GitHub Discussions; sign in with GitHub to post.</p>
      </div>
      <a class="btn" href="${report}">Back to report</a>
    </div>
    <section class="card">
      ${GISCUS.categoryId ? '<div class="giscus"></div>' : '<p class="muted">The forum is not set up yet.</p>'}
    </section>
  </div>`;
  if (!GISCUS.categoryId) return;

  const script = document.createElement('script');
  script.src = 'https://giscus.app/client.js';
  script.async = true;
  script.crossOrigin = 'anonymous';
  Object.entries({
    repo: GISCUS.repo,
    'repo-id': GISCUS.repoId,
    category: GISCUS.category,
    'category-id': GISCUS.categoryId,
    mapping: 'specific',
    term: town.id,
    strict: '1',
    'reactions-enabled': '1',
    'emit-metadata': '0',
    'input-position': 'top',
    theme: theme(),
    lang: 'en',
    loading: 'lazy',
  }).forEach(([k, v]) => script.setAttribute(`data-${k}`, v));
  root.querySelector('.giscus').after(script);

  const onTheme = () => {
    root.querySelector('iframe.giscus-frame')?.contentWindow.postMessage({ giscus: { setConfig: { theme: theme() } } }, 'https://giscus.app');
  };
  window.addEventListener('themechange', onTheme);
  return () => window.removeEventListener('themechange', onTheme);
}
