// Per-state summaries of scored towns, for the States page. Pure functions only.
// entries: [{ town, s }] as the app keeps them (s = scoreTown(town)).

const median = (vals) => {
  const v = vals.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};

export const GRADES = ['A', 'B', 'C', 'D', 'F', '?'];

export function stateSummary(entries) {
  const byState = new Map();
  for (const e of entries) {
    const k = e.town.state;
    (byState.get(k) || byState.set(k, []).get(k)).push(e);
  }
  return [...byState.entries()].map(([state, list]) => {
    const n = list.length;
    const grades = Object.fromEntries(GRADES.map((g) => [g, list.filter((e) => e.s.grade === g).length]));
    const types = {};
    for (const e of list) types[e.town.type || 'Other'] = (types[e.town.type || 'Other'] || 0) + 1;
    // Share of towns with data behind each part of the score.
    const coverage = list[0].s.components.map((c, i) => ({
      key: c.key,
      label: c.label,
      share: list.filter((e) => e.s.components[i].available).length / n,
    }));
    const avail = (key) => list.filter((e) => e.s.components.find((c) => c.key === key)?.available);
    const flagChecked = list.filter((e) => e.s.totals.redFlagKnown);
    const filingChecked = list.filter((e) => typeof e.town.transparency?.auditOnTime === 'boolean');
    return {
      state,
      stateName: list.find((e) => e.town.stateName)?.town.stateName || state,
      towns: n,
      population: list.reduce((a, e) => a + (e.town.population || 0), 0),
      types,
      fiscalYears: [...new Set(list.map((e) => e.town.fiscalYear).filter(Boolean))].sort(),
      grades,
      medianScore: median(list.map((e) => e.s.score)),
      medianDirectShare: median(avail('services').map((e) => e.s.totals.directShare)),
      medianInfluencePerResident: median(avail('influence').map((e) => e.s.totals.influencePerResident)),
      redFlagTowns: flagChecked.length ? flagChecked.filter((e) => e.s.totals.redFlagCount > 0).length : null,
      redFlagChecked: flagChecked.length,
      lateFilers: filingChecked.length ? filingChecked.filter((e) => e.town.transparency.auditOnTime === false).length : null,
      filingChecked: filingChecked.length,
      coverage,
    };
  }).sort((a, b) => a.stateName.localeCompare(b.stateName));
}
