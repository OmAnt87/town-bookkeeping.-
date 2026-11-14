// The one-paragraph "In plain terms" reading of a town's score, as HTML.
// Shared by the town report (js/views/town.js) and the static town pages
// (scripts/build-pages.mjs). s = scoreTown(town).

import { escapeHTML } from './format.js';
import { documentedRedFlags } from './scoring.js';

export function plainSummary(town, s) {
  const t = s.totals;
  const scored = s.components.filter((c) => c.available && !c.penalty);
  if (!scored.length) return '<strong>In plain terms:</strong> not enough data is loaded to judge this town yet.';
  const strongest = [...scored].sort((a, b) => b.ratio - a.ratio)[0];
  const weakest = [...scored].sort((a, b) => a.ratio - b.ratio)[0];
  const per100 = Math.round(t.directShare * 100);
  const school = town.spending?.education > 0;
  return `<strong>In plain terms:</strong> ${town.spending?.otherSpending > 0
    ? `${escapeHTML(town.name)} reports part of its spending only as a total, so how much reaches residents directly is not known.`
    : `for every $100 ${escapeHTML(town.name)} spends${school ? ' outside its schools' : t.passThroughOut ? ' of its own money' : ''}, about $${per100} pays for services residents use directly.`}
    ${strongest.ratio === weakest.ratio ? 'The available components have the same relative score.' : `Among measured components, its strongest area is <strong>${strongest.label.toLowerCase()}</strong>; its weakest is <strong>${weakest.label.toLowerCase()}</strong>.`}${
    t.redFlagSpending + t.taxBreaks > 0
      ? ` It also put <strong>$${(t.redFlagShare * 100).toFixed(2)} of every $100</strong> toward surveillance, corporate deals or corporate tax breaks${s.penalty ? `, which cost it <strong>${s.penalty} points</strong>` : ''}.`
      : t.documentedRedFlags
        ? ` Public records show <strong>${documentedRedFlags(town).map((f) => f.label.toLowerCase()).join(', ')}</strong>, which cost it <strong>${s.penalty} points</strong>.`
        : ''}`;
}
