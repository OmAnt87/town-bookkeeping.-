// Maps an Indiana government's Annual Financial Report (Gateway: detailed receipts and
// disbursements by fund, on the state's uniform chart of accounts) to TownView categories.
//
// Left out:
//   - custodial funds: money a unit holds for others or passes through, such as the county's
//     tax settlement and local income tax distribution funds (fund codes 100, 105, 106, 107),
//     payroll and clearing accounts, escrow, trusts and deposits; and internal service funds
//     (self-insurance and employee benefit funds), whose premiums the departments already paid
//   - receipts that are not revenue: sale of investments (R901), borrowing (R903, R904), refunds
//     and reimbursements (R906), benefit plan contributions and payroll receipts (R907, R909),
//     transfers and interfund loans (R910-R912), and "other receipts" (R913) that are transfers,
//     bond proceeds or settlements
//   - disbursements that are not spending: payroll withholdings paid over (D702), distributions to
//     other governments (D703, reported by the government receiving them), transfers and interfund
//     loans (D704-D706) and purchases of investments (D900)
//   - refinancing: "other disbursements" and principal repaid from debt and note funds, up to what
//     the unit borrowed during the year outside its construction and project funds (notes and
//     bonds paid off with new borrowing, often moved between funds first). Construction paid
//     for with borrowing stays in, as in the Census figures.
//
// Spending has no function code in Indiana's chart of accounts, so it is assigned from the
// department (where the fund reports by department) or the fund name: a police department or
// fire fund is public safety, a motor vehicle highway fund roads, a sewage utility fund
// utilities. Debt payments (D401-D404) are debt service, utility operating accounts (D601-D620)
// utilities and township assistance (D801-D810) health and human services. A city, town or
// county general fund (fund code 101) reported without departments cannot be split: where that is
// more than UNSPLIT_SHARE of all spending it is "other spending (not broken down)" and the unit is
// not scored on services or overhead; a smaller remainder (insurance, undistributed costs) counts
// as general government, as does a township's general fund (the trustee's office).

const num = (v) => Number(v) || 0;

const CUSTODIAL_CODES = new Set(['100', '105', '106', '107']);
const CUSTODIAL_NAME = /payroll|clearing|settlement|stlmnt|direct dep|withhold|w\/h|escrow|\btrust\b|deposit|suspense|overpayment|distribut|certified share|fica|\bbail\b|collections|undistributed|tax sale surplus|agency|custod|held for|pass.?thr(u|ough)/i;
const INTERNAL_SERVICE = /self.?insur|self.?fund|health (insurance|benefit|plan|care trust)|employee benefit|benefit (fund|plan|self)|group (health|insurance)|hospitalization|workers.? comp|deferred comp|internal service/i;
export function custodial(fundCode, fundName) {
  return CUSTODIAL_CODES.has(String(fundCode).slice(0, 3)) || CUSTODIAL_NAME.test(fundName || '') || INTERNAL_SERVICE.test(fundName || '');
}

const RECEIPT_EXCLUDED = new Set(['R901', 'R903', 'R904', 'R906', 'R907', 'R909', 'R910', 'R911', 'R912']);
const OTHER_NOT_REVENUE = /transfer|intftrans|\btrans\b|settle|distribut|adjust|clearing|payroll|reimburs|refund|loan|proceed|prem|bond|\bsold\b|interfund|withhold|deposit|escrow/i;
const OTHER_BORROWING = /prem|bond|proceed|\bsold\b/i;

// Receipt code -> [key, label] or null (not revenue).
export function receiptKey(code) {
  const n = Number(String(code).slice(1));
  if (code === 'R101' || code === 'R119' || code === 'R123') return ['propertyTax', 'Property taxes (including payments in lieu of taxes and the local income tax property tax credit)'];
  if (['R105', 'R106', 'R107', 'R108', 'R137'].includes(code) || (n >= 138 && n <= 142)) return ['salesTax', 'Local income, food and beverage, innkeeper, wheel and other local taxes'];
  if ((n >= 109 && n <= 128) || code === 'R135' || code === 'R136') return ['stateAid', 'State-shared taxes and distributions (motor vehicle highway, excise, casino, cigarette and others)'];
  if ((n >= 129 && n <= 134) || code === 'R914') return ['grants', 'Federal, state and private grants'];
  if (n >= 200 && n < 300) return ['feesPermits', 'Licenses and permits'];
  if (['R416', 'R419', 'R420', 'R421', 'R422'].includes(code) || (n >= 800 && n < 900)) return ['utilityCharges', 'Utility, sewage, storm water and garbage charges'];
  if (n >= 400 && n < 500) return ['feesPermits', 'Charges for services'];
  if (n >= 500 && n < 600) return ['finesForfeitures', 'Court costs, fines and forfeitures'];
  if (['R902', 'R905', 'R908', 'R913'].includes(code)) return ['localRevenue', 'Interest, asset sales, donations and other receipts'];
  return null;
}

const DISBURSE_EXCLUDED = new Set(['D702', 'D703', 'D704', 'D705', 'D706', 'D900']);
const FUNCTIONS = [
  [/sew|water|wastewater|electric|gas util|storm|sanitat|garbage|trash|solid waste|landfill|recycl|utilit|light|power/i, 'utilities'],
  [/police|\bimpd\b|\bifd\b|law enforcement|marshal|sheriff|jail|correction|probation|fire|\bems\b|ambulance|emergency|911|dispatch|public safety|detention|juvenile|coroner|homeland|animal control/i, 'publicSafety'],
  [/highway|street|road|bridge|\bmvh\b|motor vehicle|crossing|wheel tax|transport|airport|engineer|traffic|sidewalk|lr ?& ?b|\blrs\b|curb|\bdpw\b|public works/i, 'roads'],
  [/park|\bdpr\b|recreation|pool|golf|library|aquatic|trail|cemetery|museum|\bzoo\b|\barts?\b|cultur|coliseum|fairground/i, 'parks'],
  [/health|township assistance|poor relief|welfare|hospital|medical|mental|senior|aging|veteran/i, 'healthServices'],
];
export const UNSPLIT_SHARE = 0.15;

const PROJECT_FUND = /const|project|improvement|capital/i;
const DEBT_FUND = /bond|debt|\bb ?& ?i\b|sinking|lease rental|lease p(a)?y|\bban\b|bond anticipation/i;
export const KEY_LABEL = { publicSafety: 'Public safety', roads: 'Roads and transportation', utilities: 'Utilities', parks: 'Parks, libraries and recreation', healthServices: 'Health and human services', administration: 'General government', debtService: 'Debt service' };

// Function from a department or fund name; 'administration' when nothing matches.
export function functionKey(...names) {
  for (const n of names) for (const [re, k] of FUNCTIONS) if (n && re.test(n)) return k;
  return 'administration';
}

// One government-year. receipts and disbursements are Gateway rows (fund_name, Fund_code,
// Receipt_Code / disburse_code, amount, ...); deptRows are the same fund's disbursements by
// department, used in place of the by-fund rows for funds that report departments.
export function aggregateGateway(receipts, disbursements, deptRows = [], { township = false } = {}) {
  const revenue = {};
  const spending = {};
  const lines = new Map();
  const add = (group, key, label, amount) => {
    if (!amount) return;
    const target = group === 'revenue' ? revenue : spending;
    target[key] = (target[key] || 0) + amount;
    const k = `${group}|${key}|${label}`;
    lines.set(k, (lines.get(k) || 0) + amount);
  };
  // Fund code plus local fund number: the two disbursement files spell fund names differently.
  const fundKey = (r) => `${r.Fund_code}|${r.unit_fund_number ?? r.fund_name}`;
  let custodialReceipts = 0;
  let borrowing = 0;
  let refinancing = 0; // borrowing outside construction and project funds
  for (const r of receipts) {
    const amount = num(r.amount);
    if (custodial(r.Fund_code, r.fund_name)) { custodialReceipts += amount; continue; }
    const code = r.Receipt_Code;
    const name = `${r.receipt_name || ''} ${r.Unit_account_name || ''}`;
    const borrows = code === 'R903' || code === 'R904' || (code === 'R913' && OTHER_BORROWING.test(name));
    if (borrows) { borrowing += amount; if (!PROJECT_FUND.test(r.fund_name || '')) refinancing += amount; continue; }
    if (RECEIPT_EXCLUDED.has(code) || (code === 'R913' && OTHER_NOT_REVENUE.test(name))) continue;
    const m = receiptKey(code);
    if (m) add('revenue', m[0], m[1], amount);
  }

  // Funds that report by department use those rows (same disbursements, split by department).
  const deptFunds = new Set(deptRows.map(fundKey));
  const rows = [...disbursements.filter((r) => !deptFunds.has(fundKey(r))), ...deptRows];
  let intergovernmental = 0;
  let custodialDisbursements = 0;
  const byFund = new Map();
  for (const r of rows) {
    if (custodial(r.Fund_code, r.fund_name)) { custodialDisbursements += num(r.amount); continue; }
    if (r.disburse_code === 'D703') intergovernmental += num(r.amount);
    if (DISBURSE_EXCLUDED.has(r.disburse_code)) continue;
    const f = fundKey(r);
    (byFund.get(f) || byFund.set(f, []).get(f)).push(r);
  }
  let refinanced = 0;
  let left = refinancing;
  for (const [, rs] of byFund) {
    for (const r of rs) {
      let amount = num(r.amount);
      const code = r.disburse_code;
      const fund = r.fund_name || 'Unnamed fund';
      const debtFund = DEBT_FUND.test(fund) && !PROJECT_FUND.test(fund);
      // Notes and bonds paid off with new borrowing are refinancing.
      if (debtFund && left > 0 && (code === 'D707' || code === 'D401' || code === 'D403')) {
        const t = Math.min(left, amount);
        left -= t;
        refinanced += t;
        amount -= t;
      }
      if (!amount) continue;
      const dept = r.department_name && !/^no department$/i.test(r.department_name) ? r.department_name : null;
      if (/^D40[1-4]$/.test(code)) { add('spending', 'debtService', `Debt service: ${/^D40[13]$/.test(code) ? 'principal' : 'interest'}`, amount); continue; }
      if (/^D6/.test(code)) { add('spending', 'utilities', `Utility operations (${fund})`, amount); continue; }
      if (/^D8/.test(code)) { add('spending', 'healthServices', 'Township assistance', amount); continue; }
      if (code === 'D707' && debtFund) { add('spending', 'debtService', `Debt service (${fund})`, amount); continue; }
      const key = functionKey(dept, fund.replace(DEBT_FUND, ''));
      if (key === 'administration' && !dept && !township && String(r.Fund_code).startsWith('101')) { add('spending', 'otherSpending', `${fund} (not broken down by department)`, amount); continue; }
      add('spending', key, dept ? `${dept} (${fund})` : fund, amount);
    }
  }
  const sum = (o) => Object.values(o).reduce((a, v) => a + v, 0);
  if (spending.otherSpending && spending.otherSpending <= UNSPLIT_SHARE * sum(spending)) {
    spending.administration = (spending.administration || 0) + spending.otherSpending;
    delete spending.otherSpending;
    for (const [k, amount] of [...lines]) {
      if (!k.startsWith('spending|otherSpending|')) continue;
      lines.delete(k);
      const nk = `spending|administration|${k.split('|')[2].replace(' (not broken down by department)', ' (no department)')}`;
      lines.set(nk, (lines.get(nk) || 0) + amount);
    }
  }
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v));
  const r = round(revenue);
  const s = round(spending);
  return {
    revenue: r,
    spending: s,
    lines: [...lines].map(([k, amount]) => { const [group, key, label] = k.split('|'); return { group, key, label, amount: Math.round(amount) }; }).filter((l) => l.amount),
    borrowing: Math.round(borrowing),
    refinanced: Math.round(refinanced),
    intergovernmental: Math.round(intergovernmental),
    custodial: { receipts: Math.round(custodialReceipts), disbursements: Math.round(custodialDisbursements) },
    empty: !sum(r) || !sum(s),
    // More than four times apart means an entry error or a part left out.
    inconsistent: sum(r) > 4 * sum(s) || sum(s) > 4 * sum(r),
  };
}

// Debt rows -> principal outstanding at year end (custodial funds aside).
export function debtOutstanding(rows) {
  return Math.round(rows.reduce((a, r) => a + num(r.end_principal_bal), 0));
}
