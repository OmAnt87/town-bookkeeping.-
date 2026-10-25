// Rhode Island town school departments. A town's school department is part of the
// municipality, but it reports on the Municipal Transparency Portal as its own entity (code =
// the town's code less 1000): the town's own entry shows only its appropriation to the schools,
// while state school aid, federal grants and other school revenue go to the school department
// directly. Each town's money in and out add its school department's revenue and spending
// without counting the appropriation twice: the appropriation stays as town spending, and the
// school department's other revenue and its spending beyond the appropriation are added.
// Regional school districts (codes 960 and up) serve several towns and are separate
// governments, as school districts are in most states; towns show what they pay them.

export const SCHOOL_COUNTERPARTY = 'School department (Municipal Transparency Portal)';
export const RI_SCOPE = 'Municipal funds and the town school department under the uniform chart of accounts';
const OLD_SCOPE = 'Municipal funds under the uniform chart of accounts; schools shown as the town appropriation';
// The town's appropriation to its own school department (not to a regional district), as the
// town reports paying it and as the school department reports receiving it.
const OWN_APPROPRIATION = new Set(['Local Appropriation for Education', 'Supplemental Appropriation for Education', 'Other Education Appropriation']);
const APPROPRIATION_CLASS = 'Municipal Education Appropriation';

const num = (v) => Number(v) || 0;
const sum = (rows, control) => rows.filter((r) => r.control === control).reduce((a, r) => a + num(r.amount), 0);

// School department revenue by TownView category, leaving out the town appropriation.
export function schoolRevenue(rows = []) {
  const out = {};
  for (const r of rows.filter((x) => x.control === 'Revenue' && x.cls !== APPROPRIATION_CLASS)) {
    const key = r.group === 'State Aid' ? 'stateAid' : r.group === 'Federal Aid' ? 'federalGrants' : r.group === 'Local Revenue' ? 'feesPermits' : 'otherRevenue';
    out[key] = (out[key] || 0) + num(r.amount);
  }
  return out;
}
export const ownAppropriation = (townRows = []) => townRows.filter((r) => r.control === 'Expenditures' && OWN_APPROPRIATION.has(r.account)).reduce((a, r) => a + num(r.amount), 0);

// What one year's school department adds to the town: { revenue: {...}, spending } (spending
// beyond the town's appropriation, never negative), or null without a filing.
export function schoolYear(townRows, schoolRows) {
  if (!schoolRows?.length || !(sum(schoolRows, 'Expenditures') > 0)) return null;
  const revenue = schoolRevenue(schoolRows);
  return { revenue, revenueTotal: Object.values(revenue).reduce((a, b) => a + b, 0), spending: Math.max(0, sum(schoolRows, 'Expenditures') - ownAppropriation(townRows)), total: sum(schoolRows, 'Expenditures') };
}

// History from the portal: the town plus its school department each year. Once a town has a
// school department on file, a year without its filing is left out rather than drawn as a drop.
export function riHistory(years, schoolYears = {}) {
  const ys = Object.keys(years).filter((y) => sum(years[y], 'Revenue') > 0 && sum(years[y], 'Expenditures') > 0).sort();
  const has = ys.some((y) => schoolYear(years[y], schoolYears[y]));
  return ys.filter((y) => !has || schoolYear(years[y], schoolYears[y])).map((y) => {
    const s = schoolYear(years[y], schoolYears[y]);
    return { year: Number(y), revenue: Math.round(sum(years[y], 'Revenue') + (s?.revenueTotal || 0)), spending: Math.round(sum(years[y], 'Expenditures') + (s?.spending || 0)), basis: 'actual' };
  });
}

// Adds the town school department for the town's fiscal year to money in and out and rebuilds
// the history. `years` and `schoolYears` are the town's and its school department's portal rows
// by fiscal year. Safe to run again on a town it has already updated.
export function applySchools(town, years, schoolYears = {}, source) {
  for (const e of (town.ledger || []).filter((x) => x.counterparty === SCHOOL_COUNTERPARTY)) {
    const side = e.flow === 'in' ? town.revenue : town.spending;
    side[e.category] = (side[e.category] || 0) - e.amount;
    if (!side[e.category]) delete side[e.category];
  }
  town.ledger = (town.ledger || []).filter((x) => x.counterparty !== SCHOOL_COUNTERPARTY);
  town.notes = (town.notes || []).filter((n) => !/^Includes the (town's appropriation to its schools|school department)/.test(n));

  const y = String(town.fiscalYear);
  const s = schoolYear(years[y], schoolYears[y]);
  const shown = town.spending.education || 0;
  const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
  const date = `${y}-06-30`;
  if (s) {
    const rows = [];
    for (const [k, v] of Object.entries(s.revenue)) {
      const amount = Math.round(v);
      if (!amount) continue;
      town.revenue[k] = (town.revenue[k] || 0) + amount;
      rows.push({ date, flow: 'in', category: k, counterparty: SCHOOL_COUNTERPARTY, description: { stateAid: 'School department: state aid', federalGrants: 'School department: federal aid', feesPermits: 'School department: tuition and other local revenue' }[k] || 'School department: other revenue', amount, source });
    }
    const extra = Math.round(s.spending);
    if (extra) {
      town.spending.education = shown + extra;
      rows.push({ date, flow: 'out', category: 'education', counterparty: SCHOOL_COUNTERPARTY, description: 'School department spending beyond the town appropriation', amount: extra, source });
    }
    town.ledger.unshift(...rows);
    town.notes.splice(1, 0, `Includes the school department, which reports separately on the Municipal Transparency Portal: its spending (${money(s.total)}) in place of the town's appropriation to it, and its state aid, federal aid and other revenue (${money(s.revenueTotal)}). The appropriation is counted once, as town spending.${shown > ownAppropriation(years[y]) + 1 ? ' Payments to a regional school district are shown as the town paid them.' : ''}`);
  } else {
    town.notes.splice(1, 0, `Includes the town's appropriation to its schools (${money(shown)}). ${schoolYears && Object.keys(schoolYears).length ? `The school department's FY ${y} report is not on file, so its state and federal aid are not included.` : 'Its schools are run by a regional school district or the state, a separate government with its own revenue, so state school aid to it is not included.'}`);
  }
  if (town.reporting && (town.reporting.scope === OLD_SCOPE || town.reporting.scope === RI_SCOPE)) town.reporting.scope = s ? RI_SCOPE : OLD_SCOPE;
  town.history = riHistory(years, schoolYears);
  return s;
}

// Portal rows grouped into towns and town school departments: { towns: Map(code -> { name,
// years }), schools: Map(town code -> years) }. `rows` are parsed CSV rows of the "All Data" file.
export function groupMtp(rows) {
  const towns = new Map();
  const schools = new Map();
  for (const r of rows) {
    if (r.report_description !== 'Municipal Data Report') continue;
    const e = Number(r.entity);
    const row = { control: r.control_description, department: r.department_description, group: r.group_description, cls: r.class_description, account: r.account_description, amount: r.amount };
    if (e >= 1010 && e <= 1390 && !/school district/i.test(r.entity_description)) {
      const t = towns.get(e) || towns.set(e, { name: r.entity_description, years: {} }).get(e);
      (t.years[r.fiscal_year] ||= []).push(row);
    } else if (e >= 10 && e <= 390 && /school district/i.test(r.entity_description)) {
      const s = schools.get(e + 1000) || schools.set(e + 1000, {}).get(e + 1000);
      (s[r.fiscal_year] ||= []).push(row);
    }
  }
  return { towns, schools };
}
