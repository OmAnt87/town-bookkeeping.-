// Maps Massachusetts Division of Local Services (DLS) Schedule A general fund figures to
// TownView categories.
//
// Schedule A reports revenue by source and spending by function. "Taxes" includes motor
// vehicle and other excises (meals, rooms, cannabis), which DLS reports separately as actual
// local receipts; those are moved to other local taxes, and the rest is property tax.
//
// 'benefits' = fixed costs (health insurance, pensions and other benefits for town and school
// staff), spread across departments by size, schools included, but not debt service.
// 'shared' = intergovernmental assessments (charter school tuition, regional transit, county
// and state charges) and other spending, spread across all departments by size, as with
// capital outlay and "other" in Connecticut.

export const MA_REVENUE = {
  Taxes: ['propertyTax', 'Taxes (property tax, excises and penalties)'],
  'Service Charges': ['feesPermits', 'Charges for services'],
  'Licenses and Permits': ['feesPermits', 'Licenses and permits'],
  'Federal Revenue': ['federalGrants', 'Federal revenue'],
  'State Revenue': ['stateAid', 'State revenue (Chapter 70 school aid, local aid and grants)'],
  'Revenue from Other Governments': ['otherRevenue', 'Revenue from other governments'],
  'Special Assessments': ['otherRevenue', 'Special assessments'],
  'Fines and Forfeitures': ['finesForfeitures', 'Fines and forfeitures'],
  Miscellaneous: ['localRevenue', 'Miscellaneous (investment income, payments in lieu of taxes and other local revenue)'],
};
// Moving money between a town's own funds, and bond and other financing proceeds, are not new revenue.
export const MA_REVENUE_EXCLUDED = ['Other Financing Sources', 'Transfers'];

export const MA_FUNCTION = {
  'General Government': ['administration', 'General government'],
  'Public Safety': ['publicSafety', 'Public safety (police, fire, inspections)'],
  Education: ['education', 'Education (town schools and regional school district assessments)'],
  'Public Works': ['roads', 'Public works (roads, snow and ice, facilities)'],
  'Human Services': ['healthServices', 'Human services (health, veterans, council on aging)'],
  'Culture and Recreation': ['parks', 'Culture and recreation (libraries, parks)'],
  'Fixed Costs': ['benefits', 'Fixed costs (employee benefits and insurance)'],
  'Intergov Assessments': ['shared', 'Intergovernmental assessments (charter schools, regional transit, county and state charges)'],
  'Other Expenditures': ['shared', 'Other spending'],
  'Debt Service': ['debtService', 'Debt service'],
};

// Local receipt types that are taxes other than property tax.
export const MA_EXCISE = ['Motor Vehicle Excise', 'Other Excise', 'A.Meals', 'B.Room', 'C.Other', 'D.Cannabis'];

const num = (v) => Number(v) || 0;

// gf: { revenue, spending } column objects for one town-year; receipts: that year's actual
// local receipts by description, or null when DLS has none.
export function aggregateMa(gf, receipts) {
  const rev = gf.revenue || {};
  const exp = gf.spending || {};
  const revenue = {};
  let revSum = 0;
  for (const [col, [key]] of Object.entries(MA_REVENUE)) {
    const v = num(rev[col]);
    revSum += v;
    if (v) revenue[key] = (revenue[key] || 0) + v;
  }
  const excise = receipts ? Math.min(MA_EXCISE.reduce((a, k) => a + num(receipts[k]), 0), revenue.propertyTax || 0) : 0;
  if (excise) {
    revenue.propertyTax -= excise;
    revenue.salesTax = excise;
  }
  const excluded = Object.fromEntries(MA_REVENUE_EXCLUDED.map((c) => [c, num(rev[c])]));

  const spending = {};
  let shared = 0;
  let benefits = 0;
  let expSum = 0;
  for (const [col, [key]] of Object.entries(MA_FUNCTION)) {
    const v = num(exp[col]);
    expSum += v;
    if (!v) continue;
    if (key === 'shared') shared += v;
    else if (key === 'benefits') benefits += v;
    else spending[key] = (spending[key] || 0) + v;
  }
  const reportedSpending = num(exp['Total Expenditures']);
  if (!expSum && reportedSpending) {
    spending.otherSpending = reportedSpending;
    expSum = reportedSpending;
  } else {
    const spread = (amount, keys) => {
      const base = keys.reduce((a, k) => a + spending[k], 0);
      if (base) for (const k of keys) spending[k] += amount * (spending[k] / base);
      else if (amount) spending.administration = (spending.administration || 0) + amount;
    };
    spread(benefits, Object.keys(spending).filter((k) => k !== 'debtService'));
    spread(shared, Object.keys(spending));
  }
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v));
  return {
    revenue: round(revenue),
    spending: round(spending),
    excise: Math.round(excise),
    taxSplit: !!receipts,
    shared: Math.round(shared),
    benefitsSpread: Math.round(benefits),
    lineTotals: { revenue: revSum + Object.values(excluded).reduce((a, b) => a + b, 0), spending: expSum },
    reported: { revenue: num(rev['Total Revenues']), spending: reportedSpending },
    excluded,
  };
}

// Schedule A funds outside the general fund: special revenue (grants, receipts reserved,
// revolving and other special revenue funds), capital projects and enterprise funds. Trust
// funds are left out (mostly pension and OPEB investment holdings and money held for others),
// as are transfers between funds and borrowing, which these reports do not include.
// Each table maps its revenue to one category and its spending by column; 'shared' columns
// have no single function and are spread over the town's spending in proportion, as in the
// general fund. General government grants are shared too: most are federal recovery (ARPA)
// money that towns pass on to many programs.
export const MA_OTHER = {
  FedGrants: {
    label: 'Federal grants', revenue: 'federalGrants',
    spending: { 'Federal General Government Grants': 'shared', 'Federal Public Safety Grants': 'publicSafety', 'Federal Public Works Grants': 'roads', 'Federal Education Grants': 'education', 'Federal Emergency Management Agency': 'publicSafety', 'Federal Culture and Recreation Grants': 'parks', 'Federal Community Development Block Grants': 'administration', 'Other Federal Housing and Urban Development Grants': 'administration', 'Other Federal Grants': 'shared' },
  },
  StateGrants: {
    label: 'State grants', revenue: 'grants',
    spending: { 'General Government': 'shared', 'Public Safety': 'publicSafety', 'Public Works': 'roads', Education: 'education', MEMA: 'publicSafety', 'Culture and Recreation': 'parks', 'Council on Aging': 'healthServices', 'State Library Grants': 'parks', Other: 'shared' },
  },
  RecResApp: {
    label: 'Receipts reserved for appropriation', revenue: 'feesPermits',
    spending: { Education: 'education', 'Waterways Improvement': 'roads', 'Parking Meters': 'roads', 'Sale of Real Estate': 'administration', 'Sale of Cemetery Lots': 'administration', 'Wetlands Protection': 'administration', Ambulance: 'publicSafety', 'Insurance Reimbursement over $20,000': 'shared', Other: 'shared', 'General Government': 'administration' },
  },
  RevFunds: {
    label: 'Revolving funds', revenue: 'feesPermits',
    spending: { Education: 'education', Athletic: 'education', 'Parks and Recreation': 'parks', 'Ch. 44, 53E 1/2': 'shared', Other: 'shared' },
  },
  OtherSpRev: {
    label: 'Other special revenue', revenue: 'otherRevenue',
    spending: { Water: 'utilities', Sewer: 'utilities', Education: 'education', 'School Lunch': 'education', 'Professional Development': 'education', 'Community Preservation Act': 'shared', MWPAT: 'utilities', 'Title V': 'utilities', 'Gifts and Donations': 'shared', Other: 'shared', 'Adult Education': 'education' },
  },
  CapProjects: {
    label: 'Capital projects', revenue: 'grants',
    // Municipal buildings mix town halls with police and fire stations, libraries and public
    // works garages, so they are spread over the town's departments like other unassigned spending.
    spending: { Water: 'utilities', Sewer: 'utilities', Schools: 'education', 'Municipal Buildings': 'shared', Landfill: 'utilities', 'Highways (Chapter 90)': 'roads', Other: 'shared' },
  },
  EntFunds: {
    label: 'Enterprise funds', revenue: 'utilityCharges',
    spending: { Water: 'utilities', Sewer: 'utilities', Electric: 'utilities', Landfills: 'utilities', Hospital: 'healthServices', 'Health Care': 'healthServices', Airport: 'roads', Harbor: 'roads', 'Golf Courses': 'parks', 'Public Recreation': 'parks', Other: 'utilities' },
  },
};

// One year's other funds ({ <table>: { revenue, spending } }) as TownView amounts.
// Returns { revenue, spending: { <key>: amount, shared }, lines, totals, unmapped }. Lines are
// one per table and flow; `unmapped` lists spending columns with no mapping (counted as shared).
export function aggregateMaOther(year = {}) {
  const revenue = {};
  const spending = {};
  const lines = [];
  const unmapped = [];
  let revTotal = 0;
  let expTotal = 0;
  for (const [table, def] of Object.entries(MA_OTHER)) {
    const t = year[table];
    if (!t) continue;
    const rIn = num(t.revenue?.['Total Revenues']);
    if (rIn) {
      revenue[def.revenue] = (revenue[def.revenue] || 0) + rIn;
      revTotal += rIn;
      lines.push({ table, flow: 'in', key: def.revenue, amount: rIn, label: def.label });
    }
    const exp = t.spending || {};
    let tableOut = 0;
    for (const [col, v] of Object.entries(exp)) {
      if (/^Total/.test(col) || !num(v)) continue;
      const key = def.spending[col] || 'shared';
      if (!def.spending[col]) unmapped.push(`${table}: ${col}`);
      spending[key] = (spending[key] || 0) + num(v);
      tableOut += num(v);
    }
    if (tableOut) {
      expTotal += tableOut;
      lines.push({ table, flow: 'out', amount: tableOut, label: def.label });
    }
  }
  return { revenue, spending, lines, totals: { revenue: revTotal, spending: expTotal }, unmapped };
}

const OTHER_COUNTERPARTY = 'Schedule A: other funds';
const OTHER_NOTE = /^(Covers the general fund\.|Covers the general fund, special revenue)/;
export const MA_SCOPE = 'General, special revenue, capital and enterprise funds; includes schools';

// History from the general fund, plus other funds where a year has them. Once a town has other
// funds, a year without them is left out rather than drawn as a sudden drop.
export function maHistory(t) {
  const excluded = (g) => (g.revenue['Other Financing Sources'] || 0) + (g.revenue.Transfers || 0);
  const years = Object.keys(t.gf).filter((y) => t.gf[y]?.revenue?.['Total Revenues'] && t.gf[y]?.spending?.['Total Expenditures']).sort();
  const hasOther = years.some((y) => t.other?.[y]);
  return years.filter((y) => !hasOther || t.other?.[y]).map((y) => {
    const o = aggregateMaOther(t.other?.[y]);
    return {
      year: Number(y),
      revenue: Math.round(t.gf[y].revenue['Total Revenues'] - excluded(t.gf[y]) + o.totals.revenue),
      spending: Math.round(t.gf[y].spending['Total Expenditures'] + o.totals.spending),
      basis: 'actual',
    };
  }).filter((h) => h.revenue > 0 && h.spending > 0);
}

// Adds the town's other funds for its fiscal year to a record whose revenue and spending hold
// the general fund (from aggregateMa), and rebuilds its history. Safe to run again on a town it
// has already updated: earlier other-fund amounts are taken back out through their ledger rows.
export function applyOtherFunds(town, t, source) {
  const round = (o) => { for (const k of Object.keys(o)) { o[k] = Math.round(o[k]); if (!o[k]) delete o[k]; } };
  for (const e of (town.ledger || []).filter((x) => x.counterparty === OTHER_COUNTERPARTY)) {
    const side = e.flow === 'in' ? town.revenue : town.spending;
    for (const [k, v] of Object.entries(e.split || { [e.category]: e.amount })) side[k] = (side[k] || 0) - v;
  }
  round(town.revenue);
  round(town.spending);
  town.ledger = (town.ledger || []).filter((x) => x.counterparty !== OTHER_COUNTERPARTY);
  delete town.borrowed;

  const year = String(town.fiscalYear);
  const o = aggregateMaOther(t.other?.[year]);
  // Spending is split by column; 'shared' columns are spread over the town's spending
  // (general fund plus the other funds' mapped columns) in proportion.
  const combined = { ...town.spending };
  for (const [k, v] of Object.entries(o.spending)) if (k !== 'shared') combined[k] = (combined[k] || 0) + v;
  const spreadKeys = Object.keys(combined).filter((k) => k !== 'debtService' && k !== 'otherSpending');
  const base = spreadKeys.reduce((a, k) => a + combined[k], 0);
  const date = `${year}-06-30`;
  const rows = o.lines.map((l) => {
    if (l.flow === 'in') return { date, flow: 'in', category: l.key, counterparty: OTHER_COUNTERPARTY, description: `${l.label}: revenue`, amount: Math.round(l.amount), source };
    const def = MA_OTHER[l.table];
    const split = {};
    for (const [col, v] of Object.entries(t.other[year][l.table].spending || {})) {
      if (/^Total/.test(col) || !num(v)) continue;
      const key = def.spending[col] || 'shared';
      if (key !== 'shared') split[key] = (split[key] || 0) + num(v);
      else if (base) for (const k of spreadKeys) split[k] = (split[k] || 0) + num(v) * (combined[k] / base);
      else split.administration = (split.administration || 0) + num(v);
    }
    const rounded = Object.fromEntries(Object.entries(split).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v));
    const main = Object.entries(rounded).sort((a, b) => b[1] - a[1])[0]?.[0] || 'administration';
    return { date, flow: 'out', category: main, counterparty: OTHER_COUNTERPARTY, description: `${l.label}: spending`, amount: Object.values(rounded).reduce((a, b) => a + b, 0), split: rounded, source };
  });
  // Totals come from the ledger rows, so a rerun takes back out exactly what was added.
  for (const r of rows) {
    const side = r.flow === 'in' ? town.revenue : town.spending;
    for (const [k, v] of Object.entries(r.split || { [r.category]: r.amount })) side[k] = (side[k] || 0) + v;
  }
  round(town.revenue);
  round(town.spending);
  town.ledger = [...rows, ...town.ledger];

  // Capital projects are mostly paid for with bonds, and bond proceeds are not revenue, so the
  // part of capital spending not covered by capital-fund revenue is recorded as borrowed.
  const cap = t.other?.[year]?.CapProjects;
  const borrowed = num(cap?.spending?.['Total Expenditures']) - num(cap?.revenue?.['Total Revenues']);
  if (borrowed > 0) town.borrowed = Math.round(borrowed);

  town.history = maHistory(t);
  town.notes = (town.notes || []).filter((n) => !OTHER_NOTE.test(n));
  const where = town.notes.findIndex((n) => n.startsWith('Includes public schools'));
  const note = o.totals.revenue || o.totals.spending
    ? `Covers the general fund, special revenue funds (federal and state grants, school lunch, revolving and other special revenue), capital projects and enterprise funds such as water and sewer: $${Math.round(o.totals.revenue).toLocaleString('en-US')} of revenue and $${Math.round(o.totals.spending).toLocaleString('en-US')} of spending outside the general fund. Trust funds, transfers between funds and borrowing are left out.${town.borrowed ? ` Capital projects spent $${town.borrowed.toLocaleString('en-US')} more than they took in, which is generally paid with bonds.` : ''} Fire, water and other districts inside the town are separate governments and are not included.`
    : 'Covers the general fund. No special revenue, capital or enterprise fund figures are on file for this year. Fire, water and other districts inside the town are separate and not included.';
  town.notes.splice(where >= 0 ? where + 1 : 1, 0, note);
  if (town.reporting) town.reporting.scope = o.totals.revenue || o.totals.spending ? MA_SCOPE : 'General fund; includes schools';
  return { other: o, borrowed: town.borrowed || 0 };
}
