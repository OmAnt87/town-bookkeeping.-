import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreTown } from '../js/engine/scoring.js';
import { metric, metricText, compareValues, comparable } from '../js/engine/metrics.js';
import { validateDataset } from '../js/engine/ledger.js';
import { createDetailLoader, completeDataset, summaryDataset, requestIsCurrent } from '../js/data/loading.js';
import { reportingFor } from '../js/engine/reporting.js';
const base = () => ({ id: 'test', name: 'Test', state: 'PA', lat: 40, lng: -75, population: 1000, revenue: { propertyTax: 1000 }, spending: { publicSafety: 900, administration: 100 }, fiscalYear: 2024 });
const entry = (t) => ({ town: t, s: scoreTown(t) });

test('unknown values stay unavailable; explicit zero stays available', () => {
  const t = base();
  for (const key of ['influence', 'debt', 'taxBreaks', 'corporate', 'redFlagCount', 'redFlagPerResident']) assert.equal(metric(entry(t), key).value, null, key);
  Object.assign(t, { debt: 0, influence: { developerContributions: 0 }, taxBreaks: { corporateAbatements: 0 }, redFlags: [] });
  for (const key of ['influence', 'debt', 'taxBreaks', 'corporate', 'redFlagCount', 'redFlagPerResident']) assert.equal(metric(entry(t), key).value, 0, key);
  t.spending.otherSpending = 100;
  assert.equal(metric(entry(t), 'directShare').available, false);
  assert.equal(metric(entry(t), 'direct').available, false);
});
test('documented flags with unknown cost do not become zero dollars', () => {
  const t = { ...base(), redFlags: [{ kind: 'surveillance', label: 'ALPR' }] };
  assert.equal(metric(entry(t), 'redFlagCount').value, 1);
  assert.equal(metric(entry(t), 'redFlagPerResident').value, null);
});
test('ungraded normalized score cannot be a headline or comparison winner', () => {
  const t = base();
  assert.equal(entry(t).s.grade, '?');
  assert.equal(metricText(entry(t), 'score'), 'Not graded');
  assert.equal(comparable([entry(t), entry(t)], 'score'), false);
});
test('unavailable values sort last in either direction', () => {
  for (const direction of ['asc', 'desc']) {
    const values = [null, 0, 2, null, 1].sort((a, b) => compareValues(a, b, direction));
    assert.deepEqual(values.slice(-2), [null, null]);
    assert.deepEqual(values.slice(0, 3), direction === 'asc' ? [0, 1, 2] : [2, 1, 0]);
  }
});
test('comparison requires matching metadata and fiscal year', () => {
  const a = base(), b = base();
  assert.equal(comparable([entry(a), entry(b)], 'direct'), false);
  a.reporting = b.reporting = { basis: 'Actual results', scope: 'General fund' };
  assert.equal(comparable([entry(a), entry(b)], 'direct'), true);
  b.fiscalYear = 2023;
  assert.equal(comparable([entry(a), entry(b)], 'direct'), false);
});
test('validation rejects malformed records before use', () => {
  const invalid = [null, { ...base(), lat: Infinity }, { ...base(), population: '100' }, { ...base(), revenue: [] }, { ...base(), spending: { roads: NaN } }, { ...base(), debt: '0' }, { ...base(), ledger: [{ flow: 'out', amount: 3 }] }, { ...base(), detailFile: '../secrets.json' }];
  for (const t of invalid) assert.ok(validateDataset({ towns: [t] }).length);
  assert.ok(validateDataset({ towns: [base(), base()] }).length);
  assert.deepEqual(validateDataset({ towns: [base()] }), []);
});
test('detail request failure is evicted, retries succeed, county is cached', async () => {
  let calls = 0;
  const full = { ...base(), ledger: [] };
  const load = createDetailLoader(async () => { calls++; return calls === 1 ? { ok: false, status: 503 } : { ok: true, json: async () => ({ towns: [full] }) }; });
  const summary = { ...base(), detailFile: 'pa-test.json' };
  await assert.rejects(load(summary), /503/);
  assert.deepEqual((await load(summary)).ledger, []);
  await load(summary);
  assert.equal(calls, 2);
  assert.equal(summary.ledger, undefined, 'loader does not mutate the active record');
});
test('navigation and dataset changes invalidate pending rendering', () => {
  const dataset = { towns: [] }, state = { dataset, routeRevision: 1 };
  assert.equal(requestIsCurrent(state, dataset, 1), true);
  state.routeRevision++;
  assert.equal(requestIsCurrent(state, dataset, 1), false);
  state.routeRevision = 1; state.dataset = { towns: [] };
  assert.equal(requestIsCurrent(state, dataset, 1), false);
});
test('complete export hydrates every record or rejects with failed town', async () => {
  const dataset = { towns: [base(), { ...base(), id: 'other', name: 'Other' }] };
  const full = await completeDataset(dataset, async (t) => ({ ...t, ledger: [], history: [] }));
  assert.ok(full.towns.every((t) => t.ledger && t.history));
  assert.equal(summaryDataset(full).towns[0].ledger, undefined);
  await assert.rejects(completeDataset(dataset, async (t) => { if (t.id === 'other') throw new Error('503'); return t; }), /Other.*503/);
});
test('bundled summaries and full records validate and have identical scores', () => {
  const read = (f) => JSON.parse(readFileSync(new URL('../data/real/' + f, import.meta.url)));
  const summary = read('summary.json');
  assert.deepEqual(validateDataset(summary), []);
  const byId = new Map(summary.towns.map((t) => [t.id, t]));
  let count = 0;
  for (const file of read('index.json').files) {
    const data = read(file);
    assert.deepEqual(validateDataset(data), [], file);
    for (const t of data.towns) {
      const light = byId.get(t.id);
      assert.ok(light, t.id);
      const fullScore = scoreTown(t), summaryScore = scoreTown(light);
      assert.equal(summaryScore.score, fullScore.score, t.id);
      assert.equal(summaryScore.grade, fullScore.grade, t.id);
      assert.deepEqual(light.reporting, reportingFor(t), t.id);
      count++;
    }
  }
  assert.equal(count, summary.towns.length);
});
test('political comparisons require compatible recipient scopes and periods', () => {
  const a = { ...base(), influence: { pacContributions: 0 }, reporting: { politicalPeriod: '2023–2026', politicalScope: 'Candidates' } };
  const b = structuredClone(a);
  assert.equal(comparable([entry(a), entry(b)], 'influence'), true);
  b.reporting.politicalScope = 'Party committees';
  assert.equal(comparable([entry(a), entry(b)], 'influence'), false);
  b.reporting = { ...a.reporting, politicalPeriod: '2022–2026' };
  assert.equal(comparable([entry(a), entry(b)], 'influence'), false);
});
test('invalid county payload is evicted and can recover', async () => {
  let calls = 0;
  const load = createDetailLoader(async () => ({ ok: true, json: async () => ++calls === 1 ? { towns: [null] } : { towns: [base()] } }));
  const t = { ...base(), detailFile: 'pa-test.json' };
  await assert.rejects(load(t), /must be an object/);
  assert.deepEqual((await load(t)).ledger, []);
});
test('reporting is derived from source evidence, not state alone', () => {
  assert.deepEqual(reportingFor(base()), {});
  const t = { ...base(), state: 'CT', name: 'City of Groton', sources: [{ label: 'CT OPM Municipal Fiscal Indicators', url: 'https://data.ct.gov' }] };
  assert.equal(reportingFor(t).scope, 'General fund; City of Groton');
});
