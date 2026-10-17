// Maps Maryland Department of Legislative Services "Local Government Finances" statements to
// Town Ledger categories.
//
// Each statement has governmental operating, governmental capital and enterprise columns.
// All three are counted, so water, sewer and other utilities a town runs are included, as is
// capital spending in the year it happens. Debt proceeds are borrowing, not revenue, and are
// left out.
//
// 'benefits' = miscellaneous spending (pension contributions, health insurance, workers'
// compensation, Social Security, judgments and losses), spread across departments by size,
// except debt service, as with benefits in other states.

const COLS = 3; // operating, capital, enterprise (index 3 is the printed total)

export const MD_REVENUE = {
  'Taxes - Local - Property': ['propertyTax', 'Property tax'],
  'Taxes - Local - Income': ['salesTax', 'Local income tax (municipal share)'],
  'Taxes - Local - Other': ['salesTax', 'Other local taxes (admissions and amusement, other)'],
  'Licenses and Permits': ['feesPermits', 'Licenses and permits'],
  'Federal Grants': ['federalGrants', 'Federal grants'],
  'State Grants': ['stateAid', 'State grants and shared taxes'],
  'County Grants': ['grants', 'County grants'],
  'Other Grants': ['grants', 'Other grants'],
  'Service Charges': ['feesPermits', 'Service charges'],
  'Fines and Forfeitures': ['finesForfeitures', 'Fines and forfeitures'],
  Miscellaneous: ['localRevenue', 'Miscellaneous (interest, rents, donations, sale of property)'],
};
export const MD_REVENUE_EXCLUDED = ['Debt Proceeds'];

export const MD_FUNCTION = {
  'General Government': ['administration', 'General government'],
  Police: ['publicSafety', 'Police'],
  Fire: ['publicSafety', 'Fire'],
  'Public Safety/Other': ['publicSafety', 'Other public safety'],
  Corrections: ['publicSafety', 'Corrections'],
  Transportation: ['roads', 'Transportation (streets, parking, transit)'],
  'Sewer/Solid Waste/Water': ['utilities', 'Sewer, solid waste and water'],
  'Public Works/Other': ['utilities', 'Other public works (gas, electric, light and power)'],
  'Parks, Recreation, & Culture': ['parks', 'Parks, recreation and culture'],
  'Natural Resources': ['parks', 'Natural resources'],
  'Community Dev. & Pub. Housing': ['administration', 'Community development and public housing'],
  Health: ['healthServices', 'Health'],
  'Social Services': ['healthServices', 'Social services'],
  'Economic Dev. & Opportunity': ['administration', 'Economic development and opportunity'],
  'Primary/Secondary Education': ['education', 'Primary and secondary education'],
  'Transfers to Boards': ['education', 'Transfers to the board of education and other boards'],
  'Community Colleges': ['education', 'Community college'],
  Intergovernmental: ['administration', 'Intergovernmental payments'],
  'Other/Other': ['administration', 'Other'],
  Principal: ['debtService', 'Debt service: principal'],
  Interest: ['debtService', 'Debt service: interest'],
  Miscellaneous: ['benefits', 'Miscellaneous (pensions, health insurance, workers\' compensation, Social Security, judgments)'],
};

const sumCols = (v) => (v || []).slice(0, COLS).reduce((a, b) => a + (Number(b) || 0), 0);

// rows: { "revenues/<label>": [op, cap, ent, total], "expenditures/<label>": [...] } for one government-year.
export function aggregateMd(rows) {
  const revenue = {};
  const spending = {};
  const unmapped = [];
  let revSum = 0;
  let expSum = 0;
  let benefits = 0;
  const excluded = {};
  for (const [k, v] of Object.entries(rows)) {
    const [section, ...rest] = k.split('/');
    const label = rest.join('/');
    if (label === 'Total') continue;
    const amount = sumCols(v);
    if (section === 'revenues') {
      if (MD_REVENUE_EXCLUDED.includes(label)) { excluded[label] = amount; revSum += amount; continue; }
      const m = MD_REVENUE[label];
      if (!m) { unmapped.push(k); continue; }
      revSum += amount;
      // Enterprise service charges are utility bills (water, sewer, electric).
      if (label === 'Service Charges') {
        const ent = Number(v[2]) || 0;
        if (ent) revenue.utilityCharges = (revenue.utilityCharges || 0) + ent;
        if (amount - ent) revenue.feesPermits = (revenue.feesPermits || 0) + amount - ent;
      } else if (amount) revenue[m[0]] = (revenue[m[0]] || 0) + amount;
    } else if (section === 'expenditures') {
      const m = MD_FUNCTION[label];
      if (!m) { unmapped.push(k); continue; }
      expSum += amount;
      if (m[0] === 'benefits') benefits += amount;
      else if (amount) spending[m[0]] = (spending[m[0]] || 0) + amount;
    }
  }
  const keys = Object.keys(spending).filter((k) => k !== 'debtService');
  const base = keys.reduce((a, k) => a + spending[k], 0);
  if (benefits && base) for (const k of keys) spending[k] += benefits * (spending[k] / base);
  else if (benefits) spending.administration = (spending.administration || 0) + benefits;
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v));
  return {
    revenue: round(revenue),
    spending: round(spending),
    benefitsSpread: Math.round(benefits),
    unmapped,
    lineTotals: { revenue: revSum, spending: expSum },
    reported: { revenue: sumCols(rows['revenues/Total']), spending: sumCols(rows['expenditures/Total']) },
    excluded: Object.fromEntries(Object.entries(excluded).map(([k, v]) => [k, Math.round(v)])),
  };
}
