// Maps Census of Governments finance item codes to Town Ledger categories.
// Best-effort mapping of the common codes. Check unusual codes against the Census
// "Government Finance and Employment Classification Manual" before relying on them.

// Expenditure function codes (the two digits after E/F/G = current operations / capital outlay).
const FUNCTION_TO_SPENDING = {
  24: 'publicSafety', // fire protection
  62: 'publicSafety', // police protection
  66: 'publicSafety', // protective inspection & regulation
  44: 'roads', // regular highways
  45: 'roads', // toll highways
  80: 'utilities', // sewerage
  81: 'utilities', // solid waste management
  91: 'utilities', // water supply
  61: 'parks', // parks & recreation
  52: 'parks', // libraries
  32: 'healthServices', // health
  36: 'healthServices', // hospitals
  79: 'healthServices', // public welfare
  23: 'administration', // financial administration
  29: 'administration', // central staff services
  31: 'administration', // general public buildings
  25: 'consultants', // judicial & legal
};

export function mapCensusItem(code) {
  const c = String(code).trim().toUpperCase();
  const letter = c[0];
  const num = Number(c.slice(1));

  // Revenue
  if (c === 'T01') return { group: 'revenue', key: 'propertyTax' };
  if (letter === 'T') return { group: 'revenue', key: 'salesTax' }; // sales, income and other local taxes
  if (letter === 'B') return { group: 'revenue', key: 'federalGrants' }; // federal intergovernmental
  if (letter === 'C' || letter === 'D') return { group: 'revenue', key: 'stateAid' }; // state & local intergovernmental
  if (c === 'A80' || c === 'A81' || c === 'A91' || c === 'A92' || c === 'A93' || c === 'A94') return { group: 'revenue', key: 'utilityCharges' };
  if (letter === 'A') return { group: 'revenue', key: 'feesPermits' };
  if (c === 'U30') return { group: 'revenue', key: 'finesForfeitures' };
  if (letter === 'U') return { group: 'revenue', key: 'otherRevenue' };

  // Spending
  if (letter === 'I') return { group: 'spending', key: 'debtService' }; // interest on debt
  if (['E', 'F', 'G'].includes(letter) && FUNCTION_TO_SPENDING[num]) return { group: 'spending', key: FUNCTION_TO_SPENDING[num] };
  if (['E', 'F', 'G'].includes(letter)) return { group: 'spending', key: 'administration' }; // other general government

  return null; // debt outstanding, cash and other balance-sheet codes are ignored
}
