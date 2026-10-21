// Maps California State Controller Financial Transactions Report lines (cities and counties) to
// TownView categories.
//
// Rows are { category, subcategory_1, subcategory_2, line_description, value } as served by
// bythenumbers.sco.ca.gov. Governmental funds report revenue by source and spending by function;
// enterprise funds (water, sewer, electric, airports, hospitals...) report operating and
// nonoperating revenue and expenses. Internal service funds are left out (their charges are
// already in the departments that pay them), as are depreciation and losses on disposal (not
// cash spent). Enterprise interest is replaced by the enterprise debt payments reported on the
// debt forms (principal and interest), passed in as `enterpriseDebtPayments`.

const ENTERPRISE = /enterprise fund/i;
const PROPERTY_TAX = /property tax|in-lieu of vehicle license|parcel tax|supplemental roll|interest, penalties, and delinquent taxes/i;

// Spending by function: city subcategory_2 / county subcategory_1 names.
function functionKey(name) {
  const s = String(name || '');
  if (/district attorney|public defender|probation|trial court|judicial|court|grand jury/i.test(s)) return 'administration';
  if (/police|fire|emergency medical|paramedic|animal|disaster|detention|correction|protective inspection|protection|public safety|flood control/i.test(s)) return 'publicSafety';
  if (/street lighting|street|highway|storm drain|transit|transportation|parking|airport|public ways|road/i.test(s)) return 'roads';
  if (/solid waste|sewer|sanitation|water|electric|gas|public utilit/i.test(s)) return 'utilities';
  if (/park|recreation|librar|culture|museum|golf|community center|auditorium|leisure|education/i.test(s)) return 'parks';
  if (/health|welfare|social service|public assistance|general relief|veteran|care of court wards|mental|hospital|aid/i.test(s)) return 'healthServices';
  return 'administration';
}

export function expenditureKey(r, kind) {
  const cat = String(r.category || '');
  const sub1 = String(r.subcategory_1 || '');
  const sub2 = String(r.subcategory_2 || '');
  const line = String(r.line_description || '');
  if (/internal service fund/i.test(cat)) return null;
  if (/depreciation|amortization|loss on disposal/i.test(`${sub2} ${line}`)) return null;
  if (ENTERPRISE.test(cat)) {
    if (/interest expense/i.test(`${sub2} ${line}`)) return null;
    // Counties' hospitals pass federal match money through intergovernmental transfers.
    if (/intergovernmental transfers/i.test(`${sub2} ${line}`)) return null;
    if (/hospital/i.test(cat)) return 'healthServices';
    if (/airport|transit|harbor|port/i.test(cat)) return 'roads';
    return 'utilities';
  }
  if (/debt service/i.test(sub1) && /debt service and capital outlay/i.test(cat)) return 'debtService';
  if (/capital outlay/i.test(sub1)) {
    // Cities give capital outlay by function; counties by fund type, so it counts as infrastructure.
    return kind === 'city' ? functionKey(sub2) : 'roads';
  }
  const fn = kind === 'city' ? `${sub1} ${sub2}` : sub1;
  if (/^general government/i.test(cat) && kind === 'county') return 'administration';
  if (kind === 'city' && /general government/i.test(sub1)) return 'administration';
  if (kind === 'city' && /community development/i.test(sub1)) return 'administration';
  if (kind === 'city' && /other expenditures/i.test(sub1)) return 'administration';
  if (kind === 'city' && /public utilities/i.test(sub1)) return 'utilities';
  if (kind === 'city' && /^health$/i.test(sub1)) return /solid waste|sewer/i.test(sub2) ? 'utilities' : 'healthServices';
  if (kind === 'city' && /culture and leisure/i.test(sub1)) return 'parks';
  if (kind === 'city' && /transportation/i.test(sub1)) return 'roads';
  return functionKey(fn);
}

// Returns a revenue key, 'borrowing', or null (left out).
export function revenueKey(r) {
  const cat = String(r.category || '');
  const sub1 = String(r.subcategory_1 || '');
  const line = String(r.line_description || '');
  const text = `${sub1} ${line}`;
  if (/internal service fund|conduit financing/i.test(cat)) return null;
  if (ENTERPRISE.test(cat)) {
    if (/capital contributions|transfers|gain on disposal/i.test(text)) return null;
    if (/nonoperating/i.test(sub1)) {
      if (/intergovernmental – federal|intergovernmental - federal|federal/i.test(line)) return 'federalGrants';
      if (/intergovernmental/i.test(line)) return 'stateAid';
      if (/investment income|rents|leases|concessions|royalties/i.test(line)) return 'localRevenue';
      if (/tax/i.test(line)) return PROPERTY_TAX.test(line) ? 'propertyTax' : 'salesTax';
      return 'otherRevenue';
    }
    if (/water|sewer|electric|gas|solid waste/i.test(cat)) return 'utilityCharges';
    return 'feesPermits';
  }
  if (/^property taxes$/i.test(cat)) return 'propertyTax';
  if (/^taxes$/i.test(cat) || /^taxes [–-] other$/i.test(cat)) {
    return PROPERTY_TAX.test(line) ? 'propertyTax' : 'salesTax';
  }
  if (/special benefit assessments/i.test(cat)) return 'feesPermits';
  if (/licenses|permits|franchises/i.test(cat)) return /franchise/i.test(line) ? 'salesTax' : 'feesPermits';
  if (/fines, forfeitures/i.test(cat) && /fines/i.test(sub1)) return 'finesForfeitures';
  if (/fines, forfeitures/i.test(cat)) return 'localRevenue';
  if (/^fines, forfeitures, and penalties$/i.test(cat)) return 'finesForfeitures';
  if (/^revenue from use of money/i.test(cat)) return 'localRevenue';
  if (/intergovernmental – state|intergovernmental - state/i.test(cat)) return 'stateAid';
  if (/intergovernmental – federal|intergovernmental - federal/i.test(cat) || /federal/i.test(sub1)) {
    if (/other taxes in-lieu/i.test(sub1)) return 'localRevenue';
    if (/county/i.test(sub1)) return 'grants';
    return 'federalGrants';
  }
  if (/intergovernmental – other|intergovernmental - other|in-lieu/i.test(cat)) return 'grants';
  if (/charges for current services/i.test(cat)) return /solid waste|sewer|refuse|water/i.test(line) ? 'utilityCharges' : 'feesPermits';
  if (/miscellaneous/i.test(cat)) return /impact fee/i.test(line) ? 'feesPermits' : 'localRevenue';
  return 'otherRevenue';
}

const LABEL = (r) => String(r.line_description || r.subcategory_2 || r.subcategory_1 || r.category).replace(/_(General|Functional) Revenues$/, '').replace(/_Current Expenditures$/, '')
  .replace(/_[A-Za-z ]+ Enterprise Fund( Fund)?$/, '').replace(/ \(Specify\)/, '').replace(/ 1$/, '');

// Sums one entity-year. Returns { revenue, spending, lines, lineTotals, unmapped }.
export function aggregateSco(revRows, expRows, { kind, enterpriseDebtPayments = 0 }) {
  const revenue = {};
  const spending = {};
  const lines = new Map();
  const add = (group, key, label, amount, cat) => {
    const bucket = group === 'revenue' ? revenue : spending;
    bucket[key] = (bucket[key] || 0) + amount;
    const id = `${group}|${key}|${cat}|${label}`;
    const l = lines.get(id) || lines.set(id, { group, key, label: ENTERPRISE.test(cat) ? `${cat.replace(/ Fund$/, '').replace(/ Fund Fund$/, '')}: ${label}` : label, amount: 0 }).get(id);
    l.amount += amount;
  };
  for (const r of revRows) {
    const key = revenueKey(r);
    if (key) add('revenue', key, LABEL(r), Number(r.value) || 0, String(r.category));
  }
  for (const r of expRows) {
    const key = expenditureKey(r, kind);
    if (key) add('spending', key, LABEL(r), Number(r.value) || 0, String(r.category));
  }
  if (enterpriseDebtPayments > 0) add('spending', 'debtService', 'Enterprise fund debt payments (principal and interest)', enterpriseDebtPayments, '');
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v > 0));
  const out = { revenue: round(revenue), spending: round(spending) };
  // Negative lines (refunds, reversals) stay in the ledger whenever their category is kept,
  // so the ledger adds up to the category totals it itemizes.
  const keptKey = (l) => (l.group === 'revenue' ? out.revenue : out.spending)[l.key] > 0;
  const kept = [...lines.values()].filter((l) => Math.round(l.amount) !== 0 && keptKey(l)).map((l) => ({ ...l, amount: Math.round(l.amount) }));
  out.lines = kept;
  out.lineTotals = {
    revenue: kept.filter((l) => l.group === 'revenue').reduce((s, l) => s + l.amount, 0),
    spending: kept.filter((l) => l.group === 'spending').reduce((s, l) => s + l.amount, 0),
  };
  return out;
}
