// Data checks for a single town record. Pure functions only: the build scripts
// run them before writing a county file, the tests run them over every real
// town, and the app uses them to hold back a grade it can't stand behind.
//
// Each check returns { code, severity, message }. An 'error' means the record
// can't be right as loaded (no revenue, a budget that doesn't add up), so the
// town gets no grade. A 'warn' is unusual but can be real, and is shown as a note.

const sum = (obj = {}) => Object.values(obj).reduce((a, b) => a + (Number(b) || 0), 0);

// Rough bounding boxes (south, north, west, east) for states with real data.
export const STATE_BOUNDS = {
  CT: [40.9, 42.1, -73.8, -71.7],
  NJ: [38.9, 41.4, -75.6, -73.8],
  NY: [40.4, 45.1, -79.8, -71.8],
  PA: [39.7, 42.3, -80.6, -74.6],
};

// Money in against money out. A bond-funded project can push a year past the
// warning band; past the error band, part of one side is missing.
const RATIO_WARN = [0.5, 2];
const RATIO_ERROR = [0.25, 4];
// A history year this far from the town's typical year is a partial filing, not a real change.
const HISTORY_OUTLIER = 4;
// Ledger rows should add up to the totals they itemize.
const LEDGER_TOLERANCE = 0.02;
const STALE_YEARS = 5;

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const outside = (r, [lo, hi]) => r < lo || r > hi;

// Years whose revenue or spending is more than 4x off the town's median year.
export function historyOutliers(history = []) {
  const out = new Set();
  if (history.length < 3) return out;
  for (const k of ['revenue', 'spending']) {
    const mid = median(history.map((h) => h[k]).filter((v) => v > 0));
    if (!mid) continue;
    for (const h of history) {
      if (!(h[k] > 0) || h[k] / mid > HISTORY_OUTLIER || mid / h[k] > HISTORY_OUTLIER) out.add(h.year);
    }
  }
  return out;
}

// History with partial or broken years dropped, for charts and builds.
export function cleanHistory(history = []) {
  let kept = history;
  // Dropping a wild year moves the median, which can expose another one.
  for (let pass = 0; pass < 3; pass++) {
    const bad = historyOutliers(kept);
    if (!bad.size) break;
    kept = kept.filter((h) => !bad.has(h.year));
  }
  return kept;
}

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;

export function validateTown(town, { year = new Date().getFullYear() } = {}) {
  const issues = [];
  const add = (severity, code, message) => issues.push({ severity, code, message });
  const revenue = sum(town.revenue);
  const spending = sum(town.spending);

  if (!(town.population > 0)) add('error', 'population', 'No population on file, so per-resident figures can\'t be worked out.');
  if (!(revenue > 0)) add('error', 'no-revenue', 'No revenue is on file for this year\'s report.');
  if (!(spending > 0)) add('error', 'no-spending', 'No spending is on file for this year\'s report.');

  const box = STATE_BOUNDS[town.state];
  if (box && !(town.lat >= box[0] && town.lat <= box[1] && town.lng >= box[2] && town.lng <= box[3])) {
    add('error', 'location', `The map location is outside ${town.stateName || town.state}.`);
  }

  if (revenue > 0 && spending > 0) {
    const r = revenue / spending;
    if (outside(r, RATIO_ERROR)) {
      add('error', 'imbalance', `Money in (${money(revenue)}) and money out (${money(spending)}) are too far apart for a complete report; part of one side is probably missing.`);
    } else if (outside(r, RATIO_WARN)) {
      add('warn', 'imbalance', `Money in (${money(revenue)}) and money out (${money(spending)}) are far apart. This can be real (a bond-funded project, money saved for one), but check the source report.`);
    }
  }

  // Towns in these states live on the property tax; a tiny levy means part of the budget is missing.
  const pt = town.revenue?.propertyTax;
  if ((town.state === 'NJ' || town.state === 'CT') && town.population > 1000 && revenue > 0 && !(pt / town.population >= 50)) {
    add('warn', 'property-tax', `Property tax of ${money(pt || 0)} is under $50 per resident, which is unusual here.`);
  }

  const outliers = [...historyOutliers(town.history)];
  if (outliers.length) {
    add('warn', 'history', `Left out of the trend because the figures are far off the town's other years (probably a partial filing): ${outliers.sort().join(', ')}.`);
  }

  if (town.ledger?.length) {
    const flow = (f) => town.ledger.filter((e) => e.flow === f).reduce((a, e) => a + (Number(e.amount) || 0), 0);
    for (const [f, total, label] of [['in', revenue, 'money in'], ['out', spending, 'money out']]) {
      const rows = flow(f);
      if (total > 0 && rows > 0 && Math.abs(rows - total) / total > LEDGER_TOLERANCE) {
        add('warn', 'ledger', `Ledger rows for ${label} add up to ${money(rows)}, not the ${money(total)} total.`);
      }
    }
  }

  if (town.fiscalYear && year - town.fiscalYear > STALE_YEARS) {
    add('warn', 'stale', `The latest report on file is from ${town.fiscalYear}.`);
  }
  return issues;
}

export const dataErrors = (town) => validateTown(town).filter((i) => i.severity === 'error');
