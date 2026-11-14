// Citation, embed snippet and "report an error" link for a town, shared by the
// town report (js/views/town.js) and the plain town pages (scripts/build-pages.mjs).

import { escapeHTML } from './format.js';

export const SITE = 'https://townview.org/';
export const REPO = 'https://github.com/OmAnt87/town-bookkeeping.-';

export const townPageUrl = (id) => `${SITE}town/${encodeURIComponent(id)}/`;
export const badgeUrl = (id) => `${SITE}badge/${encodeURIComponent(id)}.svg`;

export function citationText(town) {
  const asOf = town.asOf ? `, data as of ${town.asOf}` : '';
  return `TownView, "${town.name}, ${town.state}: where the money goes," fiscal year ${town.fiscalYear ?? 'n/a'}${asOf}, ${townPageUrl(town.id)}`;
}

export function badgeAlt(town, s) {
  return /^[A-F]$/.test(s.grade)
    ? `${town.name}, ${town.state}: Community Return Score ${s.score.toFixed(1)} of 100, grade ${s.grade} (TownView)`
    : `${town.name}, ${town.state} on TownView`;
}

export const embedHTML = (town, s) =>
  `<a href="${townPageUrl(town.id)}"><img src="${badgeUrl(town.id)}" alt="${escapeHTML(badgeAlt(town, s))}" height="20"></a>`;

// Opens the "Data error" issue form (.github/ISSUE_TEMPLATE/data-error.yml) with the town filled in.
export function reportErrorUrl(town) {
  const q = new URLSearchParams({
    template: 'data-error.yml',
    title: `Data error: ${town.name}, ${town.state}`,
    town: `${town.name}, ${town.state} (${town.id}), fiscal year ${town.fiscalYear ?? 'n/a'}\n${townPageUrl(town.id)}`,
  });
  return `${REPO}/issues/new?${q}`;
}
