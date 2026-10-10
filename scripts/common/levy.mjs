// Towns and cities in northern New England (New Hampshire, Vermont, Maine) collect the whole
// property tax bill, including the shares for the school district, the county and (in New
// Hampshire and Vermont) the state education tax, and pay those shares over. Many report the
// whole levy to the Census as their own property tax without the payments, so their revenue runs
// far ahead of their spending. A town's own share is what its appropriations need beyond its
// other revenue (that is how the town rate is set), so where the reported levy is more than
// that, only the town's share is kept.

import { aggregateUnit } from '../common/census-units.mjs';

// A levy more than this much above what the town's own spending needs is taken to include
// other governments' shares.
export const PASS_THROUGH_MARGIN = 0.1;

// Some towns file their school and county assessments as their own "other general government"
// operations (E89) instead of as payments to other governments. A town with no school spending
// whose E89 is more than this share of all its spending is taken to have done so.
export const ASSESSMENT_SHARE = 0.4;

const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);

// Census figures for one government-year (see aggregateUnit) plus passThrough: property tax
// collected for other governments and taken out, and assessments: E89 spending taken to be
// school and county assessments and left out. ownLevyOnly is for governments whose tax bill
// carries only their own levy (counties, and Vermont villages, whose town collects the rest).
export function aggregateLevy(items, ownLevyOnly = false) {
  let a = aggregateUnit(items);
  let assessments = 0;
  if (!ownLevyOnly && !a.spending.education) {
    const e89 = items.filter((it) => String(it.code).trim() === 'E89').reduce((s, it) => s + (Number(it.amount) || 0) * 1000, 0);
    if (e89 > ASSESSMENT_SHARE * a.lineTotals.spending) {
      assessments = Math.round(e89);
      a = aggregateUnit(items.filter((it) => String(it.code).trim() !== 'E89'));
    }
  }
  const levy = a.revenue.propertyTax || 0;
  const own = Math.max(0, sum(a.spending) - (sum(a.revenue) - levy));
  if (ownLevyOnly || levy <= own * (1 + PASS_THROUGH_MARGIN)) return { ...a, passThrough: 0, assessments };
  const passThrough = levy - own;
  const revenue = { ...a.revenue, propertyTax: own };
  if (!own) delete revenue.propertyTax;
  const lines = a.lines.map((l) => (l.key === 'propertyTax' ? { ...l, label: 'Property tax (own share)', amount: own } : l)).filter((l) => l.amount);
  return { ...a, revenue, lines, passThrough, assessments, lineTotals: { ...a.lineTotals, revenue: a.lineTotals.revenue - passThrough } };
}
