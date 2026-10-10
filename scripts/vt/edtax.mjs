// Vermont towns and cities bill the statewide education property tax on the same bill as their
// own municipal tax, and pay it over to their school district (the state Education Fund sets
// the rates and funds the schools). Some report the whole levy to the Census as their own
// property tax, so their revenue runs far ahead of their spending. The Department of Taxes
// publishes each town's education and municipal property taxes, so where the reported levy is
// more than the town's municipal tax by at least half its education tax, the education tax is
// taken out.

import { aggregateUnit } from '../common/census-units.mjs';

// The reported levy must exceed the municipal tax by at least this share of the education tax.
// Levies fall into two groups: about the municipal tax (with district taxes or late payments a
// little above it) or about the municipal tax plus the education tax.
export const EDUCATION_SHARE = 0.5;

const norm = (s) => String(s).toLowerCase().replace(/jct\.?/g, 'junction').replace(/[^a-z]/g, '');

// Tax year that funds a fiscal year: towns on a July-June year bill the grand list of the April
// before; towns on a calendar year bill that year's.
export function taxYearFor(fyEnd) {
  const y = Number(fyEnd.slice(0, 4));
  return Number(fyEnd.slice(5, 7)) <= 6 ? y - 1 : y;
}

// taxes: { name: { year: { edu, muni } } } (taxrates.json). Census name "BARRE CITY" or
// "BRISTOL TOWN"; towns that share a name with a city keep the suffix in the tax file.
export function taxesFor(taxes, censusName, fyEnd) {
  const t = taxes[norm(censusName)] || taxes[norm(censusName.replace(/ (TOWN|CITY)$/i, ''))];
  if (!t) return null;
  const y = taxYearFor(fyEnd);
  // Essex Junction became a city in July 2022, so its first tax year is a year later.
  const v = t[y] || t[y + 1];
  return v ? { ...v, taxYear: t[y] ? y : y + 1 } : null;
}

const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);

// Census figures for one government-year (see aggregateUnit) plus passThrough: education
// property tax collected for the school district and taken out. tax is taxesFor(...) or null
// (counties and villages do not bill education tax).
export function aggregateVt(items, tax = null) {
  const a = aggregateUnit(items);
  const levy = a.revenue.propertyTax || 0;
  if (!tax || !tax.edu || levy - tax.muni < EDUCATION_SHARE * tax.edu) return { ...a, passThrough: 0 };
  const passThrough = Math.min(levy - tax.muni, tax.edu);
  const own = levy - passThrough;
  const revenue = { ...a.revenue, propertyTax: own };
  if (!own) delete revenue.propertyTax;
  const lines = a.lines.map((l) => (l.key === 'propertyTax' ? { ...l, label: 'Property tax (municipal)', amount: own } : l)).filter((l) => l.amount);
  return { ...a, revenue, lines, passThrough, lineTotals: { ...a.lineTotals, revenue: a.lineTotals.revenue - passThrough } };
}

// Revenue and spending more than four times apart means an entry error or a part left out.
export const inconsistent = (a) => sum(a.revenue) > 4 * sum(a.spending) || sum(a.spending) > 4 * sum(a.revenue);
