// Detects changes to a town's books between two versions of the data, for
// follow alerts. Pure functions only; shared by the browser and scripts.

import { scoreTown, sum } from './scoring.js';

// Mailing-list tag that marks a town's followers.
export const followTag = (id) => `town:${id}`;

// Short, stable hash of the parts of a town's books that summary data also
// carries, so a followed town can be checked without loading its ledger.
export function townFingerprint(town) {
  const parts = [
    town.fiscalYear, town.asOf, town.population, town.debt,
    ...['revenue', 'spending', 'influence', 'taxBreaks'].flatMap((k) =>
      Object.keys(town[k] || {}).sort().map((c) => `${k}.${c}=${town[k][c]}`)),
  ];
  let h = 2166136261;
  for (const ch of parts.join('|')) h = Math.imul(h ^ ch.charCodeAt(0), 16777619) >>> 0;
  return h.toString(36);
}

const ledgerKey = (e) => [e.date, e.flow, e.category, e.counterparty, e.amount].join('|');
const flagKey = (f) => [f.kind, f.label, f.amount].join('|');

// Returns null when nothing a reader would care about changed.
export function diffTown(before, after) {
  const changes = [];
  for (const key of ['revenue', 'spending', 'influence', 'taxBreaks']) {
    const a = sum(before[key]);
    const b = sum(after[key]);
    if (a !== b) changes.push({ kind: 'total', key, before: a, after: b });
  }
  if ((before.debt ?? null) !== (after.debt ?? null)) changes.push({ kind: 'total', key: 'debt', before: before.debt ?? 0, after: after.debt ?? 0 });
  for (const key of ['fiscalYear', 'asOf']) {
    if (before[key] !== after[key]) changes.push({ kind: 'field', key, before: before[key], after: after[key] });
  }
  const sb = scoreTown(before);
  const sa = scoreTown(after);
  if (sb.grade !== sa.grade || Math.abs(sb.score - sa.score) >= 0.1) {
    changes.push({ kind: 'score', before: { score: sb.score, grade: sb.grade }, after: { score: sa.score, grade: sa.grade } });
  }
  const setDiff = (xs = [], ys = [], key) => {
    const seen = new Set(xs.map(key));
    return ys.filter((y) => !seen.has(key(y)));
  };
  const addedRows = setDiff(before.ledger, after.ledger, ledgerKey);
  const removedRows = setDiff(after.ledger, before.ledger, ledgerKey);
  if (addedRows.length || removedRows.length) changes.push({ kind: 'ledger', added: addedRows, removed: removedRows });
  const addedFlags = setDiff(before.redFlags, after.redFlags, flagKey);
  const removedFlags = setDiff(after.redFlags, before.redFlags, flagKey);
  if (addedFlags.length || removedFlags.length) changes.push({ kind: 'redFlags', added: addedFlags, removed: removedFlags });
  return changes.length ? { id: after.id, name: after.name, state: after.state, changes } : null;
}

// Compares two datasets ({ towns }) and lists every town whose books changed.
// Towns new in `after` are reported as added; removed towns are skipped,
// since there is nothing left to link followers to.
export function diffDatasets(before, after) {
  const old = new Map((before?.towns || []).map((t) => [t.id, t]));
  const out = [];
  for (const town of after?.towns || []) {
    const prev = old.get(town.id);
    if (!prev) { out.push({ id: town.id, name: town.name, state: town.state, added: true, changes: [] }); continue; }
    const d = diffTown(prev, town);
    if (d) out.push(d);
  }
  return out;
}
