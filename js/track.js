// Cookieless visit counts, sent to GoatCounter (https://www.goatcounter.com).
// No script is loaded from GoatCounter: each count is one request to its
// /count endpoint. A count holds a path or event name, the page title and, on
// the first page view only, the referring site. Nothing typed into the site,
// no cookies and no identifiers are sent. See privacy.html.
//
// Counting is off until GOATCOUNTER_CODE is set, and never runs off
// townview.org, under Do Not Track or Global Privacy Control, or after a
// visitor opts out on the privacy page.

// The site code: "townview" for townview.goatcounter.com. Empty turns counting off.
export const GOATCOUNTER_CODE = '';
export const SITE_HOSTS = ['townview.org', 'www.townview.org'];
export const OPT_OUT_KEY = 'tv-no-count';

export function trackingAllowed({ code = GOATCOUNTER_CODE, host = '', dnt = false, gpc = false, optOut = false } = {}) {
  return Boolean(code) && SITE_HOSTS.includes(host) && !dnt && !gpc && !optOut;
}

// App views count under /app/... so they stay apart from the plain town and
// state pages (/town/<id>/). Query strings (?state=NJ) are left out.
export function appPath(view, arg = '') {
  const v = String(view || 'map').split('?')[0];
  const a = String(arg || '').split('?')[0];
  return `/app/${v}${a ? `/${a}` : ''}`;
}

// The request for one count. `event` marks a named action rather than a page.
export function countUrl({ code = GOATCOUNTER_CODE, path, title = '', referrer = '', event = false }) {
  const q = new URLSearchParams({ p: path });
  if (title) q.set('t', title);
  if (referrer) q.set('r', referrer);
  if (event) q.set('e', 'true');
  q.set('rnd', Math.random().toString(36).slice(2, 10));
  return `https://${code}.goatcounter.com/count?${q}`;
}

// Live checks, read on each count so an opt-out applies at once.
function allowedHere() {
  if (typeof window === 'undefined') return false;
  let optOut = false;
  try { optOut = localStorage.getItem(OPT_OUT_KEY) === '1'; } catch { /* storage blocked */ }
  return trackingAllowed({
    host: location.hostname,
    dnt: navigator.doNotTrack === '1' || window.doNotTrack === '1',
    gpc: navigator.globalPrivacyControl === true,
    optOut,
  });
}

function send(params) {
  if (!allowedHere()) return;
  const url = countUrl(params);
  try {
    if (navigator.sendBeacon?.(url)) return;
  } catch { /* fall through */ }
  new Image().src = url;
}

// Only another site is worth recording as a referrer, and only once per visit.
let referrerSent = false;
function externalReferrer() {
  if (referrerSent) return '';
  referrerSent = true;
  try {
    const r = new URL(document.referrer);
    return SITE_HOSTS.includes(r.hostname) ? '' : r.origin;
  } catch {
    return '';
  }
}

export function pageview(path, title = document.title) {
  send({ path, title, referrer: externalReferrer() });
}

export function event(name) {
  if (name) send({ path: name, title: document.title, event: true });
}

// Elements carrying data-track="<name>" count as that event when clicked, or,
// for fields, when their value is committed (Enter or leaving the field).
let wired = false;
export function wireEvents(root = document) {
  if (wired) return;
  wired = true;
  root.addEventListener('click', (e) => {
    const el = e.target.closest?.('[data-track]');
    if (el && !el.matches('input, select, textarea')) event(el.dataset.track);
  }, true);
  root.addEventListener('change', (e) => {
    const el = e.target.closest?.('[data-track]');
    if (el && el.matches('input, select, textarea') && el.value) event(el.dataset.track);
  }, true);
}
