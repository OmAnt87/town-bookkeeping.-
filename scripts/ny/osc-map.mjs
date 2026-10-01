// Maps NY Office of the State Comptroller (OSC) annual financial report lines to
// Town Ledger categories. Keys come from scripts/ny/osc-to-json.py:
//   "<FUND>|<REVENUE|EXPENDITURE>|<LEVEL_1_CATEGORY>|<LEVEL_2_CATEGORY>|<FUNCTION>"
//
// Results:
//   a category key            counted
//   'shared'                  employee benefits, spread across departments by size
//   'exclude:<reason>'        not the government's own money or an internal transfer

// Funds that hold other people's money or move money inside the government.
export const EXCLUDED_FUNDS = {
  TC: 'custodial fund (taxes collected for school districts, the county and others)',
  TA: 'agency fund (money held for others)',
  TE: 'private-purpose trust fund',
  PN: 'permanent fund (trust principal)',
  MS: 'internal self-insurance fund (charges departments, already counted there)',
};

const REVENUE = {
  'Real Property Taxes and Assessments': 'propertyTax',
  'Sales and Use Tax': 'salesTax',
  'State Aid': 'stateAid',
  'Federal Aid': 'federalGrants',
  'Use and Sale of Property': 'localRevenue',
  'Charges to Other Governments': 'otherRevenue',
};
const REVENUE_L2 = {
  'Other Real Property Tax Items|Payments In Lieu Of Taxes': 'localRevenue',
  'Other Real Property Tax Items|Interest And Penalties': 'localRevenue',
  'Other Real Property Tax Items|Miscellaneous Tax Items': 'localRevenue',
  'Other Real Property Tax Items|Gain From Sale Of Tax Acquired Property': 'otherRevenue',
  'Other Non-Property Taxes|City Income Tax': 'salesTax',
  'Other Non-Property Taxes|Miscellaneous Non-Property Taxes': 'salesTax',
  'Other Non-Property Taxes|Franchises': 'feesPermits',
  'Charges for Services|Utility Fees': 'utilityCharges',
  'Charges for Services|Sanitation Fees': 'utilityCharges',
  'Other Local Revenues|Fines': 'finesForfeitures',
  'Other Local Revenues|Forfeitures': 'finesForfeitures',
  'Other Local Revenues|Gifts': 'grants',
  'Other Local Revenues|Library Grants From Local Governments': 'grants',
  'Other Local Revenues|Miscellaneous Grants From Local Governments': 'grants',
  'Proceeds of Debt|Sale Of Obligations': 'borrowing',
  'Proceeds of Debt|Miscellaneous Debt Proceeds': 'borrowing',
  'Proceeds of Debt|Bans Redeemed From Appropriations': 'exclude:notes repaid from the government\'s own budget (already counted as debt service)',
  'Other Sources|Transfers': 'exclude:transfers between the government\'s own funds',
};
const REVENUE_L1_DEFAULT = {
  'Charges for Services': 'feesPermits',
  'Other Local Revenues': 'otherRevenue',
  'Other Real Property Tax Items': 'localRevenue',
  'Other Non-Property Taxes': 'salesTax',
  'Proceeds of Debt': 'borrowing',
};

const EXPENDITURE = {
  'Public Safety': 'publicSafety',
  'Health': 'healthServices',
  'Social Services': 'healthServices',
  'Transportation': 'roads',
  'Culture and Recreation': 'parks',
  'Education': 'parks',
  'Sanitation': 'utilities',
  'Utilities': 'utilities',
  'Employee Benefits': 'shared',
  'Debt Service': 'debtService',
  'General Government': 'administration',
  'Economic Development': 'administration',
  'Community Services': 'healthServices',
};
const EXPENDITURE_L2 = {
  'Community Services|Natural Resources': 'parks',
  'Economic Development|Development Infrastructure': 'roads',
  'Other Uses|Transfers': 'exclude:transfers between the government\'s own funds',
};
// General Government functions paid mostly to outside professionals.
const CONSULTANT_FUNCTIONS = { 1420: 'Law', 1440: 'Engineer' };

const REFINANCING = 'exclude:refinancing of existing bonds';
// 5791 advance and 5792 current refunding bonds replace old debt rather than raise new money.
const REFUNDING_CODES = new Set(['5791', '5792']);

export function mapOscLine(key) {
  const [fund, section, l1, l2, fn] = key.split('|');
  if (EXCLUDED_FUNDS[fund]) return `exclude:${EXCLUDED_FUNDS[fund]}`;
  if (l1 === 'Proceeds of Debt' && REFUNDING_CODES.has(fn)) return REFINANCING;
  // Payments to an escrow agent to retire refunded bonds carry no OSC category.
  if (section === 'EXPENDITURE' && !l1) return REFINANCING;
  const l12 = `${l1}|${l2}`;
  if (section === 'REVENUE') return REVENUE_L2[l12] || REVENUE[l1] || REVENUE_L1_DEFAULT[l1] || null;
  if (EXPENDITURE_L2[l12]) return EXPENDITURE_L2[l12];
  if (l1 === 'General Government' && CONSULTANT_FUNCTIONS[fn]) return 'consultants';
  return EXPENDITURE[l1] || null;
}

// lines: { key: amount } for one government-year.
export function aggregateOsc(lines) {
  const revenue = {};
  const spending = {};
  const excluded = { revenue: 0, spending: 0, reasons: { revenue: {}, spending: {} } };
  const raw = { revenue: 0, spending: 0 };
  const unmapped = [];
  let shared = 0;
  for (const [key, amount] of Object.entries(lines)) {
    if (!amount) continue;
    const section = key.split('|')[1];
    const isRev = section === 'REVENUE';
    raw[isRev ? 'revenue' : 'spending'] += amount;
    let k = mapOscLine(key);
    if (!k) {
      unmapped.push(key);
      k = isRev ? 'otherRevenue' : 'administration';
    }
    if (k.startsWith('exclude:')) {
      excluded[isRev ? 'revenue' : 'spending'] += amount;
      const reason = k.slice(8);
      const bucket = excluded.reasons[isRev ? 'revenue' : 'spending'];
      bucket[reason] = (bucket[reason] || 0) + amount;
    } else if (k === 'shared') {
      shared += amount;
    } else if (isRev) {
      revenue[k] = (revenue[k] || 0) + amount;
    } else {
      spending[k] = (spending[k] || 0) + amount;
    }
  }
  const base = Object.values(spending).reduce((a, b) => a + b, 0);
  if (shared && base) for (const k of Object.keys(spending)) spending[k] += (spending[k] / base) * shared;
  for (const o of [revenue, spending]) for (const k of Object.keys(o)) o[k] = Math.round(o[k]);
  return { revenue, spending, shared: Math.round(shared), excluded, raw, unmapped };
}
