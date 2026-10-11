// Towns and cities in northern New England (New Hampshire, Vermont, Maine) collect the whole
// property tax bill, including the shares for the school district, the county and (in New
// Hampshire and Vermont) the state education tax, and pay those shares over. Many report the
// whole levy to the Census as their own property tax without the payments, so their revenue runs
// far ahead of their spending. A town's own share is what its appropriations need beyond its
// other revenue (that is how the town rate is set), so where the reported levy is more than
// that, only the town's share is kept.
//
// Where the state publishes each town's taxes (Vermont lists the education and municipal
// property tax billed in every town), those figures are used instead of the estimate.

import { aggregateUnit } from '../common/census-units.mjs';

// A levy more than this much above what the town's own spending needs is taken to include
// other governments' shares.
export const PASS_THROUGH_MARGIN = 0.1;

// Some towns file their school and county assessments as their own "other general government"
// operations (E89) instead of as payments to other governments. A town with no school spending
// whose E89 is more than this share of all its spending is taken to have done so.
export const ASSESSMENT_SHARE = 0.4;

// With the state's figures, a reported levy above the municipal tax by at least this share of the
// education tax is taken to include it. Vermont levies fall into two groups: about the municipal
// tax (district taxes or late payments a little above it) or about municipal plus education.
export const EDUCATION_SHARE = 0.5;

const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);

// Census figures for one government-year (see aggregateUnit) plus passThrough: property tax
// collected for other governments and taken out, and assessments: E89 spending taken to be
// school and county assessments and left out. ownLevyOnly is for governments whose tax bill
// carries only their own levy (counties, and Vermont villages, whose town collects the rest).
// taxes is the state's figures for the town's tax year, { edu, muni, taxYear }, or null; with
// them the result has passThroughSource 'state'.
export function aggregateLevy(items, ownLevyOnly = false, taxes = null) {
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
  if (ownLevyOnly) return { ...a, passThrough: 0, assessments };
  let own;
  if (taxes) {
    if (!taxes.edu || levy - taxes.muni < EDUCATION_SHARE * taxes.edu) return { ...a, passThrough: 0, assessments, passThroughSource: 'state' };
    own = levy - Math.min(levy - taxes.muni, taxes.edu);
  } else {
    own = Math.max(0, sum(a.spending) - (sum(a.revenue) - levy));
    if (levy <= own * (1 + PASS_THROUGH_MARGIN)) return { ...a, passThrough: 0, assessments };
  }
  const passThrough = levy - own;
  const revenue = { ...a.revenue, propertyTax: own };
  if (!own) delete revenue.propertyTax;
  const lines = a.lines.map((l) => (l.key === 'propertyTax' ? { ...l, label: 'Property tax (own share)', amount: own } : l)).filter((l) => l.amount);
  return { ...a, revenue, lines, passThrough, assessments, ...(taxes ? { passThroughSource: 'state' } : {}), lineTotals: { ...a.lineTotals, revenue: a.lineTotals.revenue - passThrough } };
}
