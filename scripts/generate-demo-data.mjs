#!/usr/bin/env node
// Generates data/towns.json: FICTIONAL demo towns so every feature of the app
// works out of the box. Deterministic (seeded) so re-runs produce identical output.
// Real data replaces this file via the fetch-* scripts; see docs/DATA_SCHEMA.md.

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'towns.json');

// Mulberry32 PRNG.
let seed = 20261001;
function rand() {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const between = (lo, hi) => lo + rand() * (hi - lo);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const round = (v, step = 1) => Math.round(v / step) * step;

// Inland anchor points per state: [code, name, lat, lng, jitter in degrees, towns].
const STATES = [
  ['AL', 'Alabama', 32.8, -86.8, 0.8, 2], ['AZ', 'Arizona', 34.2, -111.7, 1.0, 2],
  ['AR', 'Arkansas', 34.9, -92.4, 0.8, 2], ['CA', 'California', 36.9, -119.6, 0.8, 4],
  ['CO', 'Colorado', 39.0, -105.4, 1.0, 3], ['CT', 'Connecticut', 41.6, -72.7, 0.25, 3],
  ['DE', 'Delaware', 39.1, -75.6, 0.15, 1], ['FL', 'Florida', 28.5, -81.8, 0.6, 3],
  ['GA', 'Georgia', 32.8, -83.6, 0.8, 3], ['ID', 'Idaho', 43.9, -114.9, 0.8, 2],
  ['IL', 'Illinois', 40.2, -89.2, 0.9, 4], ['IN', 'Indiana', 39.9, -86.3, 0.7, 3],
  ['IA', 'Iowa', 42.0, -93.5, 0.9, 3], ['KS', 'Kansas', 38.5, -98.4, 1.1, 2],
  ['KY', 'Kentucky', 37.6, -85.0, 0.6, 2], ['LA', 'Louisiana', 31.1, -92.3, 0.6, 2],
  ['ME', 'Maine', 45.0, -69.3, 0.6, 2], ['MD', 'Maryland', 39.5, -77.3, 0.2, 2],
  ['MA', 'Massachusetts', 42.35, -72.0, 0.25, 3], ['MI', 'Michigan', 43.2, -84.6, 0.8, 4],
  ['MN', 'Minnesota', 45.8, -94.3, 0.9, 3], ['MS', 'Mississippi', 32.7, -89.7, 0.7, 2],
  ['MO', 'Missouri', 38.4, -92.4, 0.9, 3], ['MT', 'Montana', 46.9, -109.6, 1.4, 2],
  ['NE', 'Nebraska', 41.5, -99.5, 1.2, 2], ['NV', 'Nevada', 39.3, -116.6, 1.0, 1],
  ['NH', 'New Hampshire', 43.5, -71.6, 0.25, 2], ['NJ', 'New Jersey', 40.25, -74.6, 0.2, 4],
  ['NM', 'New Mexico', 34.4, -106.1, 1.0, 2], ['NY', 'New York', 42.8, -75.4, 0.8, 4],
  ['NC', 'North Carolina', 35.6, -79.6, 0.7, 3], ['ND', 'North Dakota', 47.4, -100.5, 1.0, 1],
  ['OH', 'Ohio', 40.3, -82.8, 0.8, 4], ['OK', 'Oklahoma', 35.5, -97.4, 0.9, 2],
  ['OR', 'Oregon', 44.0, -120.6, 0.9, 2], ['PA', 'Pennsylvania', 40.8, -77.7, 0.8, 5],
  ['RI', 'Rhode Island', 41.75, -71.55, 0.08, 1], ['SC', 'South Carolina', 34.0, -81.0, 0.5, 2],
  ['SD', 'South Dakota', 44.4, -100.2, 1.0, 1], ['TN', 'Tennessee', 35.8, -86.4, 0.6, 3],
  ['TX', 'Texas', 31.3, -98.8, 1.6, 5], ['UT', 'Utah', 39.3, -111.7, 0.8, 2],
  ['VT', 'Vermont', 44.0, -72.7, 0.25, 2], ['VA', 'Virginia', 37.6, -78.8, 0.6, 3],
  ['WA', 'Washington', 47.3, -120.4, 0.8, 2], ['WV', 'West Virginia', 38.6, -80.6, 0.5, 2],
  ['WI', 'Wisconsin', 44.6, -89.8, 0.8, 3], ['WY', 'Wyoming', 43.0, -107.5, 1.2, 1],
];

const PREFIX = ['Cedar', 'Maple', 'Willow', 'Oak', 'Pine', 'Elm', 'Ash', 'Birch', 'Clear', 'Fox',
  'Hawk', 'Stone', 'Spring', 'River', 'Lake', 'Mill', 'Fair', 'Green', 'Red', 'Silver', 'Pleasant',
  'Union', 'Liberty', 'Harmony', 'Prairie', 'Meadow', 'Ridge', 'Hollow', 'Bright', 'Iron', 'Copper',
  'Juniper', 'Laurel', 'Hazel', 'Aspen', 'Sumner', 'Larkin', 'Owl', 'Deer', 'Bramble'];
const SUFFIX = ['field', 'ton', 'ville', 'dale', 'wood', 'brook', 'port', 'bury', 'ford', 'haven',
  'view', 'creek', 'mont', 'stead', 'water', 'grove'];
const KIND = ['Township', 'Township', 'Township', 'Town', 'Village', 'Borough'];
const COUNTY = ['Adams', 'Franklin', 'Jackson', 'Lincoln', 'Madison', 'Marion', 'Monroe', 'Warren',
  'Clay', 'Union', 'Greene', 'Wayne', 'Hamilton', 'Carroll', 'Polk', 'Grant'];

const VENDORS = {
  publicSafety: ['Tri-County Fire Apparatus', 'Regional Dispatch Authority', 'Northline Public Safety Supply'],
  roads: ['Keystone Paving Co.', 'Valley Asphalt & Grading', 'Summit Bridge Works'],
  utilities: ['Clearwater Treatment Services', 'Municipal Pipe & Valve', 'Green Valley Waste Hauling'],
  parks: ['Parkline Recreation Supply', 'County Library Cooperative', 'Riverbend Landscaping'],
  healthServices: ['Community Health Partners', 'Senior Meals Cooperative', 'Hometown Clinic Network'],
  administration: ['Payroll - Town Staff', 'Office Systems Leasing', 'Municipal Insurance Pool'],
  consultants: ['Summit Consulting Group', 'Harbor & Pike LLP (legal)', 'Meridian Planning Associates'],
  debtService: ['Bond Trustee - First Regional Bank', 'State Bond Bank'],
};
const PAYERS = {
  propertyTax: 'Property owners (tax collector deposit)',
  salesTax: 'State Dept. of Revenue - local sales tax distribution',
  stateAid: 'State Treasury - municipal aid',
  federalGrants: pick.bind(null, ['U.S. Dept. of Transportation', 'FEMA - Hazard Mitigation', 'HUD - Community Development Block Grant', 'U.S. Treasury - Infrastructure grant']),
  feesPermits: 'Building, zoning & license fees',
  utilityCharges: 'Water & sewer customers',
  finesForfeitures: 'Municipal court',
  borrowing: 'General obligation bond sale',
  otherRevenue: 'Interest income & asset sales',
};
const DONORS = [
  ['Regional Builders PAC', 'PAC'], ['Homeowners for Growth PAC', 'PAC'], ['County Realtors PAC', 'PAC'],
  ['Valley Asphalt & Grading', 'Contractor'], ['Summit Consulting Group', 'Contractor'],
  ['Lakeside Development LLC', 'Developer'], ['Crossroads Land Partners', 'Developer'],
  ['Firefighters Local 214', 'Union'], ['Public Works Employees Union', 'Union'],
  ['Waste Haulers Association PAC', 'PAC'], ['Energy Futures PAC', 'PAC'],
];
const OFFICES = ['Township supervisor', 'Mayor', 'Council member', 'Board trustee', 'Town clerk'];

function makeTown(state, index, usedNames) {
  const [code, stateName, lat0, lng0, jitter] = state;
  let name;
  do name = `${pick(PREFIX)}${pick(SUFFIX)}`; while (usedNames.has(name));
  usedNames.add(name);
  const type = pick(KIND);

  // Quality drives how well-run the town is; spread it so grades span A-F.
  const q = 0.2 + 0.8 * Math.min(1, Math.max(0, 0.6 + ((rand() + rand() + rand()) / 3 - 0.5) * 1.9));
  const population = round(Math.exp(between(Math.log(1800), Math.log(65000))), 10);
  const perCap = between(1100, 2400);
  const spendTotal = population * perCap;

  const directShare = 0.52 + q * 0.36 + between(-0.05, 0.05);
  const overheadTotal = 1 - directShare;
  const debtShare = overheadTotal * between(0.25, 0.45);
  const consultShare = overheadTotal * between(0.1, 0.25) * (1.4 - q);
  const adminShare = Math.max(0.03, overheadTotal - debtShare - consultShare);
  const directWeights = { publicSafety: between(0.3, 0.42), roads: between(0.15, 0.25), utilities: between(0.12, 0.22), parks: between(0.06, 0.12), healthServices: between(0.04, 0.1) };
  const wSum = Object.values(directWeights).reduce((a, b) => a + b, 0);
  const spending = {};
  for (const [k, w] of Object.entries(directWeights)) spending[k] = round(spendTotal * directShare * (w / wSum), 100);
  spending.administration = round(spendTotal * adminShare, 100);
  spending.consultants = round(spendTotal * consultShare, 100);
  spending.debtService = round(spendTotal * debtShare, 100);
  const spendingSum = Object.values(spending).reduce((a, b) => a + b, 0);

  const balanceRatio = between(-0.09, 0.05) + q * 0.05;
  const revTotal = spendingSum * (1 + balanceRatio);
  const propShare = between(0.32, 0.6);
  const revWeights = { salesTax: between(0.05, 0.25), stateAid: between(0.1, 0.25), federalGrants: between(0.02, 0.12), feesPermits: between(0.04, 0.1), utilityCharges: between(0.06, 0.16), finesForfeitures: between(0.005, 0.03) * (1.6 - q), borrowing: rand() < 0.4 ? between(0.02, 0.12) : 0, otherRevenue: between(0.01, 0.04) };
  const rSum = Object.values(revWeights).reduce((a, b) => a + b, 0);
  const revenue = { propertyTax: round(revTotal * propShare, 100) };
  for (const [k, w] of Object.entries(revWeights)) revenue[k] = round(revTotal * (1 - propShare) * (w / rSum), 100);

  const influencePerCap = Math.max(0.1, (1 - q) * between(4, 16) + between(0, 1.5));
  const infTotal = population * influencePerCap;
  const iw = { pacContributions: between(0.25, 0.5), developerContributions: between(0.15, 0.4), unionContributions: between(0.05, 0.2), lobbyingPaid: rand() < 0.5 ? between(0.05, 0.2) : 0 };
  const iSum = Object.values(iw).reduce((a, b) => a + b, 0);
  const influence = {};
  for (const [k, w] of Object.entries(iw)) influence[k] = round(infTotal * (w / iSum), 10);

  const transparency = {};
  for (const k of ['budgetOnline', 'openCheckbook', 'auditOnTime', 'competitiveBidding', 'meetingsRecorded', 'conflictDisclosures']) {
    transparency[k] = rand() < 0.2 + q * 0.75;
  }

  const debt = round(population * (6200 - q * 5200) * between(0.6, 1.2), 1000);
  const revSum = Object.values(revenue).reduce((a, b) => a + b, 0);

  const history = [];
  let r = revSum / Math.pow(1.035, 4);
  let s = spendingSum / Math.pow(1.04, 4);
  for (let y = 2022; y <= 2026; y++) {
    history.push({ year: y, revenue: round(y === 2026 ? revSum : r, 1000), spending: round(y === 2026 ? spendingSum : s, 1000) });
    r *= between(1.01, 1.06);
    s *= between(1.015, 1.065);
  }

  const topDonors = [];
  const donorPool = [...DONORS].sort(() => rand() - 0.5).slice(0, 3 + Math.floor(rand() * 3));
  for (const [dn, dt] of donorPool) {
    topDonors.push({ name: dn, type: dt, recipient: pick(OFFICES), amount: round(infTotal * between(0.05, 0.25), 50) });
  }
  topDonors.sort((a, b) => b.amount - a.amount);

  const ledger = [];
  const fyStart = new Date(Date.UTC(2025, 6, 1));
  const dateIn = () => new Date(fyStart.getTime() + Math.floor(rand() * 365) * 864e5).toISOString().slice(0, 10);
  for (const [k, v] of Object.entries(revenue)) {
    if (!v) continue;
    const payer = typeof PAYERS[k] === 'function' ? PAYERS[k]() : PAYERS[k];
    const parts = k === 'propertyTax' || k === 'stateAid' ? 2 : 1;
    for (let i = 0; i < parts; i++) {
      ledger.push({ date: dateIn(), flow: 'in', category: k, counterparty: payer, description: parts > 1 ? `Installment ${i + 1} of ${parts}` : 'Annual receipt', amount: round(v / parts, 1) });
    }
  }
  for (const [k, v] of Object.entries(spending)) {
    const vendor = pick(VENDORS[k]);
    ledger.push({ date: dateIn(), flow: 'out', category: k, counterparty: vendor, description: k === 'debtService' ? 'Bond payment' : 'Contract / payroll payments', amount: round(v * between(0.15, 0.45), 1) });
  }
  for (const d of topDonors) {
    const cat = d.type === 'PAC' ? 'pacContributions' : d.type === 'Union' ? 'unionContributions' : 'developerContributions';
    ledger.push({ date: dateIn(), flow: 'influence', category: cat, counterparty: d.name, description: `Contribution to ${d.recipient.toLowerCase()} campaign`, amount: d.amount });
  }
  if (influence.lobbyingPaid) {
    ledger.push({ date: dateIn(), flow: 'influence', category: 'lobbyingPaid', counterparty: 'Capitol Strategies LLC', description: 'Town-paid lobbying retainer', amount: influence.lobbyingPaid });
  }
  ledger.sort((a, b) => (a.date < b.date ? 1 : -1));

  const slug = `${name}-${type}-${code}`.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return {
    id: slug,
    name: `${name} ${type}`,
    state: code,
    stateName,
    county: `${pick(COUNTY)} County`,
    type,
    lat: Math.round((lat0 + between(-jitter, jitter) * 0.8) * 1e4) / 1e4,
    lng: Math.round((lng0 + between(-jitter, jitter)) * 1e4) / 1e4,
    population,
    fiscalYear: 2026,
    asOf: '2026-09-30',
    demo: true,
    revenue,
    spending,
    influence,
    topDonors,
    transparency,
    debt,
    history,
    ledger,
    sources: [{ label: 'Demo data generated by scripts/generate-demo-data.mjs (fictional)', url: '' }],
  };
}

const towns = [];
const used = new Set();
for (const st of STATES) for (let i = 0; i < st[5]; i++) towns.push(makeTown(st, i, used));

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify({
  generated: '2026-09-30',
  demo: true,
  note: 'Fictional towns and figures for demonstration only. Replace with real data using the scripts in /scripts.',
  towns,
}));
console.log(`Wrote ${towns.length} demo towns to ${OUT}`);
