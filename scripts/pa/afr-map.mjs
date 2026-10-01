// Maps Pennsylvania DCED Municipal Annual Financial Report (DCED-CLGS-30) statewide
// columns to Town Ledger categories.
//
// 'shared' = "Other Expenditures" (mostly insurance, pensions and employee benefits),
// spread across departments by size as in NJ and NY.
// 'exclude' = "Other Financing Sources/Uses": transfers between a municipality's own
// funds, refinancing and other non-operating items, which the statewide report does
// not break down.

export const PA_REVENUE = {
  'Real Estate Tax Revenues': 'propertyTax',
  'Earned Income Tax Revenues': 'salesTax',
  'Realty Transfer Tax Revenues': 'salesTax',
  'Local Services Tax Revenues': 'salesTax',
  'Per Capita Tax Revenues': 'salesTax',
  'Occupational Tax Revenues': 'salesTax',
  'Business Gross Receipts Tax Revenues': 'salesTax',
  'Amusement and Admissions Tax Revenues': 'salesTax',
  'Mechanical Device Tax Revenues': 'salesTax',
  'All Other Taxes Revenues': 'salesTax',
  'Intergovernmental Revenues-Federal Government': 'federalGrants',
  'Intergovernmental Revenues-State Government': 'stateAid',
  'Intergovernmental Revenues-Local Government': 'otherRevenue',
  'Sewer Revenues': 'utilityCharges',
  'Water Revenues': 'utilityCharges',
  'Solid Waste Revenues': 'utilityCharges',
  'Electric System Revenues': 'utilityCharges',
  'Gas System Revenues': 'utilityCharges',
  'Parking Revenues': 'feesPermits',
  'Culture and Recreation Revenues': 'feesPermits',
  'Other Charges for Services Revenues': 'feesPermits',
  'Licenses and Permits Revenues': 'feesPermits',
  'Cable TV Franchise Fees Revenues': 'feesPermits',
  'Fines and Forfeits Revenues': 'finesForfeitures',
  'Interest Rents and Royalties Revenues': 'localRevenue',
  'Contributions and Donations from Private Sectors Revenues': 'grants',
  'Unclassified Operating Revenues': 'otherRevenue',
  'Other Financing Sources Revenues': 'exclude',
};

export const PA_EXPENDITURE = {
  'General Government Expenditures': 'administration',
  'Police Expenditures': 'publicSafety',
  'Fire Expenditures': 'publicSafety',
  'UCC and Code Enforcement Expenditures': 'publicSafety',
  'Other Public Safety Expenditures': 'publicSafety',
  'Health and Human Services Expenditures': 'healthServices',
  'Public Works-Highways and Streets Expenditures': 'roads',
  'Sewer Expenditures': 'utilities',
  'Water Expenditures': 'utilities',
  'Solid Waste Expenditures': 'utilities',
  'Electrical System Expenditures': 'utilities',
  'Gas System Expenditures': 'utilities',
  'Other Public Works Expenditures': 'roads',
  'Culture and Recreation Expenditures': 'parks',
  'Libraries Expenditures': 'parks',
  'Community Development Expenditures': 'administration',
  'Debt Service Expenditures': 'debtService',
  'Other Expenditures': 'shared',
  'Unclassified Operating Expenditures': 'administration',
  'Other Financing Uses Expenditures': 'exclude',
};

const TAX_COLUMNS = Object.keys(PA_REVENUE).filter((c) => /Tax(es)? Revenues$/.test(c));

// rec: one municipality-year from scripts/pa/afr-to-json.py.
export function aggregateAfr(rec) {
  const revenue = {};
  const spending = {};
  let shared = 0;
  const excluded = { revenue: 0, spending: 0 };
  let revSum = 0;
  let expSum = 0;
  for (const [col, key] of Object.entries(PA_REVENUE)) {
    const v = Number(rec[col]) || 0;
    revSum += v;
    if (!v) continue;
    if (key === 'exclude') excluded.revenue += v;
    else revenue[key] = (revenue[key] || 0) + v;
  }
  for (const [col, key] of Object.entries(PA_EXPENDITURE)) {
    const v = Number(rec[col]) || 0;
    expSum += v;
    if (!v) continue;
    if (key === 'exclude') excluded.spending += v;
    else if (key === 'shared') shared += v;
    else spending[key] = (spending[key] || 0) + v;
  }
  // The statewide file itemizes only some taxes; the rest of "Total Taxes" is other local taxes.
  const unitemizedTaxes = (Number(rec['Total Taxes Revenues']) || 0) - TAX_COLUMNS.reduce((a, c) => a + (Number(rec[c]) || 0), 0);
  if (Math.abs(unitemizedTaxes) > 0.5) {
    revenue.salesTax = (revenue.salesTax || 0) + unitemizedTaxes;
    revSum += unitemizedTaxes;
  }
  const base = Object.values(spending).reduce((a, b) => a + b, 0);
  if (shared && base) for (const k of Object.keys(spending)) spending[k] += (spending[k] / base) * shared;
  else if (shared) spending.administration = (spending.administration || 0) + shared;
  for (const o of [revenue, spending]) for (const k of Object.keys(o)) o[k] = Math.round(o[k]);
  return {
    revenue,
    spending,
    shared: Math.round(shared),
    unitemizedTaxes: Math.round(unitemizedTaxes),
    excluded,
    // Sums of the line items, to check against the report's own totals.
    lineTotals: { revenue: revSum, spending: expSum },
    reported: { revenue: Number(rec['Total Revenues']) || 0, spending: Number(rec['Total Expenditures']) || 0 },
  };
}
