// "Find your town" on the map: by ZIP code or the browser's location, worked
// out in the browser. The only request is for one small ZIP table
// (data/zip/<first 3 digits>.json); the ZIP and location are never sent.
// Also offers the last town viewed, or an example town on a first visit.

import { nearestTowns, zipFile, MAX_MILES } from '../engine/nearby.js';
import { escapeHTML } from '../engine/format.js';
import { gradeBadge } from '../charts.js';
import { event } from '../track.js';

export const LAST_TOWN_KEY = 'tv-last-town';
const EXAMPLE_ID = 'city-of-hartford-ct';

export function rememberTown(id) {
  try { localStorage.setItem(LAST_TOWN_KEY, id); } catch { /* storage blocked */ }
}

function lastTown(state) {
  let id = null;
  try { id = localStorage.getItem(LAST_TOWN_KEY); } catch { /* storage blocked */ }
  return id && state.byId.get(id);
}

const townLink = (e, track) => `<a href="#/town/${encodeURIComponent(e.town.id)}" data-track="${track}">${escapeHTML(e.town.name)}, ${escapeHTML(e.town.state)}</a>`;

export function finderCard(state) {
  const last = lastTown(state);
  const example = state.byId.get(EXAMPLE_ID);
  const shortcut = last
    ? `<p class="finder-shortcut small">Continue: ${townLink(last, 'continue-last')}</p>`
    : example ? `<p class="finder-shortcut small">See an example: ${townLink(example, 'example-town')}</p>` : '';
  return `
  <section class="finder" aria-labelledby="finder-h">
    <h2 id="finder-h">Find your town</h2>
    <form class="finder-form" id="finder-form" novalidate>
      <label class="sr-only" for="finder-zip">ZIP code</label>
      <input id="finder-zip" class="input" inputmode="numeric" autocomplete="postal-code" maxlength="5" pattern="[0-9]{5}" placeholder="ZIP code">
      <button class="btn btn-primary" type="submit">Find</button>
    </form>
    ${'geolocation' in navigator ? '<button class="btn finder-locate" id="finder-locate" type="button">Use my location</button>' : ''}
    <div id="finder-out" class="finder-out" aria-live="polite"></div>
    ${shortcut}
  </section>`;
}

const fmtMiles = (m) => (m < 1 ? 'under 1 mi' : `${m.toFixed(m < 10 ? 1 : 0)} mi`);

export function resultsHTML({ towns, county }, where) {
  if (!towns.length) return `<p class="small">No town with public records within ${MAX_MILES} miles of ${escapeHTML(where)}.</p>`;
  const rows = towns.map(({ entry, miles }) => `<li><a href="#/town/${encodeURIComponent(entry.town.id)}" data-track="find-result">${gradeBadge(entry.s.grade)}<span><strong>${escapeHTML(entry.town.name)}</strong><span class="small muted">${escapeHTML(entry.town.type || '')} · ${fmtMiles(miles)}</span></span></a></li>`);
  if (county) rows.push(`<li><a href="#/town/${encodeURIComponent(county.town.id)}" data-track="find-result">${gradeBadge(county.s.grade)}<span><strong>${escapeHTML(county.town.name)}</strong><span class="small muted">County</span></span></a></li>`);
  return `<p class="small muted">Nearest to ${escapeHTML(where)}, by distance to each town's center:</p><ul class="finder-list">${rows.join('')}</ul>`;
}

export function wireFinder(root, state) {
  const out = root.querySelector('#finder-out');
  const form = root.querySelector('#finder-form');
  if (!out || !form) return;
  const entries = state.towns;
  const show = (html) => { out.innerHTML = html; };
  const near = (point, where) => show(resultsHTML(nearestTowns(entries, point), where));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const zip = root.querySelector('#finder-zip').value.trim();
    const file = zipFile(zip);
    if (!file) { show('<p class="small">Enter a 5-digit ZIP code.</p>'); return; }
    event('find-zip');
    show('<p class="small muted">Looking up…</p>');
    try {
      const res = await fetch(file);
      const table = res.ok ? await res.json() : {};
      const at = table[zip];
      if (!at) { show(`<p class="small">ZIP ${escapeHTML(zip)} is not in the Census ZIP areas. PO-box ZIP codes have none; try the ZIP where you live, or search by name below.</p>`); return; }
      near({ lat: at[0], lng: at[1] }, `ZIP ${zip}`);
    } catch {
      show('<p class="small">Could not load the ZIP table. Check your connection and try again.</p>');
    }
  });

  root.querySelector('#finder-zip').addEventListener('input', (e) => { e.target.value = e.target.value.replace(/\D/g, '').slice(0, 5); });

  root.querySelector('#finder-locate')?.addEventListener('click', () => {
    event('find-location');
    show('<p class="small muted">Finding your location…</p>');
    navigator.geolocation.getCurrentPosition(
      (pos) => near({ lat: pos.coords.latitude, lng: pos.coords.longitude }, 'your location'),
      (err) => show(`<p class="small">${err.code === err.PERMISSION_DENIED ? 'Location is turned off for this site. Enter a ZIP code instead.' : 'Could not get your location. Enter a ZIP code instead.'}</p>`),
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 600000 },
    );
  });
}
