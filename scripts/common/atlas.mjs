// Shared helpers for the EFF Atlas of Surveillance (https://atlasofsurveillance.org/),
// used by scripts/nj/red-flags.mjs and scripts/red-flags.mjs.

export const ATLAS_URL = 'https://www.atlasofsurveillance.org/download.csv';
export const ATLAS_PAGE = 'https://atlasofsurveillance.org/';

// CSV with quoted fields and embedded newlines (the Atlas summaries have both).
export function parseCSVRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length === head.length).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

// Body-worn cameras are left out: they record police, not the public at large.
export const ATLAS_LABELS = {
  'Automated License Plate Readers': 'License-plate readers',
  'Face Recognition': 'Face recognition',
  'Gunshot Detection': 'Gunshot detection (ShotSpotter)',
  Drones: 'Police drones',
  'Camera Registry': 'Private camera registry',
  'Real-Time Crime Center': 'Real-time crime center',
  'Predictive Policing': 'Predictive policing',
  'Video Analytics': 'Video analytics',
  'Third-party Investigative Platforms': 'Third-party investigative platform',
  'Cell-site Simulator': 'Cell-site simulator',
  'Fusion Center': 'Fusion center',
};
export const agencyTown = (agency) => agency
  .replace(/[’']/g, '')
  .replace(/\b(police department|police dept\.?|department of police|police division|division of police|department of public safety|public safety department|police)\b/gi, '')
  .replace(/\bboro\b/gi, 'Borough')
  .replace(/\btwp\b/gi, 'Township')
  .replace(/\s+/g, ' ').trim();

export function usDate(s) {
  const m = String(s || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : '';
}

// A record's first link, when it is a web address (a few rows hold text there instead).
export const atlasLink = (r) => (/^https?:\/\/\S+$/i.test(String(r['Link 1'] || '').trim()) ? r['Link 1'].trim() : ATLAS_PAGE);
