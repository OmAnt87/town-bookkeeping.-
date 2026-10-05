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

import { aggregateCt } from '../scripts/ct/mfi-map.mjs';

test('CT financial statements and UCOA departments map, reconcile and spread capital outlay', () => {
  const fs = {
    d_3_property_tax_revenue: 700, d_6_state_revenues: 200, d_9_federal_revenues: 0, d_12_all_other_revenues: 100, d_15_total_revenues: 1000,
    d_20_total_education: 600, d_21_debt_service_expenditures: 100, d_24_all_other_expenditures: 250, d_26_total_expenditures: 950,
    d_28_transfers_in: 40, d_29_transfers_out: -30,
  };
  const depts = [
    { department_code: '4700', total: '500' }, { department_code: '4201', total: '200' },
    { department_code: '4899', total: '100' }, { department_code: '4100', total: '0' }, { department_code: '4900', total: '150' },
  ];
  const a = aggregateCt(fs, depts);
  assert.deepEqual(a.revenue, { propertyTax: 700, stateAid: 200, otherRevenue: 100 });
  assert.deepEqual(a.spending, { education: 594, publicSafety: 238, debtService: 119 });
  assert.equal(a.lineTotals.spending, a.reported.spending);
  assert.deepEqual(a.excluded, { transfersIn: 40, transfersOut: 30, netOtherFinancing: 0 });

  // Benefits filed under general government go to town departments only.
  const c = aggregateCt({ ...fs, d_26_total_expenditures: 1000 }, [
    { department_code: '4700', total: '600' }, { department_code: '4201', total: '100' },
    { department_code: '4100', total: '200', employee_benefits: '150' }, { department_code: '4899', total: '100' },
  ]);
  assert.equal(c.benefitsSpread, 150);
  assert.deepEqual(c.spending, { education: 600, publicSafety: 200, administration: 100, debtService: 100 });
  assert.equal(Object.values(c.spending).reduce((x, y) => x + y, 0), 1000);

  // Without a department breakdown only schools and debt are known.
  const b = aggregateCt(fs, null);
  assert.deepEqual(b.spending, { education: 600, debtService: 100, otherSpending: 250 });
  const town = { population: 1000, revenue: b.revenue, spending: b.spending, debt: 0 };
  const s = scoreTown(town);
  for (const key of ['services', 'overhead']) {
    const c = s.components.find((x) => x.key === key);
    assert.equal(c.available, false);
    assert.match(c.detail, /not by department/);
  }
});

import { committeeMatcher, classifyReceipt, summarizeCtReceipts } from '../scripts/ct/seec-map.mjs';

test('CT town committees match their town and SEEC receipts are classified', () => {
  const match = committeeMatcher(['HARTFORD', 'WEST HARTFORD', 'NEW HAVEN', 'WINDSOR', 'WINDSOR LOCKS', 'STONINGTON']);
  assert.equal(match('West Hartford Democratic Town Committee'), 'WEST HARTFORD');
  assert.equal(match('Hartford Working Families Town Committee'), 'HARTFORD');
  assert.equal(match('Independent Party New Haven Town Committee'), 'NEW HAVEN');
  assert.equal(match('Windsor Locks Republican Town Committee'), 'WINDSOR LOCKS');
  assert.equal(match('Stonington Borough Town Committee of the Forward Party'), null);
  assert.equal(match('Hartford PAC'), null);

  const other = (name) => classifyReceipt({ receipt_type: 'Contributions from Other Committees', contributor_name: name });
  assert.equal(other('Sheet Metal Workers Local # 38').key, 'unionContributions');
  assert.equal(other('Ten Town PAC').key, 'pacContributions');
  assert.equal(other('Carfora for Mayor'), null);
  assert.equal(other('Elicker 2025'), null);
  assert.equal(other('30th District Republican Senatorial Committee'), null);
  const ad = (name) => classifyReceipt({ receipt_type: 'Advertising Book Proceeds', contributor_name: name });
  assert.equal(ad('Daniels Oil Co').key, 'developerContributions');
  assert.equal(ad('Carl A Massaro, Jr'), null);
  const person = { receipt_type: 'Itemized Contributions from Individuals', contributor_name: 'Pat Smith', lobbyist: 'NO', contractor: 'NO' };
  assert.equal(classifyReceipt(person), null);
  assert.equal(classifyReceipt({ ...person, lobbyist: 'YES' }).key, 'corporateLobbying');
  assert.equal(classifyReceipt({ ...person, contractor: 'YES' }).key, 'developerContributions');

  const row = { committee: 'Avon Republican Town Committee', contributor_name: 'Ten Town PAC', receipt_type: 'Contributions from Other Committees', transaction_date: '05/01/2025', amount: '500', receipt_state: 'Original' };
  const out = summarizeCtReceipts([row, { ...row, receipt_state: 'Amended' }, { ...row, transaction_date: '05/01/2020' }, { ...person, committee: row.committee, transaction_date: '05/02/2025', amount: '40', receipt_state: 'Original' }], '2023-01-01');
  assert.equal(out.influence.pacContributions, 500);
  assert.equal(out.individuals, 40);
  assert.equal(out.counted, 1);
});

import { aggregateMa } from '../scripts/ma/dls-map.mjs';

test('MA Schedule A maps, reconciles, separates excises and spreads fixed costs', () => {
  const gf = {
    revenue: {
      Taxes: 700, 'Service Charges': 20, 'Licenses and Permits': 10, 'Federal Revenue': 0, 'State Revenue': 200, 'Revenue from Other Governments': 0,
      'Special Assessments': 0, 'Fines and Forfeitures': 5, Miscellaneous: 15, 'Other Financing Sources': 30, Transfers: 20, 'Total Revenues': 1000,
    },
    spending: {
      'General Government': 50, 'Public Safety': 150, Education: 500, 'Public Works': 100, 'Human Services': 0, 'Culture and Recreation': 0,
      'Fixed Costs': 160, 'Intergov Assessments': 40, 'Other Expenditures': 0, 'Debt Service': 0, 'Total Expenditures': 1000,
    },
  };
  const a = aggregateMa(gf, { 'Motor Vehicle Excise': 60, 'A.Meals': 40, Fees: 99 });
  assert.deepEqual(a.revenue, { propertyTax: 600, salesTax: 100, feesPermits: 30, stateAid: 200, finesForfeitures: 5, localRevenue: 15 });
  assert.equal(a.lineTotals.revenue, a.reported.revenue);
  assert.equal(a.lineTotals.spending, a.reported.spending);
  assert.deepEqual(a.excluded, { 'Other Financing Sources': 30, Transfers: 20 });
  // Fixed costs (160) and assessments (40) spread by size over 800 of departments.
  assert.deepEqual(a.spending, { administration: 63, publicSafety: 188, education: 625, roads: 125 });
  assert.equal(Object.values(a.spending).reduce((x, y) => x + y, 0), 1001); // rounding

  // Fixed costs skip debt service.
  const d = aggregateMa({ revenue: gf.revenue, spending: { Education: 300, 'Debt Service': 100, 'Fixed Costs': 60, 'Total Expenditures': 460 } }, null);
  assert.deepEqual(d.spending, { education: 360, debtService: 100 });
  assert.equal(d.taxSplit, false);
  assert.equal(d.revenue.propertyTax, 700);

  // Only a total reported: not broken down.
  const t = aggregateMa({ revenue: gf.revenue, spending: { 'Total Expenditures': 900 } }, null);
  assert.deepEqual(t.spending, { otherSpending: 900 });
});

import { townMatcher, localFilers, classifyOcpf, summarizeMaReceipts } from '../scripts/ma/ocpf-map.mjs';

test('MA OCPF filers match their town and receipts are classified', () => {
  const match = townMatcher(['Boston', 'Manchester By The Sea', 'North Andover', 'Agawam']);
  assert.equal(match('Manchester'), 'Manchester By The Sea');
  assert.equal(match('north andover'), 'North Andover');
  assert.equal(match('Andover'), null);
  const filers = localFilers({
    lpc: [{ cpfId: 1, filerName: 'Boston Ward 6 DEMWC' }, { cpfId: 2, filerName: 'North Andover REPTC' }, { cpfId: 3, filerName: 'Somewhere Else DEMTC' }],
    mayoral: [{ cpfId: 4, filerName: 'Johnson, Christopher', officeSought: 'Mayoral, Agawam' }],
    cc: [{ cpfId: 5, filerName: 'Flynn, Edward Michael', officeSought: 'City Councilor, Boston' }],
  }, match);
  assert.deepEqual(filers.get(1), { town: 'Boston', label: 'Boston Ward 6 Democratic Ward Committee' });
  assert.equal(filers.get(2).label, 'North Andover Republican Town Committee');
  assert.equal(filers.has(3), false);
  assert.deepEqual(filers.get(4), { town: 'Agawam', label: 'Christopher Johnson (candidate for mayor)' });
  assert.equal(filers.get(5).town, 'Boston');

  const pac = new Set([10]);
  const item = (o) => ({ id: 0, recordTypeId: 202, fullNameReverse: '', filerCpfId: 5, date: '5/1/2025', amount: '$500.00', reportId: 9, ...o });
  assert.equal(classifyOcpf(item({ recordTypeId: 203, fullNameReverse: 'Boston Teachers Union' }), pac).key, 'unionContributions');
  assert.equal(classifyOcpf(item({ fullNameReverse: 'Ibew Local 103 #80221' }), pac).key, 'unionContributions');
  assert.equal(classifyOcpf(item({ id: 10, fullNameReverse: 'Greater Boston Real Estate Board PAC' }), pac).key, 'pacContributions');
  assert.equal(classifyOcpf(item({ fullNameReverse: 'Committee To Elect Kevin Aguiar' }), pac), null);
  assert.equal(classifyOcpf(item({ fullNameReverse: 'Saugus DEMTC' }), pac), null);
  assert.equal(classifyOcpf(item({ recordTypeId: 201, fullNameReverse: 'Pat Smith' }), pac), null);

  const out = summarizeMaReceipts([
    item({ recordTypeId: 203, fullNameReverse: 'Boston Teachers Union' }),
    item({ id: 10, fullNameReverse: 'Greater Boston Real Estate Board PAC', amount: '$1,000.00' }),
    item({ recordTypeId: 203, fullNameReverse: 'Boston Teachers Union', date: '5/1/2020' }),
  ], filers, pac, '2023-01-01');
  assert.deepEqual(out.influence, { pacContributions: 1000, developerContributions: 0, unionContributions: 500 });
  assert.equal(out.counted, 2);
  assert.equal(out.topDonors[0].recipient, 'Edward Michael Flynn (candidate for city council)');
  assert.match(out.ledger[0].source, /DisplayReport.*id=9/);
});

import { aggregateRi } from '../scripts/ri/mtp-map.mjs';

test('RI transparency portal rows map, reconcile and spread central costs', () => {
  const row = (control, o) => ({ control, department: '', group: '', cls: '', account: '', amount: '0', ...o });
  const a = aggregateRi([
    row('Revenue', { group: 'Local Revenue', cls: 'Property Tax', account: 'Current Year Levy Tax Collection', amount: '700' }),
    row('Revenue', { group: 'Local Revenue', cls: 'Property Tax', account: 'PILOT & Tax Treaty (excluded from levy) Collection', amount: '20' }),
    row('Revenue', { group: 'Local Revenue', cls: 'Local Non-Property Tax Revenues', account: 'Rescue Run Revenue', amount: '30' }),
    row('Revenue', { group: 'Local Revenue', cls: 'Local Non-Property Tax Revenues', account: 'Fines and Forfeitures', amount: '10' }),
    row('Revenue', { group: 'State Aid', cls: 'State Aid', account: 'Motor Vehicle Phase Out', amount: '200' }),
    row('Revenue', { group: 'Federal Aid', cls: 'Federal Aid', account: 'CDBG', amount: '40' }),
    row('Financing Sources', { amount: '500' }),
    row('Expenditures', { department: 'Police Department', group: 'Compensation', amount: '300' }),
    row('Expenditures', { department: 'Public Works', group: 'Operations', amount: '100' }),
    row('Expenditures', { department: 'General Government', group: 'Operations', account: 'Purchased Services', amount: '100' }),
    row('Expenditures', { department: 'General Government', group: 'Operations', account: 'Insurance', amount: '50' }),
    row('Expenditures', { department: 'General Government', group: 'Operations', account: 'Capital Outlays', amount: '100' }),
    row('Expenditures', { department: 'OPEB', group: 'Benefits', amount: '50' }),
    row('Expenditures', { department: 'Education', group: 'Municipal Education Appropriation', amount: '400' }),
    row('Expenditures', { department: 'Debt Service', group: 'Debt Service', amount: '100' }),
  ]);
  assert.deepEqual(a.revenue, { propertyTax: 700, localRevenue: 20, feesPermits: 30, finesForfeitures: 10, stateAid: 200, federalGrants: 40 });
  assert.equal(a.lineTotals.revenue, a.reported.revenue);
  assert.equal(a.lineTotals.spending, a.reported.spending);
  assert.deepEqual(a.excluded, { financingSources: 500, financingUses: 0 });
  assert.equal(a.shared, 100);
  assert.equal(a.benefitsSpread, 100); // insurance + OPEB
  // Capital outlay (100) over 1000 of departments, then benefits (100) over police, works and admin only.
  assert.deepEqual(a.spending, { publicSafety: 390, roads: 130, administration: 130, education: 440, debtService: 110 });
  assert.deepEqual(a.unmapped, []);
});

import { townMatcher as riTownMatcher, localFilers as riLocalFilers, recipientTown, classifyErts, summarizeRiReceipts } from '../scripts/ri/erts-map.mjs';

test('RI filers and party committees match their town and ERTS receipts are classified', () => {
  const match = riTownMatcher(['Providence', 'South Kingstown', 'North Kingstown', 'Cumberland', 'Pawtucket']);
  assert.equal(match('WAKEFIELD'), 'South Kingstown');
  assert.equal(match('North Kingston'), 'North Kingstown');
  assert.equal(match('Groton'), null);
  const filers = riLocalFilers([
    { name: 'PAT SMITH', city: 'WAKEFIELD', state: 'RI', office: 'City/Town Council' },
    { name: 'DANIEL J MCKEE', city: 'CUMBERLAND', state: 'RI', office: 'Mayor/Administrator' },
    { name: 'SAM LEE', city: 'PROVIDENCE', state: 'RI', office: 'School Committee' },
    { name: 'SAM LEE', city: 'PAWTUCKET', state: 'RI', office: 'City/Town Council' },
  ], match, [{ name: 'Daniel J McKee', city: 'CUMBERLAND', office: 'Governor' }]);
  assert.deepEqual(filers.get('PAT SMITH'), { town: 'South Kingstown', label: 'Pat Smith (city/town council candidate)' });
  assert.equal(filers.has('DANIEL J MCKEE'), false); // also ran for state office
  assert.equal(filers.has('SAM LEE'), false); // two towns
  assert.deepEqual(recipientTown('PROVIDENCE DEMOCRATIC CITY COMMITTEE', filers, match), { town: 'Providence', label: 'Providence Democratic City Committee' });
  assert.equal(recipientTown('RI DEMOCRATIC STATE COMMITTEE', filers, match), null);
  assert.equal(recipientTown('Pat  Smith', filers, match).town, 'South Kingstown');

  const pac = (name, o) => ({ fullname: name, transtype: 'Contribution', receiptdate: '05/01/2025', amount: '500.0000', ...o });
  assert.equal(classifyErts(pac('PROVIDENCE FIRE FIGHTERS HEALTH AND SAFETY PAC')).key, 'unionContributions');
  assert.equal(classifyErts(pac("RI LABORER'S POLITICAL LEAGUE")).key, 'unionContributions');
  assert.equal(classifyErts(pac('REALTORS PAC OF RI')).key, 'pacContributions');
  assert.equal(classifyErts(pac('RI SENATE DEMOCRATS PAC')), null);
  assert.equal(classifyErts(pac('REALTORS PAC OF RI', { transtype: 'Expenditure' })), null);

  const recipient = { town: 'Providence', label: 'Providence Democratic City Committee' };
  const out = summarizeRiReceipts([
    { ...pac('REALTORS PAC OF RI'), recipient },
    { ...pac('IBEW LOCAL 99', { amount: '250' }), recipient },
    { ...pac('IBEW LOCAL 99', { receiptdate: '05/01/2020' }), recipient },
  ], '2023-01-01');
  assert.deepEqual(out.influence, { pacContributions: 500, developerContributions: 0, unionContributions: 250 });
  assert.equal(out.counted, 2);
});

import { aggregateMd } from '../scripts/md/lgf-map.mjs';

test('MD statements map all funds, split utility charges, leave out debt proceeds and spread miscellaneous', () => {
  const a = aggregateMd({
    'revenues/Taxes - Local - Property': [500, 0, 0, 500],
    'revenues/Taxes - Local - Income': [100, 0, 0, 100],
    'revenues/Service Charges': [20, 0, 180, 200],
    'revenues/County Grants': [50, 0, 0, 50],
    'revenues/Debt Proceeds': [0, 150, 0, 150],
    'revenues/Total': [670, 150, 180, 1000],
    'expenditures/General Government': [100, 0, 0, 100],
    'expenditures/Police': [200, 0, 0, 200],
    'expenditures/Transportation': [100, 100, 0, 200],
    'expenditures/Sewer/Solid Waste/Water': [0, 0, 200, 200],
    'expenditures/Principal': [50, 0, 50, 100],
    'expenditures/Miscellaneous': [70, 0, 0, 70],
    'expenditures/Total': [520, 100, 250, 870],
  });
  assert.deepEqual(a.revenue, { propertyTax: 500, salesTax: 100, utilityCharges: 180, feesPermits: 20, grants: 50 });
  assert.deepEqual(a.excluded, { 'Debt Proceeds': 150 });
  assert.equal(a.lineTotals.revenue, a.reported.revenue);
  assert.equal(a.lineTotals.spending, a.reported.spending);
  // Miscellaneous (70) over 700 of departments, not debt service.
  assert.deepEqual(a.spending, { administration: 110, publicSafety: 220, roads: 220, utilities: 220, debtService: 100 });
  assert.equal(a.benefitsSpread, 70);
  assert.deepEqual(aggregateMd({ 'expenditures/Mystery': [1, 0, 0, 1] }).unmapped, ['expenditures/Mystery']);
});

import { aggregateVa } from '../scripts/va/apa-map.mjs';

test('VA comparative report maps all funds, reconciles to Exhibit A and spreads shared costs', () => {
  const a = aggregateVa({
    A: { 'Local Revenue': 700, 'Maintenance and Operation Expenditures': 1000, 'Non-Revenue Receipts': 5 },
    B: { 'Real Property': 500, 'Personal Property - General': 100, 'Other Local Taxes (Exhibit B-2)': 60, 'Charges for Services': 30, 'Interest (25)': 10 },
    B1: { 'Categorical State Aid': 200, 'Categorical Federal Aid': 50 },
    C: { 'General Government Administration (Exhibit C-1)': 100, 'Public Safety (Exhibit C-3)': 200, 'Public Works (Exhibit C-4)': 100, 'Education (Exhibit C-6)': 500, 'Non- Departmental': 100 },
    C4: { 'Maintenance of Highways, Streets, Bridges, and Sidewalks': 60, 'Sanitation and Waste Removal': 40 },
    D: { 'Debt Proceeds': 300, Education: 0, 'Streets, Roads, and Bridges': 0 },
    E: { 'Redemption of Debt Education': 50, 'Debt Interest Costs Education': 20 },
    F: { 'User Charges': 80, 'General Operating Expenses': 70, Depreciation: 15 },
    G: { 'Bonds and Bond Issue Anticipation Loans': 900, 'Literary Fund Loans': 100 },
  });
  assert.deepEqual(a.check, { localRevenue: [700, 700], operations: [1000, 1000] });
  assert.deepEqual(a.revenue, { propertyTax: 600, salesTax: 60, feesPermits: 30, localRevenue: 10, stateAid: 200, federalGrants: 50, utilityCharges: 80 });
  // Non-departmental (100) spread over 970 of departments (not debt service).
  assert.equal(a.shared, 100);
  assert.equal(Math.round(Object.values(a.spending).reduce((x, y) => x + y, 0)), 1140);
  assert.equal(a.spending.debtService, 70);
  assert.equal(a.spending.education, Math.round(500 + 100 * (500 / 970)));
  assert.deepEqual(a.excluded, { debtProceeds: 300, nonRevenue: 5, depreciation: 15 });
  assert.equal(a.debt, 1000);
});

import { localityFor, classifyVa, isLocalReport, summarizeVaReceipts } from '../scripts/va/elect-map.mjs';

test('VA local committees are placed by district, office or address and receipts are classified', () => {
  const ctx = {
    zipCounty: new Map([['20176', '51107'], ['23219', '51760']]),
    countyKey: new Map([['51107', 'County|Loudoun'], ['51760', 'City|Richmond']]),
    towns: new Map([['leesburg', 'Town|Leesburg']]),
    byName: new Map([['richmond', 'City|Richmond']]),
    placeCounty: new Map([['ashburn', '51107']]),
  };
  assert.equal(localityFor({ officesought: 'Member Town Council - Leesburg', district: '', city: 'Leesburg', zipcode: '20176' }, ctx), 'Town|Leesburg');
  assert.equal(localityFor({ officesought: 'Member Board Of Supervisors', district: 'Election - Broad Run District', city: 'Leesburg', zipcode: '20176-1234' }, ctx), 'County|Loudoun');
  assert.equal(localityFor({ officesought: 'Mayor', district: '', city: 'Richmond', zipcode: '23219' }, ctx), 'City|Richmond');
  assert.equal(localityFor({ officesought: 'Sheriff', district: '', city: 'Ashburn', zipcode: '20146' }, ctx), 'County|Loudoun'); // PO box ZIP
  assert.equal(localityFor({ officesought: 'Member Town Council', district: 'Town - Hamilton', city: 'Hamilton', zipcode: '20158' }, ctx), null);
  assert.equal(isLocalReport({ islocal: 'True', officesought: 'Member, House Of Delegates', district: '' }), false);
  assert.equal(isLocalReport({ islocal: 'True', officesought: 'Member School Board', district: '' }), true);

  const rec = (name, o) => ({ isindividual: 'False', firstname: '', lastorcompanyname: name, transactiondate: '05/01/2025', amount: '500.00', recipient: 'Friends of Pat (board of supervisors)', ...o });
  assert.equal(classifyVa(rec('Firepac Local 2068')).key, 'unionContributions');
  assert.equal(classifyVa(rec('Dominion Political Action Committee')).key, 'pacContributions');
  assert.equal(classifyVa(rec('Pruitt Corporation')).key, 'developerContributions');
  assert.equal(classifyVa(rec('Kannan For Delegate')), null);
  assert.equal(classifyVa(rec('Loudoun County Republican Committee')), null);
  assert.equal(classifyVa(rec('Pat Smith', { isindividual: 'True' })), null);
  const out = summarizeVaReceipts([rec('Pruitt Corporation'), rec('Pruitt Corporation'), rec('Firepac Local 2068', { amount: '250' }), rec('Pruitt Corporation', { transactiondate: '05/01/2020' })], '2023-01-01');
  assert.deepEqual(out.influence, { pacContributions: 0, developerContributions: 500, unionContributions: 250 });
  assert.equal(out.counted, 2); // the amended duplicate is dropped
});

import { mapItem as ncMapItem, aggregateUnit as aggregateNc } from '../scripts/common/census-units.mjs';

test('NC Census items map to categories, leave out intergovernmental payments and flag imputed units', () => {
  assert.equal(ncMapItem('T01').key, 'propertyTax');
  assert.equal(ncMapItem('A91').key, 'utilityCharges');
  assert.equal(ncMapItem('E12').key, 'education');
  assert.equal(ncMapItem('F44').key, 'roads');
  assert.equal(ncMapItem('39U').key, 'debtService');
  assert.equal(ncMapItem('M89').group, 'excluded');
  assert.equal(ncMapItem('29U').group, 'excluded');
  assert.equal(ncMapItem('Q99'), null);
  const it = (code, amount, flag = 'R') => ({ code, amount, flag });
  const a = aggregateNc([it('T01', 100), it('C89', 50), it('A91', 20), it('E62', 60), it('F62', 10), it('E91', 15), it('I89', 5), it('39U', 10), it('M89', 30), it('29U', 40), it('49U', 300), it('64V', 20)]);
  assert.deepEqual(a.revenue, { propertyTax: 100000, stateAid: 50000, utilityCharges: 20000 });
  assert.deepEqual(a.spending, { publicSafety: 70000, utilities: 15000, debtService: 15000 });
  assert.equal(a.debt, 320000);
  assert.equal(a.proceeds, 40000);
  assert.equal(a.intergovernmental, 30000);
  assert.deepEqual(a.lineTotals, { revenue: 170000, spending: 100000 });
  assert.equal(a.imputed, false);
  assert.equal(aggregateNc([it('T01', 1, 'I'), it('E62', 1, 'I'), it('C89', 1)]).imputed, true);
  assert.equal(a.incomplete, false);
  assert.equal(aggregateNc([it('A90', 5000), it('E90', 4500), it('T10', 185), it('49U', 3450)]).incomplete, true); // only the ABC board
  assert.equal(aggregateNc([it('39U', 1288), it('49U', 19995)]).incomplete, true); // only debt
});

import { localityFor as ncLocalityFor, classifyNc, summarizeNcReceipts } from '../scripts/nc/ncsbe-map.mjs';

test('NC local committees are placed by office and address and receipts are classified', () => {
  const ctx = {
    zipCounty: new Map([['27601', '37183'], ['27513', '37183'], ['28202', '37119']]),
    countyKey: new Map([['37183', 'County|37183'], ['37119', 'County|37119']]),
    munis: new Map([['raleigh', [{ key: 'Place|55000', county: '37183' }]], ['cary', [{ key: 'Place|10740', county: '37183' }]]]),
    placeCounty: new Map([['charlotte', '37119']]),
  };
  assert.equal(ncLocalityFor({ CandOfficeCode: 'COUM', CommCity: 'RALEIGH', CommZip: '27601', CommName: 'X' }, ctx), 'Place|55000');
  assert.equal(ncLocalityFor({ CandOfficeCode: 'MAY', CommCity: 'APEX', CommZip: '27513', CommName: 'COMMITTEE TO ELECT JO FOR CARY TOWN COUNCIL' }, ctx), 'Place|10740');
  assert.equal(ncLocalityFor({ CandOfficeCode: 'CYCM', CommCity: 'RALEIGH', CommZip: '27601', CommName: 'X' }, ctx), 'County|37183');
  assert.equal(ncLocalityFor({ CandOfficeCode: 'SHER', CommCity: 'CHARLOTTE', CommZip: '28299', CommName: 'X' }, ctx), 'County|37119'); // PO box ZIP
  assert.equal(ncLocalityFor({ CandOfficeCode: 'NSHS', CommCity: 'RALEIGH', CommZip: '27601', CommName: 'X' }, ctx), null);

  const rec = (name, o) => ({ TransSubTypeCode: 'CPCM', OrgName: name, OccurDate: '05/01/2025', Amount: 500, SboeID: '183-1', recipient: 'Committee to Elect Pat (county commissioner)', ...o });
  assert.equal(classifyNc(rec('Wake County Professional Firefighters Local 548')).key, 'unionContributions');
  assert.equal(classifyNc(rec('NC Realtors PAC')).key, 'pacContributions');
  assert.equal(classifyNc(rec('Self Help Credit Union', { TransSubTypeCode: 'OUTS' })), null);
  assert.equal(classifyNc(rec('Committee to Elect Jane Doe')), null);
  assert.equal(classifyNc(rec('Jim Perry Committee')), null);
  assert.equal(classifyNc(rec('Wake County Democratic Party')), null);
  const out = summarizeNcReceipts([rec('NC Realtors PAC'), rec('NC Realtors PAC'), rec('Wake County Professional Firefighters Local 548', { Amount: 250 }), rec('NC Realtors PAC', { OccurDate: '05/01/2020' })], '2023-01-01');
  assert.deepEqual(out.influence, { pacContributions: 500, developerContributions: 0, unionContributions: 250 });
  assert.equal(out.counted, 2);
});

import { parseOffice, localityFor as scLocalityFor, classifySc, summarizeScReceipts } from '../scripts/sc/ethics-map.mjs';

test('SC candidates are placed by office name and Ethics Commission contributions are classified', () => {
  const ctx = {
    counties: new Map([['charleston', 'County|45019'], ['spartanburg', 'County|45083'], ['horry', 'County|45051']]),
    munis: new Map([['charleston', 'Place|13330'], ['mount pleasant', 'Place|48535'], ['north myrtle beach', 'Place|50695']]),
  };
  assert.equal(scLocalityFor('Charleston City Council District 3', ctx), 'Place|13330');
  assert.equal(scLocalityFor('Charleston County Council District 8', ctx), 'County|45019');
  assert.equal(scLocalityFor('Mt. Pleasant City Council At Large', ctx), 'Place|48535');
  assert.equal(scLocalityFor('North Myrtle Beach Mayor ', ctx), 'Place|50695');
  assert.equal(scLocalityFor('Spartanburg Sheriff ', ctx), 'County|45083');
  assert.equal(scLocalityFor('Horry County Council Chairman/Supervisor', ctx), 'County|45051');
  assert.equal(parseOffice('Charleston Solicitor'), null);
  assert.equal(parseOffice('School Board Trustee District SPARTANBURG #2'), null);
  assert.equal(parseOffice('SC House of Representatives District 4'), null);
  assert.equal(parseOffice('4'), null);
  assert.equal(parseOffice('State Treasurer'), null);
  assert.equal(scLocalityFor('Sullivans Island Mayor', { counties: new Map(), munis: new Map([['sullivans island', 'Place|70090']]) }), 'Place|70090');

  const rec = (name, o) => ({ contributionId: Math.random(), group: 'Yes', contributorName: ` ${name}`, date: '2025-05-01T04:00:00', amount: 500, recipient: 'Pat Doe (council)', ...o });
  assert.equal(classifySc(rec('Charleston Firefighters Local 1146')).key, 'unionContributions');
  assert.equal(classifySc(rec('SC Realtors PAC')).key, 'pacContributions');
  assert.equal(classifySc(rec('Greystar Development LLC')).key, 'developerContributions');
  assert.equal(classifySc(rec('Founders Federal Credit Union')).key, 'developerContributions');
  assert.equal(classifySc(rec('COR Employees Credit Union')).key, 'developerContributions');
  assert.equal(classifySc(rec('Ross Appel for City Council')), null);
  assert.equal(classifySc(rec('Ripley Yacht Club Investors, LLC')).key, 'developerContributions');
  assert.equal(classifySc(rec('First Citizens Bank')).key, 'developerContributions');
  assert.equal(classifySc(rec('Union Heights Residential')).key, 'developerContributions');
  assert.equal(classifySc(rec("International Longshoreman's Association")).key, 'unionContributions');
  assert.equal(classifySc(rec('Friends of Jane Doe')), null);
  assert.equal(classifySc(rec('Charleston County Republican Party')), null);
  assert.equal(classifySc(rec('Pat Smith', { group: 'No' })), null);
  const out = summarizeScReceipts([rec('Greystar Development LLC', { contributionId: 1 }), rec('Greystar Development LLC', { contributionId: 1 }), rec('SC Realtors PAC', { contributionId: 2, amount: 250 }), rec('SC Realtors PAC', { contributionId: 3, date: '2020-05-01T04:00:00' })], '2023-01-01');
  assert.deepEqual(out.influence, { pacContributions: 250, developerContributions: 500, unionContributions: 0 });
  assert.equal(out.counted, 2); // the repeated contribution is dropped
});

import { aggregateGa, functionKey as gaFunctionKey } from '../scripts/ga/rlgf-map.mjs';

test('GA RLGF maps revenue and spending, reconciles to the form, and nets out intergovernmental payments', () => {
  assert.equal(gaFunctionKey('2650'), 'administration');
  assert.equal(gaFunctionKey('3500'), 'publicSafety');
  assert.equal(gaFunctionKey('4200'), 'roads');
  assert.equal(gaFunctionKey('4400'), 'utilities');
  assert.equal(gaFunctionKey('4960'), null);
  assert.equal(gaFunctionKey('6100'), 'parks');
  const blocks = {
    R1: { '31_1100': 600, '31_9000': 10, '31_3100': 300, '31_4100': 50, '32_1200': 40, TTL_Part1: 1000 },
    R2: { '33_9999A': 20, '33_7100B': 30, '33_1000C': 15, '34_2100': 5, TTL_2A: 20, TTL_2B: 30, TTL_2C: 15 },
    R3: { '35_1100': 8, '36_1000': 12, '34_4210': 200, '34_6000': 3, TTL_Part3: 25, TTL_Part4: 203 },
    E1: { '1300A': 100, '1565B': 20 },
    E3: { '3200A': 300, '3200C': 25 },
    E4: { '4200A': 80, '4200B': 40 },
    E5: { '4960A': 60 },
    E6: { '6100A': 50, TTL_PART5_A: 590, TTL_PART5_B: 60, TTL_PART5_C: 25, TTL_PART5_D: 0 },
    E7: { '505CO': 150, '505IE': 30, '550CO': 70 },
    E9: { '3200B': 25, '4960B': 60, '5540B': 5 },
    D1: { TTL_10A_C: 40, TTL_10A_D: 500, TTL_10A_E: 30 },
    D2: { TTL_10B_C: 10, TTL_10B_D: 100, TTL_10B_E: 4 },
    D4: { SE_STN_C: 99, SE_STN_D: 7, SE_STN_E: 1 },
  };
  const a = aggregateGa(blocks);
  assert.deepEqual(a.revenue, { propertyTax: 610, salesTax: 350, feesPermits: 45, stateAid: 20, grants: 30, federalGrants: 15, finesForfeitures: 8, localRevenue: 12, utilityCharges: 203 });
  assert.deepEqual(a.check.revenue, [1293, 1293]);
  assert.deepEqual(a.check.partV, [675, 675]);
  // Police less its payment to another government; SPLOST paid to cities left out; the transit
  // payment (5540, not on Part V) comes out of health and welfare, absent here, so it is dropped.
  assert.deepEqual(a.spending, { administration: 120, publicSafety: 300, roads: 190, parks: 50, utilities: 150, debtService: 85 });
  assert.equal(a.debt, 607); // long-term 600 plus short-term notes 7; short-term notes retired are not debt service
  assert.equal(a.intergovernmental, 90);
  assert.equal(a.empty, false);
  assert.equal(aggregateGa({ R1: { TTL_Part1: 0 } }).empty, true);
  assert.equal(a.inconsistent, false);
  assert.equal(aggregateGa({ ...blocks, R3: { ...blocks.R3, '39_9999': 7e9 } }).inconsistent, true);
});

import { aggregateFl, revenueKey as flRevenueKey, expenditureKey as flExpenditureKey } from '../scripts/fl/edr-map.mjs';

test('FL EDR rows map by account code and fund, leaving out internal service, fiduciary and financing items', () => {
  assert.equal(flRevenueKey('311')[0], 'propertyTax');
  assert.equal(flRevenueKey('312.41')[0], 'salesTax');
  assert.equal(flRevenueKey('323.1')[0], 'feesPermits');
  assert.equal(flRevenueKey('335.18')[0], 'stateAid');
  assert.equal(flRevenueKey('343.3')[0], 'utilityCharges');
  assert.equal(flRevenueKey('381'), null);
  assert.equal(flExpenditureKey('517')[0], 'debtService');
  assert.equal(flExpenditureKey('522')[0], 'publicSafety');
  assert.equal(flExpenditureKey('535')[0], 'utilities');
  assert.equal(flExpenditureKey('572')[0], 'parks');
  assert.equal(flExpenditureKey('581'), null);
  const f = (o) => ({ general: 0, specialRevenue: 0, debtService: 0, capitalProjects: 0, permanent: 0, enterprise: 0, internalService: 0, custodial: 0, pension: 0, trust: 0, privatePurpose: 0, componentUnits: 0, ...o });
  const rev = [
    ['311', 'Ad Valorem Taxes', f({ general: 1000 })],
    ['343.3', 'Water Utility', f({ enterprise: 500 })],
    ['341.2', 'Internal Service Charges', f({ internalService: 300 })],
    ['381', 'Inter-fund Transfer In', f({ general: 200 })],
  ];
  const exp = [
    ['521', 'Law Enforcement', f({ general: 700, capitalProjects: 50 })],
    ['533', 'Water Utility Services', f({ enterprise: 450 })],
    ['517', 'Debt Service Payments', f({ debtService: 80 })],
    ['518', 'Pension Benefits', f({ pension: 900 })],
    ['581', 'Inter-fund Group Transfers Out', f({ general: 200 })],
  ];
  const a = aggregateFl(rev, exp);
  assert.deepEqual(a.revenue, { propertyTax: 1000, utilityCharges: 500 });
  assert.deepEqual(a.spending, { publicSafety: 750, utilities: 450, debtService: 80 });
  assert.deepEqual(a.leftOut, { otherSources: 200, otherUses: 200 });
  assert.equal(a.empty, false);
  assert.equal(a.inconsistent, false);
  assert.equal(aggregateFl(rev, []).empty, true);
});

import { parseCommitteeOffice, classifyDe, summarizeDeReceipts } from '../scripts/de/cfrs-map.mjs';

test('DE committees are placed by their office and CFRS contributor types classify the money', () => {
  assert.deepEqual(parseCommitteeOffice('County Office - Sussex County - County Council - District 3'), { level: 'county', place: 'Sussex', office: 'county council' });
  assert.deepEqual(parseCommitteeOffice('Municipal Office - Newark - City Council - District 03'), { level: 'municipal', place: 'Newark', office: 'city council' });
  assert.equal(parseCommitteeOffice('State Office - State Senator - District 16'), null);
  const rec = (name, type, o) => ({ contributor_name: name, contributor_type: type, contribution_type: 'Check', contribution_date: '5/1/2025', contribution_amount: '500.0000', cf_id: '01000001', recipient: 'Friends of Pat (county council)', ...o });
  assert.equal(classifyDe(rec('Rickman Management LLC', 'Corporation  Partnership  and Other Entity')).key, 'developerContributions');
  assert.equal(classifyDe(rec('Laborers Local 199', 'Labor Union')).key, 'unionContributions');
  assert.equal(classifyDe(rec('Delaware Realtors', 'Political Action Committee')).key, 'pacContributions');
  assert.equal(classifyDe(rec('Scaor Political Action Committee', 'Corporation  Partnership  and Other Entity')).key, 'pacContributions');
  assert.equal(classifyDe(rec('Pat Smith', 'Individual')), null);
  assert.equal(classifyDe(rec('Friends of Lee', 'Candidate Committee')), null);
  assert.equal(classifyDe(rec('Acme Inc', 'Corporation  Partnership  and Other Entity', { contribution_type: 'Refund/Rebate' })), null);
  const out = summarizeDeReceipts([rec('Acme Inc', 'Corporation  Partnership  and Other Entity'), rec('Acme Inc', 'Corporation  Partnership  and Other Entity'), rec('Laborers Local 199', 'Labor Union', { contribution_amount: '250' }), rec('Acme Inc', 'Corporation  Partnership  and Other Entity', { contribution_date: '5/1/2020' })], '2023-01-01');
  assert.deepEqual(out.influence, { pacContributions: 0, developerContributions: 500, unionContributions: 250 });
  assert.equal(out.counted, 2);
});
