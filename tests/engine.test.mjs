import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreTown, gradeFor, totals, COMPONENTS } from '../js/engine/scoring.js';
import { filterLedger, summarizeLedger, sortLedger, toCSV, validateDataset } from '../js/engine/ledger.js';
import { mapCensusItem } from '../scripts/census-codes.mjs';
import { classifyContributor } from '../scripts/contributor-types.mjs';
import { parseCSV } from '../scripts/lib.mjs';

const base = () => ({
  id: 't', name: 'Test Township', state: 'PA', lat: 40, lng: -77, population: 10000,
  revenue: { propertyTax: 5_000_000, stateAid: 3_000_000, federalGrants: 1_000_000, feesPermits: 1_000_000 },
  spending: { publicSafety: 4_000_000, roads: 2_000_000, utilities: 1_500_000, parks: 500_000, administration: 1_000_000, consultants: 200_000, debtService: 800_000 },
  influence: { pacContributions: 2_000, developerContributions: 1_000 },
  transparency: { budgetOnline: true, openCheckbook: true, auditOnTime: true, competitiveBidding: false, meetingsRecorded: true, conflictDisclosures: false },
  debt: 5_000_000,
});

test('totals split property tax from everything else', () => {
  const t = totals(base());
  assert.equal(t.revenue, 10_000_000);
  assert.equal(t.propertyTax, 5_000_000);
  assert.equal(t.nonPropertyRevenue, 5_000_000);
  assert.equal(t.nonPropertyShare, 0.5);
  assert.equal(t.directSpending, 8_000_000);
  assert.equal(t.directShare, 0.8);
  assert.equal(t.adminShare, 0.12);
  assert.equal(t.influencePerResident, 0.3);
  assert.equal(t.debtPerResident, 500);
});

test('score is bounded and components sum to the score', () => {
  const s = scoreTown(base());
  const sum = s.components.reduce((a, c) => a + c.points, 0);
  assert.ok(Math.abs(sum - s.score) < 0.2);
  assert.ok(s.score >= 0 && s.score <= 100);
  for (const c of s.components) assert.ok(c.points >= 0 && c.points <= c.max, c.key);
  assert.equal(COMPONENTS.reduce((a, c) => a + c.max, 0), 100);
});

test('a well-run town outscores a poorly-run one', () => {
  const good = scoreTown(base());
  const bad = base();
  bad.spending.consultants = 4_000_000;
  bad.influence.pacContributions = 150_000;
  bad.transparency = {};
  bad.debt = 70_000_000;
  assert.ok(scoreTown(bad).score < good.score - 30);
});

test('grade cut-offs', () => {
  assert.equal(gradeFor(85), 'A');
  assert.equal(gradeFor(84.9), 'B');
  assert.equal(gradeFor(70), 'B');
  assert.equal(gradeFor(55), 'C');
  assert.equal(gradeFor(40), 'D');
  assert.equal(gradeFor(39.9), 'F');
});

test('handles missing sections without throwing', () => {
  const s = scoreTown({ id: 'x', name: 'x', state: 'OH', population: 100, revenue: {}, spending: {} });
  assert.ok(Number.isFinite(s.score));
});

const ledger = [
  { date: '2026-01-05', flow: 'in', category: 'stateAid', counterparty: 'State Treasury', description: 'Aid', amount: 100 },
  { date: '2026-03-01', flow: 'out', category: 'roads', counterparty: 'Valley Paving', description: 'Repaving', amount: 40 },
  { date: '2026-02-11', flow: 'influence', category: 'pacContributions', counterparty: 'Builders PAC', description: 'Gift', amount: 5 },
];

test('ledger filter, summary and sort', () => {
  assert.equal(filterLedger(ledger, { flow: 'out' }).length, 1);
  assert.equal(filterLedger(ledger, { query: 'paving' }).length, 1);
  assert.equal(filterLedger(ledger, { query: 'state aid' }).length, 1, 'matches category label');
  assert.deepEqual(summarizeLedger(ledger), { in: 100, out: 40, influence: 5, count: 3 });
  assert.equal(sortLedger(ledger, 'date', 'desc')[0].date, '2026-03-01');
  assert.equal(sortLedger(ledger, 'amount', 'asc')[0].amount, 5);
});

test('CSV escapes commas, quotes and newlines', () => {
  const csv = toCSV([{ a: 'x, "y"\nz' }], [{ label: 'A', get: (r) => r.a }]);
  assert.equal(csv, 'A\n"x, ""y""\nz"');
  assert.deepEqual(parseCSV(`${csv}\n`), [{ a: 'x, "y"\nz' }]);
});

test('dataset validation reports problems', () => {
  assert.deepEqual(validateDataset({ towns: [base()] }), []);
  assert.ok(validateDataset({}).length > 0);
  const bad = base();
  delete bad.lat;
  assert.match(validateDataset({ towns: [bad] })[0], /lat/);
});

test('demo dataset is valid and spans every grade', () => {
  const data = JSON.parse(readFileSync(new URL('../data/towns.json', import.meta.url)));
  assert.deepEqual(validateDataset(data), []);
  const grades = new Set(data.towns.map((t) => scoreTown(t).grade));
  for (const g of ['A', 'B', 'C', 'D', 'F']) assert.ok(grades.has(g), `missing grade ${g}`);
  assert.equal(new Set(data.towns.map((t) => t.id)).size, data.towns.length, 'ids are unique');
});

test('census item codes map to categories', () => {
  assert.deepEqual(mapCensusItem('T01'), { group: 'revenue', key: 'propertyTax' });
  assert.equal(mapCensusItem('T09').key, 'salesTax');
  assert.equal(mapCensusItem('B46').key, 'federalGrants');
  assert.equal(mapCensusItem('C21').key, 'stateAid');
  assert.equal(mapCensusItem('A91').key, 'utilityCharges');
  assert.equal(mapCensusItem('U30').key, 'finesForfeitures');
  assert.equal(mapCensusItem('E62').key, 'publicSafety');
  assert.equal(mapCensusItem('F44').key, 'roads');
  assert.equal(mapCensusItem('I89').key, 'debtService');
  assert.equal(mapCensusItem('E23').key, 'administration');
  assert.equal(mapCensusItem('W01'), null);
});

test('contributor classification', () => {
  assert.equal(classifyContributor('PAC', 'Regional Builders PAC'), 'pacContributions');
  assert.equal(classifyContributor('', 'Firefighters Local 214'), 'unionContributions');
  assert.equal(classifyContributor('Contractor', 'Valley Asphalt'), 'developerContributions');
  assert.equal(classifyContributor('Lobbying', 'Capitol Strategies'), 'lobbyingPaid');
  assert.equal(classifyContributor('Individual', 'Jane Smith'), null);
});

import { mapNJLine, aggregateNJBudget } from '../scripts/nj-budget-map.mjs';

test('NJ budget lines map to categories', () => {
  const a = (l) => mapNJLine(l, 'appropriation');
  const r = (l) => mapNJLine(l, 'revenue');
  assert.equal(a('Police - Salaries and Wages'), 'publicSafety');
  assert.equal(a('Streets and Road Maintenance - Other Expenses'), 'roads');
  assert.equal(a('Solid Waste Collection'), 'utilities');
  assert.equal(a('Recreation Services and Programs'), 'parks');
  assert.equal(a('Legal Services and Costs'), 'consultants');
  assert.equal(a('Engineering Services and Costs'), 'consultants');
  assert.equal(a('Municipal Clerk - Salaries and Wages'), 'administration');
  assert.equal(a('Payment of Bond Principal'), 'debtService');
  assert.equal(a("Police and Firemen's Retirement System of NJ"), 'shared');
  assert.equal(a('Social Security System (O.A.S.I.)'), 'shared');
  assert.equal(a('Reserve for Uncollected Taxes'), 'exclude');
  assert.equal(r('Amount to be Raised by Taxes for Support of Municipal Budget'), 'propertyTax');
  assert.equal(r('Energy Receipts Tax'), 'stateAid');
  assert.equal(r('Fines and Costs - Municipal Court'), 'finesForfeitures');
  assert.equal(r('Uniform Construction Code Fees'), 'feesPermits');
  assert.equal(r('Clean Communities Program'), 'stateAid');
  assert.equal(r('Hotel and Motel Occupancy Tax'), 'salesTax');
  assert.equal(r('Surplus Anticipated'), 'otherRevenue');
});

test('NJ aggregation spreads shared costs and drops reserves', () => {
  const out = aggregateNJBudget([
    { section: 'appropriation', line: 'Police', amount: 600 },
    { section: 'appropriation', line: 'Municipal Clerk', amount: 400 },
    { section: 'appropriation', line: 'Group Insurance Plans for Employees', amount: 100 },
    { section: 'appropriation', line: 'Reserve for Uncollected Taxes', amount: 50 },
    { section: 'revenue', line: 'Amount to be Raised by Taxes', amount: 1000 },
  ]);
  assert.deepEqual(out.spending, { publicSafety: 660, administration: 440 });
  assert.equal(out.excluded, 50);
  assert.deepEqual(out.revenue, { propertyTax: 1000 });
});

test('missing sections are not scored instead of counting as zero', () => {
  const t = base();
  delete t.influence;
  const s = scoreTown(t);
  const inf = s.components.find((c) => c.key === 'influence');
  assert.equal(inf.available, false);
  assert.equal(inf.points, null);
  assert.equal(s.coverage.scored, 4);
  const full = scoreTown(base());
  assert.notEqual(s.score, full.score);
  assert.ok(s.score >= 0 && s.score <= 100);
});
