import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { scoreTown, gradeFor, totals, COMPONENTS, redFlagEntries, corporateTies, transparencyChecked } from '../js/engine/scoring.js';
import { filterLedger, summarizeLedger, sortLedger, toCSV, validateDataset } from '../js/engine/ledger.js';
import { validateTown, historyOutliers, cleanHistory } from '../js/engine/validate.js';
import { mapCensusItem } from '../scripts/census-codes.mjs';
import { classifyContributor } from '../scripts/contributor-types.mjs';
import { parseCSV } from '../scripts/lib.mjs';
import { stateSummary } from '../js/engine/states.js';

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
  assert.equal(COMPONENTS.filter((c) => !c.penalty).reduce((a, c) => a + c.max, 0), 100);
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
  assert.equal(clean.components.find((c) => c.key === 'redFlags').points, 0);
  const flagged = base();
  flagged.spending.surveillance = 150_000;
  flagged.spending.corporateDeals = 200_000;
  flagged.taxBreaks = { dataCenterAbatements: 300_000 };
  const s = scoreTown(flagged);
  assert.equal(s.totals.redFlagSpending, 350_000);
  assert.equal(s.totals.taxBreaks, 300_000);
  assert.equal(s.components.find((c) => c.key === 'redFlags').points, -10);
  assert.equal(s.penalty, 10, 'the whole penalty comes off');
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
  assert.equal(clean.points, 0);
  town.redFlags = [
    { kind: 'surveillance', label: 'License-plate readers', date: '2023-04-28' },
    { kind: 'surveillance', label: 'License-plate readers', date: '2025-01-02' },
    { kind: 'dataCenter', label: 'Data center tax break (PILOT)' },
    { kind: 'surveillance', label: 'Police drones', scored: false },
  ];
  const s = scoreTown(town);
  assert.equal(s.totals.documentedRedFlags, 2, 'same program counted once; unscored records skipped');
  assert.equal(s.components.find((c) => c.key === 'redFlags').points, -5);
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

test('red flags only ever lower a score', () => {
  // A town whose other parts are weak would gain from a clean red-flag part if it
  // were averaged in; as a penalty, finding nothing changes nothing.
  const weak = base();
  weak.spending.consultants = 3_000_000;
  weak.transparency = {};
  const unchecked = { ...weak, spending: { ...weak.spending } };
  delete unchecked.spending.surveillance;
  delete unchecked.spending.corporateDeals;
  assert.equal(scoreTown(weak).score, scoreTown(unchecked).score);
  const flagged = { ...weak, redFlags: [{ kind: 'surveillance', label: 'Flock camera network' }] };
  assert.ok(Math.abs(scoreTown(weak).score - scoreTown(flagged).score - 2.5) < 0.2);
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
  assert.equal(s.coverage.scored, 4);
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

test('transparency counts only the practices that were checked', () => {
  const tr = (town) => scoreTown(town).components.find((c) => c.key === 'transparency');
  const all = tr(base());
  assert.equal(all.max, 20);
  assert.equal(all.points, Math.round((4 / 6) * 20 * 10) / 10);

  const one = base();
  one.transparency = { auditOnTime: true };
  assert.equal(transparencyChecked(one), 1);
  assert.equal(tr(one).max, 3.3);
  assert.equal(tr(one).points, 3.3);
  assert.match(tr(one).detail, /1 of 1 checked/);

  const late = base();
  late.transparency = { auditOnTime: false };
  assert.equal(tr(late).points, 0);
  // A town with one failed check loses at most that check's share, not 20 points.
  const unchecked = base();
  unchecked.transparency = {};
  assert.equal(tr(unchecked).available, false);
  assert.ok(scoreTown(unchecked).score - scoreTown(late).score < 4);
});

test('state summary groups towns and takes medians over towns with data', () => {
  const mk = (state, patch = {}) => { const t = { ...base(), state, stateName: state === 'MA' ? 'Massachusetts' : 'Connecticut', type: 'Town', ...patch }; return { town: t, s: scoreTown(t) }; };
  const entries = [
    mk('MA'),
    mk('MA', { influence: {}, transparency: { auditOnTime: false } }),
    mk('MA', { population: 30000 }),
    mk('CT', { type: 'City', transparency: {} }),
  ];
  const [ct, ma] = stateSummary(entries);
  assert.equal(ct.state, 'CT');
  assert.equal(ma.towns, 3);
  assert.equal(ma.population, 50000);
  assert.deepEqual(ma.types, { Town: 3 });
  assert.equal(Object.values(ma.grades).reduce((a, b) => a + b, 0), 3);
  assert.equal(ma.medianScore, [...entries.slice(0, 3)].map((e) => e.s.score).sort((a, b) => a - b)[1]);
  // The town with no political money loaded is left out of that median and that coverage.
  assert.equal(ma.coverage.find((c) => c.key === 'influence').share, 2 / 3);
  assert.equal(ma.medianInfluencePerResident, (0.3 + 0.1) / 2);
  assert.equal(ma.filingChecked, 3);
  assert.equal(ma.lateFilers, 1);
  assert.equal(ct.lateFilers, null);
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

import { aggregateLevy as aggregateNh } from '../scripts/common/levy.mjs';

test('NH keeps only the town share of a property tax levy that includes school and county shares', () => {
  const it = (code, amount, flag = 'R') => ({ code, amount, flag });
  // Levy of 900 covers the school district and county; the town spends 400 and has 100 of other revenue.
  const gross = aggregateNh([it('T01', 900), it('C89', 100), it('E62', 250), it('E44', 150)]);
  assert.equal(gross.passThrough, 600000);
  assert.deepEqual(gross.revenue, { propertyTax: 300000, stateAid: 100000 });
  assert.deepEqual(gross.lineTotals, { revenue: 400000, spending: 400000 });
  assert.equal(gross.lines.find((l) => l.key === 'propertyTax').amount, 300000);
  // A levy within 10% of what spending needs is the town's own, surplus included.
  const own = aggregateNh([it('T01', 320), it('C89', 100), it('E62', 250), it('E44', 150)]);
  assert.equal(own.passThrough, 0);
  assert.equal(own.revenue.propertyTax, 320000);
  // Counties levy only their own tax.
  assert.equal(aggregateNh([it('T01', 900), it('E62', 400)], true).passThrough, 0);
});

test('Northern New England towns that file school and county assessments as general government spending have them left out', () => {
  const it = (code, amount, flag = 'R') => ({ code, amount, flag });
  // 600 of "other general government" in a 900 budget with no schools: the assessments.
  const a = aggregateNh([it('T01', 850), it('C89', 50), it('E89', 600), it('E62', 200), it('E44', 100)]);
  assert.equal(a.assessments, 600000);
  assert.deepEqual(a.spending, { publicSafety: 200000, roads: 100000 });
  assert.equal(a.revenue.propertyTax, 250000);
  assert.equal(a.passThrough, 600000);
  // A town with its own school department keeps its general government spending.
  assert.equal(aggregateNh([it('T01', 850), it('E89', 600), it('E12', 200), it('E62', 100)]).assessments, 0);
  assert.equal(aggregateNh([it('T01', 300), it('E89', 100), it('E62', 200)]).assessments, 0);
});

import { candidatePlacer, classifyIl, committeeTypes, summarizeIlReceipts } from '../scripts/il/isbe-map.mjs';

test('IL candidates are placed by office and ISBE receipts are classified', () => {
  const place = candidatePlacer([
    { key: 'Place|14000', level: 'municipal', name: 'Chicago', county: 'Cook' },
    { key: 'Place|51622', level: 'municipal', name: 'Mount Prospect', county: 'Cook' },
    { key: 'Cousub|1', level: 'township', name: 'Washington', county: 'Tazewell' },
    { key: 'Cousub|2', level: 'township', name: 'Washington', county: 'Will' },
    { key: 'County|17031', level: 'county', name: 'Cook', county: 'Cook' },
  ]);
  assert.equal(place({ DistrictType: 'Ward', District: 'Chicago 24  ', ResidenceCounty: 'Cook' }).key, 'Place|14000');
  assert.equal(place({ DistrictType: 'Village', District: 'Mt. Prospect', ResidenceCounty: 'Cook' }).key, 'Place|51622');
  assert.equal(place({ DistrictType: 'Township', District: 'Washington', ResidenceCounty: 'Will' }).key, 'Cousub|2');
  assert.equal(place({ DistrictType: 'Township', District: 'Washington', ResidenceCounty: '' }), null); // ambiguous
  assert.equal(place({ DistrictType: 'County Board', District: 'Cook 14  ', ResidenceCounty: 'Cook' }).key, 'County|17031');
  assert.equal(place({ DistrictType: 'Representative', District: '5', ResidenceCounty: 'Cook' }), null);

  const rec = (LastOnlyName, D2Part, extra = {}) => ({ ID: String(Math.random()), LastOnlyName, FirstName: '', D2Part, Amount: '500', RcvDate: '2024-03-01 00:00:00', Archived: 'False', recipient: 'Jane Doe (Mayor)', ...extra });
  assert.equal(classifyIl(rec('Knowles Construction, Inc', '1A')).key, 'developerContributions');
  assert.equal(classifyIl(rec('Ibew Local 134', '1A')).key, 'unionContributions');
  assert.equal(classifyIl(rec('Realtors PAC', '2A')).key, 'pacContributions');
  assert.equal(classifyIl(rec('Illinois Hospital Assn', '2A')).key, 'pacContributions');
  assert.equal(classifyIl(rec('Woodford Co Dem Central Cmte', '2A')), null);
  assert.equal(classifyIl(rec('Friends of Bob Smith', '2A')), null);
  assert.equal(classifyIl(rec('Friends For Vicki Scaman', '1A')), null);
  assert.equal(classifyIl(rec('Isdf', '2A')), null); // Illinois Senate Democratic Fund
  const types = committeeTypes([{ Name: 'Committee to Elect Jones', TypeOfCommittee: 'Candidate' }, { Name: 'Good Roads Fund', TypeOfCommittee: 'Political Action' }]);
  assert.equal(classifyIl(rec('Committee To Elect Jones', '2A'), types), null);
  assert.equal(classifyIl(rec('Good Roads Fund', '1A'), types).key, 'pacContributions');
  assert.equal(classifyIl(rec('Smith', '1A', { FirstName: 'Bob' })), null);
  assert.equal(classifyIl(rec('First Bank', '3A')), null);
  assert.equal(classifyIl(rec('Acme Inc', '1A', { Archived: 'True' })), null);
  const out = summarizeIlReceipts([rec('Acme Inc', '1A', { ID: '1' }), rec('Acme Inc', '1A', { ID: '1' }), rec('Laborers Local 25', '1A', { ID: '2', Amount: '250' }), rec('Acme Inc', '1A', { ID: '3', RcvDate: '2020-01-01 00:00:00' })], '2023-01-01');
  assert.deepEqual(out.influence, { pacContributions: 0, developerContributions: 500, unionContributions: 250 });
  assert.equal(out.counted, 2);
});

test('Census principal repaid with new borrowing beyond capital outlay is left out as refinancing', () => {
  const it = (code, amount, flag = 'R') => ({ code, amount, flag });
  const items = [it('T01', 1000), it('E62', 600), it('F44', 100), it('29U', 900), it('39U', 1000), it('I89', 50)];
  const plain = aggregateNc(items);
  assert.equal(plain.spending.debtService, 1050000);
  assert.equal(plain.refinanced, 0);
  // 900 borrowed, 100 spent on capital: 800 of the 1,000 repaid was refinancing.
  const net = aggregateNc(items, { refinancing: true });
  assert.equal(net.refinanced, 800000);
  assert.equal(net.spending.debtService, 250000);
  assert.equal(net.lineTotals.spending, 950000);
  assert.equal(net.lines.find((l) => l.label === 'Debt service: principal repaid').amount, 200000);
  // Borrowing that all went to capital leaves principal repaid as is.
  assert.equal(aggregateNc([it('T01', 1000), it('E62', 600), it('F44', 900), it('29U', 900), it('39U', 100)], { refinancing: true }).refinanced, 0);
});

import { taxesFor, taxYearFor } from '../scripts/vt/taxes.mjs';

test('With the state\'s tax figures, the levy rule takes out the education tax a town reported as its own', () => {
  const it = (code, amount, flag = 'R') => ({ code, amount, flag });
  // Levy of 4,191 includes the town's 965 and education tax billed for the state.
  const gross = aggregateNh([it('T01', 4191), it('C89', 300), it('E44', 900), it('E62', 300)], false, { taxes: { muni: 965000, edu: 3301000, taxYear: 2021 } });
  assert.equal(gross.passThroughSource, 'state');
  assert.equal(gross.passThrough, 3226000);
  assert.deepEqual(gross.revenue, { propertyTax: 965000, stateAid: 300000 });
  assert.equal(gross.lineTotals.revenue, 1265000);
  // A levy close to the municipal tax is the town's own, surplus included (the estimate would have cut it).
  const own = aggregateNh([it('T01', 2436), it('E44', 2000)], false, { taxes: { muni: 2200000, edu: 6000000, taxYear: 2021 } });
  assert.equal(own.passThrough, 0);
  assert.equal(own.revenue.propertyTax, 2436000);
  // Assessments filed as general government spending are still left out first.
  const both = aggregateNh([it('T01', 4000), it('E89', 3000), it('E62', 500), it('E44', 400)], false, { taxes: { muni: 900000, edu: 3100000, taxYear: 2022 } });
  assert.equal(both.assessments, 3000000);
  assert.equal(both.passThrough, 3100000);
  assert.equal(both.revenue.propertyTax, 900000);
});

test('VT tax file lookup matches Census names and the tax year funding each fiscal year', () => {
  assert.equal(taxYearFor('2022-06-30'), 2021);
  assert.equal(taxYearFor('2022-12-31'), 2022);
  const taxes = { barrecity: { 2021: { edu: 1, muni: 2 } }, barretown: { 2021: { edu: 3, muni: 4 } }, bristol: { 2023: { edu: 5, muni: 6 } }, essexjunction: { 2022: { edu: 7, muni: 8 } } };
  assert.deepEqual(taxesFor(taxes, 'BARRE CITY', '2022-06-30'), { edu: 1, muni: 2, taxYear: 2021 });
  assert.deepEqual(taxesFor(taxes, 'BARRE TOWN', '2022-06-30'), { edu: 3, muni: 4, taxYear: 2021 });
  assert.deepEqual(taxesFor(taxes, 'BRISTOL TOWN', '2024-06-30'), { edu: 5, muni: 6, taxYear: 2023 });
  // Essex Junction became a city in July 2022: its first tax year is the next one.
  assert.deepEqual(taxesFor(taxes, 'ESSEX JUNCTION CITY', '2022-06-30'), { edu: 7, muni: 8, taxYear: 2022 });
  assert.equal(taxesFor(taxes, 'GOSHEN TOWN', '2022-06-30'), null);
});

import { aggregateCmre } from '../scripts/wi/dor-map.mjs';

test('WI DOR rows map by column, count utility funds as totals and leave out other financing', () => {
  const a = aggregateCmre({
    'General Property Taxes': 1000, 'Tax Increments': 200, 'State Shared Revenues': 300, 'Other Financing Sources': 5000,
    'Propriety Funds - Revenues': 400, 'Law Enforcement': 500, 'Fire': 100, 'General Government': 150, 'Conservation and Development': 50,
    'Highway Construction': 250, 'Debt Service - Principal Interest': 80, 'Other Financing Uses': 4000, 'Propriety Funds - Expenses': 390,
    'Total General Obligation Debt': 2500,
  });
  assert.deepEqual(a.revenue, { propertyTax: 1200, stateAid: 300, utilityCharges: 400 });
  assert.deepEqual(a.spending, { administration: 200, publicSafety: 600, roads: 250, debtService: 80, utilities: 390 });
  assert.equal(a.debt, 2500);
  assert.deepEqual(a.leftOut, { sources: 5000, uses: 4000 });
  assert.equal(a.empty, false);
  assert.equal(aggregateCmre({ 'General Property Taxes': 1000 }).empty, true);
});

import { aggregateGateway, custodial, receiptKey, functionKey } from '../scripts/in/gateway-map.mjs';

test('IN Gateway receipts and disbursements map by code, fund and department, leaving out custodial money', () => {
  const rc = (Receipt_Code, amount, fund_name = 'General Fund', Fund_code = '101001', receipt_name = '') => ({ Receipt_Code, amount: String(amount), fund_name, Fund_code, receipt_name });
  const ds = (disburse_code, amount, fund_name = 'General Fund', Fund_code = '101001', department_name = '') => ({ disburse_code, amount: String(amount), fund_name, Fund_code, department_name });
  assert.equal(custodial('106001', 'Settlement'), true);
  assert.equal(custodial('900120', 'Payroll Clearing'), true);
  assert.equal(custodial('940001', 'Benefit Self-Insurance'), true);
  assert.equal(custodial('101001', 'General Fund'), false);
  assert.deepEqual(receiptKey('R101')[0], 'propertyTax');
  assert.deepEqual(receiptKey('R138')[0], 'salesTax');
  assert.deepEqual(receiptKey('R116')[0], 'stateAid');
  assert.deepEqual(receiptKey('R421')[0], 'utilityCharges');
  assert.equal(receiptKey('R910'), null);
  assert.equal(functionKey('Police Department'), 'publicSafety');
  assert.equal(functionKey(null, 'Motor Vehicle Highway'), 'roads');
  const a = aggregateGateway(
    [rc('R101', 1000), rc('R138', 300), rc('R910', 500), rc('R904', 400, 'Fire Station BAN', '990001'), rc('R101', 9000, 'Settlement', '106001'),
      rc('R913', 50, 'General Fund', '101001', 'Other Receipts/39100 - INTFTRANS')],
    [ds('D101', 999, 'General Fund'), ds('D704', 200, 'General Fund'), ds('D101', 300, 'Fire Fund', '102001'), ds('D403', 400, 'Fire Station BAN', '990001'),
      ds('D404', 20, 'Fire Station BAN', '990001'), ds('D312', 5000, 'Settlement', '106001'), ds('D703', 70, 'Fire Fund', '102001')],
    // The general fund reports by department: those rows replace its by-fund row.
    [ds('D101', 600, 'General Fund', '101001', 'Police Department'), ds('D101', 399, 'General Fund', '101001', 'Clerk-Treasurer')],
  );
  assert.deepEqual(a.revenue, { propertyTax: 1000, salesTax: 300 });
  // The note paid off with new borrowing is refinancing; its interest is debt service.
  assert.equal(a.refinanced, 400);
  assert.deepEqual(a.spending, { publicSafety: 900, administration: 399, debtService: 20 });
  assert.equal(a.intergovernmental, 70);
  assert.deepEqual(a.custodial, { receipts: 9000, disbursements: 5000 });
});

test('IN general funds without departments are not split when they are a large share of spending', () => {
  const ds = (disburse_code, amount, fund_name, Fund_code) => ({ disburse_code, amount: String(amount), fund_name, Fund_code, department_name: 'No Department' });
  const rev = [{ Receipt_Code: 'R101', amount: '1000', fund_name: 'General', Fund_code: '101001' }];
  const big = aggregateGateway(rev, [ds('D101', 600, 'General', '101001'), ds('D101', 400, 'Motor Vehicle Highway', '102001')]);
  assert.deepEqual(big.spending, { otherSpending: 600, roads: 400 });
  const small = aggregateGateway(rev, [ds('D101', 100, 'General', '101001'), ds('D101', 900, 'Motor Vehicle Highway', '102001')]);
  assert.deepEqual(small.spending, { administration: 100, roads: 900 });
  // A township's general fund is the trustee's office.
  assert.deepEqual(aggregateGateway(rev, [ds('D101', 600, 'Township', '101001')], [], { township: true }).spending, { administration: 600 });
});

import { aggregateComptroller, revenueKey as ilRevenueKey, functionKey as ilFunctionKey, debtOutstanding as ilDebt } from '../scripts/il/comptroller-map.mjs';

test('IL Comptroller reports map revenue by source and spending by function, counting governmental and enterprise funds', () => {
  const row = (Category, GN = 0, EP = 0, extra = {}) => ({ Category, GN: String(GN), SR: '0', CP: String(extra.CP || 0), DS: '0', EP: String(EP), TS: String(extra.TS || 0), FD: String(extra.FD || 0), DP: '0' });
  assert.equal(ilRevenueKey('201t')[0], 'propertyTax');
  assert.equal(ilRevenueKey('212t')[0], 'stateAid');
  assert.equal(ilRevenueKey('234a')[0], 'utilityCharges');
  assert.equal(ilRevenueKey('234k')[0], 'feesPermits');
  assert.equal(ilFunctionKey('252a')[0], 'publicSafety');
  assert.equal(ilFunctionKey('254t')[0], 'administration');
  assert.equal(ilFunctionKey('271c')[0], 'roads');
  assert.equal(ilFunctionKey('272t'), null);
  const a = aggregateComptroller(
    // Fiduciary money (the county collector's tax distributions) is left out.
    [row('201t', 1000, 0, { FD: 50000 }), row('234a', 0, 400), row('234t', 0, 400)],
    // Sub-codes are used where reported, not the total as well; depreciation is left out;
    // utility capital outlay is utilities; the other 80 is spread over all non-debt spending
    // (500 : 300 : 300).
    [row('252a', 500), row('252t', 500), row('251t', 300), row('271a', 0, 200), row('272t', 0, 90), row('280t', 0, 100, { CP: 80 }), row('259b', 0, 0)],
  );
  assert.deepEqual(a.revenue, { propertyTax: 1000, utilityCharges: 400 });
  assert.deepEqual(a.spending, { publicSafety: 536, administration: 322, utilities: 322 });
  assert.equal(a.capital, 80);
  assert.equal(a.leftOut.depreciation, 90);
  assert.equal(a.leftOut.revenue, 50000);
});

test('IL "other" spending is not broken down when it is a large share, and debt outstanding comes from the indebtedness statement', () => {
  const row = (Category, GN) => ({ Category, GN: String(GN), SR: '0', CP: '0', DS: '0', EP: '0', TS: '0', FD: '0', DP: '0' });
  const rev = [row('201t', 1000)];
  assert.deepEqual(aggregateComptroller(rev, [row('252t', 600), row('260t', 400)]).spending, { publicSafety: 600, otherSpending: 400 });
  assert.deepEqual(aggregateComptroller(rev, [row('252t', 900), row('260t', 100)]).spending, { publicSafety: 900, administration: 100 });
  // Sub-codes that add up to less than the code's total keep the rest under the total.
  assert.deepEqual(aggregateComptroller(rev, [row('252a', 300), row('252t', 500), row('251t', 100)]).spending, { publicSafety: 500, administration: 100 });
  // General obligation bonds (water): 1,000 at the start, 200 issued, 100 retired; contractual: 50 less 10.
  assert.equal(ilDebt({ a400: '1000', a406: '200', a412: '100', t403: '50', t415: '10' }), 1140);
  assert.equal(ilDebt(undefined), 0);
});

import { atlasLink, agencyTown, ATLAS_PAGE } from '../scripts/common/atlas.mjs';
test('Atlas of Surveillance helpers clean agency names and links', () => {
  assert.equal(agencyTown('Springfield Police Department'), 'Springfield');
  assert.equal(agencyTown('Lower Merion Twp Police'), 'Lower Merion Township');
  assert.equal(atlasLink({ 'Link 1': 'https://example.org/story' }), 'https://example.org/story');
  // Some rows hold an agency name instead of a link; the Atlas itself is cited then.
  assert.equal(atlasLink({ 'Link 1': 'Greenfield Police Department' }), ATLAS_PAGE);
  assert.equal(atlasLink({}), ATLAS_PAGE);
});

import { countyFor as hiCountyFor, classifyHi } from '../scripts/hi/csc-map.mjs';
test('Hawaii contributions are placed by county office and classified by contributor type', () => {
  assert.equal(hiCountyFor({ office: 'Maui Council' }), 'Maui');
  assert.equal(hiCountyFor({ office: 'Mayor', county: 'Honolulu' }), 'Honolulu');
  // A blank county is filled from the candidate's other rows.
  assert.equal(hiCountyFor({ office: 'Mayor', county: '', reg_no: 'CC1' }, new Map([['CC1', 'Kauai']])), 'Kauai');
  assert.equal(hiCountyFor({ office: 'House' }), null);
  assert.deepEqual(classifyHi({ contributor_type: 'Other Entity', contributor_name: 'ILWU Local 142' }), { key: 'unionContributions' });
  assert.deepEqual(classifyHi({ contributor_type: 'Other Entity', contributor_name: 'Matson Navigation Company, Inc.' }), { key: 'developerContributions' });
  assert.deepEqual(classifyHi({ contributor_type: 'Noncandidate Committee', contributor_name: 'Hawaii Realtors PAC' }), { key: 'pacContributions' });
  assert.equal(classifyHi({ contributor_type: 'Individual', contributor_name: 'Jane Doe' }), null);
  assert.equal(classifyHi({ contributor_type: 'Political Party', contributor_name: 'Democratic Party of Hawaii' }), null);
});

import { classifyDc } from '../scripts/dc/ocf-map.mjs';
test('DC contributions leave out shadow congressional seats and candidate transfers', () => {
  const row = (o) => ({ committee_name: 'Smith for Ward 3', contribution_type: 'Check', contributor_type: 'Corporation', contributor_organization_name: 'Acme Inc', ...o });
  assert.deepEqual(classifyDc(row()), { key: 'developerContributions' });
  assert.deepEqual(classifyDc(row({ contributor_type: 'Labor', contributor_organization_name: 'Local 25' })), { key: 'unionContributions' });
  assert.equal(classifyDc(row({ committee_name: 'Jain for Senate' })), null);
  assert.equal(classifyDc(row({ contributor_type: 'Other PAC or Committee', contributor_organization_name: 'Cynthia Phillips 4 DC' })), null);
  assert.equal(classifyDc(row({ contributor_type: 'Individual' })), null);
});

import { placeCandidate as kyPlace, classifyKy } from '../scripts/ky/kref-map.mjs';
test('Kentucky candidates are placed by office and location', () => {
  assert.deepEqual(kyPlace({ office: 'Magistrate/Justice Of The Peace', location: 'Pike-District 5' }), { level: 'county', county: 'pike' });
  assert.deepEqual(kyPlace({ office: 'City Council Member (A)', location: 'Park Hills-Kenton' }), { level: 'city', city: 'park hills', county: 'kenton' });
  assert.deepEqual(kyPlace({ office: 'Legislative Council - Even', location: 'Jefferson-Dist 4' }), { level: 'merged', county: 'jefferson' });
  assert.deepEqual(kyPlace({ office: 'Mayor (J2)', location: 'Lexington-Urban County-Fayette' }), { level: 'merged', county: 'fayette' });
  assert.equal(kyPlace({ office: 'Circuit Court Clerk', location: 'Pike' }), null);
  assert.deepEqual(classifyKy({ contributor: 'Ibew Pac Voluntary Fund', contributionType: 'Kypac' }), { key: 'unionContributions' });
  assert.deepEqual(classifyKy({ contributor: 'Kentucky Realtors PAC', contributionType: 'Kypac' }), { key: 'pacContributions' });
  assert.equal(classifyKy({ contributor: 'Clark County Republicans', contributionType: 'Contributingorganization' }), null);
});

import { placeOffice as laPlace, nameKey as laNameKey, classifyLa, norm as laNorm } from '../scripts/la/ethics-map.mjs';
test('Louisiana offices typed by filers are placed in a parish or municipality', () => {
  const places = {
    parishes: new Map([[laNorm('Calcasieu'), 'calcasieu'], [laNorm('Lafayette'), 'lafayette-parish'], [laNorm('East Baton Rouge'), 'ebr']]),
    munis: [{ name: laNorm('Lake Charles'), key: 'lake-charles', parish: laNorm('Calcasieu') }, { name: laNorm('Lafayette'), key: 'lafayette', parish: laNorm('Lafayette') }, { name: laNorm('Baton Rouge'), key: 'baton-rouge', parish: laNorm('East Baton Rouge') }],
  };
  assert.equal(laPlace('Police Juror / Calcasieu/Lake Charles / 5', places), 'calcasieu');
  assert.equal(laPlace('Mayor / Lake Charles / Calcasieu', places), 'lake-charles');
  assert.equal(laPlace('City Council / Lafayette / 1', places), 'lafayette');
  assert.equal(laPlace('Sheriff / Lafayette Parish /', places), 'lafayette-parish');
  assert.equal(laPlace('Councilman / EBR/Baton Rouge / At-Large', places), 'baton-rouge');
  assert.equal(laPlace('District Court Judge / Calcasieu / 14', places), null);
  assert.equal(laNameKey('Kristopher W.', 'Cloessner'), 'kristopher cloessner');
  assert.equal(laNameKey('Linton F. Broussard, Jr.'), 'linton broussard');
  assert.deepEqual(classifyLa({ contributiontype: 'CONTRIB', contributortypecode: 'BUS', contributorname: 'FEDEX CORP' }), { key: 'developerContributions' });
  assert.deepEqual(classifyLa({ contributiontype: 'CONTRIB', contributortypecode: 'PAC', contributorname: 'OPERATORS POLITICAL ARM LOCAL, IUOE' }), { key: 'unionContributions' });
  assert.equal(classifyLa({ contributiontype: 'CONTRIB', contributortypecode: 'IND', contributorname: 'JANE DOE' }), null);
  assert.equal(classifyLa({ contributiontype: 'CONTRIB', contributortypecode: 'ORG', contributorname: 'AVOYELLES PARISH CLERK OF COURT' }), null);
});

import { placeCommittee as alPlace, classifyAl, norm as alNorm } from '../scripts/al/fcpa-map.mjs';
test('Alabama committees are placed by office, county jurisdiction or mailing city', () => {
  const places = { counties: new Map([[alNorm('Washington'), 'washington'], [alNorm('St. Clair'), 'st-clair']]), cities: new Map([[alNorm('Mobile'), ['mobile']], [alNorm('Midway'), ['midway-1', 'midway-2']]]) };
  assert.equal(alPlace({ office: 'County Commissioner', jurisdiction: 'WASHINGTON COUNTY' }, places), 'washington');
  assert.equal(alPlace({ office: 'Sheriff', jurisdiction: 'ST. CLAIR COUNTY' }, places), 'st-clair');
  assert.equal(alPlace({ office: 'Mayor', city: 'MOBILE, ALABAMA' }, places), 'mobile');
  assert.equal(alPlace({ office: 'City Council', city: 'Midway' }, places), null);
  assert.equal(alPlace({ office: 'Circuit Court Judge', jurisdiction: 'WASHINGTON COUNTY' }, places), null);
  assert.equal(alPlace({ office: 'County Board of Education', jurisdiction: 'WASHINGTON COUNTY' }, places), null);
  const row = (o) => ({ contributiontype: 'Cash (Itemized)', contributortype: 'Group/Business/Corporation', lastname: 'WINWOOD LLC', candidatelast: 'DRUMMOND', ...o });
  assert.deepEqual(classifyAl(row()), { key: 'developerContributions' });
  assert.deepEqual(classifyAl(row({ lastname: 'Alabama Realtors Political Action Committee' })), { key: 'pacContributions' });
  assert.deepEqual(classifyAl(row({ contributortype: 'PAC', lastname: 'IBEW LOCAL 136 PAC' })), { key: 'unionContributions' });
  assert.equal(classifyAl(row({ lastname: 'Team Drummond' })), null);
  assert.equal(classifyAl(row({ contributiontype: 'In-Kind (Itemized)' })), null);
  assert.equal(classifyAl(row({ contributortype: 'Individual', lastname: 'Smith' })), null);
});

import { placeMunicipality as akPlace, classifyAk, norm as akNorm } from '../scripts/ak/apoc-map.mjs';
test('Alaska APOC municipalities map to boroughs, cities and consolidated city-boroughs', () => {
  const places = { boroughs: new Map([[akNorm('Fairbanks North Star Borough'), 'fnsb'], [akNorm('Municipality of Anchorage'), 'anchorage']]), cities: new Map([[akNorm('Fairbanks'), 'fairbanks']]) };
  assert.equal(akPlace('Fairbanks, City of', places), 'fairbanks');
  assert.equal(akPlace('Fairbanks Northstar Borough', places), 'fnsb');
  assert.equal(akPlace('Anchorage, City and Borough', places), 'anchorage');
  assert.equal(akPlace('Palmer, City of', places), null);
  const row = (o) => ({ 'Payment Type': 'Check', 'Last/Business Name': 'IBEW PAC', 'First Name': '', Occupation: 'PAC', ...o });
  assert.deepEqual(classifyAk(row()), { key: 'unionContributions' });
  assert.deepEqual(classifyAk(row({ 'Last/Business Name': 'Anchorage Home Builders Association BUILD-PAC' })), { key: 'pacContributions' });
  assert.deepEqual(classifyAk(row({ 'Last/Business Name': 'Turnagain Training', Occupation: 'Business' })), { key: 'developerContributions' });
  assert.equal(classifyAk(row({ 'Last/Business Name': 'Anchorage Democrats', Occupation: 'Party Committee' })), null);
  assert.equal(classifyAk(row({ 'Last/Business Name': 'Lee', 'First Name': 'Amber' })), null);
  assert.equal(classifyAk(row({ 'Payment Type': 'Bank Interest', 'Last/Business Name': 'Global Federal Credit Union' })), null);
});

import { officeLevel as nvLevel, classifyNv, nameKey as nvNameKey, norm as nvNorm, parseOffice as nvOffice } from '../scripts/nv/sos-map.mjs';
test('Nevada candidates are placed by jurisdiction and office; organizations recognized by name', () => {
  assert.equal(nvLevel('Clark County Commissioner, District A', 'CLARK COUNTY'), 'county');
  assert.equal(nvLevel('City of Reno, City Council, Ward 1', 'CITY OF RENO'), 'city');
  assert.equal(nvLevel('Carson City, Supervisor, Ward 2', 'CARSON CITY'), 'county');
  assert.equal(nvLevel('City of Las Vegas, Municipal Court Judge, Dept 3', 'CITY OF LAS VEGAS'), null);
  assert.equal(nvLevel('City of Reno, Assistant City Manager', 'CITY OF RENO'), null);
  assert.equal(nvLevel('Clark County School Trustee, District C', 'CLARK COUNTY'), null);
  assert.equal(nvNorm('CITY OF NORTH LAS VEGAS'), 'north las vegas');
  assert.equal(nvNorm('BOULDER CITY'), nvNorm('Boulder City'));
  assert.equal(nvNameKey('Michael Corey Thomas'), 'michael thomas');
  assert.equal(nvOffice('<span id="ctl00_MainContent_lblOffice">Clark County Commissioner, District A</span>'), 'Clark County Commissioner, District A');
  const row = (o) => ({ Type: 'Monetary Contribution', Contributor: '19 Enterprises LLC', ...o });
  assert.deepEqual(classifyNv(row()), { key: 'developerContributions' });
  assert.deepEqual(classifyNv(row({ Contributor: 'IBEW Local 357' })), { key: 'unionContributions' });
  assert.deepEqual(classifyNv(row({ Contributor: 'Nevada Realtors PAC' })), { key: 'pacContributions' });
  assert.equal(classifyNv(row({ Contributor: 'Jane Doe' })), null);
  assert.equal(classifyNv(row({ Contributor: 'Accrued Account Interest' })), null);
  assert.equal(classifyNv(row({ Type: 'In Kind Contribution' })), null);
});

import { placeCandidate as mtPlace, classifyMt, parsePipes as mtParse, norm as mtNorm } from '../scripts/mt/copp-map.mjs';
test('Montana candidates are placed by county of residence or mailing city', () => {
  const places = { counties: new Map([['yellowstone', 'yellowstone'], ['silver bow', 'butte']]), consolidated: new Set(['silver bow']), cities: new Map([['billings', [{ key: 'billings', county: 'yellowstone' }]], ['great falls', [{ key: 'great-falls', county: 'cascade' }]]]) };
  assert.equal(mtPlace({ officeTitle: 'County Commissioner', resCountyDescr: 'Yellowstone' }, 'CN', places), 'yellowstone');
  assert.equal(mtPlace({ officeTitle: 'County Attorney', resCountyDescr: 'Yellowstone' }, 'CN', places), null);
  assert.equal(mtPlace({ officeTitle: 'City Council', resCountyDescr: 'Yellowstone', candidateAddress: '123 Main St, Billings, MT 59101' }, 'CT', places), 'billings');
  assert.equal(mtPlace({ officeTitle: 'Councilman', resCountyDescr: 'Cascade', candidateAddress: 'PO BOX 6156, GREAT FALLS, MT 59406' }, 'CT', places), 'great-falls');
  assert.equal(mtPlace({ officeTitle: 'Commissioner', resCountyDescr: 'Silver Bow', candidateAddress: 'Butte, MT' }, 'CT', places), 'butte');
  assert.equal(mtPlace({ officeTitle: 'City Judge', resCountyDescr: 'Yellowstone', candidateAddress: 'Billings, MT' }, 'CT', places), null);
  assert.equal(mtNorm('St. Ignatius'), 'saint ignatius');
  const rows = mtParse('Candidate ID|Contributor Name|Description|Line Item|Amount|Amount Subtype\n1|Smith, Jo|signs|Individual Contributions|50.00|Cash\n2|MEA-MFT COPE|long\ndescription|Independent Committee Contributions|500.00|Cash\n');
  assert.equal(rows.length, 2);
  assert.equal(rows[1].Description, 'long description');
  assert.equal(classifyMt(rows[0]), null);
  assert.deepEqual(classifyMt(rows[1]), { key: 'unionContributions' });
  assert.deepEqual(classifyMt({ 'Contributor Name': 'Yellowstone Realty LLC', 'Line Item': 'Individual Contributions', 'Amount Subtype': 'Cash' }), { key: 'developerContributions' });
  assert.equal(classifyMt({ 'Contributor Name': 'Montana Republican Party', 'Line Item': 'Political Party Committee Contributions', 'Amount Subtype': 'Cash' }), null);
});

import { placeJurisdiction as waPlace, classifyWa } from '../scripts/wa/pdc-map.mjs';
test('Washington PDC rows are placed by office jurisdiction and classified by contributor code', () => {
  assert.deepEqual(waPlace('KING CO'), { level: 'county', name: 'king' });
  assert.deepEqual(waPlace('CITY OF AUBURN *'), { level: 'city', name: 'auburn' });
  assert.deepEqual(waPlace('TOWN OF WINTHROP'), { level: 'city', name: 'winthrop' });
  assert.equal(waPlace('PORT OF SEATTLE'), null);
  assert.equal(waPlace('SEATTLE SCHOOL DIST 001'), null);
  const row = (o) => ({ cash_or_in_kind: 'Cash', contributor_category: 'Organization', code: 'Business', contributor_name: 'Acme Homes LLC', ...o });
  assert.deepEqual(classifyWa(row()), { key: 'developerContributions' });
  assert.deepEqual(classifyWa(row({ code: 'Union', contributor_name: 'SEIU 775' })), { key: 'unionContributions' });
  assert.deepEqual(classifyWa(row({ code: 'Political Action Committee', contributor_name: 'Electrical Workers 46 PAC' })), { key: 'unionContributions' });
  assert.deepEqual(classifyWa(row({ code: 'Political Action Committee', contributor_name: 'Washington Realtors PAC' })), { key: 'pacContributions' });
  assert.equal(classifyWa(row({ code: 'Other', contributor_name: 'Tulalip Tribes' })), null);
  assert.equal(classifyWa(row({ code: 'Party', contributor_name: 'King County Democrats' })), null);
  assert.equal(classifyWa(row({ cash_or_in_kind: 'In kind' })), null);
  assert.equal(classifyWa(row({ contributor_category: 'Individual' })), null);
});

import { isCountyRace, classifyCo, parseTracer } from '../scripts/co/tracer-map.mjs';
test('Colorado TRACER committees count for a county only when their name shows a county office', () => {
  assert.equal(isCountyRace('ANGELA THOMAS 4 COMMISSIONER', 'DOUGLAS'), true);
  assert.equal(isCountyRace('CANDACE RIVERA 4 COUNTY CLERK', 'PUEBLO'), true);
  assert.equal(isCountyRace('CLAIRE FOR BOULDER COUNTY', 'BOULDER'), true);
  assert.equal(isCountyRace('WYATT FOR LARIMER', 'LARIMER'), true);
  assert.equal(isCountyRace('VALERIE FOR DOUGLAS COUNTY SCHOOLS', 'DOUGLAS'), false);
  assert.equal(isCountyRace('KIMBERLEE SIA FOR DPS BOARD', 'DENVER'), false);
  assert.equal(isCountyRace('COMMITTEE TO ELECT SETH BRYANT', 'TELLER'), false);
  assert.equal(isCountyRace('GOLDSTEIN4ADAMS12', 'ADAMS'), false);
  const row = (o) => ({ amended: 'N', contributiontype: 'Monetary (Itemized)', contributortype: 'Business', lastname: 'ACME HOMES LLC', firstname: '', ...o });
  assert.deepEqual(classifyCo(row()), { key: 'developerContributions' });
  assert.deepEqual(classifyCo(row({ contributortype: 'Small Donor Committee', lastname: 'IBEW LOCAL 68 SDC' })), { key: 'unionContributions' });
  assert.deepEqual(classifyCo(row({ contributortype: 'Political Committee', lastname: 'COLORADO REALTORS PAC' })), { key: 'pacContributions' });
  assert.equal(classifyCo(row({ amended: 'Y' })), null);
  assert.equal(classifyCo(row({ contributiontype: 'Non-Monetary (Itemized)' })), null);
  assert.equal(classifyCo(row({ contributortype: 'Individual', lastname: 'DOE', firstname: 'JANE' })), null);
  // Stray quotes inside a field and a field broken across lines.
  const rows = parseTracer('"A","B","C"\n"1","12" PIPE","x"\n"2","line\none","y"\n');
  assert.deepEqual(rows.map((r) => r.b), ['12" PIPE', 'line one']);
});

import { revenueKey as caRevenueKey, expenditureKey as caExpenditureKey, aggregateSco } from '../scripts/ca/sco-map.mjs';
test('California State Controller lines map to TownView categories', () => {
  const rev = (category, subcategory_1, line_description, value = 100) => ({ category, subcategory_1, line_description, value });
  assert.equal(caRevenueKey(rev('Taxes', 'Taxes', 'Secured and Unsecured Property Taxes_General Revenues')), 'propertyTax');
  assert.equal(caRevenueKey(rev('Taxes', 'Taxes', 'Property Tax In-Lieu of Vehicle License Fees_General Revenues')), 'propertyTax');
  assert.equal(caRevenueKey(rev('Taxes', 'Taxes', 'Sales and Use Taxes_General Revenues')), 'salesTax');
  assert.equal(caRevenueKey(rev('Property Taxes', 'General', 'Countywide Secured and Unsecured_General')), 'propertyTax');
  assert.equal(caRevenueKey(rev('Water Enterprise Fund', 'Operating Revenues', 'Water Sales Revenues')), 'utilityCharges');
  assert.equal(caRevenueKey(rev('Airport Enterprise Fund', 'Nonoperating Revenues', 'Intergovernmental – Federal')), 'federalGrants');
  assert.equal(caRevenueKey(rev('Internal Service Fund', 'Operating Revenues', 'Charges for Services_Internal Service Fund')), null);
  assert.equal(caRevenueKey(rev('Fines, Forfeitures, Penalties, and Revenue from Use of Money and Property', 'Fines, Forfeitures, and Penalties', 'Vehicle Code Fines')), 'finesForfeitures');
  const exp = (category, subcategory_1, subcategory_2, value = 100) => ({ category, subcategory_1, subcategory_2, line_description: subcategory_2, value });
  assert.equal(caExpenditureKey(exp('General Government and Public Safety', 'Public Safety', 'Police_Current Expenditures'), 'city'), 'publicSafety');
  assert.equal(caExpenditureKey(exp('General Government and Public Safety', 'Public Safety', 'District Attorney - Prosecution_Current Expenditures'), 'city'), 'administration');
  assert.equal(caExpenditureKey(exp('Debt Service and Capital Outlay', 'Capital Outlay', 'Transportation'), 'city'), 'roads');
  assert.equal(caExpenditureKey(exp('Debt Service and Capital Outlay', 'Capital Outlay', 'General'), 'county'), 'roads');
  assert.equal(caExpenditureKey(exp('Public Assistance', 'Welfare', 'General'), 'county'), 'healthServices');
  assert.equal(caExpenditureKey(exp('Public Protection', 'Judicial', 'General'), 'county'), 'administration');
  assert.equal(caExpenditureKey(exp('Sewer Enterprise Fund', 'Operating Expenses', 'Depreciation and Amortization Expenses_Sewer Enterprise Fund'), 'city'), null);
  assert.equal(caExpenditureKey(exp('Water Enterprise Fund', 'Nonoperating Expenses', 'Interest Expense_Water Enterprise Fund'), 'city'), null);
  // Enterprise interest is replaced by enterprise debt payments from the debt forms.
  const a = aggregateSco([rev('Taxes', 'Taxes', 'Sales and Use Taxes_General Revenues', 500)], [exp('Water Enterprise Fund', 'Operating Expenses', 'Water Supply Expenses', 300)], { kind: 'city', enterpriseDebtPayments: 50 });
  assert.deepEqual(a.revenue, { salesTax: 500 });
  assert.deepEqual(a.spending, { utilities: 300, debtService: 50 });
  assert.equal(a.lineTotals.spending, 350);
});

import { assignPeers, percentileOf, popBand, govKind, MIN_PEERS } from '../js/engine/peers.js';
test('Peer groups rank towns against the same state, kind and size, widening small groups', () => {
  assert.equal(popBand(2499).key, 'xs');
  assert.equal(popBand(2500).key, 's');
  assert.equal(popBand(300000).key, 'xl');
  assert.equal(govKind({ type: 'Charter Township' }), 'township');
  assert.equal(govKind({ type: 'Consolidated government' }), 'city');
  assert.equal(govKind({ type: 'Borough' }), 'town');
  assert.equal(govKind({ type: 'County' }), 'county');
  // Ties count half; one town alone has no percentile.
  assert.equal(percentileOf([10, 20, 30, 40, 50], 50), 100);
  assert.equal(percentileOf([10, 20, 30, 40, 50], 10), 0);
  assert.equal(percentileOf([10, 20, 20, 40, 50], 20), 38);
  assert.equal(percentileOf([10], 10), null);
  const entry = (id, state, type, population, score, possible = 80) => ({
    town: { id, state, type, population },
    s: { score, grade: possible >= 50 ? 'B' : '?', coverage: { possible }, components: [{ key: 'services', available: true, ratio: score / 100 }] },
  });
  const small = Array.from({ length: MIN_PEERS }, (_, i) => entry(`t${i}`, 'NJ', 'Township', 5000, 50 + i));
  const big = [entry('c1', 'NJ', 'City', 300000, 90), entry('c2', 'NJ', 'City', 20000, 40)];
  const thin = entry('thin', 'NJ', 'Township', 5000, 99, 40);
  const all = assignPeers([...small, ...big, thin]);
  const top = all.find((e) => e.town.id === `t${MIN_PEERS - 1}`);
  assert.equal(top.peer.level, 0);
  assert.equal(top.peer.rank, 1);
  assert.equal(top.peer.percentile, 100);
  assert.match(top.peer.label, /NJ townships with 2,500 to 10,000 people/);
  // Two NJ cities are too few for a group of their own, at any level.
  assert.equal(all.find((e) => e.town.id === 'c1').peer.percentile, null);
  // Ungraded towns are provisional and left out of their peers' ranks.
  const t = all.find((e) => e.town.id === 'thin');
  assert.equal(t.provisional, true);
  assert.equal(t.peer.percentile, null);
  assert.equal(t.peer.size, MIN_PEERS);
});

import { classifyContributor as civixClassify, isoDate, normPlace as civixPlace } from '../scripts/common/civix.mjs';
import { placeCommittee as okPlace, classifyOk } from '../scripts/ok/guardian-map.mjs';
test('Civix sites share contributor types; Oklahoma committees are placed by their registered jurisdiction', () => {
  assert.deepEqual(civixClassify('Political Action Committee (Registered)', 'Oklahoma Bankers PAC'), { key: 'pacContributions' });
  assert.deepEqual(civixClassify('PAC-Separate Segregated Political Fund', 'Omaha Firefighters PAC'), { key: 'unionContributions' });
  assert.deepEqual(civixClassify('Business (For-Profit and Non-Profit entities)', 'Acme Homes'), { key: 'developerContributions' });
  assert.equal(civixClassify('Indian Tribe', 'Chickasaw Nation'), null);
  assert.equal(civixClassify('Candidate Committee (Registered)', 'Pugh For Senate'), null);
  assert.equal(isoDate('01/02/2023'), '2023-01-02');
  assert.equal(isoDate('2024-06-30 00:00:00'), '2024-06-30');
  assert.equal(civixPlace('CITY OF OKLAHOMA CITY'), civixPlace('Oklahoma City'));
  assert.deepEqual(okPlace({ jurisdiction: 'OKLAHOMA COUNTY', office: 'COUNTY COMMISSIONER' }), { level: 'county', name: 'oklahoma' });
  assert.deepEqual(okPlace({ jurisdiction: 'CITY OF TULSA', office: 'COUNCILMEMBER' }), { level: 'city', name: 'tulsa' });
  assert.equal(okPlace({ jurisdiction: 'STATE OF OKLAHOMA', office: 'STATE SENATOR' }), null);
  assert.equal(okPlace({ jurisdiction: 'TULSA PUBLIC SCHOOLS', office: 'BOARD MEMBER' }), null);
  const row = { amended: 'N', 'receipt type': 'Monetary', 'receipt source type': 'Political Action Committee (Not Registered)', 'last name': 'GENEN PAC', 'first name': '' };
  assert.deepEqual(classifyOk(row), { key: 'pacContributions' });
  assert.equal(classifyOk({ ...row, amended: 'Y' }), null);
  assert.equal(classifyOk({ ...row, 'receipt type': 'In-Kind' }), null);
});

import { placeCommittee as nePlace, classifyNe } from '../scripts/ne/nadc-map.mjs';
test('Nebraska committees are placed by jurisdiction type; only mayor and council count in cities', () => {
  assert.deepEqual(nePlace({ jurisdictionType: 'County', jurisdiction: 'LANCASTER', office: 'COUNTY COMMISSIONER' }), { level: 'county', name: 'lancaster' });
  assert.deepEqual(nePlace({ jurisdictionType: 'Municipal', jurisdiction: 'OMAHA', office: 'MAYOR' }), { level: 'city', name: 'omaha' });
  assert.equal(nePlace({ jurisdictionType: 'Municipal', jurisdiction: 'OMAHA', office: 'AIRPORT AUTHORITY' }), null);
  assert.equal(nePlace({ jurisdictionType: 'State', jurisdiction: 'NEBRASKA', office: 'STATE LEGISLATURE' }), null);
  const row = { amended: 'N', 'receipt transaction/contribution type': 'Monetary', 'contributor or transaction source type': 'Business (For-Profit and Non-Profit entities)', 'contributor or source name (individual last name)': 'Gifford Realty, Inc.', 'first name': '' };
  assert.deepEqual(classifyNe(row), { key: 'developerContributions' });
  assert.deepEqual(classifyNe({ ...row, 'contributor or transaction source type': 'PAC-Separate Segregated Political Fund', 'contributor or source name (individual last name)': 'Lincoln Fire Fighters Assn. Local #644' }), { key: 'unionContributions' });
  assert.equal(classifyNe({ ...row, 'receipt transaction/contribution type': 'In-Kind Contribution' }), null);
});

import { placeOffice as moPlace, classifyMo, norm as moNorm } from '../scripts/mo/mec-map.mjs';
test('Missouri committees are placed by the jurisdiction ending the office they sought', () => {
  const counties = ['saint louis', 'saint charles', 'jackson', 'greene', 'charles'].sort((a, b) => b.length - a.length);
  assert.deepEqual(moPlace('Mayor City of Creve Coeur', counties), { level: 'city', name: 'creve coeur' });
  assert.deepEqual(moPlace('County Council District 2 St. Louis County', counties), { level: 'county', name: 'saint louis' });
  assert.deepEqual(moPlace('Prosecuting Attorney St. Charles County', counties), { level: 'county', name: 'saint charles' });
  assert.equal(moPlace('State Representative District 62 Missouri House of Representatives', counties), null);
  assert.equal(moPlace('Boardmember Ferguson-Florissant School District', counties), null);
  assert.equal(moPlace('Associate Circuit Judge Greene County', counties), null);
  assert.equal(moNorm('St. Louis'), 'saint louis');
  const row = { contribution_type: 'Monetary', company: '', committee: '' };
  assert.deepEqual(classifyMo({ ...row, company: 'Clayco Inc' }), { key: 'developerContributions' });
  assert.deepEqual(classifyMo({ ...row, committee: 'Missouri Realtors PAC' }), { key: 'pacContributions' });
  assert.deepEqual(classifyMo({ ...row, committee: 'IBEW Local 1 PAC' }), { key: 'unionContributions' });
  assert.equal(classifyMo({ ...row, committee: 'Friends Of Joe Vaccaro' }), null);
  assert.equal(classifyMo({ ...row, committee: 'Jackson County Democratic Committee' }), null);
  assert.equal(classifyMo(row), null);
  assert.equal(classifyMo({ ...row, company: 'Acme', contribution_type: 'In-Kind' }), null);
});

const codes = (town, severity) => validateTown(town, { year: 2026 }).filter((i) => !severity || i.severity === severity).map((i) => i.code);

test('data checks pass a complete record', () => {
  assert.deepEqual(codes(base()), []);
});

test('data checks catch missing money, population and location', () => {
  assert.deepEqual(codes({ ...base(), revenue: {} }, 'error'), ['no-revenue']);
  assert.deepEqual(codes({ ...base(), spending: {} }, 'error'), ['no-spending']);
  assert.deepEqual(codes({ ...base(), population: 0 }, 'error'), ['population']);
  assert.deepEqual(codes({ ...base(), lat: 34, lng: -118 }, 'error'), ['location']);
  // States without a bounding box are not location-checked.
  assert.deepEqual(codes({ ...base(), state: 'CA', lat: 34, lng: -118 }), []);
});

test('money in and out far apart is a warning, then an error', () => {
  const t = base();
  const scaled = (k) => ({ ...t, revenue: Object.fromEntries(Object.entries(t.revenue).map(([c, v]) => [c, v * k])) });
  assert.deepEqual(codes(scaled(2.5)), ['imbalance']);
  assert.deepEqual(codes(scaled(2.5), 'error'), []);
  assert.deepEqual(codes(scaled(5), 'error'), ['imbalance']);
  assert.deepEqual(codes(scaled(0.2), 'error'), ['imbalance']);
});

test('a tiny property tax levy is flagged where towns live on it', () => {
  const nj = { ...base(), state: 'NJ', lat: 40.3, lng: -74.5, revenue: { ...base().revenue, propertyTax: 100_000 } };
  assert.deepEqual(codes(nj), ['property-tax']);
  assert.deepEqual(codes({ ...nj, state: 'PA', lat: 40, lng: -77 }), []);
});

test('partial history years are found and left out of the trend', () => {
  const history = [2019, 2020, 2021, 2022, 2023].map((year) => ({ year, revenue: 40e6, spending: 38e6 }));
  history[3] = { year: 2022, revenue: 1.7e6, spending: 1.5e6 };
  assert.deepEqual([...historyOutliers(history)], [2022]);
  assert.deepEqual(cleanHistory(history).map((h) => h.year), [2019, 2020, 2021, 2023]);
  assert.deepEqual(codes({ ...base(), history }), ['history']);
  // Ordinary growth is left alone, and two points are too few to judge.
  const growth = [1, 1.5, 2.2, 3].map((k, i) => ({ year: 2020 + i, revenue: k * 1e6, spending: k * 1e6 }));
  assert.equal(historyOutliers(growth).size, 0);
  assert.equal(historyOutliers(history.slice(2, 4)).size, 0);
});

test('ledger rows must add up to the totals they itemize', () => {
  const t = base();
  const ledger = [
    { flow: 'in', amount: 10_000_000 }, { flow: 'out', amount: 10_000_000 },
    { flow: 'influence', amount: 3_000 },
  ];
  assert.deepEqual(codes({ ...t, ledger }), []);
  assert.deepEqual(codes({ ...t, ledger: [...ledger, { flow: 'in', amount: 5_000_000 }] }), ['ledger']);
});

test('old reports are flagged as stale', () => {
  assert.deepEqual(codes({ ...base(), fiscalYear: 2017 }), ['stale']);
  assert.deepEqual(codes({ ...base(), fiscalYear: 2023 }), []);
});

test('a town that fails a data check gets no grade', () => {
  const s = scoreTown({ ...base(), revenue: {} });
  assert.equal(s.review, true);
  assert.equal(s.grade, '?');
  assert.equal(scoreTown(base()).review, false);
});

// Every real town in the states whose builds run these checks: no record may fail
// one unless it is listed here with the reason. Other states' towns are still
// checked in the app (a failing town shows as data under review); their builds
// don't run the checks yet. These are real filings that don't add up in the state's own data.
const KNOWN_DATA_ERRORS = new Set([
  'hunker-borough-pa', // latest DCED report: money in nearly five times money out
  'marion-center-borough-pa', // latest DCED report (2020): money in four times money out
  'castleton-on-hudson-village-ny', // latest report (2020): money in five times money out
]);

test('NJ, NY, PA and CT data pass the data checks', () => {
  const dir = new URL('../data/real/', import.meta.url);
  const failures = [];
  for (const file of readdirSync(dir).filter((f) => /^(nj|ny|pa|ct)-.*\.json$/.test(f))) {
    for (const town of JSON.parse(readFileSync(new URL(file, dir))).towns) {
      const errors = validateTown(town).filter((i) => i.severity === 'error');
      const ledger = validateTown(town).filter((i) => i.code === 'ledger' || i.code === 'history');
      if (errors.length && !KNOWN_DATA_ERRORS.has(town.id)) failures.push(`${town.id}: ${errors.map((i) => i.code).join(', ')}`);
      if (ledger.length) failures.push(`${town.id}: ${ledger.map((i) => i.message).join(' ')}`);
    }
  }
  assert.deepEqual(failures, []);
});
