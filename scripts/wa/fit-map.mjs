// Maps a Washington county's or city's annual report (Schedule 1, as published in the State
// Auditor's Financial Intelligence Tool) to Town Ledger categories by BARS account.
//
// Revenue is the "revenues" section (BARS 31x-37x); spending is the "expenditures" section by
// function (BARS 51x-57x) plus, from "other decreases", debt service (591, 592) and capital
// expenditures (594, coded by function; 595 roads). Left out: internal service funds (the
// departments they serve report that spending), internal service sales (348), gains and joint
// venture income, borrowing and other financing sources, transfers, interfund loans, refunding
// escrow and refunded debt, depreciation, custodial and court remittances. General government,
// courts and legal services, and natural and economic environment (planning, economic
// development, housing, conservation) count as overhead, as elsewhere.
//
// Principal repaid with new borrowing is left out of debt service as refinancing: debt issued
// (391) beyond the year's capital expenditures, up to the principal repaid, as in the Census
// builder.

export const SECTION = { revenues: 20, otherIncreases: 25, expenditures: 30, otherDecreases: 35 };
export const INTERNAL_SERVICE_FUND = 5;
export const UNCLASSIFIED_SHARE = 0.15;

// Three-digit BARS revenue account -> [key, label] or null.
export function revenueKey(acct) {
  const a = Number(acct.slice(0, 3));
  if (a === 311) return ['propertyTax', 'Property tax'];
  if (a === 317) return ['propertyTax', 'Excise taxes in lieu of property tax'];
  if (a === 313) return ['salesTax', 'Retail sales and use taxes'];
  if (a === 316) return ['salesTax', 'Business and occupation and utility taxes'];
  if (a >= 310 && a <= 319) return ['salesTax', 'Other taxes'];
  if (a >= 320 && a <= 329) return ['feesPermits', 'Licenses and permits'];
  if (a >= 331 && a <= 333) return ['federalGrants', 'Federal grants'];
  if (a === 334) return ['stateAid', 'State grants'];
  if (a === 335 || a === 336) return ['stateAid', 'State shared revenues'];
  if (a >= 337 && a <= 339) return ['grants', 'Local grants, entitlements and interlocal payments'];
  if (a === 343) return ['utilityCharges', 'Water, sewer, electric, storm and solid waste charges'];
  if (a === 348) return null; // internal service sales
  if (a >= 340 && a <= 349) return ['feesPermits', 'Charges for services'];
  if (a >= 350 && a <= 359) return ['finesForfeitures', 'Fines and penalties'];
  if (a === 368) return ['feesPermits', 'Special assessments'];
  if (a === 371 || a === 373) return null; // joint venture income, gains on capital assets
  if (a >= 360 && a <= 379) return ['localRevenue', a === 361 ? 'Interest and other earnings' : 'Rents, contributions and other revenue'];
  return null;
}

// Three-digit BARS function (51x-59x) -> [key, label].
export function functionKey(fn) {
  const a = Number(String(fn).slice(0, 3));
  if (a === 512 || a === 515) return ['administration', 'Courts and legal services'];
  if (a >= 510 && a <= 519) return ['administration', 'General government'];
  if (a === 523 || a === 527) return ['publicSafety', 'Detention, corrections and juvenile services'];
  if (a === 522) return ['publicSafety', 'Fire and emergency medical services'];
  if (a === 521) return ['publicSafety', 'Law enforcement'];
  if (a >= 520 && a <= 529) return ['publicSafety', 'Other public safety'];
  if (a === 536) return ['parks', 'Cemeteries'];
  if (a >= 530 && a <= 539 || a === 554) return ['utilities', 'Water, sewer, electric, storm, solid waste and environmental services'];
  if (a === 546) return ['roads', 'Airports and ports'];
  if (a === 547) return ['roads', 'Transit'];
  if (a >= 540 && a <= 549) return ['roads', 'Roads and streets'];
  if (a >= 550 && a <= 559) return ['administration', 'Planning, economic development, housing and conservation'];
  if (a >= 560 && a <= 569) return ['healthServices', a === 562 ? 'Public health' : 'Social, mental health and human services'];
  if (a === 572) return ['parks', 'Libraries'];
  if (a >= 570 && a <= 579) return ['parks', 'Parks, recreation and culture'];
  return ['otherSpending', 'Miscellaneous expenses'];
}

const sum = (o) => Object.values(o).reduce((a, v) => a + v, 0);

// rows: [[logicalAccount, fundTypeId, sectionId, amount]] (logical accounts like '3111000').
export function aggregateFit(rows) {
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
  const leftOut = { internalService: 0, financingSources: 0, otherDecreases: 0 };
  let borrowing = 0;
  let capital = 0;
  for (const [acct, fund, section, amount] of rows) {
    if (fund === INTERNAL_SERVICE_FUND) { if (section === SECTION.revenues || section === SECTION.expenditures) leftOut.internalService += amount; continue; }
    const a = String(acct);
    const three = Number(a.slice(0, 3));
    if (section === SECTION.revenues) {
      const k = revenueKey(a);
      if (k) add('revenue', k[0], k[1], amount);
    } else if (section === SECTION.otherIncreases) {
      leftOut.financingSources += amount;
      if (three === 391) borrowing += amount;
    } else if (section === SECTION.expenditures) {
      const k = functionKey(a);
      add('spending', k[0], k[1], amount);
    } else if (section === SECTION.otherDecreases) {
      if (three === 591) add('spending', 'debtService', 'Debt service: principal', amount);
      else if (three === 592) add('spending', 'debtService', 'Debt service: interest and other costs', amount);
      else if (three === 594) {
        // Capital expenditures carry the function in digits 4-5 (59476: parks).
        const k = functionKey(`5${a.slice(3, 5)}`);
        add('spending', k[0], `${k[1]} (capital)`, amount);
        capital += amount;
      } else if (three === 595) { add('spending', 'roads', 'Roads and streets (capital)', amount); capital += amount; }
      else leftOut.otherDecreases += amount;
    }
  }
  // Refinancing: borrowing beyond the year's capital expenditures, up to the principal repaid.
  const principal = lines.get('spending|debtService|Debt service: principal') || 0;
  const refinanced = Math.max(0, Math.min(principal, borrowing - capital));
  if (refinanced) {
    spending.debtService -= refinanced;
    lines.set('spending|debtService|Debt service: principal', principal - refinanced);
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
    refinanced: Math.round(refinanced),
    leftOut: Object.fromEntries(Object.entries({ ...leftOut, borrowing }).map(([k, v]) => [k, Math.round(v)])),
    empty: !sum(r) || !sum(s),
    // More than four times apart means an entry error or a part left out.
    inconsistent: sum(r) > 4 * sum(s) || sum(s) > 4 * sum(r),
  };
}
