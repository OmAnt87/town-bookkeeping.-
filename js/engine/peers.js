// Peer groups: towns are ranked against others like them, so a small township is not
// measured against a big city, and a state with political money loaded is not mixed with
// one without. A town's peers share its state, kind of government and population band;
// groups too small to rank are widened step by step.
//
// Completeness: a town's score is rescaled from the parts with data (scoring.js). A score
// built on little data is shown as provisional and sorts after complete ones.

export const POP_BANDS = [
  { key: 'xs', label: 'Under 2,500', phrase: 'under 2,500 people', max: 2500 },
  { key: 's', label: '2,500 to 10,000', phrase: '2,500 to 10,000 people', max: 10000 },
  { key: 'm', label: '10,000 to 50,000', phrase: '10,000 to 50,000 people', max: 50000 },
  { key: 'l', label: '50,000 to 250,000', phrase: '50,000 to 250,000 people', max: 250000 },
  { key: 'xl', label: '250,000 and up', phrase: '250,000 people or more', max: Infinity },
];

export const GOV_KINDS = [
  { key: 'county', label: 'Counties' },
  { key: 'city', label: 'Cities' },
  { key: 'town', label: 'Towns, villages & boroughs' },
  { key: 'township', label: 'Townships' },
];

// The smallest group a percentile is reported for.
export const MIN_PEERS = 8;
// Scoring weight (of 100) below which a score is provisional.
export const PROVISIONAL_BELOW = 60;

export const popBand = (population) => POP_BANDS.find((b) => (Number(population) || 0) < b.max) || POP_BANDS.at(-1);

export function govKind(town) {
  const type = String(town.type || '');
  if (/^county$/i.test(type)) return 'county';
  if (/township/i.test(type)) return 'township';
  if (/^city$|consolidated/i.test(type)) return 'city';
  return 'town';
}

const kindLabel = (key) => GOV_KINDS.find((k) => k.key === key)?.label.toLowerCase() || key;

export function completeness(s) {
  return Math.round(s.coverage.possible) / 100;
}

export const isProvisional = (s) => s.grade === '?' || s.coverage.possible < PROVISIONAL_BELOW;

const median = (sorted) => (sorted.length ? sorted[sorted.length >> 1] : null);

// Index of the first value >= x (or > x when `after`) in an ascending list.
function bound(sorted, x, after = false) {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < x || (after && sorted[mid] === x)) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// Percentile of `score` in a sorted (ascending) list: the share of the others it beats,
// ties counting half. One town alone has no percentile.
export function percentileOf(sortedScores, score) {
  const n = sortedScores.length;
  if (n < 2) return null;
  const below = bound(sortedScores, score);
  const equal = bound(sortedScores, score, true) - below;
  return Math.round(((below + Math.max(0, equal - 1) / 2) / (n - 1)) * 100);
}

// Group label in plain words: "NJ townships with 2,500 to 10,000 people".
function groupLabel(level, state, kind, band) {
  if (level === 0) return `${state} ${kindLabel(kind)} with ${band.phrase}`;
  if (level === 1) return `${state} ${kindLabel(kind)}`;
  if (level === 2) return `${kindLabel(kind)} with ${band.phrase}, all states`;
  return `all ${kindLabel(kind)}`;
}

// Adds `peer` and `provisional` to each entry ({ town, s }). Demo and real towns are
// grouped apart. Ungraded towns get no percentile but still see their group.
export function assignPeers(entries) {
  // Each town's kind, population band and four group keys (narrowest first), computed once.
  const meta = entries.map((e) => {
    const kind = govKind(e.town);
    const band = popBand(e.town.population);
    const demo = e.town.demo === true;
    return { kind, band, keys: [`${demo}|${e.town.state}|${kind}|${band.key}`, `${demo}|${e.town.state}|${kind}`, `${demo}|*|${kind}|${band.key}`, `${demo}|*|${kind}`] };
  });
  const groups = [0, 1, 2, 3].map((level) => {
    const m = new Map();
    entries.forEach((e, i) => {
      if (e.s.grade === '?') return;
      const k = meta[i].keys[level];
      (m.get(k) || m.set(k, []).get(k)).push(e);
    });
    return m;
  });
  const cache = new Map();
  const statsFor = (level, k) => {
    const id = `${level}#${k}`;
    if (cache.has(id)) return cache.get(id);
    const members = groups[level].get(k) || [];
    const scores = members.map((e) => e.s.score).sort((a, b) => a - b);
    const ratios = {};
    for (const m of members) for (const c of m.s.components) if (c.available) (ratios[c.key] ||= []).push(c.ratio);
    const components = {};
    for (const [key, list] of Object.entries(ratios)) if (list.length >= MIN_PEERS) components[key] = median(list.sort((a, b) => a - b));
    const stats = { scores, median: median(scores), components };
    cache.set(id, stats);
    return stats;
  };
  entries.forEach((e, i) => {
    const { kind, band, keys } = meta[i];
    e.provisional = isProvisional(e.s);
    e.completeness = completeness(e.s);
    let level = keys.findIndex((k, l) => (groups[l].get(k)?.length || 0) >= MIN_PEERS);
    if (level === -1) level = 3;
    const stats = statsFor(level, keys[level]);
    const graded = e.s.grade !== '?';
    // Rank 1 is the best score; ties share a rank.
    const rank = graded ? 1 + stats.scores.length - bound(stats.scores, e.s.score, true) : null;
    e.peer = {
      level,
      label: groupLabel(level, e.town.state, kind, band),
      size: stats.scores.length,
      percentile: graded && stats.scores.length >= MIN_PEERS ? percentileOf(stats.scores, e.s.score) : null,
      rank: graded && stats.scores.length >= MIN_PEERS ? rank : null,
      median: stats.median,
      components: stats.components,
    };
  });
  return entries;
}

export function percentileText(p) {
  if (p == null) return 'Not ranked';
  const n = Math.round(p);
  const suffix = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  return `${n}${suffix} percentile`;
}
