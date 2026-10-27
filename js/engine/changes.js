// Detects whether a followed town's books changed since it was saved.

// Dollar changes smaller than this are rounding noise, not news.
export const MIN_CHANGE = 100;

// Short, stable hash of the parts of a town's books that summary data also
// carries, so a followed town can be checked without loading its ledger.
// Dollar figures are rounded to MIN_CHANGE so rounding noise does not count.
export function townFingerprint(town) {
  const r = (v) => (typeof v === 'number' ? Math.round(v / MIN_CHANGE) : v);
  const parts = [
    town.fiscalYear, town.asOf, town.population, r(town.debt),
    ...['revenue', 'spending', 'influence', 'taxBreaks'].flatMap((k) =>
      Object.keys(town[k] || {}).sort().map((c) => `${k}.${c}=${r(town[k][c])}`)),
  ];
  let h = 2166136261;
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h.toString(36);
}
