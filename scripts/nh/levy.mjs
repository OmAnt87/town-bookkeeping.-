// New Hampshire towns and cities collect the whole property tax bill, including the shares for
// the school district, the county and the state education tax, and pay those shares over. Many
// report the whole levy to the Census as their own property tax without the payments, so their
// revenue runs far ahead of their spending. A town's own share is what its appropriations need
// beyond its other revenue (that is how the Department of Revenue Administration sets the town
// rate), so where the reported levy is more than that, only the town's share is kept.

import { aggregateUnit } from '../common/census-units.mjs';

// A levy more than this much above what the town's own spending needs is taken to include
// other governments' shares.
export const PASS_THROUGH_MARGIN = 0.1;

const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);

// Census figures for one government-year (see aggregateUnit) plus passThrough: property tax
// collected for other governments and taken out. Counties levy only their own.
export function aggregateNh(items, isCounty = false) {
  const a = aggregateUnit(items);
  const levy = a.revenue.propertyTax || 0;
  const own = Math.max(0, sum(a.spending) - (sum(a.revenue) - levy));
  if (isCounty || levy <= own * (1 + PASS_THROUGH_MARGIN)) return { ...a, passThrough: 0 };
  const passThrough = levy - own;
  const revenue = { ...a.revenue, propertyTax: own };
  if (!own) delete revenue.propertyTax;
  const lines = a.lines.map((l) => (l.key === 'propertyTax' ? { ...l, label: 'Property tax (town share)', amount: own } : l)).filter((l) => l.amount);
  return { ...a, revenue, lines, passThrough, lineTotals: { ...a.lineTotals, revenue: a.lineTotals.revenue - passThrough } };
}
