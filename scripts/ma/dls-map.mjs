// Maps Massachusetts Division of Local Services (DLS) Schedule A general fund figures to
// Town Ledger categories.
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
