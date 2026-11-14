// The governments nearest a point, for "Find my town". Pure functions only.
// entries: [{ town, s }] as the app keeps them; point: { lat, lng }.

import { govKind } from './peers.js';

const R_MILES = 3958.8;
const rad = (d) => (d * Math.PI) / 180;

export function distanceMiles(a, b) {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R_MILES * Math.asin(Math.min(1, Math.sqrt(h)));
}

// Towns farther than this are not "near" anyone; the finder says so instead.
export const MAX_MILES = 25;

// The n closest towns, villages, townships and cities by their center point,
// plus the county the closest one sits in (counties' centers say little about
// who lives in them, so they are not ranked by distance).
export function nearestTowns(entries, point, n = 5, maxMiles = MAX_MILES) {
  const located = entries.filter((e) => Number.isFinite(e.town.lat) && Number.isFinite(e.town.lng));
  const near = located
    .filter((e) => govKind(e.town) !== 'county')
    .map((e) => ({ entry: e, miles: distanceMiles(point, e.town) }))
    .filter((x) => x.miles <= maxMiles)
    .sort((a, b) => a.miles - b.miles)
    .slice(0, n);
  const first = near[0]?.entry.town;
  const county = first?.county
    ? located.find((e) => govKind(e.town) === 'county' && e.town.state === first.state && sameCounty(e.town.name, first.county))
    : null;
  return { towns: near, county: county || null };
}

// "Hartford County" matches "Hartford County"; "Aleutians East Borough" matches itself.
const norm = (s) => String(s || '').toLowerCase().replace(/^(county|parish|borough) of /, '').replace(/\b(county|parish|borough|municipality|city and borough|census area)\b/g, '').replace(/[^a-z]/g, '');
function sameCounty(a, b) {
  return norm(a) !== '' && norm(a) === norm(b);
}

// The shard file (data/zip/<3 digits>.json) holding a ZIP, or null if it is not a ZIP.
export const zipFile = (zip) => (/^\d{5}$/.test(String(zip).trim()) ? `data/zip/${String(zip).trim().slice(0, 3)}.json` : null);
