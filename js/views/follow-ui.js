// Follow button and RSS feed link shown on a town report.

import { isFollowing, follow, unfollow } from '../follows.js';

const label = (on) => (on ? '★ Following' : '☆ Follow');

export const followButton = (town) => {
  const on = isFollowing(town.id);
  return `<button class="btn${on ? ' btn-following' : ''}" id="follow-btn" type="button" aria-pressed="${on}" title="Save this town to your Following list">${label(on)}</button>`;
};

// Built at deploy by scripts/build-feeds.mjs.
export const feedUrl = (id) => `feeds/${encodeURIComponent(id)}.xml`;

export const feedLink = (town) =>
  `<a class="btn" href="${feedUrl(town.id)}" type="application/rss+xml" title="RSS feed of changes to this town's books">RSS feed</a>`;

// Lets feed readers and browser extensions find the town's feed.
export function advertiseFeed(town) {
  const link = document.createElement('link');
  Object.assign(link, { rel: 'alternate', type: 'application/rss+xml', title: `${town.name} - TownView`, href: feedUrl(town.id) });
  link.dataset.townFeed = '';
  document.head.append(link);
}

export function wireFollow(root, town) {
  const btn = root.querySelector('#follow-btn');
  if (!btn) return;
  btn.addEventListener('click', () => {
    if (isFollowing(town.id)) unfollow(town.id); else follow(town);
    const on = isFollowing(town.id);
    btn.textContent = label(on);
    btn.setAttribute('aria-pressed', String(on));
    btn.classList.toggle('btn-following', on);
    // A quick press-pop confirms the change.
    btn.classList.remove('follow-pop');
    void btn.offsetWidth;
    btn.classList.add('follow-pop');
  });
}
