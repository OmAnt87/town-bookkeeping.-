import { escapeHTML } from '../engine/format.js';
import { isDark } from '../app.js';
import { revealOnScroll } from '../charts.js';

// Posts live in GitHub Discussions on this repo, one thread per town, via giscus.
// Ids come from https://giscus.app. Announcements lets only maintainers and giscus start threads.
const GISCUS = {
  repo: 'OmAnt87/town-bookkeeping.-',
  repoId: 'R_kgDOU2FXPg',
  category: 'Announcements',
  categoryId: 'DIC_kwDOU2FXPs4DJESg',
};

const theme = () => (isDark() ? 'dark' : 'light');

export function renderForum(root, state, id) {
  const entry = state.byId.get(id);
  if (!entry) {
    root.innerHTML = `<div class="page"><div class="card empty notice-card"><h2>Town not found</h2><p>It may not be in the loaded dataset.</p><a class="btn" href="#/rankings">Browse all towns</a></div></div>`;
    return;
  }
  const { town } = entry;
  const report = `#/town/${encodeURIComponent(town.id)}`;
  root.innerHTML = `
  <div class="page forum">
    <div class="report-head">
      <div>
        <div class="crumbs"><a href="#/map">Map</a> / <a href="#/rankings">Rankings</a> / <a href="${report}">${escapeHTML(town.name)}</a> / Forum</div>
        <h1>${escapeHTML(town.name)} forum</h1>
        <p class="muted">Talk about this town's money with other residents. Discussion is hosted on GitHub Discussions; sign in with GitHub to post.</p>
      </div>
      <a class="btn" href="${report}">Back to report</a>
    </div>
    <section class="card forum-card">
      ${GISCUS.categoryId ? '<div class="forum-skeleton" aria-hidden="true"><span></span><span></span><span></span><span></span></div><div class="giscus"></div>' : '<p class="muted">The forum is not set up yet.</p>'}
    </section>
  </div>`;
  const card = root.querySelector('.forum-card');
  const unreveal = revealOnScroll([card]);
  if (!GISCUS.categoryId) return unreveal;

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
  // Fade the widget in once giscus has rendered (it posts a resize message), or after 4s regardless.
  // The loading placeholder fades out at the same time and is then removed.
  let unskeleton;
  const markLoaded = () => {
    if (card.classList.contains('loaded')) return;
    card.classList.add('loaded');
    unskeleton = setTimeout(() => card.querySelector('.forum-skeleton')?.remove(), 400);
  };
  const onLoaded = (e) => { if (e.origin === 'https://giscus.app') markLoaded(); };
  window.addEventListener('message', onLoaded);
  const fallback = setTimeout(markLoaded, 4000);
  return () => {
    window.removeEventListener('themechange', onTheme);
    window.removeEventListener('message', onLoaded);
    clearTimeout(fallback);
    clearTimeout(unskeleton);
    unreveal();
  };
}
