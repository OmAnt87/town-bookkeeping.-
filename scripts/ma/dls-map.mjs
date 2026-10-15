// Maps Massachusetts DLS Schedule A general-fund columns to Town Ledger categories.
//
// Revenue: Schedule A "Taxes" holds the property tax plus motor vehicle excise,
// local-option meals and room excises and penalties. DLS also publishes the certified
// property tax levy, so the levy is shown as property tax and the rest of "Taxes"
// as other taxes and excises. Other financing sources (such as bond proceeds) and
// transfers from the town's own funds are not new revenue and are left out.
//
// Spending: Schedule A reports by function. "Fixed costs" (health insurance,
// pensions and other benefits, including for school staff) and "other expenditures"
// are spread across the functions in proportion to their size, as with employee
// benefits in other states. Debt service is left out of that spread.
// "Intergovernmental assessments" are state and county charges taken out of state
// aid (the Cherry Sheet), mostly charter school tuition and school choice, so they
// are counted with schools.

export const MA_REVENUE = {
  'Service Charges': ['localRevenue', 'Charges for services'],
  'Licenses and Permits': ['feesPermits', 'Licenses and permits'],
  'Federal Revenue': ['federalGrants', 'Federal revenue'],
  'State Revenue': ['stateAid', 'State revenue (Cherry Sheet aid and grants)'],
  'Revenue from Other Governments': ['otherRevenue', 'Revenue from other governments'],
  'Special Assessments': ['localRevenue', 'Special assessments'],
  'Fines and Forfeitures': ['finesForfeitures', 'Fines and forfeitures'],
  Miscellaneous: ['otherRevenue', 'Miscellaneous (investment income and other)'],
};
export const MA_REVENUE_EXCLUDED = ['Other Financing Sources', 'Transfers'];

export const MA_SPENDING = {
  'General Government': ['administration', 'General government'],
  'Public Safety': ['publicSafety', 'Public safety (police, fire, inspections)'],
  Education: ['education', 'Education (local and regional schools)'],
  'Public Works': ['roads', 'Public works (roads, snow, trash)'],
  'Human Services': ['healthServices', 'Human services (health, seniors, veterans)'],
  'Culture and Recreation': ['parks', 'Culture and recreation (libraries, parks)'],
  'Intergov Assessments': ['education', 'Intergovernmental assessments (charter schools, school choice, transit, county)'],
  'Debt Service': ['debtService', 'Debt service'],
  'Fixed Costs': ['shared', 'Fixed costs (health insurance, pensions and other benefits)'],
  'Other Expenditures': ['shared', 'Other expenditures'],
};

const num = (v) => Number(v) || 0;

// rev, exp: one municipality-year's Schedule A rows; levy: that year's certified total levy (or null).
export function aggregateMa(rev, exp, levy) {
  const revenue = {};
  const taxes = num(rev.Taxes);
  const propertyTax = levy ? Math.min(levy, taxes) : taxes;
  if (propertyTax) revenue.propertyTax = propertyTax;
  if (taxes - propertyTax) revenue.salesTax = taxes - propertyTax;
  let revSum = taxes;
  for (const [col, [key]] of Object.entries(MA_REVENUE)) {
    const v = num(rev[col]);
    revSum += v;
    if (v) revenue[key] = (revenue[key] || 0) + v;
  }
  const excluded = Object.fromEntries(MA_REVENUE_EXCLUDED.map((c) => [c, num(rev[c])]));

  const spending = {};
  let shared = 0;
  let expSum = 0;
  for (const [col, [key]] of Object.entries(MA_SPENDING)) {
    const v = num(exp[col]);
    expSum += v;
    if (!v) continue;
    if (key === 'shared') shared += v;
    else spending[key] = (spending[key] || 0) + v;
  }
  const spreadKeys = Object.keys(spending).filter((k) => k !== 'debtService');
  const base = spreadKeys.reduce((a, k) => a + spending[k], 0);
  if (shared && base) for (const k of spreadKeys) spending[k] += shared * (spending[k] / base);
  else if (shared) spending.administration = (spending.administration || 0) + shared;

  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v));
  return {
    revenue: round(revenue),
    spending: round(spending),
    shared: Math.round(shared),
    fixedCosts: Math.round(num(exp['Fixed Costs'])),
    levyUsed: Boolean(levy),
    lineTotals: { revenue: revSum, spending: expSum },
    reported: { revenue: num(rev['Total Revenues']) - Object.values(excluded).reduce((a, b) => a + b, 0), spending: num(exp['Total Expenditures']) },
    excluded,
  };
}
