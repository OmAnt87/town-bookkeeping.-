// Small dependency-free chart and UI helpers. All return HTML strings or attach to a host element.

import { money, escapeHTML } from './engine/format.js';

export const ICONS = {
  check: '<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity=".15"/><path d="M6 10.2l2.6 2.6L14 7.4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cross: '<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity=".15"/><path d="M7 7l6 6M13 7l-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  unknown: '<svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="9" fill="currentColor" opacity=".15"/><path d="M7 10h6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  download: '<svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v10m0 0l-4-4m4 4l4-4M4 16h12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  close: '<svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  arrow: '<svg width="16" height="16" viewBox="0 0 20 20" aria-hidden="true"><path d="M4 10h12m0 0l-5-5m5 5l-5 5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  sort: '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 4l3-3 3 3M2 6l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>',
};

export const gradeBadge = (grade, size = '') => {
  const known = /^[A-F]$/.test(grade);
  return `<span class="grade ${known ? `g-${grade}` : 'g-none'} ${size ? `grade-${size}` : ''}" role="img" aria-label="${known ? `Grade ${grade}` : 'Not graded'}">${known ? grade : '?'}</span>`;
};

// Small pill marking a town whose figures come from real public records.
export const isVerified = (town) => town.demo !== true && (Boolean(town.detailFile) || (town.sources || []).some((src) => src.url));
export const verifiedPill = (town) =>
  !isVerified(town) ? '' : '<span class="pill pill-verified" title="Figures come from public records listed under Sources">Verified data</span>';

// Horizontal bar list. rows: [{ label, amount, share, color }]; bars scale to the largest row.
export function barList(rows, { total } = {}) {
  const max = Math.max(...rows.map((r) => r.amount), 1);
  return `<div class="bars">${rows
    .map(
      (r) => `<div class="bar-row" title="${escapeHTML(r.label)}: ${money(r.amount)}">
        <span class="lbl">${escapeHTML(r.label)}</span>
        <span class="bar" aria-hidden="true"><span style="width:${(r.amount / max) * 100}%;--c:${r.color}"></span></span>
        <span class="amt num">${money(r.amount, { compact: true })}${total ? `<small>${Math.round((r.amount / total) * 100)}%</small>` : ''}</span>
      </div>`,
    )
    .join('')}</div>`;
}

// Single stacked bar (part-of-whole) with a 2px gap between segments.
export function splitBar(parts) {
  const total = parts.reduce((a, p) => a + p.amount, 0) || 1;
  return `<div class="split" role="img" aria-label="${parts.map((p) => `${p.label} ${Math.round((p.amount / total) * 100)}%`).join(', ')}">${parts
    .map((p) => `<span style="flex:${p.amount / total};--c:${p.color}" title="${escapeHTML(p.label)}: ${money(p.amount)}"></span>`)
    .join('')}</div>`;
}

export function legendKey(items) {
  return `<div class="key">${items.map((i) => `<span><i style="--c:${i.color}"></i>${escapeHTML(i.label)}</span>`).join('')}</div>`;
}

// Line chart with a hover crosshair + tooltip. series: [{ label, color, values: [{x, y}] }]
export function lineChart(host, series, { height = 220, format = (v) => money(v, { compact: true }) } = {}) {
  const W = 640;
  const H = height;
  const pad = { l: 56, r: 16, t: 12, b: 28 };
  const xs = series[0].values.map((v) => v.x);
  const all = series.flatMap((s) => s.values.map((v) => v.y));
  let lo = Math.min(...all);
  let hi = Math.max(...all);
  const span = hi - lo || hi || 1;
  lo = Math.max(0, lo - span * 0.25);
  hi += span * 0.15;
  const x = (i) => pad.l + (i / Math.max(1, xs.length - 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const ticks = 4;
  let grid = '';
  for (let i = 0; i <= ticks; i++) {
    const v = lo + ((hi - lo) * i) / ticks;
    grid += `<line class="grid-line" x1="${pad.l}" x2="${W - pad.r}" y1="${y(v)}" y2="${y(v)}"/>
      <text class="axis-text num" x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end">${format(v)}</text>`;
  }
  const xl = xs.map((v, i) => `<text class="axis-text" x="${x(i)}" y="${H - 6}" text-anchor="middle">FY${String(v).slice(-2)}</text>`).join('');
  const lines = series
    .map((s) => `<path class="line" style="stroke:${s.color}" d="${s.values.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v.y)}`).join('')}"/>`)
    .join('');
  const lastDots = series
    .map((s) => { const i = s.values.length - 1; return `<circle class="dot" r="4.5" style="fill:${s.color}" cx="${x(i)}" cy="${y(s.values[i].y)}"/>`; })
    .join('');
  host.classList.add('chart');
  host.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${series.map((s) => s.label).join(' and ')} by fiscal year">
    ${grid}${xl}${lines}${lastDots}
    <line class="crosshair" style="stroke:var(--baseline)" stroke-width="1" y1="${pad.t}" y2="${H - pad.b}" visibility="hidden"/>
    <g class="hover-dots"></g>
    <rect x="${pad.l}" y="0" width="${W - pad.l - pad.r}" height="${H}" fill="transparent"/>
  </svg><div class="tooltip" hidden></div>`;
  const svg = host.querySelector('svg');
  const tip = host.querySelector('.tooltip');
  const cross = svg.querySelector('.crosshair');
  const dots = svg.querySelector('.hover-dots');
  svg.addEventListener('pointermove', (e) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(xs.length - 1, Math.round(((px - pad.l) / (W - pad.l - pad.r)) * (xs.length - 1))));
    cross.setAttribute('x1', x(i));
    cross.setAttribute('x2', x(i));
    cross.setAttribute('visibility', 'visible');
    dots.innerHTML = series.map((s) => `<circle class="dot" r="5" style="fill:${s.color}" cx="${x(i)}" cy="${y(s.values[i].y)}"/>`).join('');
    tip.hidden = false;
    tip.innerHTML = `<strong>Fiscal year ${xs[i]}</strong>${series
      .map((s) => `<div class="row"><span><i style="--c:${s.color}"></i>${s.label}</span><span class="num">${money(s.values[i].y)}</span></div>`)
      .join('')}`;
    const left = (x(i) / W) * r.width;
    tip.style.left = `${Math.min(left + 12, r.width - tip.offsetWidth - 4)}px`;
    tip.style.top = '8px';
  });
  svg.addEventListener('pointerleave', () => {
    tip.hidden = true;
    cross.setAttribute('visibility', 'hidden');
    dots.innerHTML = '';
  });
}

export function downloadFile(name, content, type = 'text/csv') {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Reads a CSS custom property's resolved value (for Leaflet, which needs real colors).
export const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
