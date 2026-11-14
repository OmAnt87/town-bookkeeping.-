// Follow button and RSS feed link shown on a town report.

import { isFollowing, follow, unfollow, BUTTONDOWN_USER, subscribeUrl } from '../follows.js';
import { followTag } from '../engine/changes.js';
import { escapeHTML } from '../engine/format.js';
import { event } from '../track.js';

const label = (on) => (on ? '★ Following' : '☆ Follow');

export const followButton = (town) => {
  const on = isFollowing(town.id);
  return `<button class="btn${on ? ' btn-following' : ''}" id="follow-btn" type="button" data-track="follow" aria-pressed="${on}" title="Save this town to your Following list">${label(on)}</button>`;
};

// Built at deploy by scripts/build-feeds.mjs.
export const feedUrl = (id) => `feeds/${encodeURIComponent(id)}.xml`;

export const feedLink = (town) =>
  `<a class="btn" href="${feedUrl(town.id)}" type="application/rss+xml" data-track="rss" title="RSS feed of changes to this town's books">RSS feed</a>`;

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
    const wasFollowing = isFollowing(town.id);
    if (wasFollowing) unfollow(town.id); else follow(town);
    if (!wasFollowing && BUTTONDOWN_USER) offerEmail(town);
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

// After a follow, offer email alerts too. The address goes straight to the
// Buttondown signup form in a new tab, tagged with the town, and is not kept
// here. Buttondown sends a confirmation email first (double opt-in).
export function offerEmail(town, user = BUTTONDOWN_USER) {
  const dlg = document.createElement('dialog');
  dlg.className = 'follow-dialog';
  dlg.innerHTML = `
    <form class="follow-form" method="post" action="${escapeHTML(subscribeUrl(user))}" target="_blank">
      <h2>Saved ${escapeHTML(town.name)}</h2>
      <p class="small">It's on your Following list in this browser. Want an email when its books change too?</p>
      <label class="field"><span class="small">Email</span>
        <input class="input" type="email" name="email" required autocomplete="email" placeholder="you@example.com"></label>
      <input type="hidden" name="tag" value="${escapeHTML(followTag(town.id))}">
      <input type="hidden" name="embed" value="1">
      <p class="small muted">Buttondown sends the alerts and a confirmation email first. Your address is used only for these alerts; each email has an unsubscribe link. See <a href="privacy.html">Privacy</a>.</p>
      <div class="follow-dialog-actions">
        <button class="btn" type="button" data-close>No thanks</button>
        <button class="btn btn-primary" type="submit">Email me</button>
      </div>
    </form>`;
  document.body.append(dlg);
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.querySelector('[data-close]').addEventListener('click', close);
  dlg.addEventListener('cancel', () => dlg.remove());
  // The form posts to Buttondown in a new tab, which shows its "check your inbox" page.
  dlg.querySelector('form').addEventListener('submit', () => { event('email-signup'); setTimeout(close, 0); });
  dlg.showModal();
  dlg.querySelector('input[type=email]').focus();
  return dlg;
}
