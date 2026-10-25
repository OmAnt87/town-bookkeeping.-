// Town-owned utilities in Connecticut. The state's Municipal Fiscal Indicators cover each town's
// general fund, while electric, water and gas utilities that towns own (Groton Utilities,
// Norwich Public Utilities, Wallingford's electric and water divisions, Manchester's water
// department) run as enterprise funds outside it. The Census Bureau's Annual Survey of State and
// Local Government Finances reports them with the town: utility revenue (water, electric, gas
// and transit charges) and utility spending (operations, construction, other capital outlay and
// interest). They are added to money in and out for the same fiscal year. Sewer funds are left
// out: the Census counts sewers as a general function, and some towns already run them through
// the general fund, so adding them could count them twice. Utilities under MATERIAL of the
// town's own revenue are left out.

import { readUnits, CENSUS_PAGE } from '../common/census-units.mjs';

export const UTILITY_YEARS = [2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024];
export const UTILITY_COUNTERPARTY = 'Town-owned utilities (Census)';
const UTILITY_FUNCTIONS = new Set(['91', '92', '93', '94']);
const KIND = { 91: 'water', 92: 'electric', 93: 'gas', 94: 'transit' };
export const MATERIAL = 0.02;
const GF_NOTE = 'Covers the town\'s general fund. Water, sewer and other enterprise funds and independent authorities are separate.';
const GF_UTIL_NOTE = 'Covers the town\'s general fund and its town-owned utilities. Sewer and other enterprise funds and independent authorities are separate.';

// "City of Groton" / "GROTON CITY" -> "groton city"; "Town of Wallingford" -> "wallingford town".
export function utilityKey(name) {
  const s = String(name).toLowerCase().trim();
  const m = s.match(/^(city|town|borough) of (.+)$/);
  return (m ? `${m[2]} ${m[1]}` : s).replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// Utility revenue and spending in dollars by town key and fiscal year:
// Map(key -> { year: { revenue, spending, kinds } }). Only unit-years with utility money are kept.
export function censusUtilities(raw, years = UTILITY_YEARS) {
  const out = new Map();
  for (const [y, units] of Object.entries(readUnits(raw, '09', '23', years))) {
    for (const u of units.values()) {
      let revenue = 0;
      let spending = 0;
      const kinds = new Set();
      for (const i of u.items) {
        const fn = i.code.slice(1);
        if (!UTILITY_FUNCTIONS.has(fn)) continue;
        if (i.code[0] === 'A') { revenue += i.amount; if (i.amount) kinds.add(KIND[fn]); }
        else if ('EFGI'.includes(i.code[0])) spending += i.amount;
      }
      if (!revenue && !spending) continue;
      const key = utilityKey(u.name);
      (out.get(key) || out.set(key, {}).get(key))[y] = { revenue: revenue * 1000, spending: spending * 1000, kinds: [...kinds] };
    }
  }
  return out;
}

// History from the state's town data series (2014 on), replaced by the financial statements
// where both exist, plus each year's utilities. Once a town has utilities, a year without
// Census figures is left out rather than drawn as a sudden drop.
export function ctHistory(t, util = {}) {
  const hist = {};
  for (const [y, r] of Object.entries(t.town)) hist[y] = { revenue: Number(r.total_revenues), spending: Number(r.total_expenditures) };
  for (const [y, r] of Object.entries(t.fs)) hist[y] = { revenue: Number(r.d_15_total_revenues), spending: Number(r.d_26_total_expenditures) };
  const has = Object.keys(util).length > 0;
  return Object.entries(hist).filter(([y, h]) => h.revenue > 0 && h.spending > 0 && (!has || util[y])).sort(([x], [y]) => x - y)
    .map(([y, h]) => ({ year: Number(y), revenue: Math.round(h.revenue + (util[y]?.revenue || 0)), spending: Math.round(h.spending + (util[y]?.spending || 0)), basis: 'actual' }));
}

// Adds the town's utilities for its fiscal year to money in and out and rebuilds the history.
// `t` is the town's state rows ({ fs, town }); `util` its censusUtilities entry (or undefined).
// Safe to run again on a town it has already updated.
export function applyUtilities(town, t, util = {}) {
  for (const e of (town.ledger || []).filter((x) => x.counterparty === UTILITY_COUNTERPARTY)) {
    const side = e.flow === 'in' ? town.revenue : town.spending;
    side[e.category] = (side[e.category] || 0) - e.amount;
    if (!side[e.category]) delete side[e.category];
  }
  town.ledger = (town.ledger || []).filter((x) => x.counterparty !== UTILITY_COUNTERPARTY);
  town.sources = (town.sources || []).filter((s) => !/town-owned utilities/.test(s.label));
  town.notes = (town.notes || []).filter((n) => !/^(Includes town-owned|Town-owned) .*utilit/.test(n));
  town.notes = town.notes.map((n) => (n === GF_UTIL_NOTE ? GF_NOTE : n));

  // Only utilities large enough to matter: Census records for many towns carry a few thousand
  // dollars of transit or water spending, which would only thin out the history.
  const y = String(town.fiscalYear);
  const own = Object.values(town.revenue).reduce((x, v) => x + v, 0);
  if (!(Math.max(util[y]?.revenue || 0, util[y]?.spending || 0) >= MATERIAL * own)) util = {};
  const u = util[y];
  if (u) {
    const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
    const date = `${y}-06-30`;
    const kinds = u.kinds.length > 1 ? `${u.kinds.slice(0, -1).join(', ')} and ${u.kinds.at(-1)}` : u.kinds[0] || 'water';
    const what = `${kinds} utilit${u.kinds.length > 1 ? 'ies' : 'y'}`;
    const rev = Math.round(u.revenue);
    const out = Math.round(u.spending);
    if (rev) town.revenue.utilityCharges = (town.revenue.utilityCharges || 0) + rev;
    if (out) town.spending.utilities = (town.spending.utilities || 0) + out;
    town.ledger.unshift(
      ...(rev ? [{ date, flow: 'in', category: 'utilityCharges', counterparty: UTILITY_COUNTERPARTY, description: `Town-owned ${what}: charges and other revenue`, amount: rev, source: CENSUS_PAGE(Number(y)) }] : []),
      ...(out ? [{ date, flow: 'out', category: 'utilities', counterparty: UTILITY_COUNTERPARTY, description: `Town-owned ${what}: operations, capital outlay and interest`, amount: out, source: CENSUS_PAGE(Number(y)) }] : []),
    );
    town.sources.push({ label: `U.S. Census Bureau, ${y} Annual Survey of State and Local Government Finances, individual unit file (town-owned utilities)`, url: CENSUS_PAGE(Number(y)) });
    town.notes = town.notes.map((n) => (n === GF_NOTE ? GF_UTIL_NOTE : n));
    const at = town.notes.findIndex((n) => /^Covers the town's general fund/.test(n));
    town.notes.splice(at >= 0 ? at + 1 : 1, 0, `Includes town-owned ${what} (${money(rev)} of revenue and ${money(out)} of spending), which run outside the general fund, as the town reported them to the Census Bureau's Annual Survey of State and Local Government Finances for FY ${y}. Repayment of utility debt principal is not broken out there, so it is not included.`);
    if (town.reporting?.scope && !/utilities/.test(town.reporting.scope)) town.reporting.scope = town.reporting.scope.replace(/^General fund/, 'General fund and town-owned utilities');
  } else if (town.reporting?.scope) town.reporting.scope = town.reporting.scope.replace(/^General fund and town-owned utilities/, 'General fund');
  town.history = ctHistory(t, util);
  return u || null;
}
