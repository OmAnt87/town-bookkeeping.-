// Followed towns. The list lives in this browser only (localStorage); the
// email signup goes to the mailing list that sends change alerts, tagged
// with the town id so each follower only hears about towns they follow.

import { townFingerprint, followTag } from './engine/changes.js';

// Buttondown newsletter that sends the alerts (see scripts/notify-changes.mjs).
export const BUTTONDOWN_USER = 'townview';
const SUBSCRIBE_URL = `https://buttondown.com/api/emails/embed-subscribe/${BUTTONDOWN_USER}`;
const KEY = 'tv-follows';

export function getFollows() {
  try {
    const v = JSON.parse(localStorage.getItem(KEY));
    if (v && typeof v === 'object') return { email: v.email || '', towns: v.towns || {} };
  } catch { /* ignore */ }
  return { email: '', towns: {} };
}

function save(f) {
  try { localStorage.setItem(KEY, JSON.stringify(f)); } catch { /* ignore */ }
  window.dispatchEvent(new CustomEvent('followschange'));
}

export const isFollowing = (id) => Boolean(getFollows().towns[id]);

// True when the town's books differ from when it was saved.
export function hasChanged(town) {
  const saved = getFollows().towns[town.id];
  return Boolean(saved && saved.fingerprint !== townFingerprint(town));
}

export const isEmail = (s) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());

export function setEmail(email) {
  const f = getFollows();
  f.email = String(email).trim();
  save(f);
}

export async function follow(town, email) {
  const f = getFollows();
  f.email = String(email).trim();
  f.towns[town.id] = { name: town.name, state: town.state, savedAt: new Date().toISOString(), fingerprint: townFingerprint(town) };
  save(f);
  await subscribe(f.email, town);
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

// The embed endpoint does not allow CORS reads, so the request is sent
// opaque; Buttondown then emails a confirmation link (double opt-in).
async function subscribe(email, town) {
  const body = new URLSearchParams({ email, tag: followTag(town.id), embed: '1', referrer_url: location.href });
  await fetch(SUBSCRIBE_URL, { method: 'POST', mode: 'no-cors', body });
}
