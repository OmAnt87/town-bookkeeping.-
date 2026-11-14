#!/usr/bin/env node
// Writes a plain HTML page per town and per state, plus sitemap.xml, so search
// engines and link previews can read what the app shows under #/town/<id>.
//   node scripts/build-pages.mjs [--out _site] [--summary data/real/summary.json]
// Run by .github/workflows/pages.yml at deploy; the pages are not committed.
//   town/<id>/index.html   score, key numbers, money in and out, link to the full report
//   state/<st>/index.html  state totals and a link to every government in it
//   state/index.html       every state
//   sitemap.xml            all of the above

import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from './lib.mjs';
import { scoreTown, revenueRows, spendingRows } from '../js/engine/scoring.js';
import { assignPeers, percentileText } from '../js/engine/peers.js';
import { stateSummary, GRADES } from '../js/engine/states.js';
import { metric, metricText } from '../js/engine/metrics.js';
import { reportingText } from '../js/engine/reporting.js';
import { plainSummary } from '../js/engine/summary.js';
import { money, number, escapeHTML as esc, formatDate } from '../js/engine/format.js';

export const SITE = 'https://townview.org/';
// Other governments in the same county linked from a town page.
const MAX_NEIGHBORS = 12;

export const townPath = (id) => `town/${encodeURIComponent(id)}/`;
export const statePath = (st) => `state/${String(st).toLowerCase()}/`;
const appTown = (id) => `/#/town/${encodeURIComponent(id)}`;
const place = (town) => `${town.name}, ${town.state}`;
const pct = (v) => `${Math.round(v * 100)}%`;
const plural = (n, one, many = `${one}s`) => `${number(n)} ${n === 1 ? one : many}`;
const graded = (s) => /^[A-F]$/.test(s.grade);

const badge = (s, size = '') =>
  `<span class="grade ${graded(s) ? `g-${s.grade}` : 'g-none'}${size ? ` grade-${size}` : ''}" role="img" aria-label="${graded(s) ? `Grade ${s.grade}` : 'Not graded'}">${graded(s) ? s.grade : '?'}</span>`;

// JSON-LD is inlined in a <script>, so "<" must not be able to close it.
const jsonLd = (data) => `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;

const BRAND_MARK = '<svg class="brand-mark" viewBox="0 0 32 32" width="34" height="34" aria-hidden="true"><rect width="32" height="32" rx="8" fill="var(--brand)"/><path d="M6.5 23v-8l4.25-3.75L15 15v8z" fill="#fff"/><path d="M16.5 23V8.5h4.5V23z" fill="#fff"/><path d="M22.5 23v-6.5h3V23z" fill="var(--accent-2)"/><rect x="5.5" y="24.5" width="21" height="1.8" rx=".9" fill="var(--accent-2)"/></svg>';

// The shell every static page shares. `path` is site-relative ("town/x/").
export function layout({ title, description, path, body, data }) {
  const url = `${SITE}${path}`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta name="theme-color" content="#1b3768" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#0b1424" media="(prefers-color-scheme: dark)">
<meta property="og:type" content="website">
<meta property="og:site_name" content="TownView">
<meta property="og:url" content="${esc(url)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:image" content="${SITE}img/og-image.png">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/img/favicon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,600;8..60,700&display=swap">
<link rel="stylesheet" href="/css/styles.css">
<script>try{var t=localStorage.getItem('tl-theme');if(t)document.documentElement.dataset.theme=t}catch(e){}</script>
${data ? jsonLd(data) : ''}
<script type="module">import{pageview,wireEvents}from'/js/track.js';pageview(location.pathname);wireEvents()</script>
</head>
<body class="static">
<a class="skip-link" href="#main">Skip to content</a>
<header class="topbar">
<a class="brand" href="/" aria-label="TownView home">${BRAND_MARK}<span class="brand-text"><span class="brand-name">Town<span>View</span></span><span class="brand-tag">Public money, in plain view</span></span></a>
<nav class="static-nav" aria-label="Main"><a href="/#/map">Map</a><a href="/#/rankings">Rankings</a><a href="/state/">States</a></nav>
</header>
<main id="main">
${body}
</main>
<footer class="site-footer"><div class="footer-base"><span>&copy; ${new Date().getFullYear()} TownView. Open data, no cookies, no personal data. <a href="/privacy.html">Privacy</a> · <a href="/#/method">How scores work</a></span><a href="https://github.com/OmAnt87/town-bookkeeping.-" rel="noopener">Source on GitHub</a></div></footer>
</body>
</html>
`;
}

// One sentence for search results and link previews.
export function townDescription(entry) {
  const { town, s } = entry;
  const t = s.totals;
  const where = [town.county, town.stateName || town.state].filter((x) => x && x !== town.name).join(', ');
  const books = t.revenue > 0 || t.spending > 0
    ? `took in ${money(t.revenue, { compact: true })} and spent ${money(t.spending, { compact: true })} in fiscal year ${town.fiscalYear}`
    : `has public records on file for fiscal year ${town.fiscalYear}`;
  const score = graded(s) ? `Community Return Score: ${s.score.toFixed(1)} of 100, grade ${s.grade}.` : 'Not graded yet.';
  return `${town.name}${where ? ` (${where})` : ''} ${books}. ${score} See where the money comes from and where it goes.`;
}

const tile = (k, v, sub) => `<div class="tile"><div class="k">${k}</div><div class="v num">${esc(v)}</div><div class="s">${esc(sub)}</div></div>`;

function moneyTable(caption, rows, total) {
  if (!rows.length) return `<section class="card"><h2>${caption}</h2><p class="muted">No figures on file.</p></section>`;
  const body = [...rows].sort((a, b) => b.amount - a.amount)
    .map((r) => `<tr><td class="wrap">${esc(r.label)}</td><td class="r num">${money(r.amount)}</td><td class="r num">${pct(r.share)}</td></tr>`).join('');
  return `<section class="card"><div class="card-head"><h2>${caption}</h2><span class="num muted small">${money(total)}</span></div>
<div class="table-wrap"><table><thead><tr><th>Category</th><th class="r">Amount</th><th class="r">Share</th></tr></thead><tbody>${body}</tbody></table></div></section>`;
}

// entry: { town, s, peer, provisional } from assignPeers. neighbors: entries in the same county.
export function renderTownPage(entry, neighbors = []) {
  const { town, s, peer } = entry;
  const t = s.totals;
  const stateName = town.stateName || town.state;
  const title = `${place(town)} budget: where the money goes - TownView`;
  const description = townDescription(entry);
  const perResident = (key) => (metric(entry, key).available ? `${metricText(entry, key)} per resident` : '');
  const flags = (town.redFlags || []).filter((f) => f.scored !== false);
  const peerLine = peer?.percentile != null
    ? `<p class="small muted">${percentileText(peer.percentile)} among ${number(peer.size)} ${esc(peer.label)}${entry.provisional ? ' (provisional: little data is behind this score)' : ''}.</p>`
    : '';
  const others = neighbors.filter((n) => n.town.id !== town.id)
    .sort((a, b) => (b.town.population || 0) - (a.town.population || 0)).slice(0, MAX_NEIGHBORS);

  const body = `<div class="page static-page">
<div class="report-head"><div>
<div class="crumbs"><a href="/">TownView</a> / <a href="/${statePath(town.state)}">${esc(stateName)}</a> / ${esc(town.name)}</div>
<h1>${esc(town.name)}, ${esc(stateName)}: where the money goes</h1>
<div class="meta-row"><span>${esc(town.type || 'Municipality')}${town.county ? ` in ${esc(town.county)}` : ''}</span><span>Population ${number(town.population)}</span><span>Fiscal year ${esc(town.fiscalYear)}</span>${town.asOf ? `<span>Data as of ${formatDate(town.asOf)}</span>` : ''}</div>
</div></div>
<section class="card static-score g-${graded(s) ? s.grade : 'none'}">
<div class="eyebrow">Community Return Score</div>
<div class="score-main">${badge(s, 'lg')}<div class="score-text"><div class="score-value num">${graded(s) ? `${s.score.toFixed(1)}<small> / 100</small>` : 'Not graded'}</div>
${graded(s) ? '' : '<p class="small muted">A letter grade needs data for at least half of the score.</p>'}${peerLine}</div></div>
<div class="callout">${plainSummary(town, s)}</div>
<p class="static-cta"><a class="btn btn-primary" href="${appTown(town.id)}" data-track="full-report">Open the full interactive report</a><a class="btn" href="/feeds/${encodeURIComponent(town.id)}.xml" type="application/rss+xml" data-track="rss">RSS feed of changes</a></p>
<p class="small muted">The full report adds the transaction ledger, multi-year trend, political donors, transparency checks and side-by-side comparison with other towns.</p>
</section>
<section class="tiles" aria-label="Key numbers">
${tile('Total money in', metricText(entry, 'revenue'), town.population ? `${money(t.revenue / town.population)} per resident` : '')}
${tile('Total money out', metricText(entry, 'spending'), town.population ? `${money(t.spending / town.population)} per resident` : '')}
${tile('Not from property tax', metricText(entry, 'nonPropertyShare'), 'share of revenue')}
${tile('Services per resident', metricText(entry, 'directPerResident'), metric(entry, 'directShare').available ? `${metricText(entry, 'directShare')} of spending` : 'Spending not fully broken down')}
${tile('Political money', metricText(entry, 'politicalTotal'), perResident('influencePerResident') || 'No filings loaded')}
${tile('Debt', metric(entry, 'debtPerResident').available ? money(town.debt, { compact: true }) : 'Not available', perResident('debtPerResident') || 'No debt statement loaded')}
</section>
<div class="grid grid-2">
${moneyTable('Money in', revenueRows(town), t.revenue)}
${moneyTable('Money out', spendingRows(town), t.spending)}
</div>
${flags.length ? `<section class="card"><h2>Red flags in public records</h2><ul class="static-flags">${flags.slice(0, 8).map((f) => `<li><strong>${esc(f.label)}</strong>${f.vendor ? ` (${esc(f.vendor)})` : ''}</li>`).join('')}</ul><p class="small muted">Surveillance programs, data center deals and corporate tax breaks cost points. Sources are listed in the <a href="${appTown(town.id)}">full report</a>.</p></section>` : ''}
<section class="card"><h2>About these figures</h2><p class="small">${esc(reportingText(town))}</p><p class="small muted">Figures come from public records. See <a href="/#/method">how scores work</a>.</p></section>
${others.length ? `<section class="card"><h2>Also in ${esc(town.county || stateName)}</h2><ul class="static-list">${others.map(listItem).join('')}</ul><p class="small"><a href="/${statePath(town.state)}">Every government in ${esc(stateName)}</a></p></section>` : ''}
</div>`;

  const data = {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'BreadcrumbList', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'TownView', item: SITE },
        { '@type': 'ListItem', position: 2, name: stateName, item: `${SITE}${statePath(town.state)}` },
        { '@type': 'ListItem', position: 3, name: town.name, item: `${SITE}${townPath(town.id)}` },
      ] },
      {
        '@type': 'Dataset',
        name: `${place(town)} local government finances, fiscal year ${town.fiscalYear}`,
        description,
        url: `${SITE}${townPath(town.id)}`,
        isAccessibleForFree: true,
        temporalCoverage: String(town.fiscalYear ?? ''),
        ...(town.asOf ? { dateModified: town.asOf } : {}),
        spatialCoverage: { '@type': 'Place', name: `${town.name}, ${stateName}`, ...(Number.isFinite(town.lat) && Number.isFinite(town.lng) ? { geo: { '@type': 'GeoCoordinates', latitude: town.lat, longitude: town.lng } } : {}) },
        creator: { '@type': 'Organization', name: 'TownView', url: SITE },
        ...(town.detailFile ? { distribution: [{ '@type': 'DataDownload', encodingFormat: 'application/json', contentUrl: `${SITE}data/real/${town.detailFile}` }] } : {}),
      },
    ],
  };
  return layout({ title, description, path: townPath(town.id), body, data });
}

const listItem = ({ town, s }) =>
  `<li><a href="/${townPath(town.id)}">${esc(town.name)}</a> <span class="muted">${graded(s) ? `${s.grade} · ${s.score.toFixed(0)}` : 'not graded'}</span></li>`;

// sum: one stateSummary() row. entries: that state's scored towns.
export function renderStatePage(sum, entries) {
  const title = `${sum.stateName} town and county budgets, graded - TownView`;
  const description = `Where the money goes in ${plural(sum.towns, 'local government')} in ${sum.stateName}: revenue, spending, debt and a Community Return Score for each.${sum.medianScore == null ? '' : ` Median score ${sum.medianScore.toFixed(0)} of 100.`}`;
  const counties = new Map();
  for (const e of entries) {
    const k = e.town.county || 'Other';
    (counties.get(k) || counties.set(k, []).get(k)).push(e);
  }
  const groups = [...counties.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([county, list]) => `<h3>${esc(county)}</h3><ul class="static-list">${list.sort((a, b) => a.town.name.localeCompare(b.town.name)).map(listItem).join('')}</ul>`).join('\n');
  const gradeLine = GRADES.filter((g) => sum.grades[g]).map((g) => `${g === '?' ? 'Not graded' : g} ${number(sum.grades[g])}`).join(' · ');
  const body = `<div class="page static-page">
<div class="report-head"><div>
<div class="crumbs"><a href="/">TownView</a> / <a href="/state/">States</a> / ${esc(sum.stateName)}</div>
<h1>${esc(sum.stateName)}: where local governments' money goes</h1>
<div class="meta-row"><span>${plural(sum.towns, 'government')}</span><span>Population ${number(sum.population)}</span><span>Grades: ${gradeLine}</span></div>
</div><p class="static-cta"><a class="btn btn-primary" href="/#/map?state=${esc(sum.state)}">Open the map</a><a class="btn" href="/#/rankings?state=${esc(sum.state)}">Rankings</a></p></div>
<section class="tiles static-tiles" aria-label="State numbers">
${tile('Median score', sum.medianScore == null ? 'Not available' : `${sum.medianScore.toFixed(0)} / 100`, 'Community Return Score')}
${tile('Median spent on services', sum.medianDirectShare == null ? 'Not available' : pct(sum.medianDirectShare), 'of spending')}
${tile('With red flags', sum.redFlagTowns == null ? 'Not checked' : number(sum.redFlagTowns), sum.redFlagTowns == null ? '' : `of ${number(sum.redFlagChecked)} checked`)}
</section>
<section class="card"><h2>Every government, by county</h2>
${groups}
</section>
</div>`;
  const data = {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: [
      { '@type': 'ListItem', position: 1, name: 'TownView', item: SITE },
      { '@type': 'ListItem', position: 2, name: 'States', item: `${SITE}state/` },
      { '@type': 'ListItem', position: 3, name: sum.stateName, item: `${SITE}${statePath(sum.state)}` },
    ],
  };
  return layout({ title, description, path: statePath(sum.state), body, data });
}

export function renderStateIndex(sums) {
  const towns = sums.reduce((a, s) => a + s.towns, 0);
  const body = `<div class="page static-page">
<div class="report-head"><div><div class="crumbs"><a href="/">TownView</a> / States</div>
<h1>Local government budgets by state</h1>
<div class="meta-row"><span>${plural(towns, 'government')}</span><span>${plural(sums.length, 'state')}, counting DC</span></div></div></div>
<section class="card"><ul class="static-list">${sums.map((s) => `<li><a href="/${statePath(s.state)}">${esc(s.stateName)}</a> <span class="muted">${plural(s.towns, 'government')}</span></li>`).join('')}</ul></section>
</div>`;
  return layout({
    title: 'Town, city and county budgets by state - TownView',
    description: `Revenue, spending, debt and a Community Return Score for ${number(towns)} local governments. Pick a state to see every town, city and county in it.`,
    path: 'state/',
    body,
  });
}

// urls: [{ path, lastmod? }], paths site-relative.
export function renderSitemap(urls) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `<url><loc>${esc(`${SITE}${u.path}`)}</loc>${/^\d{4}-\d{2}-\d{2}$/.test(u.lastmod || '') ? `<lastmod>${u.lastmod}</lastmod>` : ''}</url>`).join('\n')}
</urlset>
`;
}

// Scores the summary towns the way the app does at startup.
export function scoreAll(towns) {
  return assignPeers(towns.map((t) => ({ town: { ...t, demo: false }, s: scoreTown(t) })));
}

function write(out, path, content) {
  const dir = join(out, path);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'index.html'), content);
  return Buffer.byteLength(content);
}

function main() {
  const args = parseArgs();
  const out = args.out || '_site';
  const { towns } = JSON.parse(readFileSync(args.summary || 'data/real/summary.json', 'utf8'));
  const entries = scoreAll(towns);
  const byState = new Map();
  const byCounty = new Map();
  for (const e of entries) {
    (byState.get(e.town.state) || byState.set(e.town.state, []).get(e.town.state)).push(e);
    const k = `${e.town.state}|${e.town.county || ''}`;
    (byCounty.get(k) || byCounty.set(k, []).get(k)).push(e);
  }
  const sums = stateSummary(entries);
  const urls = [{ path: '' }, { path: 'state/' }];
  let bytes = write(out, 'state', renderStateIndex(sums));
  for (const sum of sums) {
    bytes += write(out, statePath(sum.state), renderStatePage(sum, byState.get(sum.state)));
    urls.push({ path: statePath(sum.state) });
  }
  for (const e of entries) {
    const neighbors = e.town.county ? byCounty.get(`${e.town.state}|${e.town.county}`) : [];
    bytes += write(out, townPath(e.town.id), renderTownPage(e, neighbors));
    urls.push({ path: townPath(e.town.id), lastmod: e.town.asOf });
  }
  writeFileSync(join(out, 'sitemap.xml'), renderSitemap(urls));
  console.log(`Wrote ${number(entries.length)} town pages, ${sums.length} state pages and sitemap.xml (${number(urls.length)} URLs) to ${out}/, ${(bytes / 1e6).toFixed(0)} MB of HTML`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
