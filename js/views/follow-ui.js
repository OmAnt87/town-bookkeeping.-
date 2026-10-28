// Follow button shown on a town report.

import { isFollowing, follow, unfollow } from '../follows.js';

const label = (on) => (on ? '★ Following' : '☆ Follow');

export const followButton = (town) => {
  const on = isFollowing(town.id);
  return `<button class="btn${on ? ' btn-following' : ''}" id="follow-btn" type="button" aria-pressed="${on}" title="Save this town to your Following list">${label(on)}</button>`;
};

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
