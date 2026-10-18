// Maps an Iowa city's or county's Annual Financial Report, as published by the Department of
// Management, to Town Ledger categories.
//
// Cities report revenue by type and line item and spending by program (function) and line item,
// for every fund. Capital projects have no function, so they are spread over the city's other
// spending in proportion, which leaves its service and overhead shares as they are; enterprise
// capital outlay counts as utilities. Internal service funds (self-insurance, central garages)
// are left out, since the departments they serve report that spending. Other financing sources
// and uses (borrowing, transfers, internal TIF loans, sales of capital assets) are left out.
// Counties report revenue by type and spending by service area.
//
// Principal repaid with new borrowing is left out of debt service as refinancing: borrowing beyond
// the year's capital outlay, up to the debt service paid (the report does not split principal from
// interest), as in the Census builder.

export const UNCLASSIFIED_SHARE = 0.15;

const INTERNAL = /internal serv|\bisf\b|self[- ]*(funded|insur|insuar)|insurance|insuranc|health flex|medical flex|wellness|risk|garage|central (stores|maint)|fleet|equipment replacement|revolving|joint fueling|workers comp/i;
const UTILITY_ITEM = /water|sewer|electric|\bgas\b|storm|landfill|garbage|refuse|solid waste|recycl|utility|cable|broadband|internet|telephone/i;

// City revenue line -> [key, label] or null (left out).
export function cityRevenueKey(type, item, fund) {
  switch (type) {
    case 'Property Tax': return /tif/i.test(item) ? ['propertyTax', 'TIF revenues'] : ['propertyTax', 'Property taxes'];
    case 'Other City Taxes':
      if (/replacement excise|mobile home/i.test(item)) return ['propertyTax', 'Utility replacement and mobile home taxes'];
      if (/hotel|motel/i.test(item)) return ['salesTax', 'Hotel and motel tax'];
      if (/franchise/i.test(item)) return ['salesTax', 'Utility franchise tax'];
      return ['salesTax', 'Local option sales and other city taxes'];
    case 'Licenses & Permits': return ['feesPermits', 'Licenses and permits'];
    case 'Use of Money & Property': return ['localRevenue', /interest/i.test(item) ? 'Interest' : 'Rents and other use of money and property'];
    case 'Intergovernmental - Federal': return ['federalGrants', 'Federal grants'];
    case 'Intergovernmental - State':
      if (/road use/i.test(item)) return ['stateAid', 'Road use taxes'];
      if (/replacement claim/i.test(item)) return ['stateAid', 'Commercial and industrial property tax replacement'];
      return ['stateAid', 'State grants and aid'];
    case 'Intergovernmental - Local': return ['grants', 'From counties, townships and other local governments'];
    case 'Charges For Fees & Service':
      if (INTERNAL.test(item)) return null;
      return fund === 'Proprietary Fund' || UTILITY_ITEM.test(item) ? ['utilityCharges', 'Utility and enterprise charges'] : ['feesPermits', 'Charges for services'];
    case 'Special Assessments': return ['feesPermits', 'Special assessments'];
    case 'Micellaneous':
    case 'Miscellaneous':
      if (/internal/i.test(item)) return null;
      if (/fine/i.test(item)) return ['finesForfeitures', 'Fines'];
      return ['localRevenue', 'Contributions, sales of property and other revenue'];
    default: return null; // Other Financing Sources
  }
}

// City spending line -> [key, label], 'capital' (no function) or null (left out).
export function citySpendingKey(program, item) {
  switch (program) {
    case 'Public Safety': return ['publicSafety', /ambulance/i.test(item) ? 'Ambulance' : /fire/i.test(item) ? 'Fire' : /police/i.test(item) ? 'Police' : 'Other public safety'];
    case 'Public Works':
      if (/garbage/i.test(item)) return ['utilities', 'Garbage'];
      if (/airport/i.test(item)) return ['roads', 'Airport'];
      return ['roads', 'Roads, bridges, snow removal and other public works'];
    case 'Health and Social Services': return ['healthServices', 'Health and social services'];
    case 'Culture and Recreation': return ['parks', /library/i.test(item) ? 'Libraries' : /cemetery/i.test(item) ? 'Cemeteries' : 'Parks, recreation and culture'];
    case 'Comm and Econ Development': return ['administration', /tif rebate/i.test(item) ? 'TIF rebates' : 'Community and economic development'];
    case 'General Government': return ['administration', 'General government'];
    case 'Debt Service': return ['debtService', 'Debt service'];
    case 'Capital Projects': return 'capital';
    case 'Business Type / Enterprise':
      if (INTERNAL.test(item)) return null;
      if (/debt service/i.test(item)) return ['debtService', 'Debt service (enterprise funds)'];
      if (/hospital/i.test(item)) return ['healthServices', 'Hospital'];
      if (/airport|parking|transit/i.test(item)) return ['roads', 'Airport, parking and transit (enterprise funds)'];
      if (/housing/i.test(item)) return ['administration', 'Housing authority'];
      if (/\bems\b|ambulance/i.test(item)) return ['publicSafety', 'Ambulance'];
      return ['utilities', /capital outlay/i.test(item) ? 'Utility and enterprise capital outlay' : 'Water, sewer, electric, garbage and other enterprise operations'];
    default: return null; // Other Financing Uses
  }
}

const sum = (o) => Object.values(o).reduce((a, v) => a + v, 0);

function finish({ revenue, spending, lines, capital, borrowing, leftOut, enterpriseCapital = 0 }) {
  const add = (group, key, label, amount) => {
    if (!amount) return;
    const target = group === 'revenue' ? revenue : spending;
    target[key] = (target[key] || 0) + amount;
    const id = `${group}|${key}|${label}`;
    lines.set(id, (lines.get(id) || 0) + amount);
  };
  // Capital outlay without a function, spread over the other spending in proportion.
  if (capital) {
    const base = Object.entries(spending).filter(([k]) => k !== 'debtService' && k !== 'otherSpending');
    const total = base.reduce((a, [, v]) => a + v, 0);
    if (total) for (const [k, v] of base) add('spending', k, 'Capital projects (spread over services by spending)', (capital * v) / total);
    else add('spending', 'administration', 'Capital projects', capital);
  }
  // Refinancing: borrowing beyond the year's capital outlay, up to the debt service paid.
  const capitalOutlay = capital + enterpriseCapital;
  const refinanced = Math.min(spending.debtService || 0, Math.max(0, borrowing - capitalOutlay));
  if (refinanced) {
    spending.debtService -= refinanced;
    const ids = [...lines.keys()].filter((id) => id.startsWith('spending|debtService|'));
    const total = ids.reduce((a, id) => a + lines.get(id), 0);
    for (const id of ids) lines.set(id, lines.get(id) - (refinanced * lines.get(id)) / total);
  }
  if (spending.otherSpending && spending.otherSpending <= UNCLASSIFIED_SHARE * sum(spending)) {
    spending.administration = (spending.administration || 0) + spending.otherSpending;
    delete spending.otherSpending;
    for (const [id, amount] of [...lines]) {
      if (!id.startsWith('spending|otherSpending|')) continue;
      lines.delete(id);
      const moved = `spending|administration|${id.split('|')[2]}`;
      lines.set(moved, (lines.get(moved) || 0) + amount);
    }
  }
  const round = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)]).filter(([, v]) => v));
  const r = round(revenue);
  const s = round(spending);
  return {
    revenue: r,
    spending: s,
    lines: [...lines].map(([id, amount]) => { const [group, key, label] = id.split('|'); return { group, key, label, amount: Math.round(amount) }; }).filter((l) => l.amount),
    capital: Math.round(capital),
    refinanced: Math.round(refinanced),
    leftOut: Object.fromEntries(Object.entries({ ...leftOut, borrowing }).map(([k, v]) => [k, Math.round(v)])),
    empty: !sum(r) || !sum(s),
    // More than four times apart means an entry error or a part left out.
    inconsistent: sum(r) > 4 * sum(s) || sum(s) > 4 * sum(r),
  };
}

// city: { rev: [[type, item, fund, amount]], exp: [[program, item, fund, amount]] }
export function aggregateCity(city) {
  const revenue = {};
  const spending = {};
  const lines = new Map();
  const leftOut = { financingSources: 0, financingUses: 0, internalService: 0 };
  let capital = 0;
  let enterpriseCapital = 0;
  let borrowing = 0;
  const add = (group, key, label, amount) => {
    const target = group === 'revenue' ? revenue : spending;
    target[key] = (target[key] || 0) + amount;
    const id = `${group}|${key}|${label}`;
    lines.set(id, (lines.get(id) || 0) + amount);
  };
  for (const [type, item, fund, amount] of city.rev || []) {
    const k = cityRevenueKey(type, item, fund);
    if (k) add('revenue', k[0], k[1], amount);
    else if (type === 'Other Financing Sources') {
      leftOut.financingSources += amount;
      if (/proceeds of long-term debt/i.test(item)) borrowing += amount;
    } else leftOut.internalService += amount;
  }
  for (const [program, item, , amount] of city.exp || []) {
    const k = citySpendingKey(program, item);
    if (k === 'capital') capital += amount;
    else if (k) {
      add('spending', k[0], k[1], amount);
      if (program === 'Business Type / Enterprise' && /capital outlay/i.test(item)) enterpriseCapital += amount;
    } else if (program === 'Other Financing Uses') leftOut.financingUses += amount;
    else leftOut.internalService += amount;
  }
  return finish({ revenue, spending, lines, capital, borrowing, leftOut, enterpriseCapital });
}

const COUNTY_REVENUE = [
  ['net_current_property_taxes', 'propertyTax', 'Property taxes (net of credits and uncollected)'],
  ['delinquent_property_tax', 'propertyTax', 'Delinquent property taxes'],
  ['penalties_interest_costs', 'localRevenue', 'Penalties, interest and costs on taxes'],
  ['other_county_taxes_tif_tax', 'salesTax', 'Other county taxes, local option sales tax and TIF'],
  ['intergovernmental', 'stateAid', 'Intergovernmental: state, federal and local aid'],
  ['licenses_permits', 'feesPermits', 'Licenses and permits'],
  ['charges_for_service', 'feesPermits', 'Charges for services'],
  ['use_of_money_property', 'localRevenue', 'Use of money and property'],
  ['miscellaneous', 'localRevenue', 'Miscellaneous'],
];
const COUNTY_SPENDING = [
  ['public_safety_and_legal', 'publicSafety', 'Public safety and legal services'],
  ['physical_health_social', 'healthServices', 'Physical health and social services'],
  ['mental_health_id_dd', 'healthServices', 'Mental health and disability services'],
  ['county_environment_and_education', 'parks', 'County environment and education (conservation, libraries, extension)'],
  ['roads_transportation', 'roads', 'Roads and transportation'],
  ['government_services_to_residents', 'administration', 'Government services to residents (recorder, elections, treasurer)'],
  ['administration', 'administration', 'Administration'],
  ['nonprogram_current', 'otherSpending', 'Nonprogram current spending'],
  ['debt_service', 'debtService', 'Debt service'],
];

// county: { rev: {column: value}, exp: {column: value} }
export function aggregateCounty(county) {
  const num = (v) => Number(v) || 0;
  const revenue = {};
  const spending = {};
  const lines = new Map();
  const add = (group, key, label, amount) => {
    if (!amount) return;
    const target = group === 'revenue' ? revenue : spending;
    target[key] = (target[key] || 0) + amount;
    const id = `${group}|${key}|${label}`;
    lines.set(id, (lines.get(id) || 0) + amount);
  };
  const rev = county.rev || {};
  const exp = county.exp || {};
  for (const [col, key, label] of COUNTY_REVENUE) add('revenue', key, label, num(rev[col]));
  for (const [col, key, label] of COUNTY_SPENDING) add('spending', key, label, num(exp[col]));
  const borrowing = num(rev.general_long_term_debt);
  const leftOut = {
    financingSources: borrowing + num(rev.operating_transfers_in) + num(rev.proceeds_of_capital_asset),
    financingUses: num(exp.operating_transfers_out) + num(exp.refunded_debt_payments_to_escrow),
  };
  return finish({ revenue, spending, lines, capital: num(exp.capital_projects), borrowing, leftOut });
}
