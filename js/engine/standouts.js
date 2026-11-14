// "Standouts" on each state page: the towns at each end of a few measures.
// Pure functions only. entries: [{ town, s, provisional }] for one state.
//
// Extremes are where missing or misfiled data shows up first, so a town is
// listed only when its record looks complete: no data-check warnings, most
// of the score backed by data, some itemized service spending, and a value
// within a plausible range of the state's typical one.

import { metric, metricText } from './metrics.js';
import { validateTown } from './validate.js';

// Per-resident figures for very small places swing on a single contract.
export const MIN_POPULATION = 2500;
// Share of the score's weight (of 100) that must be backed by data.
export const MIN_COVERAGE = 80;
// Values more than this many times the state median are more likely data gaps than stories.
export const MAX_MEDIAN_MULTIPLE = 5;
export const LIST_SIZE = 5;
// A list shorter than this says little, so it is left out.
export const MIN_LIST = 3;

export const STANDOUT_LISTS = [
  { key: 'score', title: 'Highest Community Return Score', dir: 'desc', gradedOnly: true },
  { key: 'score', title: 'Lowest Community Return Score', dir: 'asc', gradedOnly: true },
  { key: 'debtPerResident', title: 'Most debt per resident', dir: 'desc', capped: true },
  { key: 'directShare', title: 'Smallest share of spending on direct services', dir: 'asc' },
  { key: 'influencePerResident', title: 'Most political money per resident', dir: 'desc', capped: true },
  { key: 'redFlagCount', title: 'Most surveillance programs and corporate deals on record', dir: 'desc', positiveOnly: true },
];

const median = (vals) => {
  const v = [...vals].sort((a, b) => a - b);
  return v.length ? v[v.length >> 1] : null;
};

// A town's record is complete enough to name at the end of a list.
export function listable(e, { minPopulation = MIN_POPULATION, minCoverage = MIN_COVERAGE } = {}) {
  return (Number(e.town.population) || 0) >= minPopulation
    && !e.s.review
    && !e.provisional
    && e.s.coverage.possible >= minCoverage
    && e.s.totals.directSpending > 0
    && validateTown(e.town).length === 0;
}

export function standouts(entries, opts = {}) {
  const size = opts.size || LIST_SIZE;
  let pool = entries.filter((e) => listable(e, opts));
  // A figure far beyond the state's typical one is more likely a gap in the records than a
  // story, and it would skew the town's score too, so such a town is left off every list.
  for (const key of STANDOUT_LISTS.filter((l) => l.capped).map((l) => l.key)) {
    const values = pool.map((e) => metric(e, key)).filter((m) => m.available && m.value > 0).map((m) => m.value);
    const mid = median(values);
    if (mid) pool = pool.filter((e) => { const m = metric(e, key); return !m.available || m.value <= mid * MAX_MEDIAN_MULTIPLE; });
  }
  return STANDOUT_LISTS.map((list) => {
    const rows = pool
      .filter((e) => !list.gradedOnly || /^[A-F]$/.test(e.s.grade))
      .map((e) => ({ entry: e, m: metric(e, list.key) }))
      .filter(({ m }) => m.available && (!list.positiveOnly || m.value > 0))
      .sort((a, b) => (list.dir === 'asc' ? a.m.value - b.m.value : b.m.value - a.m.value) || (b.entry.town.population || 0) - (a.entry.town.population || 0))
      .slice(0, size)
      .map(({ entry, m }) => ({ entry, value: m.value, text: metricText(entry, list.key) }));
    return { ...list, rows };
  }).filter((list) => list.rows.length >= MIN_LIST);
}
