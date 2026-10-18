// Maps a Wisconsin government's row in the Department of Revenue "County and Municipal Revenues
// and Expenditures" workbook (compiled from its Municipal Financial Report) to Town Ledger
// categories.
//
// Governmental funds are reported by revenue source and by function; proprietary (utility and
// other enterprise) funds only as total revenues and expenses, which count as utility charges and
// utilities. Other financing sources and uses (borrowing, transfers and refunding) are left out.
// Conservation and development, like general government, counts as overhead.

const REVENUE = [
  ['General Property Taxes', 'propertyTax', 'General property taxes'],
  ['Tax Increments', 'propertyTax', 'Tax increments (TIF districts)'],
  ['InLieu of Taxes', 'localRevenue', 'Payments in lieu of taxes'],
  ['Other Taxes', 'salesTax', 'Sales, room and other taxes'],
  ['Special Assessments', 'feesPermits', 'Special assessments'],
  ['Federal Aids', 'federalGrants', 'Federal aids'],
  ['State Shared Revenues', 'stateAid', 'State shared revenues'],
  ['State Highway Aids', 'stateAid', 'State highway aids'],
  ['All Other State Aids', 'stateAid', 'Other state aids'],
  ['Other Local Govt Aids', 'grants', 'Aids from other local governments'],
  ['Licenses and Permits', 'feesPermits', 'Licenses and permits'],
  ['Fines, Forfeits and Penalties', 'finesForfeitures', 'Fines, forfeitures and penalties'],
  ['Public Charges for Services', 'feesPermits', 'Charges for services'],
  ['Intergovernmental Charges for Services', 'feesPermits', 'Charges to other governments for services'],
  ['Interest Income', 'localRevenue', 'Interest'],
  ['Other Revenues', 'localRevenue', 'Other revenue'],
  ['Propriety Funds - Revenues', 'utilityCharges', 'Utility and other enterprise fund revenues'],
];
const SPENDING = [
  ['General Government', 'administration', 'General government'],
  ['Law Enforcement', 'publicSafety', 'Law enforcement'],
  ['Fire', 'publicSafety', 'Fire'],
  ['Ambulance', 'publicSafety', 'Ambulance'],
  ['Other Public Safety', 'publicSafety', 'Other public safety'],
  ['Highway Maintainence and Administration', 'roads', 'Highway maintenance and administration'],
  ['Highway Construction', 'roads', 'Highway construction'],
  ['Road- Related Facilities', 'roads', 'Road-related facilities'],
  ['Other Transportation', 'roads', 'Other transportation'],
  ['Solid Waste Collection and Disposal', 'utilities', 'Solid waste collection and disposal'],
  ['Other Sanitation', 'utilities', 'Other sanitation'],
  ['Health and Human Services', 'healthServices', 'Health and human services'],
  ['Culture and Education', 'parks', 'Libraries, culture and education'],
  ['Parks and Recreation', 'parks', 'Parks and recreation'],
  ['Conservation and Development', 'administration', 'Conservation and development'],
  ['All Other Expenditures', 'administration', 'All other'],
  ['Debt Service - Principal Interest', 'debtService', 'Debt service: principal and interest'],
  ['Debt Service - Fiscal Changes', 'debtService', 'Debt service: fiscal charges'],
  ['Propriety Funds - Expenses', 'utilities', 'Utility and other enterprise fund expenses'],
];
export const LEFT_OUT = ['Other Financing Sources', 'Other Financing Uses'];

const num = (v) => Number(v) || 0;

// row: one government's CMRE row (column -> value).
export function aggregateCmre(row) {
  const revenue = {};
  const spending = {};
  const lines = [];
  for (const [group, map, target] of [['revenue', REVENUE, revenue], ['spending', SPENDING, spending]]) {
    for (const [col, key, label] of map) {
      const amount = Math.round(num(row[col]));
      if (!amount) continue;
      target[key] = (target[key] || 0) + amount;
      lines.push({ group, key, label, amount });
    }
  }
  const sum = (o) => Object.values(o).reduce((a, v) => a + v, 0);
  return {
    revenue,
    spending,
    lines,
    debt: Math.round(num(row['Total General Obligation Debt'])),
    leftOut: { sources: Math.round(num(row['Other Financing Sources'])), uses: Math.round(num(row['Other Financing Uses'])) },
    empty: !sum(revenue) || !sum(spending),
    // More than four times apart means an entry error or a part left out.
    inconsistent: sum(revenue) > 4 * sum(spending) || sum(spending) > 4 * sum(revenue),
  };
}
