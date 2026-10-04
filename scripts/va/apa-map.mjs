// Maps the Virginia Auditor of Public Accounts Comparative Report to Town Ledger categories.
//
// Revenue (Exhibits B, B1, D, E, F): general government local revenue, aid from the
// Commonwealth and the federal government, capital project grants and income, and enterprise
// (utility) revenue. Borrowing, transfers between a locality's own funds and non-revenue
// receipts are left out.
//
// Spending (Exhibits C, C4, D, E, F): maintenance and operations by function, capital projects,
// debt service (principal and interest) and enterprise operations. Judicial administration
// (courts, the Commonwealth's attorney, clerks) and community development count as overhead,
// as with community and economic development in New York, Pennsylvania and Maryland. Non-
// departmental spending and capital projects other than schools and roads are spread across
// departments by size, except debt service. Depreciation is not spending and is left out.

const num = (v) => Number(v) || 0;
const pick = (ex, re) => Object.entries(ex || {}).filter(([k]) => re.test(k)).reduce((a, [, v]) => a + num(v), 0);

export const VA_REVENUE = [
  ['propertyTax', 'General property taxes (real estate, personal property, machinery and tools, penalties and interest)', 'B', /^(Real Property|Public Service Corporations|Personal Property - (General|Mobile Home)|Machinery and Tools|Merchants' Capital|Penalties|Interest)$/],
  ['salesTax', 'Other local taxes (sales, utility, business license, meals, lodging and others)', 'B', /^Other Local Taxes/],
  ['feesPermits', 'Permits, privilege fees and regulatory licenses', 'B', /^Permits/],
  ['finesForfeitures', 'Fines and forfeitures', 'B', /^Fines/],
  ['feesPermits', 'Charges for services', 'B', /^Charges for Services/],
  ['localRevenue', 'Use of money and property (interest, rents, sale of property)', 'B', /^(Interest \(\d+\)|Rental and Sale of Property)$/],
  ['localRevenue', 'Miscellaneous revenue', 'B', /^Miscellaneous/],
  ['stateAid', 'Aid from the Commonwealth (non-categorical, shared expenses, categorical, PILOT)', 'B1', /^(Payments in Lieu of Taxes|Non- Categorical State Aid|Shared Expenses|Categorical State Aid)$/],
  ['federalGrants', 'Federal aid (non-categorical, categorical, PILOT)', 'B1', /^(Payments in Lieu of Taxes \(\d+\)|Non- Categorical Federal Aid|Categorical Federal Aid)$/],
  ['stateAid', 'Capital projects: State grants', 'D', /^State Grants$/],
  ['federalGrants', 'Capital projects: federal grants', 'D', /^Federal Grants$/],
  ['localRevenue', 'Capital projects: interest income and sale of property', 'D', /^(Interest Income|Sale of Property)$/],
  ['grants', 'Capital projects and debt service: payments from other governments', 'D', /^Payments From Other Governments$/],
  ['otherRevenue', 'Capital projects: other sources', 'D', /^Other Sources$/],
  ['grants', 'Debt service: payments from other governments', 'E', /^Payments From Other Governments$/],
  ['otherRevenue', 'Debt service: direct sources', 'E', /^Direct Sources$/],
  ['utilityCharges', 'Enterprise activities: user charges', 'F', /^User Charges$/],
  ['grants', 'Enterprise activities: from other local governments', 'F', /^From Other Local Governments$/],
  ['stateAid', 'Enterprise activities: from the Commonwealth', 'F', /^From the Commonwealth$/],
  ['federalGrants', 'Enterprise activities: from the federal government', 'F', /^From the Federal Government$/],
  ['localRevenue', 'Enterprise activities: miscellaneous revenue', 'F', /^Miscellaneous Revenue$/],
];

export const VA_SPENDING = [
  ['administration', 'General government administration', 'C', /^General Government Administration/],
  ['administration', 'Judicial administration (courts, Commonwealth\'s attorney, clerks)', 'C', /^Judicial Administration/],
  ['publicSafety', 'Public safety (police, sheriff, fire and rescue, corrections, inspections)', 'C', /^Public Safety/],
  ['roads', 'Public works: highways, streets, bridges and sidewalks', 'C4', /^Maintenance of Highways/],
  ['utilities', 'Public works: sanitation and waste removal', 'C4', /^Sanitation and Waste Removal/],
  ['administration', 'Public works: general buildings and grounds', 'C4', /^Maintenance of General Buildings/],
  ['healthServices', 'Health and human services', 'C', /^Health and Human Services/],
  ['education', 'Education (school division operations and community college contributions)', 'C', /^Education/],
  ['parks', 'Parks, recreation, culture and libraries', 'C', /^Parks, Recreation/],
  ['administration', 'Community development (planning, environmental management, extension)', 'C', /^Community Development/],
  ['shared', 'Non-departmental', 'C', /^Non- ?Departmental/],
  ['education', 'Capital projects: schools', 'D', /^Education$/],
  ['roads', 'Capital projects: streets, roads and bridges', 'D', /^Streets, Roads, and Bridges$/],
  ['shared', 'Capital projects: other general government', 'D', /^Other General Government$/],
  ['shared', 'Capital projects: payments to other governments', 'D', /^Payments to Other Governments$/],
  ['debtService', 'Debt service: principal', 'E', /^Redemption of Debt (Education|Streets|Other)/],
  ['debtService', 'Debt service: interest', 'E', /^Debt Interest Costs (Education|Streets|Other)/],
  ['shared', 'Debt service: payments to other governments and other', 'E', /^(Payments to Other Governments|Other)$/],
  ['utilities', 'Enterprise activities: payments to other local governments and authorities', 'F', /^(General Operating and Interest|Capital)( \(\d+\))?$/],
  ['utilities', 'Enterprise activities: operating, interest and other expenses (depreciation left out)', 'F', /^(General Operating Expenses|Debt Interest Expenses|Other Expenses)$/],
];

// Public works in Exhibit C is replaced by its Exhibit C4 activities when they add up to it.
const PUBLIC_WORKS = /^Public Works/;

// ent: one locality-year { A: {...}, B: {...}, ... } from apa-to-json.py.
export function aggregateVa(ent) {
  const revenue = {};
  const spending = {};
  const lines = [];
  let shared = 0;
  const add = (o, k, v) => { if (v) o[k] = (o[k] || 0) + v; };
  for (const [key, label, ex, re] of VA_REVENUE) {
    const v = pick(ent[ex], re);
    if (!v) continue;
    add(revenue, key, v);
    lines.push({ flow: 'in', key, label, amount: v, exhibit: ex });
  }
  const pw = pick(ent.C, PUBLIC_WORKS);
  const pwParts = pick(ent.C4, /^(Maintenance of Highways|Sanitation and Waste Removal|Maintenance of General Buildings)/);
  const useC4 = pwParts && Math.abs(pwParts - pw) <= 2;
  for (const [key, label, ex, re] of VA_SPENDING) {
    if (ex === 'C4' && !useC4) continue;
    const v = pick(ent[ex], re);
    if (!v) continue;
    if (key === 'shared') shared += v;
    else add(spending, key, v);
    lines.push({ flow: 'out', key, label, amount: v, exhibit: ex });
  }
  if (!useC4 && pw) { add(spending, 'roads', pw); lines.push({ flow: 'out', key: 'roads', label: 'Public works', amount: pw, exhibit: 'C' }); }
  const keys = Object.keys(spending).filter((k) => k !== 'debtService');
  const base = keys.reduce((a, k) => a + spending[k], 0);
  if (shared && base) for (const k of keys) spending[k] += shared * (spending[k] / base);
  else if (shared) add(spending, 'administration', shared);

  const A = ent.A || {};
  const B = (re) => pick(ent.B, re);
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v));
  const generalRevenue = VA_REVENUE.filter(([, , ex]) => ex === 'B').reduce((a, [, , , re]) => a + B(re), 0);
  const operations = pick(ent.C, /^(General Government|Judicial|Public Safety|Public Works|Health and Human|Education|Parks|Community Development|Non- ?Departmental)/);
  return {
    revenue: round(revenue),
    spending: round(spending),
    shared: Math.round(shared),
    lines,
    // Reconciliation against Exhibit A, which the Auditor totals separately.
    check: {
      localRevenue: [Math.round(generalRevenue), num(A['Local Revenue'])],
      operations: [Math.round(operations), num(A['Maintenance and Operation Expenditures'])],
    },
    excluded: {
      debtProceeds: Math.round(pick(ent.D, /^\s*Debt Proceeds$/)),
      nonRevenue: Math.round(num(A['Non-Revenue Receipts'])),
      depreciation: Math.round(pick(ent.F, /^Depreciation$/)),
    },
    debt: Math.round(pick(ent.G, /^(Bonds and Bond Issue Anticipation Loans|Literary Fund Loans|Other Long-Term Obligations|Temporary Loans)$/)),
    reported: num(A['Local Revenue']) > 0,
  };
}
