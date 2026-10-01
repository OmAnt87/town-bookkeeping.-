// Community Return Score: how much of a town's money comes back to residents
// as services, and how clean the money around the town is. Pure functions only.

import {
  REVENUE_CATEGORIES,
  SPENDING_CATEGORIES,
  INFLUENCE_CATEGORIES,
  TRANSPARENCY_CHECKS,
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
  const direct = SPENDING_CATEGORIES.filter((c) => c.direct)
    .reduce((a, c) => a + (town.spending?.[c.key] || 0), 0);
  const pop = Math.max(1, town.population || 1);
  return {
    revenue,
    spending,
    influence,
    propertyTax,
    nonPropertyRevenue: revenue - propertyTax,
    nonPropertyShare: revenue ? (revenue - propertyTax) / revenue : 0,
    directSpending: direct,
    directShare: spending ? direct / spending : 0,
    adminShare: spending
      ? ((town.spending?.administration || 0) + (town.spending?.consultants || 0)) / spending
      : 0,
    spendingPerResident: spending / pop,
    directPerResident: direct / pop,
    influencePerResident: influence / pop,
    debtPerResident: (town.debt || 0) / pop,
    balance: revenue - spending,
  };
}

// Each component returns { key, label, points, max, detail } so the UI can
// explain exactly where the score came from.
export const COMPONENTS = [
  {
    key: 'services',
    label: 'Money reaching residents',
    max: 30,
    available: (t) => t.spending > 0,
    measure: (t) => scale(t.directShare, 0.5, 0.88),
    detail: (t) => `${pct(t.directShare)} of spending goes to direct services`,
  },
  {
    key: 'overhead',
    label: 'Low overhead',
    max: 15,
    available: (t) => t.spending > 0,
    measure: (t) => scale(t.adminShare, 0.3, 0.06),
    detail: (t) => `${pct(t.adminShare)} spent on administration and consultants`,
  },
  {
    key: 'influence',
    label: 'Low outside political money',
    max: 20,
    available: (_t, town) => hasData(town.influence),
    measure: (t) => scale(t.influencePerResident, 12, 0.5),
    detail: (t) => `$${t.influencePerResident.toFixed(2)} in PAC, donor and lobbying money per resident`,
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
      detail: available ? c.detail(t, town) : 'Not scored: no data loaded for this part yet',
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

export function influenceRows(town) {
  return INFLUENCE_CATEGORIES.map((c) => ({ ...c, amount: town.influence?.[c.key] || 0 }));
}

// Map metrics: `higherIsBetter` drives the color direction on the map.
export const MAP_METRICS = [
  { key: 'score', label: 'Community Return Score', higherIsBetter: true, value: (s) => s.score, format: (v) => v.toFixed(0) },
  { key: 'directPerResident', label: 'Service dollars per resident', higherIsBetter: true, value: (s) => s.totals.directPerResident, format: (v) => `$${Math.round(v).toLocaleString('en-US')}` },
  { key: 'directShare', label: 'Share of spending on services', higherIsBetter: true, value: (s) => s.totals.directShare, format: (v) => pct(v) },
  { key: 'influencePerResident', label: 'Outside political money per resident', higherIsBetter: false, value: (s) => s.totals.influencePerResident, format: (v) => `$${v.toFixed(2)}` },
  { key: 'nonPropertyShare', label: 'Revenue not from property tax', higherIsBetter: null, value: (s) => s.totals.nonPropertyShare, format: (v) => pct(v) },
];
