// Maps an Ohio government's summarized annual financial report (as published by the Auditor of
// State) to Town Ledger categories.
//
// The governmental funds statement (total governmental funds) lists revenue or receipt columns, a
// total, spending columns by function, a second total, then other financing sources and uses and
// fund balances; columns are classified by that position, so a name like "Interest" or "Other" is
// read in context. Enterprise fund statements (water, sewer, electric, landfill, or villages'
// combined enterprise funds) list operating revenue, operating expenses and nonoperating items.
// Capital outlay in governmental funds has no function, so it is spread over the other spending in
// proportion. Depreciation, intergovernmental disbursements (the receiving government reports that
// spending), payments to refunded bond escrow agents, borrowing, transfers, advances, sales of
// capital assets, gains and losses, and special and extraordinary items are left out. General
// government, courts, community and economic development and community environment count as
// overhead.
//
// Principal repaid with new borrowing is left out of debt service as refinancing: bonds, notes and
// loans issued (other than refunding debt, whose escrow payments are already left out) beyond the
// year's capital outlay, up to the principal retired, as in the Census builder; Ohio governments
// often roll bond anticipation notes over from year to year.

export const UNCLASSIFIED_SHARE = 0.15;

const isTotal = (h) => /^Total\b/i.test(h);

export function revenueKey(h) {
  if (/^Property (And Other Local )?Taxes$/i.test(h)) return ['propertyTax', 'Property taxes'];
  if (/in lieu of taxes/i.test(h)) return ['propertyTax', 'Payments in lieu of taxes'];
  if (/income tax/i.test(h)) return ['salesTax', 'Municipal income tax'];
  if (/sales tax/i.test(h)) return ['salesTax', 'Sales tax'];
  if (/other local taxes/i.test(h)) return ['salesTax', 'Other local taxes'];
  if (/^Intergovernmental|^Operating Grants/i.test(h)) return ['stateAid', 'Intergovernmental revenue (state and federal)'];
  if (/^Special Assessments$/i.test(h)) return ['feesPermits', 'Special assessments'];
  if (/^Charges For Services$|^Sales$/i.test(h)) return ['feesPermits', 'Charges for services'];
  if (/licenses|permits/i.test(h)) return ['feesPermits', 'Licenses, permits and fees'];
  if (/^Fines And Forfeitures$/i.test(h)) return ['finesForfeitures', 'Fines and forfeitures'];
  if (/^Interest|^Earnings On Investments$/i.test(h)) return ['localRevenue', 'Interest'];
  return ['localRevenue', 'Rentals, royalties, contributions and other revenue'];
}

// Spending column (with the previous column, for "Other") -> [key, label], 'capital' or null.
export function spendingKey(h, prev = '') {
  if (/^Capital Outlay$/i.test(h)) return 'capital';
  if (/^Intergovernmental/i.test(h)) return null;
  if (/refunded/i.test(h)) return null;
  if (/principal|interest|bond issuance|capital appreciation|^Debt Service|^Other Debt Service$/i.test(h)) return ['debtService', 'Debt service'];
  if (/^Other$/i.test(h)) {
    if (/^(Police|Fire|Public Safety|Security)/i.test(prev)) return ['publicSafety', 'Other public safety'];
    if (/principal|interest|bond issuance|debt/i.test(prev)) return ['debtService', 'Debt service'];
    return ['otherSpending', 'Other'];
  }
  if (/judicial|legislative|general government/i.test(h)) return ['administration', /judicial/i.test(h) ? 'Courts' : 'General government'];
  if (/community and economic development|community environment/i.test(h)) return ['administration', 'Community and economic development'];
  if (/^Police$/i.test(h)) return ['publicSafety', 'Police'];
  if (/^Fire$/i.test(h)) return ['publicSafety', 'Fire'];
  if (/public safety|security of persons/i.test(h)) return ['publicSafety', 'Public safety'];
  if (/basic utility/i.test(h)) return ['utilities', 'Basic utility services'];
  if (/public works|public services|transportation/i.test(h)) return ['roads', 'Public works, streets and transportation'];
  if (/health|human services/i.test(h)) return ['healthServices', /human/i.test(h) ? 'Human services' : 'Health'];
  if (/recreation|leisure/i.test(h)) return ['parks', 'Parks, recreation and leisure'];
  return ['otherSpending', 'Other spending'];
}

// An enterprise statement's nonoperating column -> [group, key, label] or null.
function enterpriseNonoperating(h) {
  if (/refunded|^Sale Of|loans issued|debt proceeds|premium|discount|gain|loss on|^Intergovernmental (Disbursements|Expenses)|non operating (expenses|disbursements|uses)|^Receipts$|^Disbursements$|^Transfers|^Advances|capital contributions/i.test(h)) return null;
  if (/principal|interest and|fiscal charges|issuance|capital appreciation|^Other Debt Service$/i.test(h)) return ['spending', 'debtService', 'Debt service (enterprise funds)'];
  if (/^Capital Outlay$|excise tax/i.test(h)) return ['spending', 'utilities', 'Utility capital outlay and excise tax'];
  if (/^Property/i.test(h)) return ['revenue', 'propertyTax', 'Property taxes (enterprise funds)'];
  if (/intergovernmental|operating grants/i.test(h)) return ['revenue', 'stateAid', 'Intergovernmental revenue (enterprise funds)'];
  if (/special assessments/i.test(h)) return ['revenue', 'feesPermits', 'Special assessments (enterprise funds)'];
  if (/interest|earnings/i.test(h)) return ['revenue', 'localRevenue', 'Interest (enterprise funds)'];
  if (/other non operating (revenues|receipts|sources)|miscellaneous receipts/i.test(h)) return ['revenue', 'localRevenue', 'Other nonoperating revenue (enterprise funds)'];
  return null;
}

const sum = (o) => Object.values(o).reduce((a, v) => a + v, 0);

// gov: [[header, value]] of the governmental funds statement; ent: list of enterprise statements;
// debt: [[header, value]] of long-term obligations.
export function aggregateAos(gov = [], ent = [], debt = []) {
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
  const leftOut = { intergovernmental: 0, financing: 0, depreciation: 0 };
  let capital = 0;
  let borrowing = 0;
  // Split the statement into its revenue, spending and financing parts by its totals.
  const parts = { revenue: [], spending: [], financing: [] };
  const totals = {};
  {
    let section = 'revenue';
    for (const [h, v] of gov) {
      if (isTotal(h)) {
        if (section !== 'financing') totals[section] = Number(v) || 0;
        section = section === 'revenue' ? 'spending' : 'financing';
        continue;
      }
      parts[section].push([h, Number(v) || 0]);
    }
  }
  // Some governments enter disbursements as negative numbers, all or a few of them: read the
  // spending columns the way (as entered, flipped, or all as sizes) that matches their total.
  {
    const cols = parts.spending;
    const t = totals.spending ?? cols.reduce((a, [, v]) => a + v, 0);
    const readings = [cols.map(([h, v]) => [h, v]), cols.map(([h, v]) => [h, -v]), cols.map(([h, v]) => [h, Math.abs(v)])];
    const gap = (r) => Math.abs(Math.abs(t) - r.reduce((a, [, v]) => a + v, 0));
    parts.spending = readings.reduce((best, r) => (gap(r) < gap(best) ? r : best));
    totals.spending = Math.abs(t);
  }
  const rest = (section) => (totals[section] === undefined ? 0 : totals[section] - parts[section].reduce((a, [, v]) => a + v, 0));
  for (const [h, amount] of parts.revenue) { const k = revenueKey(h); add('revenue', k[0], k[1], amount); }
  // Some summaries leave part of a total out of the columns: the rest is its own line.
  if (Math.abs(rest('revenue')) > 1) add('revenue', 'localRevenue', 'Other receipts (in the total, not itemized in the summary)', rest('revenue'));
  let prev = '';
  for (const [h, amount] of parts.spending) {
    const k = spendingKey(h, prev);
    if (k === 'capital') capital += amount;
    else if (k) add('spending', k[0], k[1], amount);
    else if (/^Intergovernmental/i.test(h)) leftOut.intergovernmental += amount;
    prev = h;
  }
  if (Math.abs(rest('spending')) > 1) add('spending', 'otherSpending', 'Other disbursements (in the total, not itemized in the summary)', rest('spending'));
  for (const [h, amount] of parts.financing) {
    if (/excess of|over under|net change|beginning|end of year|fund balances/i.test(h)) continue;
    if (/^(Sale Of Bonds|Sale Of Notes|Loans Issued|Other Debt Proceeds|General Obligation Bonds Issued)$/i.test(h)) borrowing += Math.abs(amount);
    leftOut.financing += Math.abs(amount);
  }
  for (const pairs of ent) {
    let part = 'operatingRevenue';
    for (const [h, v] of pairs) {
      const amount = Number(v) || 0;
      if (isTotal(h)) {
        part = part === 'operatingRevenue' ? 'operatingExpense' : part === 'operatingExpense' ? 'nonoperating' : 'done';
        continue;
      }
      if (part === 'done') break;
      if (/income loss|operating income/i.test(h)) { if (part === 'operatingExpense') part = 'nonoperating'; continue; }
      if (part === 'operatingRevenue') add('revenue', 'utilityCharges', 'Water, sewer, electric and other utility charges', amount);
      else if (part === 'operatingExpense') {
        if (/depreciation/i.test(h)) leftOut.depreciation += Math.abs(amount);
        else add('spending', 'utilities', 'Water, sewer, electric and other utility operations', Math.abs(amount));
      } else {
        // Nonoperating disbursements are shown as negative numbers in the regulatory statements.
        const k = enterpriseNonoperating(h);
        if (k) add(k[0], k[1], k[2], k[0] === 'spending' ? Math.abs(amount) : amount);
        if (/^(Sale Of Bonds|Sale Of Notes|Loans Issued|Other Debt Proceeds)$/i.test(h)) borrowing += amount;
      }
    }
  }
  const enterpriseCapital = ent.flat().filter(([h]) => /^Capital Outlay$/i.test(h)).reduce((a, [, v]) => a + Math.abs(Number(v) || 0), 0);
  // Governmental capital outlay, spread over the other spending in proportion.
  if (capital) {
    const base = Object.entries(spending).filter(([k]) => k !== 'debtService' && k !== 'otherSpending');
    const total = base.reduce((a, [, v]) => a + v, 0);
    if (total) for (const [k, v] of base) add('spending', k, 'Capital outlay (spread over services by spending)', (capital * v) / total);
    else add('spending', 'administration', 'Capital outlay', capital);
  }
  // Refinancing: borrowing beyond the year's capital outlay, up to the principal retired.
  const principal = [...gov, ...ent.flat()].filter(([h]) => /principal/i.test(h)).reduce((a, [, v]) => a + Math.abs(Number(v) || 0), 0);
  const refinanced = Math.max(0, Math.min(principal, spending.debtService || 0, borrowing - capital - enterpriseCapital));
  if (refinanced) {
    const ids = [...lines.keys()].filter((id) => id.startsWith('spending|debtService|'));
    const total = ids.reduce((a, id) => a + lines.get(id), 0);
    for (const id of ids) lines.set(id, lines.get(id) - (refinanced * lines.get(id)) / total);
    spending.debtService -= refinanced;
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
    // Bonds, notes, loans, leases and other long-term obligations (governmental and business-type);
    // pension and OPEB liabilities and net position columns are not debt.
    debt: debt.length ? Math.round(debt.filter(([h]) => /bonds|notes|loans|leases|miscellaneous long term/i.test(h)).reduce((a, [, v]) => a + (Number(v) || 0), 0)) : null,
    leftOut: Object.fromEntries(Object.entries({ ...leftOut, borrowing }).map(([k, v]) => [k, Math.round(v)])),
    empty: !sum(r) || !sum(s),
    // More than four times apart means an entry error or a part left out.
    inconsistent: sum(r) > 4 * sum(s) || sum(s) > 4 * sum(r),
  };
}
