// A small SVG score badge for a town, for news sites and blogs to embed
// (https://townview.org/badge/<id>.svg, written by scripts/build-pages.mjs).
// The text is fixed or numeric, never taken from the town's name.

export const GRADE_COLORS = { A: '#0f7a2c', B: '#3d8f3a', C: '#a06a00', D: '#c4581f', F: '#c0302f', none: '#6b6b66' };
const BRAND = '#1b3768';

// Verdana 11px averages about 6.5px per character, enough to size each half.
const width = (text) => Math.round(text.length * 6.5) + 14;

export function badgeSVG({ s }) {
  const graded = /^[A-F]$/.test(s.grade);
  const left = 'TownView';
  const right = graded ? `${s.grade} · ${s.score.toFixed(1)}` : 'not graded';
  const color = GRADE_COLORS[graded ? s.grade : 'none'];
  const lw = width(left);
  const rw = width(right);
  const label = graded ? `TownView Community Return Score: grade ${s.grade}, ${s.score.toFixed(1)} of 100` : 'TownView Community Return Score: not graded';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${lw + rw}" height="20" role="img" aria-label="${label}"><title>${label}</title><clipPath id="r"><rect width="${lw + rw}" height="20" rx="4"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="20" fill="${BRAND}"/><rect x="${lw}" width="${rw}" height="20" fill="${color}"/></g><g fill="#fff" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11" text-anchor="middle"><text x="${lw / 2}" y="14">${left}</text><text x="${lw + rw / 2}" y="14" font-weight="bold">${right}</text></g></svg>`;
}
