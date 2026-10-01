// Community Return Score: how much of a town's money comes back to residents
// as services, and how clean the money around the town is. Pure functions only.

import {
  REVENUE_CATEGORIES,
  SPENDING_CATEGORIES,
  INFLUENCE_CATEGORIES,
  TRANSPARENCY_CHECKS,
  TAX_BREAK_CATEGORIES,
  RED_FLAG_PATTERNS,
} from './categories.js';

export const sum = (obj = {}) => Object.values(obj).reduce((a, b) => a + (Number(b) || 0), 0);

const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
// Linear scale from `worst` (0) to `best` (1); works in either direction.
const scale = (value, worst, best) => clamp((value - worst) / (best - worst));

export function totals(town) {
  const revenue = sum(town.revenue);
  const spending = sum(town.spending);
  const influence = sum(town.influence);
  const propertyTax = town.revenue?.propertyTax || 0;
  const reserves = REVENUE_CATEGORIES.filter((c) => c.reserve).reduce((a, c) => a + (town.revenue?.[c.key] || 0), 0);
  // Red-flag payments filed under a service line (a Flock contract under
  // police, say) are moved out of direct services and into red flags.
  const flaggedInDirect = redFlagEntries(town)
    .filter((e) => DIRECT_KEYS.has(e.category))
    .reduce((a, e) => a + e.amount, 0);
  const direct = SPENDING_CATEGORIES.filter((c) => c.direct)
    .reduce((a, c) => a + (town.spending?.[c.key] || 0), 0);
  const directNet = Math.max(0, direct - flaggedInDirect);
  // Spending the services and overhead shares are measured against (without schools).
  const municipal = spending - SPENDING_CATEGORIES.filter((c) => c.outsideShares)
    .reduce((a, c) => a + (town.spending?.[c.key] || 0), 0);
  const redFlagSpending = SPENDING_CATEGORIES.filter((c) => c.redFlag)
    .reduce((a, c) => a + (town.spending?.[c.key] || 0), 0) + flaggedInDirect;
  const taxBreaks = sum(town.taxBreaks);
  const documented = documentedRedFlags(town);
  const corporateMoney = (town.influence?.corporateLobbying || 0) + (town.influence?.developerContributions || 0);
  const pop = Math.max(1, town.population || 1);
  return {
    revenue,
    spending,
    influence,
    propertyTax,
    reserves,
    nonPropertyRevenue: revenue - propertyTax - reserves,
    nonPropertyShare: revenue ? (revenue - propertyTax - reserves) / revenue : 0,
    directSpending: directNet,
    redFlagSpending,
    taxBreaks,
    // Red-flag spending plus revenue given away, against what the town spends.
    redFlagShare: spending ? (redFlagSpending + taxBreaks) / spending : 0,
    redFlagPerResident: (redFlagSpending + taxBreaks) / pop,
    redFlagKnown: hasRedFlagData(town),
    documentedRedFlags: documented.length,
    // Everything flagged: documented programs and deals, plus each red-flag
    // spending line or tax break with money in it.
    redFlagCount: documented.length
      + RED_FLAG_KEYS.filter((k) => town.spending?.[k] > 0).length
      + Object.values(town.taxBreaks || {}).filter((v) => v > 0).length,
    corporateMoney,
    corporateShareOfInfluence: influence ? corporateMoney / influence : 0,
    municipalSpending: municipal,
    directShare: municipal > 0 ? directNet / municipal : 0,
    adminShare: municipal > 0
      ? ((town.spending?.administration || 0) + (town.spending?.consultants || 0)) / municipal
      : 0,
    spendingPerResident: spending / pop,
    directPerResident: directNet / pop,
    influencePerResident: influence / pop,
    debtPerResident: (town.debt || 0) / pop,
    balance: revenue - spending,
  };
}

const notItemized = (_t, town) => (town.spending?.otherSpending > 0
  ? 'Not scored: part of this town\'s spending is reported only as a total, not by department'
  : null);

// Each component returns { key, label, points, max, detail } so the UI can
// explain exactly where the score came from.
export const COMPONENTS = [
  {
    key: 'services',
    label: 'Money reaching residents',
    max: 25,
    available: (t, town) => t.municipalSpending > 0 && !(town.spending?.otherSpending > 0),
    measure: (t) => scale(t.directShare, 0.5, 0.88),
    detail: (t) => `${pct(t.directShare)} of spending goes to direct services${t.municipalSpending < t.spending ? ' (not counting schools)' : ''}`,
    unavailable: notItemized,
  },
  {
    key: 'overhead',
    label: 'Low overhead',
    max: 10,
    available: (t, town) => t.municipalSpending > 0 && !(town.spending?.otherSpending > 0),
    measure: (t) => scale(t.adminShare, 0.3, 0.06),
    detail: (t) => `${pct(t.adminShare)} spent on administration and consultants${t.municipalSpending < t.spending ? ' (not counting schools)' : ''}`,
    unavailable: notItemized,
  },
  {
    key: 'redFlags',
    label: 'No surveillance or corporate giveaways',
    max: 10,
    available: (_t, town) => hasRedFlagData(town),
    // Dollars and documented programs are both checked; the worse one counts.
    // Each documented program or deal (most records carry no dollar figure) costs a quarter of the points.
    measure: (t) => Math.min(scale(t.redFlagShare, 0.05, 0), Math.max(0, 1 - 0.25 * t.documentedRedFlags)),
    detail: (t) => {
      const parts = [];
      if (t.redFlagSpending + t.taxBreaks > 0) parts.push(`$${Math.round(t.redFlagPerResident).toLocaleString('en-US')} per resident on surveillance, corporate deals and tax breaks (${pct(t.redFlagShare, 1)} of spending)`);
      if (t.documentedRedFlags) parts.push(`${t.documentedRedFlags} documented surveillance program${t.documentedRedFlags === 1 ? '' : 's'} or corporate deal${t.documentedRedFlags === 1 ? '' : 's'}`);
      return parts.length ? parts.join('; ') : 'No surveillance programs, data center deals or corporate tax breaks found';
    },
  },
  {
    key: 'influence',
    label: 'Low outside political money',
    max: 20,
    available: (_t, town) => hasData(town.influence),
    measure: (t) => scale(t.influencePerResident, 12, 0.5),
    detail: (t) =>
      `$${t.influencePerResident.toFixed(2)} in PAC, donor and lobbying money per resident` +
      (t.corporateMoney > 0 ? `; ${pct(t.corporateShareOfInfluence)} of it from corporations and their lobbyists` : ''),
  },
  {
    key: 'transparency',
    label: 'Transparency',
    max: 20,
    available: (_t, town) => Object.values(town.transparency || {}).some((v) => typeof v === 'boolean'),
    measure: (_t, town) => transparencyCount(town) / TRANSPARENCY_CHECKS.length,
    detail: (_t, town) => `${transparencyCount(town)} of ${TRANSPARENCY_CHECKS.length} transparency practices`,
  },
  {
    key: 'fiscal',
    label: 'Fiscal health',
    max: 15,
    available: (t, town) => typeof town.debt === 'number' && t.revenue > 0,
    measure: (t) =>
      0.65 * scale(t.debtPerResident, 6000, 300) +
      0.35 * scale(t.revenue ? t.balance / t.revenue : 0, -0.1, 0.02),
    detail: (t) =>
      `$${Math.round(t.debtPerResident).toLocaleString('en-US')} debt per resident, ` +
      `${t.balance >= 0 ? 'surplus' : 'deficit'} of ${pct(Math.abs(t.revenue ? t.balance / t.revenue : 0))}`,
  },
];

// A section counts as reported when it exists as an object, even if every value is 0.
// A missing section means "unknown", which is different from zero.
const hasData = (obj) => obj != null && typeof obj === 'object' && Object.keys(obj).length > 0;

const DIRECT_KEYS = new Set(SPENDING_CATEGORIES.filter((c) => c.direct).map((c) => c.key));
const RED_FLAG_KEYS = SPENDING_CATEGORIES.filter((c) => c.redFlag).map((c) => c.key);

// Which red-flag pattern (if any) a ledger entry matches.
export function redFlagReason(entry) {
  const text = `${entry.counterparty || ''} ${entry.description || ''}`;
  return RED_FLAG_PATTERNS.find((p) => p.pattern.test(text))?.label || null;
}

// Payments out of the treasury that are red flags: anything in a red-flag
// category, plus known surveillance vendors and data center deals filed elsewhere.
export function redFlagEntries(town) {
  // Summary records (no ledger yet) carry their flagged payments in redFlagLedger.
  return (town.ledger || town.redFlagLedger || []).filter(
    (e) => e.flow === 'out' && (RED_FLAG_KEYS.includes(e.category) || redFlagReason(e)),
  );
}

// Documented red flags from public records (`town.redFlags`), counted once per
// kind of program: three news stories about the same plate readers are one flag.
export function documentedRedFlags(town) {
  const seen = new Map();
  for (const f of town.redFlags || []) {
    if (f.scored === false) continue;
    const k = `${f.kind}|${f.label}`;
    if (!seen.has(k)) seen.set(k, { ...f, records: [] });
    seen.get(k).records.push(f);
  }
  return [...seen.values()];
}

// The part is scored only when someone has checked for red flags: a red-flag
// spending line (even 0), a tax-break record, a `redFlags` list (even empty),
// or a flagged ledger payment.
function hasRedFlagData(town) {
  return RED_FLAG_KEYS.some((k) => typeof town.spending?.[k] === 'number') || hasData(town.taxBreaks)
    || Array.isArray(town.redFlags) || redFlagEntries(town).length > 0;
}

const normName = (s) =>
  String(s || '').toLowerCase().replace(/\b(llc|inc|co|corp|corporation|company|pac|ltd|lp|llp)\b|[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Pay-to-play check: companies that gave money to local officials or lobbied
// them, and were also paid by the town. Returns [{ name, paid, gave, payments }].
export function corporateTies(town) {
  const givers = new Map();
  const addGiver = (name, amount) => {
    const k = normName(name);
    if (k.length < 4) return;
    givers.set(k, { name, gave: (givers.get(k)?.gave || 0) + amount });
  };
  const fromLedger = (town.ledger || []).filter((e) => e.flow === 'influence' && e.category !== 'lobbyingPaid');
  for (const e of fromLedger) addGiver(e.counterparty, e.amount);
  // topDonors repeats what the ledger holds when both are loaded, so it is only a fallback.
  if (!fromLedger.length) for (const d of town.topDonors || []) addGiver(d.name, d.amount);
  const ties = new Map();
  for (const e of town.ledger || []) {
    if (e.flow !== 'out') continue;
    const k = normName(e.counterparty);
    const match = [...givers.keys()].find((g) => k === g || k.includes(g) || g.includes(k));
    if (!match || k.length < 4) continue;
    const tie = ties.get(match) || { name: givers.get(match).name, paid: 0, gave: givers.get(match).gave, payments: 0 };
    tie.paid += e.amount;
    tie.payments++;
    ties.set(match, tie);
  }
  return [...ties.values()].sort((a, b) => b.paid - a.paid);
}

export function transparencyCount(town) {
  return TRANSPARENCY_CHECKS.filter((c) => town.transparency?.[c.key] === true).length;
}

export function gradeFor(score) {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 55) return 'C';
  if (score >= 40) return 'D';
  return 'F';
}

export function scoreTown(town) {
  const t = totals(town);
  const components = COMPONENTS.map((c) => {
    const available = c.available(t, town);
    const ratio = available ? clamp(c.measure(t, town)) : 0;
    return {
      key: c.key,
      label: c.label,
      max: c.max,
      available,
      points: available ? Math.round(ratio * c.max * 10) / 10 : null,
      ratio,
      detail: available ? c.detail(t, town) : (c.unavailable?.(t, town) || 'Not scored: no data loaded for this part yet'),
    };
  });
  // Parts with no data are left out and the rest are rescaled to 100, so
  // missing records never count as good or bad.
  const scored = components.filter((c) => c.available);
  const possible = scored.reduce((a, c) => a + c.max, 0);
  const earned = scored.reduce((a, c) => a + c.points, 0);
  const score = possible ? Math.round((earned / possible) * 1000) / 10 : 0;
  return {
    score,
    // A letter grade needs data behind at least half of the 100 points.
    grade: possible >= 50 ? gradeFor(score) : '?',
    components,
    totals: t,
    coverage: { scored: scored.length, total: components.length, possible },
  };
}

export function pct(v, digits = 0) {
  return `${(v * 100).toFixed(digits)}%`;
}

// Breakdown helpers return rows sorted for display.
export function revenueRows(town) {
  const total = sum(town.revenue);
  return REVENUE_CATEGORIES.map((c) => ({
    ...c,
    amount: town.revenue?.[c.key] || 0,
    share: total ? (town.revenue?.[c.key] || 0) / total : 0,
  })).filter((r) => r.amount > 0);
}

export function spendingRows(town) {
  const total = sum(town.spending);
  return SPENDING_CATEGORIES.map((c) => ({
    ...c,
    amount: town.spending?.[c.key] || 0,
    share: total ? (town.spending?.[c.key] || 0) / total : 0,
  })).filter((r) => r.amount > 0);
}

export function taxBreakRows(town) {
  return TAX_BREAK_CATEGORIES.map((c) => ({ ...c, amount: town.taxBreaks?.[c.key] || 0 })).filter((r) => r.amount > 0);
}

export function influenceRows(town) {
  return INFLUENCE_CATEGORIES.map((c) => ({ ...c, amount: town.influence?.[c.key] || 0 }));
}

// Map metrics: `higherIsBetter` drives the color direction on the map.
export const MAP_METRICS = [
  { key: 'score', label: 'Community Return Score', higherIsBetter: true, value: (s) => s.score, format: (v) => v.toFixed(0) },
  { key: 'directPerResident', label: 'Service dollars per resident', higherIsBetter: true, value: (s) => s.totals.directPerResident, format: (v) => `$${Math.round(v).toLocaleString('en-US')}` },
  { key: 'directShare', label: 'Share of spending on services', higherIsBetter: true, value: (s) => s.totals.directShare, format: (v) => pct(v) },
  { key: 'influencePerResident', label: 'Outside political money per resident', higherIsBetter: false, value: (s) => s.totals.influencePerResident, format: (v) => `$${v.toFixed(2)}` },
  { key: 'redFlagCount', label: 'Red flags: surveillance & corporate deals', higherIsBetter: false, value: (s) => s.totals.redFlagCount, format: (v) => `${Math.round(v)}` },
  { key: 'nonPropertyShare', label: 'Revenue not from property tax', higherIsBetter: null, value: (s) => s.totals.nonPropertyShare, format: (v) => pct(v) },
];
