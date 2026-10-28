#!/usr/bin/env node
// Writes an RSS feed per town, listing when its books changed on main.
//   node scripts/build-feeds.mjs [--out feeds] [--ref HEAD] [--commits 60] [--days 90]
// Run by .github/workflows/pages.yml at deploy. Each item is one data commit
// on main's first-parent history that changed the town, so the feeds are
// rebuilt from git each time and need no stored state.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from './lib.mjs';
import { diffDatasets } from '../js/engine/changes.js';
import { money } from '../js/engine/format.js';

const SITE = 'https://townview.org/';
const SKIP = new Set(['data/real/summary.json', 'data/real/index.json']);
const LABELS = { revenue: 'Money in', spending: 'Money out', influence: 'Political money', taxBreaks: 'Tax breaks', debt: 'Debt', fiscalYear: 'Fiscal year', asOf: 'Data as of' };
// Items kept per feed; older ones drop off as new changes arrive.
const MAX_ITEMS = 20;

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });

// A file that did not exist at `sha` reads as an empty dataset.
function readAt(sha, path) {
  try { return JSON.parse(git('show', `${sha}:${path}`)); } catch { return { towns: [] }; }
}

// Reads many `sha:path` files in one git call; missing ones read as empty.
function readMany(specs) {
  const out = new Map(specs.map((k) => [k, { towns: [] }]));
  if (!specs.length) return out;
  const buf = execFileSync('git', ['cat-file', '--batch'], { input: `${specs.join('\n')}\n`, maxBuffer: 1 << 30, stdio: ['pipe', 'pipe', 'ignore'] });
  let pos = 0;
  for (const spec of specs) {
    const nl = buf.indexOf(10, pos);
    const header = buf.toString('utf8', pos, nl).split(' ');
    pos = nl + 1;
    if (header[1] !== 'blob') continue;
    const size = Number(header[2]);
    try { out.set(spec, JSON.parse(buf.toString('utf8', pos, pos + size))); } catch { /* not JSON */ }
    pos += size + 1;
  }
  return out;
}

function changedFiles(base, head) {
  return git('diff', '--name-only', base, head, '--', 'data/real/')
    .split('\n').filter((p) => p.endsWith('.json') && !SKIP.has(p));
}

// Each town at `head` in the changed files, paired with its record at `base`.
// A town whose file was renamed or split is found through the base summary,
// so it is compared with its old record rather than reported as new.
export function townVersions(base, head, files, read = readAt) {
  const before = new Map();
  for (const p of files) for (const t of read(base, p).towns || []) before.set(t.id, t);
  const after = files.flatMap((p) => read(head, p).towns || []);
  const missing = after.filter((t) => !before.has(t.id));
  if (missing.length) {
    const where = new Map((read(base, 'data/real/summary.json').towns || []).map((t) => [t.id, t.detailFile]));
    const extra = new Set(missing.map((t) => where.get(t.id)).filter((f) => f && !files.includes(`data/real/${f}`)));
    for (const f of extra) for (const t of read(base, `data/real/${f}`).towns || []) if (!before.has(t.id)) before.set(t.id, t);
  }
  return { before: { towns: [...before.values()] }, after: { towns: after } };
}

const fmt = (key, v) => (['fiscalYear', 'asOf'].includes(key) ? String(v ?? 'n/a') : money(v, { compact: true }));
// Exact dollars when the rounded figures would look the same.
const change = (key, a, b) => (fmt(key, a) === fmt(key, b) && a !== b ? `${money(a)} → ${money(b)}` : `${fmt(key, a)} → ${fmt(key, b)}`);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
const townUrl = (id) => `${SITE}#/town/${encodeURIComponent(id)}`;

// Plain-text lines describing one town's changes.
export function changeLines(d) {
  const lines = [];
  for (const c of d.changes) {
    if (c.kind === 'total' || c.kind === 'field') lines.push(`${LABELS[c.key]}: ${change(c.key, c.before, c.after)}`);
    if (c.kind === 'score') lines.push(`Community Return Score: ${c.before.score.toFixed(1)} (${c.before.grade}) → ${c.after.score.toFixed(1)} (${c.after.grade})`);
    if (c.kind === 'ledger') {
      const n = (k) => `${k} entr${k === 1 ? 'y' : 'ies'}`;
      lines.push(`Ledger: ${n(c.added.length)} added, ${c.removed.length} removed`);
      for (const e of c.added.slice(0, 5)) lines.push(`New entry: ${e.date} ${e.counterparty || ''} ${money(e.amount)}${e.description ? ` (${e.description})` : ''}`.replace(/\s+/g, ' '));
    }
    if (c.kind === 'redFlags') {
      for (const f of c.added) lines.push(`New red flag: ${f.label}${f.amount ? ` (${money(f.amount)})` : ''}`);
      for (const f of c.removed) lines.push(`Red flag removed: ${f.label}`);
    }
  }
  return lines;
}

// One feed item for a town changed by commit `sha` at `date`.
export function feedItem(d, sha, date) {
  // The data date goes last so the title leads with what changed in the books.
  const lines = changeLines(d).sort((a, b) => a.startsWith('Data as of') - b.startsWith('Data as of'));
  return {
    title: `Books updated: ${lines[0] || 'records revised'}${lines.length > 1 ? ` and ${lines.length - 1} more` : ''}`,
    link: townUrl(d.id),
    guid: `townview:${d.id}:${sha}`,
    date: new Date(date).toUTCString(),
    description: `<ul>${lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul><p><a href="${townUrl(d.id)}">See the full report</a></p>`,
  };
}

export function renderFeed(town, items) {
  const name = `${town.name}${town.state ? `, ${town.state}` : ''}`;
  const self = `${SITE}feeds/${encodeURIComponent(town.id)}.xml`;
  const body = items.map((i) => `
  <item>
    <title>${esc(i.title)}</title>
    <link>${esc(i.link)}</link>
    <guid isPermaLink="false">${esc(i.guid)}</guid>
    <pubDate>${i.date}</pubDate>
    <description>${esc(i.description)}</description>
  </item>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
<channel>
  <title>${esc(name)} - TownView</title>
  <link>${esc(townUrl(town.id))}</link>
  <atom:link href="${esc(self)}" rel="self" type="application/rss+xml"/>
  <description>${esc(`Changes to ${name}'s public books on TownView: money in and out, debt, political money, red flags and score.`)}</description>
  <language>en-us</language>${items[0] ? `\n  <lastBuildDate>${items[0].date}</lastBuildDate>` : ''}${body}
</channel>
</rss>
`;
}

function main() {
  const args = parseArgs();
  const out = args.out || 'feeds';
  const ref = args.ref || 'HEAD';
  const maxCommits = Number(args.commits) || 60;
  const days = Number(args.days) || 90;
  const towns = readAt(ref, 'data/real/summary.json').towns || [];
  // Newest first, so each feed lists its latest change first.
  const commits = git('log', '--first-parent', `--since=${days} days ago`, `-n${maxCommits}`, '--format=%H %cI', ref, '--', 'data/real')
    .trim().split('\n').filter(Boolean).map((l) => l.split(' '));
  const items = new Map();
  for (const [sha, date] of commits) {
    let parent;
    try { parent = git('rev-parse', `${sha}^1`).trim(); } catch { continue; }
    const files = changedFiles(parent, sha);
    const specs = [`${parent}:data/real/summary.json`, ...files.flatMap((p) => [`${parent}:${p}`, `${sha}:${p}`])];
    const cache = readMany(specs);
    const read = (at, p) => cache.get(`${at}:${p}`) || readAt(at, p);
    const { before, after } = townVersions(parent, sha, files, read);
    // Towns new to the site have no earlier books to compare, and a newer
    // retrieval date alone is not a change to the books.
    const diffs = diffDatasets(before, after).filter((d) => !d.added && d.changes.some((c) => c.key !== 'asOf'));
    for (const d of diffs) {
      const list = items.get(d.id) || [];
      if (list.length < MAX_ITEMS) list.push(feedItem(d, sha, date));
      items.set(d.id, list);
    }
    console.log(`${sha.slice(0, 8)} ${date}: ${diffs.length} town(s) changed`);
  }
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const town of towns) writeFileSync(join(out, `${town.id}.xml`), renderFeed(town, items.get(town.id) || []));
  console.log(`Wrote ${towns.length} feeds to ${out}/ from ${commits.length} data commit(s); ${items.size} town(s) have changes`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
