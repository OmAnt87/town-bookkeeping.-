// The towns this browser follows.

import { escapeHTML, formatDate } from '../engine/format.js';
import { getFollows, unfollow, hasChanged } from '../follows.js';
import { feedUrl } from './follow-ui.js';

export function renderFollowing(root, state) {
  // The page slides in on arrival only; redraws after an unfollow stay still.
  let first = true;
  const draw = () => {
    const { towns } = getFollows();
    const ids = Object.keys(towns).sort((a, b) => towns[a].name.localeCompare(towns[b].name));
    const rows = ids.map((id, i) => {
      const saved = towns[id];
      const entry = state.byId.get(id);
      const updated = entry && hasChanged(entry.town);
      return `<li class="follow-row" style="--i:${Math.min(i, 12)}">
        <div><a href="#/town/${encodeURIComponent(id)}"><strong>${escapeHTML(saved.name)}</strong></a>${saved.state ? `, ${escapeHTML(saved.state)}` : ''}
          ${updated ? '<span class="pill pill-out">Books updated</span>' : ''}
          <div class="small muted">Saved ${formatDate(saved.savedAt.slice(0, 10))}${entry ? '' : ' · not in the loaded data'}</div></div>
        <div class="follow-actions"><a class="btn" href="${feedUrl(id)}" type="application/rss+xml">RSS</a>
          <button class="btn" type="button" data-unfollow="${escapeHTML(id)}">Unfollow</button></div></li>`;
    });
    root.innerHTML = `
    <div class="page following${first ? '' : ' still'}">
      <div class="page-head"><div><h1>Following</h1><p>Towns you saved in this browser. A badge shows when a town's books changed since you last looked.</p></div></div>
      <section class="card">
        <h2 style="margin-bottom:6px">Your towns</h2>
        ${rows.length ? `<ul class="follow-list">${rows.join('')}</ul>` : '<p class="muted follow-empty">No towns yet. Open any town and press <strong>☆ Follow</strong>.</p>'}
        <p class="small muted" style="margin:12px 0 0">This list is kept on this device only and is never sent anywhere. To hear about changes without visiting, add a town's <strong>RSS</strong> feed to a feed reader.</p>
      </section>
    </div>`;
    first = false;
    // An unfollowed row slides out before the list redraws.
    root.querySelectorAll('[data-unfollow]').forEach((b) => b.addEventListener('click', () => {
      const done = () => { unfollow(b.dataset.unfollow); draw(); };
      if (!matchMedia('(prefers-reduced-motion: no-preference)').matches) return done();
      b.disabled = true;
      b.closest('.follow-row').classList.add('leaving');
      setTimeout(done, 250);
    }));
  };
  draw();
}
