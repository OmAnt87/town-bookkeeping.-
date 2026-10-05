// Maps a Georgia Report of Local Government Finance (RLGF, FY 2020+ UCOA form) to Town Ledger
// categories. Input is the form's LOAD1 sheet as blocks of { code: value }:
//   R1  Part I taxes, licenses and permits (31_xxxx, 32_xxxx)
//   R2  Part II intergovernmental revenue (33_xxxxA state, B other local, C federal) and
//       Part III A service charges (34_1100 ... 34_3900)
//   R3  Part III B other revenue (34_6110 ... 39_9999) and Part IV utility and enterprise
//       revenue (34_4110 ... 34_6000)
//   E1-E6  Part V expenditures by UCOA function: A current operations, B property, C machinery,
//       D intangibles (capital outlay). Part V leaves out debt service and utilities reported in
//       Part VI.
//   E7  Part VI enterprise expenses: 505 water and sewer, 510 electric, 515 gas, 550 airport,
//       540 solid waste, OTHER; CO current operations, IE interest
//   E9  Part X payments to other governments, by function (B = amount)
//   D1-D4  Part XI debt: A revenue bonds, B general obligation bonds, C other long-term debt,
//       D capital leases; columns A beginning, B issued, C retired, D ending, E interest paid
//   D4  also SE_STN_* short-term notes and SF_SAD_* special assessment debt
//
// Debt service is long-term principal retired plus all interest paid (Part XI); Part VI interest
// is the same interest, so it is not added again. Payments to other governments (Part X) are
// taken out of their function: the receiving government reports that spending (as in North and
// South Carolina). SPLOST paid to cities (4960) is such a payment.

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);

// UCOA function (4 digits) -> spending key.
export function functionKey(fn) {
  const f = Number(fn);
  if (f >= 1000 && f < 3000) return 'administration'; // general government and judicial
  if (f >= 3000 && f < 4000) return 'publicSafety';
  if (f >= 4100 && f < 4300) return 'roads';
  if (f >= 4300 && f < 4900) return 'utilities';
  if (f === 4900) return 'administration'; // maintenance shop
  if (f === 4950) return 'parks'; // cemetery
  if (f === 4960) return null; // SPLOST paid to cities
  if (f >= 5000 && f < 5600) return 'healthServices';
  if (f === 5600) return 'education';
  if (f >= 6000 && f < 7000) return 'parks';
  if (f === 7100) return 'parks'; // conservation and county extension
  if (f === 7200) return 'publicSafety'; // protective inspection
  if (f >= 7300 && f < 8000) return 'administration'; // housing, planning, economic development
  return 'administration';
}

const FUNCTION_LABEL = {
  1: 'General government', 2: 'Judicial', 3: 'Public safety', 4: 'Public works', 5: 'Health and welfare', 6: 'Culture and recreation', 7: 'Housing and development',
};
const ENTERPRISE = { 505: ['utilities', 'Water and sewer system'], 510: ['utilities', 'Electric system'], 515: ['utilities', 'Natural gas system'], 550: ['roads', 'Airport'], 540: ['utilities', 'Solid waste system'], OTHER: ['utilities', 'Other enterprise funds'] };

// 3x_xxxx revenue code -> [key, label].
export function revenueKey(code) {
  const c = code.replace(/[A-C]$/, '');
  if (/^31_1[1-4]/.test(c) || c === '31_9000') return ['propertyTax', 'Property taxes'];
  if (/^31_3/.test(c)) return ['salesTax', 'Local option and special purpose sales taxes'];
  if (/^31_/.test(c)) return ['salesTax', 'Franchise, hotel/motel, alcohol, insurance premium and other taxes'];
  if (/^32_/.test(c)) return ['feesPermits', 'Licenses and permits'];
  if (/^34_(4|5)/.test(c) || c === '34_6000') return ['utilityCharges', 'Utility and enterprise charges'];
  if (/^34_(1|2|3|6|7|9)/.test(c)) return ['feesPermits', 'Charges for services'];
  if (/^35_/.test(c)) return ['finesForfeitures', 'Fines and forfeitures'];
  if (/^3[6-9]_/.test(c)) return ['localRevenue', 'Interest, rents, donations, asset sales and other'];
  return null;
}

export function aggregateGa(blocks) {
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
  const R1 = blocks.R1 || {};
  const R2 = blocks.R2 || {};
  const R3 = blocks.R3 || {};
  // Part I and Part III: one column.
  for (const [code, v] of [...Object.entries(R1), ...Object.entries(R3)]) {
    if (!/^3\d_/.test(code)) continue;
    const m = revenueKey(code);
    if (m) add('revenue', m[0], m[1], num(v));
  }
  // Part II (state / other local / federal) and Part III A.
  const AID = { A: ['stateAid', 'State grants and payments'], B: ['grants', 'From other local governments (including SPLOST shares)'], C: ['federalGrants', 'Federal grants'] };
  for (const [code, v] of Object.entries(R2)) {
    if (/^33_.*[ABC]$/.test(code)) { const [k, l] = AID[code.at(-1)]; add('revenue', k, l, num(v)); continue; }
    if (/^34_/.test(code)) { const m = revenueKey(code); if (m) add('revenue', m[0], m[1], num(v)); }
  }

  // Part V by function, less Part X payments to other governments.
  const intergov = {};
  let intergovernmental = 0;
  for (const [code, v] of Object.entries(blocks.E9 || {})) {
    const m = code.match(/^(\d{4})B$/);
    if (m) { intergov[m[1]] = (intergov[m[1]] || 0) + num(v); intergovernmental += num(v); }
  }
  const byFn = {};
  let partV = 0;
  for (const b of ['E1', 'E2', 'E3', 'E4', 'E5', 'E6']) {
    for (const [code, v] of Object.entries(blocks[b] || {})) {
      const m = code.match(/^(\d{4})([A-D])$/);
      if (!m) continue;
      byFn[m[1]] = (byFn[m[1]] || 0) + num(v);
      partV += num(v);
    }
  }
  // Payments listed under a function not on Part V (regional commission 1595, hospitals 5000,
  // transit 5540, airport 7563) come out of the largest function of the same category.
  const left = {};
  for (const [fn, amount] of Object.entries(intergov)) {
    if (byFn[fn] !== undefined) byFn[fn] -= amount;
    else { const k = functionKey(fn); if (k) left[k] = (left[k] || 0) + amount; }
  }
  for (const [k, amount] of Object.entries(left)) {
    const fn = Object.keys(byFn).filter((f) => functionKey(f) === k).sort((a, b) => byFn[b] - byFn[a])[0];
    if (fn) byFn[fn] -= amount;
  }
  for (const [fn, amount] of Object.entries(byFn)) {
    const key = functionKey(fn);
    if (!key) continue; // SPLOST paid to cities: all of it goes to other governments
    add('spending', key, `${FUNCTION_LABEL[fn[0]] || 'Other'} (UCOA ${fn})`, amount);
  }
  const E7 = blocks.E7 || {};
  for (const [fund, [key, label]] of Object.entries(ENTERPRISE)) add('spending', key, `${label} (operations)`, num(E7[`${fund}CO`]));

  // Part XI debt.
  const D = { ...(blocks.D1 || {}), ...(blocks.D2 || {}), ...(blocks.D3 || {}), ...(blocks.D4 || {}) };
  const sec = (s, col) => num(D[`TTL_10${s}_${col}`]);
  const longTerm = ['A', 'B', 'C', 'D'];
  const retired = longTerm.reduce((a, s) => a + sec(s, 'C'), 0) + num(D.SF_SAD_C);
  const interest = longTerm.reduce((a, s) => a + sec(s, 'E'), 0) + num(D.SE_STN_E) + num(D.SF_SAD_E);
  add('spending', 'debtService', 'Debt service: principal retired', retired);
  add('spending', 'debtService', 'Debt service: interest', interest);
  const debt = longTerm.reduce((a, s) => a + sec(s, 'D'), 0) + num(D.SE_STN_D) + num(D.SF_SAD_D);
  const issued = longTerm.reduce((a, s) => a + sec(s, 'B'), 0) + num(D.SE_STN_B) + num(D.SF_SAD_B);

  // The form's own totals, to check the mapping.
  const formRevenue = num(R1.TTL_Part1) + num(R2.TTL_2A) + num(R2.TTL_2B) + num(R2.TTL_2C) + num(R3.TTL_Part3) + num(R3.TTL_Part4);
  const formPartV = ['A', 'B', 'C', 'D'].reduce((a, c) => a + num((blocks.E6 || {})[`TTL_PART5_${c}`]), 0);
  const sum = (o) => Object.values(o).reduce((a, v) => a + v, 0);
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v));
  return {
    revenue: round(revenue),
    spending: round(spending),
    debt: Math.round(debt),
    issued: Math.round(issued),
    intergovernmental: Math.round(intergovernmental),
    lines: [...lines].map(([k, amount]) => { const [group, key, label] = k.split('|'); return { group, key, label, amount: Math.round(amount) }; }).filter((l) => l.amount),
    check: { revenue: [Math.round(sum(revenue)), Math.round(formRevenue)], partV: [Math.round(partV), Math.round(formPartV)] },
    // A report with no revenue or no spending was not filled in.
    empty: !sum(revenue) || !partV,
    // Revenue and spending more than four times apart means an entry error (Milledgeville's
    // FY 2025 report lists $7.2 billion of other revenue) or a part left blank.
    inconsistent: sum(revenue) > 4 * sum(spending) || sum(spending) > 4 * sum(revenue),
  };
}
