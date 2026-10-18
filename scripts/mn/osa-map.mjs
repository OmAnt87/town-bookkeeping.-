// Maps a Minnesota government's financial reporting form, as compiled by the Office of the State
// Auditor (one row of governmental funds, one row per enterprise fund and one row of debt), to
// Town Ledger categories.
//
// Governmental funds are reported by revenue source and by function, current spending and capital
// outlay alike. Enterprise funds (water, sewer, electric, liquor stores, ambulances and so on) are
// reported as operating revenue and expenses plus capital outlay and debt payments: depreciation
// is left out and capital outlay counted when paid, so they are on the same footing as
// governmental funds. Borrowing, transfers between funds and refunded principal are left out.
// Housing, economic development and conservation, like general government, count as overhead.

// Column names differ slightly between workbooks ("Interest Earnings", "InterestEarned"), so they
// are matched on letters and digits only.
const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const num = (v) => Number(v) || 0;

const REVENUE = [
  [/^propertytaxes$/, 'propertyTax', 'Property taxes'],
  [/^taxincrements$/, 'propertyTax', 'Tax increments (TIF districts)'],
  [/^franchisefees$/, 'salesTax', 'Franchise fees'],
  [/^salestax$/, 'salesTax', 'Local sales tax'],
  [/^hotelmoteltax$/, 'salesTax', 'Lodging tax'],
  [/^gamblingtax$/, 'salesTax', 'Gambling tax'],
  [/^graveltax$/, 'salesTax', 'Gravel tax'],
  [/^wheelagetax$/, 'salesTax', 'Wheelage tax'],
  [/^specialassessments$/, 'feesPermits', 'Special assessments'],
  [/^licensesandpermits$/, 'feesPermits', 'Licenses and permits'],
  [/^totalfederalgrants$/, 'federalGrants', 'Federal grants'],
  [/^statelocalgovernmentaid$/, 'stateAid', 'Local Government Aid'],
  [/^statecountyprogramaid$/, 'stateAid', 'County Program Aid'],
  [/^statetownaid$/, 'stateAid', 'Town aid'],
  [/^statetransportationgrants$|^statehighwaygrants$/, 'stateAid', 'State transportation grants'],
  [/^statehumanservicegrants$/, 'stateAid', 'State human services grants'],
  [/^statepoliceaid$/, 'stateAid', 'State police aid'],
  [/^countyhighwaygrants$/, 'grants', 'Highway grants from the county'],
  [/^allothercountygrants$/, 'grants', 'Other grants from the county'],
  [/^localirrrbgrants$|^allotherlocalgrants$/, 'grants', 'Grants from other local governments'],
  [/^totalchargesforservices$/, 'feesPermits', 'Charges for services'],
  [/^finesandforfeits$|^adminfines$/, 'finesForfeitures', 'Fines and forfeits'],
  [/^interestearn/, 'localRevenue', 'Interest'],
  [/^allotherrevenue$/, 'localRevenue', 'Other revenue'],
];
// State aid other than the itemized programs above: property tax credits, PERA aid and other grants.
const STATE_TOTAL = 'totalstategrants';
const STATE_ITEMIZED = /^state(localgovernmentaid|countyprogramaid|townaid|transportationgrants|highwaygrants|humanservicegrants|policeaid)$/;

const SPENDING = [
  [/^(governingboard|administrationandfinance|allothergeneralgovernment)currentexpend$|^generalgovernmentcapitaloutlay$/, 'administration', 'General government'],
  [/^policesheriff/, 'publicSafety', 'Police and sheriff'],
  [/^corrections/, 'publicSafety', 'Corrections'],
  [/^ambulance/, 'publicSafety', 'Ambulance'],
  [/^fire(currentexpend|capitaloutlay)$/, 'publicSafety', 'Fire'],
  [/^allotherpublicsafety/, 'publicSafety', 'Other public safety'],
  [/^streethighway|^snowandiceremoval$|^streetlighting$|^allotherstreethighwaycapitaloutlay$/, 'roads', 'Streets and highways'],
  [/^airport/, 'roads', 'Airport'],
  [/^transit/, 'roads', 'Transit'],
  [/^refusecollection|^allothersanitation|^sanitationcapitaloutlay$/, 'utilities', 'Sanitation'],
  [/^tnwaterc[eo]$|^capitaloutlayforenterprisefunds$/, 'utilities', 'Water and other utilities'],
  [/^humanservice|^allotherhumanservices/, 'healthServices', 'Human services'],
  [/^health(currentexpend|capitaloutlay)$/, 'healthServices', 'Health'],
  [/^library/, 'parks', 'Libraries'],
  [/^parkrecreation/, 'parks', 'Parks and recreation'],
  [/^cemetery/, 'parks', 'Cemeteries'],
  [/^education/, 'education', 'Education'],
  [/^housingurbanredevelopment/, 'administration', 'Housing and redevelopment'],
  [/^(economic|ecenomic)development/, 'administration', 'Economic development'],
  [/^conservationofnaturalresources/, 'administration', 'Conservation of natural resources'],
  [/^unallocated(pension|insurance)costs$/, 'administration', 'Pension and insurance costs not allocated to a function'],
  [/^allother(currentexpend|capitaloutlay)$/, 'otherSpending', 'All other spending'],
  [/^bondprincipalpayments$|^otherlongtermdebtprincipalpayments$/, 'debtService', 'Debt service: principal'],
  [/^interestpaymentsfiscalcharges$/, 'debtService', 'Debt service: interest and fiscal charges'],
];
// "All other" spending without a function counts as overhead unless it is a large share.
export const UNCLASSIFIED_SHARE = 0.15;

// Enterprise funds by the Auditor's category, or by name for "Other" and health funds.
function enterpriseKeys(category, name) {
  const n = String(name || '');
  if (/ambulance|\bems\b|rescue/i.test(n)) return ['feesPermits', 'publicSafety'];
  if (/airport|transit|parking/i.test(n)) return ['feesPermits', 'roads'];
  if (/golf|arena|pool|aquatic|park|recreation|ice|campground|marina|cemetery|community center|civic center/i.test(n)) return ['feesPermits', 'parks'];
  switch (category) {
    case 'Health': return ['feesPermits', 'healthServices'];
    case 'Culture & Recreation': return ['feesPermits', 'parks'];
    case 'Economic Development': return ['feesPermits', 'administration'];
    case 'Street & Highways': return /storm|drain|water|sewer/i.test(n) ? ['utilityCharges', 'utilities'] : ['utilityCharges', 'roads'];
    default: return ['utilityCharges', 'utilities']; // Electric, Gas, Water, Sewer, Sanitation, Broadband, Liquor Store, Other
  }
}

const sum = (o) => Object.values(o).reduce((a, v) => a + v, 0);

// gov: the governmental funds row; enterprises: enterprise fund rows; debtRow: the debt row.
export function aggregateOsa(gov, enterprises = [], debtRow = null) {
  const g = Object.fromEntries(Object.entries(gov || {}).map(([k, v]) => [norm(k), v]));
  // Revenue columns come before the revenue total, spending columns between the "revenues and
  // other sources" total and the spending total (fee and spending columns share names).
  const cols = Object.keys(g);
  const at = (c) => cols.indexOf(c);
  const revCols = cols.slice(0, at('totalrevenues'));
  const spendCols = cols.slice(at('totalrevenuesothersources') + 1, at('totalexpenditures'));
  const revenue = {};
  const spending = {};
  const lines = new Map(); // 'group|key|label' -> amount
  const add = (group, key, label, amount) => {
    amount = Math.round(amount);
    if (!amount) return;
    const target = group === 'revenue' ? revenue : spending;
    target[key] = (target[key] || 0) + amount;
    const id = `${group}|${key}|${label}`;
    lines.set(id, (lines.get(id) || 0) + amount);
  };

  let revMapped = 0;
  for (const col of revCols) {
    const v = g[col];
    const rule = REVENUE.find(([re]) => re.test(col));
    if (rule) { add('revenue', rule[1], rule[2], num(v)); revMapped += num(v); }
  }
  const stateOther = num(g[STATE_TOTAL]) - Object.entries(g).filter(([c]) => STATE_ITEMIZED.test(c)).reduce((s, [, v]) => s + num(v), 0);
  add('revenue', 'stateAid', 'Other state aid, property tax credits and grants', stateOther);
  revMapped += stateOther;
  // Whatever the itemized sources miss of the reported total.
  const revRest = num(g.totalrevenues) - revMapped;
  if (Math.abs(revRest) > 1) add('revenue', 'localRevenue', 'Other revenue (not itemized)', revRest);

  let spendMapped = 0;
  for (const col of spendCols) {
    const v = g[col];
    const rule = SPENDING.find(([re]) => re.test(col));
    if (rule) { add('spending', rule[1], rule[2], num(v)); spendMapped += num(v); }
  }
  const spendRest = num(g.totalexpenditures) - spendMapped;
  if (Math.abs(spendRest) > 1) add('spending', 'otherSpending', 'Other spending (not itemized)', spendRest);

  // Enterprise funds.
  let refinanced = 0;
  let enterpriseLeftOut = 0;
  for (const e of enterprises) {
    const name = e['Name of Enterprise'];
    const [revKey, spendKey] = enterpriseKeys(e['Enterprise Category'], name);
    const label = `${name} (${String(e['Enterprise Category'] || 'enterprise').toLowerCase()} fund)`;
    add('revenue', revKey, `${label}: operating revenue`, num(e['Operating Revenue']));
    const taxes = num(e.Taxes);
    const fed = num(e.FederalGrants);
    const state = num(e.StateGrants);
    const local = num(e['Count/Local Grants']);
    add('revenue', 'propertyTax', `${label}: property taxes`, taxes);
    add('revenue', 'federalGrants', `${label}: federal grants`, fed);
    add('revenue', 'stateAid', `${label}: state grants`, state);
    add('revenue', 'grants', `${label}: local grants`, local);
    add('revenue', 'localRevenue', `${label}: interest and other nonoperating revenue`, Math.max(0, num(e['Nonoperating Revenue']) - taxes - fed - state - local));
    const cash = num(e['Cost of Sales']) + num(e['Operating Expenses']) - num(e.Depreciation) + num(e.TotalCapOutlay);
    add('spending', spendKey, `${label}: operating expenses and capital outlay (less depreciation)`, Math.max(0, cash));
    const interest = num(e.InterestPaid);
    const principal = num(e.BondsPaid) + num(e['Principal Payments - Other Long-term Debt']);
    // Principal repaid with new borrowing not spent on capital that year is refinancing.
    const refi = Math.min(principal, Math.max(0, num(e.Borrowing) - num(e.TotalCapOutlay)));
    refinanced += refi;
    add('spending', 'debtService', 'Debt service: principal', principal - refi);
    add('spending', 'debtService', 'Debt service: interest and fiscal charges', interest);
    enterpriseLeftOut += Math.max(0, num(e['Nonoperating Expenses']) - interest);
  }

  // Unclassified spending that is a small share counts as overhead.
  if (spending.otherSpending && spending.otherSpending <= UNCLASSIFIED_SHARE * sum(spending)) {
    spending.administration = (spending.administration || 0) + spending.otherSpending;
    delete spending.otherSpending;
    for (const [id, amount] of [...lines]) {
      if (!id.startsWith('spending|otherSpending|')) continue;
      lines.delete(id);
      const moved = `spending|administration|${id.split('|')[2]}`;
      lines.set(moved, (lines.get(moved) || 0) + amount);
    }
  }
  for (const o of [revenue, spending]) for (const k of Object.keys(o)) if (!o[k]) delete o[k];

  const d = Object.fromEntries(Object.entries(debtRow || {}).map(([k, v]) => [norm(k), v]));
  const bonds = ['genobligation', 'genobtaxincr', 'revenuetaxincr', 'specassessment', 'genobrevenue', 'revenue', 'other'].reduce((s, k) => s + num(d[k]), 0);
  const olt = num(d.oltbegin) + num(d.oltadjustment) + num(d.oltissued) - num(d.oltpaid);
  const shortTerm = num(d.shorttermbegin) + num(d.shorttermissued) - num(d.shorttermpaid);
  const lineList = [...lines].map(([id, amount]) => { const [group, key, label] = id.split('|'); return { group, key, label, amount }; }).filter((l) => l.amount);
  return {
    revenue,
    spending,
    lines: lineList,
    debt: Math.round(bonds + Math.max(0, olt) + Math.max(0, shortTerm)),
    refinanced: Math.round(refinanced),
    leftOut: {
      borrowing: Math.round(num(g.bondsissued) + num(g.otherlongtermdebtissued) + num(g.shorttermdebtissued) + num(g.otherfinancingsources)),
      refunded: Math.round(num(g.principalpaymentsrefundedbonds)),
      enterprise: Math.round(enterpriseLeftOut),
    },
    empty: !sum(revenue) || !sum(spending),
    // More than four times apart means an entry error or a part left out.
    inconsistent: sum(revenue) > 4 * sum(spending) || sum(spending) > 4 * sum(revenue),
  };
}
