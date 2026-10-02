// Presentation rules only. The scoring model remains unchanged.
import { money, number } from './format.js';

const hasNumbers = (obj) => obj && Object.values(obj).some(Number.isFinite);
const aliases = { direct: 'directPerResident', nonProp: 'nonPropertyShare', redFlags: 'redFlagCount', corporate: 'corporateMoney', influence: 'influencePerResident', debt: 'debtPerResident' };
export function metric(entry, requested) {
  const { town, s } = entry;
  const key = requested === 'politicalTotal' ? 'influence' : aliases[requested] || requested;
  const component = (name) => s.components.find((c) => c.key === name)?.available;
  let value = key === 'score' ? s.score : key === 'population' ? town.population : s.totals[key];
  let available = Number.isFinite(value);
  let reason = 'No data loaded for this measure';
  if (key === 'score') { available = s.grade !== '?'; reason = 'Not graded: data covers less than 50 of 100 scoring points'; }
  if (['directPerResident', 'directShare', 'adminShare'].includes(key)) { available = component('services'); reason = 'Spending is not fully broken down by department'; }
  if (['influence', 'influencePerResident'].includes(key)) { available = hasNumbers(town.influence); reason = 'No political filings loaded'; }
  if (key === 'corporateMoney') { available = ['corporateLobbying', 'developerContributions'].some((k) => Number.isFinite(town.influence?.[k])); reason = 'No corporate lobbying or business donation figures loaded'; }
  if (key === 'debtPerResident') { available = Number.isFinite(town.debt); reason = 'No debt statement loaded'; }
  if (key === 'taxBreaks') { available = hasNumbers(town.taxBreaks); reason = 'Tax-break amounts have not been checked'; }
  if (key === 'redFlagCount') { available = s.totals.redFlagKnown; reason = 'Red flags have not been checked'; }
  if (key === 'redFlagPerResident') {
    available = hasNumbers(town.taxBreaks) || ['surveillance', 'corporateDeals'].some((k) => Number.isFinite(town.spending?.[k])) || (town.ledger || town.redFlagLedger || []).some((e) => e.flow === 'out' && /surveillance|corporateDeals/.test(e.category));
    // A documented program without a dollar figure never establishes $0 spending.
    available ||= s.totals.redFlagSpending > 0;
    reason = 'Documented programs do not establish their dollar cost';
  }
  if (['revenue', 'nonPropertyRevenue', 'nonPropertyShare'].includes(key)) available = hasNumbers(town.revenue) && (key !== 'nonPropertyShare' || s.totals.revenue > 0);
  if (key === 'spending') available = hasNumbers(town.spending);
  available = Boolean(available && Number.isFinite(value));
  return { key, value: available ? value : null, available, reason: available ? '' : reason };
}
export function metricText(entry, key) {
  const m = metric(entry, key);
  if (!m.available) return m.key === 'score' ? 'Not graded' : 'Not available';
  if (m.key === 'score') return `${m.value.toFixed(1)} / 100`;
  if (['population', 'redFlagCount'].includes(m.key)) return number(m.value);
  if (['directShare', 'adminShare', 'nonPropertyShare'].includes(m.key)) return `${Math.round(m.value * 100)}%`;
  if (['influencePerResident', 'redFlagPerResident'].includes(m.key)) return `$${m.value.toFixed(2)}`;
  return money(m.value, { compact: ['revenue', 'spending', 'influence', 'corporateMoney', 'taxBreaks', 'nonPropertyRevenue'].includes(m.key) });
}
export function compareValues(a, b, direction = 'desc') {
  if (a == null || b == null) return a == null ? (b == null ? 0 : 1) : -1;
  return (direction === 'asc' ? 1 : -1) * (a - b);
}
export function coverageText({ town, s }) {
  return `FY ${town.fiscalYear ?? 'Not recorded'} · Retrieved ${town.asOf || 'Not recorded'} · ${s.coverage.scored}/${s.coverage.total} parts · ${s.coverage.possible}/100 scoring weight available`;
}
export function comparable(entries, requested) {
  if (entries.length < 2) return false;
  const key = requested === 'politicalTotal' ? 'influence' : aliases[requested] || requested;
  if (entries.some((e) => !metric(e, key).available)) return false;
  // Red-flag searches have no standardized completeness window yet.
  if (['redFlagCount', 'redFlagPerResident', 'taxBreaks'].includes(key)) return false;
  const political = ['influence', 'influencePerResident', 'corporateMoney'].includes(key);
  const signatures = entries.map(({ town, s }) => {
    const r = town.reporting || {};
    const finance = [town.fiscalYear, r.basis, r.scope];
    const politics = [r.politicalPeriod, r.politicalScope];
    const values = political ? politics : key === 'score' ? [...finance, ...(s.components.find((c) => c.key === 'influence')?.available ? politics : []), s.components.filter((c) => c.available).map((c) => c.key).join(',')] : finance;
    return values.every((v) => v != null && v !== '') ? JSON.stringify([town.demo === true, ...values]) : null;
  });
  return signatures[0] !== null && signatures.every((s) => s === signatures[0]);
}
