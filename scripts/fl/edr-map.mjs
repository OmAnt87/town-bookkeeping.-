// Maps a Florida government's EDR revenue and expenditure rows (Uniform Accounting System codes,
// from the Annual Financial Report filed with the Department of Financial Services) to Town
// Ledger categories.
//
// Counted funds: general, special revenue, debt service, capital projects, permanent and
// enterprise. Internal service funds (charges between departments), fiduciary funds (pension,
// trust, custodial) and component units are left out, as are other financing sources and uses
// (38x/58x/59x: transfers between funds, borrowing, refunding escrow, lease financing and
// proprietary non-operating items).

export const COUNTED_FUNDS = ['general', 'specialRevenue', 'debtService', 'capitalProjects', 'permanent', 'enterprise'];

// Returns [key, label] or null (left out).
export function revenueKey(code) {
  const c = String(code);
  const p3 = c.slice(0, 3);
  if (p3 === '311') return ['propertyTax', 'Ad valorem (property) taxes'];
  if (/^31[2-9]/.test(c)) return ['salesTax', 'Local option, tourist, utility service, business and other taxes'];
  if (/^32/.test(c)) return ['feesPermits', 'Permits, franchise fees, impact fees and special assessments'];
  if (p3 === '331' || p3 === '333') return ['federalGrants', 'Federal grants and payments'];
  if (p3 === '334' || p3 === '335') return ['stateAid', 'State grants and shared revenues'];
  if (/^33[6-9]/.test(c)) return ['grants', 'Grants and shared revenues from other local governments'];
  if (p3 === '332') return ['federalGrants', 'Federal grants and payments'];
  if (p3 === '343' || p3 === '344') return ['utilityCharges', 'Utility, solid waste, transit, parking and airport charges'];
  if (/^34/.test(c)) return ['feesPermits', 'Charges for services'];
  if (/^35/.test(c)) return ['finesForfeitures', 'Judgments, fines and forfeitures'];
  if (/^36/.test(c)) return ['localRevenue', 'Interest, rents, contributions, asset sales and other'];
  return null; // 38x other sources: transfers, debt proceeds
}

export function expenditureKey(code) {
  const c = String(code);
  const p3 = c.slice(0, 3);
  if (p3 === '517') return ['debtService', 'Debt service (governmental funds)'];
  if (/^51/.test(c)) return ['administration', 'General government'];
  if (/^52/.test(c)) return ['publicSafety', 'Public safety'];
  if (p3 === '537') return ['parks', 'Conservation and resource management'];
  if (/^53/.test(c)) return ['utilities', 'Physical environment: utilities, solid waste and stormwater'];
  if (/^54/.test(c)) return ['roads', 'Transportation: roads, transit, airports, ports and parking'];
  if (/^55/.test(c)) return ['administration', 'Economic environment: housing and economic development'];
  if (/^56/.test(c)) return ['healthServices', 'Human services'];
  if (/^57/.test(c)) return ['parks', 'Culture and recreation'];
  if (/^(6|7)/.test(c)) return ['administration', 'Court-related'];
  return null; // 58x/59x other uses
}

// rows: [[code, name, { fund: amount }]] for one year; kind: 'revenue' | 'expenditure'.
function tally(rows, kind, target, lines, left) {
  const mapper = kind === 'revenue' ? revenueKey : expenditureKey;
  for (const [code, name, funds] of rows) {
    const amount = COUNTED_FUNDS.reduce((a, f) => a + (Number(funds[f]) || 0), 0);
    if (!amount) continue;
    const m = mapper(code);
    if (!m) { left[kind] += amount; continue; }
    target[m[0]] = (target[m[0]] || 0) + amount;
    const k = `${kind}|${m[0]}|${code} ${name}`;
    lines.set(k, (lines.get(k) || 0) + amount);
  }
}

export function aggregateFl(revRows, expRows) {
  const revenue = {};
  const spending = {};
  const lines = new Map();
  const left = { revenue: 0, expenditure: 0 };
  tally(revRows || [], 'revenue', revenue, lines, left);
  tally(expRows || [], 'expenditure', spending, lines, left);
  const sum = (o) => Object.values(o).reduce((a, v) => a + v, 0);
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v));
  const r = round(revenue);
  const s = round(spending);
  return {
    revenue: r,
    spending: s,
    leftOut: { otherSources: Math.round(left.revenue), otherUses: Math.round(left.expenditure) },
    lines: [...lines].map(([k, amount]) => { const [group, key, label] = k.split('|'); return { group: group === 'revenue' ? 'revenue' : 'spending', key, label, amount: Math.round(amount) }; }).filter((l) => l.amount),
    empty: !sum(r) || !sum(s),
    // More than four times apart means an entry error or a part left out.
    inconsistent: sum(r) > 4 * sum(s) || sum(s) > 4 * sum(r),
  };
}
