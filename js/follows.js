// Followed towns. The list lives in this browser only (localStorage) and is
// never sent anywhere; a fingerprint of each town's books shows when they
// changed since the reader last looked.

import { townFingerprint } from './engine/changes.js';

const KEY = 'tv-follows';

export function getFollows() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    if (v && typeof v === 'object' && v.towns && typeof v.towns === 'object') return { towns: v.towns };
  } catch { /* ignore */ }
  return { towns: {} };
}

// Writes only the town list, so an email saved by an older version is dropped.
function save(f) {
  try { localStorage.setItem(KEY, JSON.stringify({ towns: f.towns })); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('followschange'));
}

export const isFollowing = (id) => Boolean(getFollows().towns[id]);

// True when the town's books differ from when it was saved.
export function hasChanged(town) {
  const saved = getFollows().towns[town.id];
  return Boolean(saved && saved.fingerprint !== townFingerprint(town));
}

export function follow(town) {
  const f = getFollows();
  f.towns[town.id] = { name: town.name, state: town.state, savedAt: new Date().toISOString(), fingerprint: townFingerprint(town) };
  save(f);
}

export function unfollow(id) {
  const f = getFollows();
  delete f.towns[id];
  save(f);
}

// Marks a followed town as seen, so the "updated" note clears.
export function markSeen(town) {
  const f = getFollows();
  if (!f.towns[town.id]) return;
  f.towns[town.id].fingerprint = townFingerprint(town);
  save(f);
}
