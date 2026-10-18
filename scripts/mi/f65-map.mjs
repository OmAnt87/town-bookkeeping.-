// Maps a Michigan local unit's F-65 Annual Local Unit Fiscal Report (expenditure and revenue lines
// by fund, as published by the Department of Treasury) to Town Ledger categories.
//
// The general fund, other governmental funds, enterprise funds and component units (county road
// commissions, downtown development and brownfield authorities and the like, which the unit
// appoints and funds) are counted. Internal service funds are left out: the departments they serve
// report that spending. Spending is by the F-65 function account; capital outlay has no
// function, so enterprise-fund capital counts as utilities and the rest is spread over the
// unit's other spending in proportion. Depreciation, transfers, extraordinary items, bond and note
// proceeds and sales of capital assets are left out. Courts, community and economic development,
// and redevelopment and public housing count as overhead, like general government.
//
// Debt service (906-929) is counted as reported. The F-65 shows refunding bonds as borrowing but not
// the escrow payments they fund, so no refinancing adjustment is made.

export const COUNTED_FUNDS = new Set(['General Fund', 'All Other Governmental Funds', 'Enterprise Funds', 'Component Units']);
export const UNCLASSIFIED_SHARE = 0.15;

const first = (account) => Number(String(account).match(/\d{3}/)?.[0]);

// Expenditure account (first function code) -> [key, label], 'capital' or null.
export function spendingKey(account) {
  const a = first(account);
  if (a >= 901 && a <= 904) return 'capital';
  if (a >= 906 && a <= 929) return ['debtService', 'Debt service'];
  if (a === 968 || a === 995 || a >= 998) return null; // depreciation, transfers, extraordinary items
  if (a === 955) return ['otherSpending', 'Miscellaneous'];
  if (a >= 100 && a <= 279) return ['administration', 'General government'];
  if (a >= 280 && a <= 299) return ['administration', 'Courts and prosecutor'];
  if (a >= 300 && a <= 439) return ['publicSafety', a >= 336 && a <= 345 ? 'Fire' : a >= 351 && a <= 370 ? 'Corrections and jail' : a <= 332 ? 'Police and sheriff' : 'Other public safety'];
  if (a === 595 || a === 596) return ['roads', a === 595 ? 'Airports' : 'Public transportation'];
  if (a >= 521 && a <= 594 || a === 597) return ['utilities', 'Water, sewer, sanitation and other public works enterprises'];
  if (a >= 440 && a <= 599) return ['roads', 'Roads, streets and public works'];
  if (a === 651) return ['publicSafety', 'Ambulance'];
  if (a >= 690 && a <= 699) return ['administration', 'Redevelopment and public housing'];
  if (a >= 600 && a <= 699) return ['healthServices', a === 635 ? 'Hospital' : 'Health, mental health and human services'];
  if (a >= 700 && a <= 749) return ['administration', 'Community and economic development'];
  if (a >= 750 && a <= 849) return ['parks', a === 790 || a === 791 ? 'Libraries' : 'Parks, recreation and culture'];
  return ['otherSpending', 'Other'];
}

// Revenue account and fund -> [key, label] or null.
export function revenueKey(account, fund) {
  const a = first(account);
  if (a >= 696 && a <= 699) return null; // bond and note proceeds, transfers in
  if (a === 673) return null; // sale of capital assets
  if (a === 435) return ['salesTax', 'Lodging tax'];
  if (a === 438) return ['salesTax', 'Income tax'];
  if (a >= 401 && a <= 449) return ['propertyTax', a === 432 ? 'Payments in lieu of taxes' : 'Property and specific taxes'];
  if (a >= 450 && a <= 474) return ['feesPermits', 'Special assessments'];
  if (a >= 476 && a <= 500) return ['feesPermits', 'Licenses and permits'];
  if (a >= 501 && a <= 538) return ['federalGrants', 'Federal grants'];
  if (a === 574) return ['stateAid', 'State revenue sharing'];
  if (a === 546) return ['stateAid', 'State road funds (Act 51)'];
  if (a >= 539 && a <= 579) return ['stateAid', 'State grants'];
  if (a >= 580 && a <= 599) return ['grants', 'Contributions from other local units'];
  if (a >= 600 && a <= 654) return fund === 'Enterprise Funds' ? ['utilityCharges', 'Utility and enterprise charges'] : ['feesPermits', 'Charges for services'];
  if (a >= 655 && a <= 663) return ['finesForfeitures', 'Fines and forfeits'];
  if (a >= 664 && a <= 670) return ['localRevenue', a === 665 || a === 666 ? 'Interest' : 'Rents and other earnings'];
  if (a >= 671 && a <= 695) return ['localRevenue', 'Contributions, reimbursements and other revenue'];
  return ['localRevenue', 'Other revenue'];
}

const sum = (o) => Object.values(o).reduce((a, v) => a + v, 0);

// exp, rev: [{ Fund, Account, Amount }]
export function aggregateF65(exp = [], rev = []) {
  const revenue = {};
  const spending = {};
  const lines = new Map();
  const add = (group, key, label, amount) => {
    if (!amount) return;
    const target = group === 'revenue' ? revenue : spending;
    target[key] = (target[key] || 0) + amount;
    const id = `${group}|${key}|${label}`;
    lines.set(id, (lines.get(id) || 0) + amount);
  };
  const leftOut = { otherFunds: 0, financing: 0, depreciation: 0 };
  let capital = 0;
  let enterpriseCapital = 0;
  let borrowing = 0;
  for (const r of rev) {
    const amount = Number(r.Amount) || 0;
    if (!COUNTED_FUNDS.has(r.Fund)) { leftOut.otherFunds += amount; continue; }
    const k = revenueKey(r.Account, r.Fund);
    if (k) add('revenue', k[0], k[1], amount);
    else {
      leftOut.financing += amount;
      const a = first(r.Account);
      if (a >= 696 && a <= 698) borrowing += amount;
    }
  }
  for (const r of exp) {
    const amount = Number(r.Amount) || 0;
    if (!COUNTED_FUNDS.has(r.Fund)) { leftOut.otherFunds += amount; continue; }
    const k = spendingKey(r.Account);
    if (k === 'capital') {
      if (r.Fund === 'Enterprise Funds') { add('spending', 'utilities', 'Enterprise capital outlay', amount); enterpriseCapital += amount; } else capital += amount;
    } else if (k) add('spending', k[0], k[1], amount);
    else if (first(r.Account) === 968) leftOut.depreciation += amount;
    else leftOut.financing += amount;
  }
  // Capital outlay outside enterprise funds, spread over the other spending in proportion.
  if (capital) {
    const base = Object.entries(spending).filter(([k]) => k !== 'debtService' && k !== 'otherSpending');
    const total = base.reduce((a, [, v]) => a + v, 0);
    if (total) for (const [k, v] of base) add('spending', k, 'Capital outlay (spread over services by spending)', (capital * v) / total);
    else add('spending', 'administration', 'Capital outlay', capital);
  }
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
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v));
  const r = round(revenue);
  const s = round(spending);
  return {
    revenue: r,
    spending: s,
    lines: [...lines].map(([id, amount]) => { const [group, key, label] = id.split('|'); return { group, key, label, amount: Math.round(amount) }; }).filter((l) => l.amount),
    capital: Math.round(capital),
    leftOut: Object.fromEntries(Object.entries({ ...leftOut, borrowing }).map(([k, v]) => [k, Math.round(v)])),
    empty: !sum(r) || !sum(s),
    // More than four times apart means an entry error or a part left out.
    inconsistent: sum(r) > 4 * sum(s) || sum(s) > 4 * sum(r),
  };
}
