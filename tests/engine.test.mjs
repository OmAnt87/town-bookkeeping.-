import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { scoreTown, gradeFor, totals, COMPONENTS, redFlagEntries, corporateTies } from '../js/engine/scoring.js';
import { filterLedger, summarizeLedger, sortLedger, toCSV, validateDataset } from '../js/engine/ledger.js';
import { mapCensusItem } from '../scripts/census-codes.mjs';
import { classifyContributor } from '../scripts/contributor-types.mjs';
import { parseCSV } from '../scripts/lib.mjs';

const base = () => ({
  id: 't', name: 'Test Township', state: 'PA', lat: 40, lng: -77, population: 10000,
  revenue: { propertyTax: 5_000_000, stateAid: 3_000_000, federalGrants: 1_000_000, feesPermits: 1_000_000 },
  spending: { publicSafety: 4_000_000, roads: 2_000_000, utilities: 1_500_000, parks: 500_000, administration: 1_000_000, consultants: 200_000, debtService: 800_000, surveillance: 0, corporateDeals: 0 },
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

test('surveillance, data center deals and corporate tax breaks cost points', () => {
  const clean = scoreTown(base());
  assert.equal(clean.components.find((c) => c.key === 'redFlags').points, 10);
  const flagged = base();
  flagged.spending.surveillance = 150_000;
  flagged.spending.corporateDeals = 200_000;
  flagged.taxBreaks = { dataCenterAbatements: 300_000 };
  const s = scoreTown(flagged);
  assert.equal(s.totals.redFlagSpending, 350_000);
  assert.equal(s.totals.taxBreaks, 300_000);
  assert.equal(s.components.find((c) => c.key === 'redFlags').points, 0);
  assert.ok(s.score < clean.score);
});

test('red flags are not scored when nobody has checked for them', () => {
  const town = base();
  delete town.spending.surveillance;
  delete town.spending.corporateDeals;
  const part = scoreTown(town).components.find((c) => c.key === 'redFlags');
  assert.equal(part.available, false);
  assert.equal(part.points, null);
});

test('a Flock contract filed under police moves from services to red flags', () => {
  const town = base();
  delete town.spending.surveillance;
  delete town.spending.corporateDeals;
  town.ledger = [
    { date: '2026-02-01', flow: 'out', category: 'publicSafety', counterparty: 'Flock Group Inc.', description: 'License plate reader cameras', amount: 60_000 },
    { date: '2026-02-01', flow: 'out', category: 'publicSafety', counterparty: 'County Fire Supply', description: 'Hoses', amount: 9_000 },
  ];
  assert.equal(redFlagEntries(town).length, 1);
  const t = totals(town);
  assert.equal(t.redFlagSpending, 60_000);
  assert.equal(t.directSpending, 8_000_000 - 60_000);
  assert.equal(scoreTown(town).components.find((c) => c.key === 'redFlags').available, true);
});

test('documented red flags without dollar amounts still cost points', () => {
  const town = base();
  delete town.spending.surveillance;
  delete town.spending.corporateDeals;
  town.redFlags = [];
  const clean = scoreTown(town).components.find((c) => c.key === 'redFlags');
  assert.equal(clean.available, true, 'an empty list means checked, none found');
  assert.equal(clean.points, 10);
  town.redFlags = [
    { kind: 'surveillance', label: 'License-plate readers', date: '2023-04-28' },
    { kind: 'surveillance', label: 'License-plate readers', date: '2025-01-02' },
    { kind: 'dataCenter', label: 'Data center tax break (PILOT)' },
    { kind: 'surveillance', label: 'Police drones', scored: false },
  ];
  const s = scoreTown(town);
  assert.equal(s.totals.documentedRedFlags, 2, 'same program counted once; unscored records skipped');
  assert.equal(s.components.find((c) => c.key === 'redFlags').points, 5);
});

test('corporate ties match donors and lobbyists the town also pays', () => {
  const town = base();
  town.influence.corporateLobbying = 25_000;
  town.ledger = [
    { date: '2026-01-10', flow: 'influence', category: 'corporateLobbying', counterparty: 'Flock Safety', description: 'Lobbying council', amount: 25_000 },
    { date: '2026-01-11', flow: 'influence', category: 'developerContributions', counterparty: 'Valley Paving LLC', description: 'Gift', amount: 2_000 },
    { date: '2026-03-01', flow: 'out', category: 'surveillance', counterparty: 'Flock Safety', description: 'Cameras', amount: 90_000 },
    { date: '2026-04-01', flow: 'out', category: 'roads', counterparty: 'Valley Paving', description: 'Repaving', amount: 400_000 },
    { date: '2026-04-02', flow: 'out', category: 'roads', counterparty: 'Other Co', description: 'Signs', amount: 1_000 },
  ];
  const ties = corporateTies(town);
  assert.deepEqual(ties.map((x) => [x.name, x.paid, x.gave]), [['Valley Paving LLC', 400_000, 2_000], ['Flock Safety', 90_000, 25_000]]);
  assert.equal(totals(town).corporateMoney, 26_000);
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
  assert.equal(classifyContributor('Town-paid lobbying', 'Capitol Strategies'), 'lobbyingPaid');
  assert.equal(classifyContributor('Corporate lobbying', 'Flock Safety'), 'corporateLobbying');
  assert.equal(classifyContributor('Lobbying', 'Data center developer'), 'corporateLobbying');
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
  assert.equal(s.coverage.scored, 5);
  const full = scoreTown(base());
  assert.notEqual(s.score, full.score);
  assert.ok(s.score >= 0 && s.score <= 100);
});

import { aggregateUFB, groupFor, linesOf, totalOf, UFB_REVENUE, UFB_APPROPRIATION, normName } from '../scripts/nj/ufb-map.mjs';

test('NJ UFB service types aggregate and reconcile', () => {
  const rec = {
    '2026 Total Anticipated Revenues Current Year (Budgeted)|Surplus': 100,
    '2026 Total Anticipated Revenues Current Year (Budgeted)|Local Tax for Municipal Purposes': 700,
    '2026 Total Anticipated Revenues Current Year (Budgeted)|State Aid (without offsetting appropriation)': 200,
    '2026 Total Anticipated Revenues Current Year (Budgeted)|Total': 1000,
    '2026 Total Appropriations by Service Type (Current Year)|Public Safety': 600,
    '2026 Total Appropriations by Service Type (Current Year)|General Government': 200,
    '2026 Total Appropriations by Service Type (Current Year)|Statutory Expenditures': 160,
    '2026 Total Appropriations by Service Type (Current Year)|Reserve for Uncollected Taxes': 40,
    '2026 Total Appropriations by Service Type (Current Year)|TOTAL APPROPRIATION': 1000,
    '2025 Total Modified Appropriations by Service Type (Prior Year)|Public Safety': 1,
  };
  const rg = groupFor(rec, 'anticipated');
  const ag = groupFor(rec, 'appropriations');
  assert.match(ag, /^2026 Total Appropriations/);
  assert.equal(totalOf(rec, rg), 1000);
  assert.equal(totalOf(rec, ag), 1000);
  const out = aggregateUFB(linesOf(rec, rg), linesOf(rec, ag));
  assert.deepEqual(out.revenue, { surplusUsed: 100, propertyTax: 700, stateAid: 200 });
  assert.deepEqual(out.spending, { publicSafety: 720, administration: 240 });
  assert.equal(out.excluded, 40);
  assert.deepEqual(out.unmapped, []);
});

test('NJ UFB maps every known label and normalizes names', () => {
  for (const v of [...Object.values(UFB_REVENUE), ...Object.values(UFB_APPROPRIATION)]) assert.ok(v);
  assert.equal(normName("Atlantic City city"), normName('Atlantic City'));
  assert.equal(normName('Holmdel township'), 'holmdel');
});

test('surplus from prior years is not counted as non-property-tax revenue', () => {
  const t = base();
  t.revenue = { propertyTax: 600, surplusUsed: 200, stateAid: 200 };
  const s = scoreTown(t);
  assert.equal(s.totals.nonPropertyRevenue, 200);
  assert.equal(s.totals.reserves, 200);
});

import { summarizeElec, donorKey } from '../scripts/nj/elec-map.mjs';

test('ELEC contributions: counted types, party exclusion, donor grouping, date window', () => {
  const row = (o) => ({ CONT_DATE: '2025-05-01T00:00:00', CONT_AMT: 100, CAND_NAME: 'DOE, JANE', ContributionType: 'MONETARY', OFFICE: 'MUNICIPAL OFFICE', ELECTIONYEAR: 2025, ELECTIONTYPE: 'GENERAL', ...o });
  const out = summarizeElec([
    row({ CONTRIBUTOR: 'T&M ASSOCIATES', CONT_TYPE: 'B' }),
    row({ CONTRIBUTOR: 'T AND M ASSOCIATES', CONT_TYPE: 'B', CAND_NAME: 'ROE, RICH' }),
    row({ CONTRIBUTOR: 'ENGINEERS PAC', CONT_TYPE: 'X', CONT_AMT: 250 }),
    row({ CONTRIBUTOR: 'LOCAL 825 OPERATING ENGINEERS', CONT_TYPE: 'H', CONT_AMT: 300 }),
    row({ CONTRIBUTOR: 'HOLMDEL NJ REPUBLICAN PARTY', CONT_TYPE: 'B', CONT_AMT: 5000 }),
    row({ CONTRIBUTOR: 'MONMOUTH COUNTY DEMOCRATS', CONT_TYPE: 'B', CONT_AMT: 900 }),
    row({ CONTRIBUTOR: 'SMITH FOR COUNCIL', CONT_TYPE: 'B', CONT_AMT: 900 }),
    row({ CONTRIBUTOR: 'NJ 8DEMOCRATIC STATE COMMITTEE', CONT_TYPE: 'J', CONT_AMT: 900 }),
    row({ CONTRIBUTOR: 'JOHN SMITH', CONT_TYPE: 'A', CONT_AMT: 75 }),
    row({ CONTRIBUTOR: 'OLD PAC', CONT_TYPE: 'J', CONT_DATE: '2019-01-01T00:00:00' }),
  ], '2022-10-01');
  assert.deepEqual(out.influence, { pacContributions: 250, developerContributions: 200, unionContributions: 300 });
  assert.equal(out.individuals, 75);
  assert.equal(out.topDonors.find((d) => d.type === 'Business').amount, 200);
  assert.equal(out.topDonors.find((d) => d.type === 'Business').recipient, 'Jane Doe, Rich Roe');
  assert.equal(out.ledger.length, 4);
  assert.equal(donorKey('Collier Engineering & Design'), donorKey('Colliers Engineering and Design'));
});

import { mapOscLine, aggregateOsc } from '../scripts/ny/osc-map.mjs';
import { summarizeNyContributions, isCandidateFiler, isCountedOffice } from '../scripts/ny/politics-map.mjs';

test('NY OSC lines map to categories and pass-through money is excluded', () => {
  assert.equal(mapOscLine('A|REVENUE|Real Property Taxes and Assessments|Real Property Taxes|'), 'propertyTax');
  assert.equal(mapOscLine('A|REVENUE|Sales and Use Tax|Sales Tax Distribution|'), 'salesTax');
  assert.equal(mapOscLine('A|REVENUE|Other Real Property Tax Items|Payments In Lieu Of Taxes|'), 'localRevenue');
  assert.equal(mapOscLine('SW|REVENUE|Charges for Services|Utility Fees|'), 'utilityCharges');
  assert.equal(mapOscLine('A|REVENUE|Other Local Revenues|Fines|'), 'finesForfeitures');
  assert.equal(mapOscLine('H|REVENUE|Proceeds of Debt|Sale Of Obligations|5710'), 'borrowing');
  assert.match(mapOscLine('H|REVENUE|Proceeds of Debt|Miscellaneous Debt Proceeds|5792'), /^exclude:refinancing/);
  assert.match(mapOscLine('TC|REVENUE|Other Local Revenues|Miscellaneous Revenues|'), /^exclude:custodial/);
  assert.match(mapOscLine('A|REVENUE|Other Sources|Transfers|'), /^exclude:transfers/);
  assert.equal(mapOscLine('A|EXPENDITURE|General Government|Administration|1420'), 'consultants');
  assert.equal(mapOscLine('A|EXPENDITURE|General Government|Administration|1220'), 'administration');
  assert.equal(mapOscLine('DA|EXPENDITURE|Transportation|Highways|'), 'roads');
  assert.equal(mapOscLine('A|EXPENDITURE|Employee Benefits|Medical Insurance|'), 'shared');
  assert.match(mapOscLine('V|EXPENDITURE|||'), /^exclude:refinancing/);
});

test('NY OSC aggregation reconciles to reported totals', () => {
  const out = aggregateOsc({
    'A|REVENUE|Real Property Taxes and Assessments|Real Property Taxes|': 800,
    'A|REVENUE|State Aid|Unrestricted State Aid|': 200,
    'TC|REVENUE|Other Local Revenues|Miscellaneous Revenues|': 5000,
    'A|EXPENDITURE|Public Safety|Police|': 600,
    'A|EXPENDITURE|General Government|Administration|1220': 300,
    'A|EXPENDITURE|Employee Benefits|Medical Insurance|': 90,
    'TC|EXPENDITURE|General Government|Miscellaneous General Government|1935': 5000,
  });
  assert.deepEqual(out.revenue, { propertyTax: 800, stateAid: 200 });
  assert.deepEqual(out.spending, { publicSafety: 660, administration: 330 });
  assert.equal(out.excluded.revenue, 5000);
  assert.equal(out.raw.spending, 5990);
  assert.deepEqual(out.unmapped, []);
});

test('NY contributions: counted types, corporate schedule, filers and offices', () => {
  const row = (o) => ({ sched_date: '2025-05-01T00:00:00.000', org_amt: '100', cand_comm_name: 'FRIENDS OF JANE DOE', election_year: '2025', election_type: 'State/Local', ...o });
  const out = summarizeNyContributions([
    row({ cntrbr_type_desc: 'Professional/Limited Liability Company (PLLC/LLC)', flng_ent_name: 'ACME PAVING LLC' }),
    row({ cntrbr_type_desc: 'Political Action Committee (PAC)', flng_ent_name: 'NYS LABORERS PAC', org_amt: '250' }),
    row({ cntrbr_type_desc: 'Union', flng_ent_name: 'CSEA LOCAL 1000', org_amt: '300' }),
    row({ filing_sched_desc: 'Monetary Contributions Received From Corporation', flng_ent_name: 'BIG BOX INC', org_amt: '50' }),
    row({ cntrbr_type_desc: 'Political Committee', flng_ent_name: 'TOWN DEMOCRATIC COMMITTEE', org_amt: '900' }),
    row({ cntrbr_type_desc: 'Individual', flng_ent_first_name: 'Sam', org_amt: '40' }),
  ], '2022-10-01');
  assert.deepEqual(out.influence, { pacContributions: 250, developerContributions: 150, unionContributions: 300 });
  assert.equal(out.individuals, 40);
  assert.ok(isCandidateFiler({ committee_type_desc: 'Authorized Single Candidate Committee' }));
  assert.ok(!isCandidateFiler({ committee_type_desc: 'Political Action Committee' }));
  assert.ok(isCountedOffice('Town Supervisor') && !isCountedOffice('Town Justice'));
});

import { aggregateAfr } from '../scripts/pa/afr-map.mjs';

test('PA annual financial report columns map, reconcile and spread benefits', () => {
  const rec = {
    'Total Revenues': 1000, 'Total Expenditures': 980, 'Total Taxes Revenues': 650,
    'Real Estate Tax Revenues': 300, 'Earned Income Tax Revenues': 250, 'All Other Taxes Revenues': 50,
    'Intergovernmental Revenues-State Government': 200, 'Fines and Forfeits Revenues': 50, 'Other Financing Sources Revenues': 100,
    'Police Expenditures': 400, 'General Government Expenditures': 200, 'Other Expenditures': 80,
    'Debt Service Expenditures': 200, 'Other Financing Uses Expenditures': 100,
  };
  const a = aggregateAfr(rec);
  assert.equal(a.unitemizedTaxes, 50);
  assert.deepEqual(a.revenue, { propertyTax: 300, salesTax: 350, stateAid: 200, finesForfeitures: 50 });
  assert.deepEqual(a.spending, { publicSafety: 440, administration: 220, debtService: 220 });
  assert.equal(a.lineTotals.revenue, 1000);
  assert.equal(a.lineTotals.spending, 980);
  assert.deepEqual(a.excluded, { revenue: 100, spending: 100 });
});
