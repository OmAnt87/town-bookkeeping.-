#!/usr/bin/env node
// Emails the followers of each town whose books changed between two commits.
//   node scripts/notify-changes.mjs --base <sha> --head <sha> [--dry-run]
// Run by .github/workflows/notify-followers.yml after data is pushed.
// Without BUTTONDOWN_API_KEY it always runs dry and prints the emails.

import { execFileSync } from 'node:child_process';
import { parseArgs } from './lib.mjs';
import { diffDatasets, followTag } from '../js/engine/changes.js';
import { money } from '../js/engine/format.js';
import { sendToTag, followedTags } from './notifiers/buttondown.mjs';

const SITE = 'https://townview.org/';
const SKIP = new Set(['data/real/summary.json', 'data/real/index.json']);
const LABELS = { revenue: 'Money in', spending: 'Money out', influence: 'Political money', taxBreaks: 'Tax breaks', debt: 'Debt', fiscalYear: 'Fiscal year', asOf: 'Data as of' };

const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });

// A file that did not exist at `sha` reads as an empty dataset.
function readAt(sha, path) {
  try { return JSON.parse(git('show', `${sha}:${path}`)); } catch { return { towns: [] }; }
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

export function changedFiles(base, head) {
  return git('diff', '--name-only', base, head, '--', 'data/real/')
    .split('\n').filter((p) => p.endsWith('.json') && !SKIP.has(p));
}

const fmt = (key, v) => (['fiscalYear', 'asOf'].includes(key) ? String(v ?? 'n/a') : money(v, { compact: true }));
// Exact dollars when the rounded figures would look the same.
const change = (key, a, b) => (fmt(key, a) === fmt(key, b) && a !== b ? `${money(a)} → ${money(b)}` : `${fmt(key, a)} → ${fmt(key, b)}`);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function composeEmail(d) {
  const url = `${SITE}#/town/${encodeURIComponent(d.id)}`;
  const lines = [];
  if (d.added) lines.push('Full records for this town were added to TownView.');
  for (const c of d.changes) {
    if (c.kind === 'total' || c.kind === 'field') lines.push(`${LABELS[c.key]}: ${change(c.key, c.before, c.after)}`);
    if (c.kind === 'score') lines.push(`Community Return Score: ${c.before.score.toFixed(1)} (${c.before.grade}) → ${c.after.score.toFixed(1)} (${c.after.grade})`);
    if (c.kind === 'ledger') {
      lines.push(`Ledger: ${c.added.length} new entr${c.added.length === 1 ? 'y' : 'ies'}, ${c.removed.length} removed`);
      for (const e of c.added.slice(0, 5)) lines.push(`  - ${e.date} ${e.counterparty || ''} ${money(e.amount)}${e.description ? ` (${e.description})` : ''}`);
      if (c.added.length > 5) lines.push(`  - ...and ${c.added.length - 5} more`);
    }
    if (c.kind === 'redFlags') {
      for (const f of c.added) lines.push(`New red flag: ${f.label}${f.amount ? ` (${money(f.amount)})` : ''}`);
      for (const f of c.removed) lines.push(`Red flag removed: ${f.label}`);
    }
  }
  const subject = `${d.name}${d.state ? `, ${d.state}` : ''}: the town's books were updated`;
  const body = `The records for **${esc(d.name)}** on TownView changed.\n\n${lines.map((l) => (l.startsWith('  - ') ? `  - ${esc(l.slice(4))}` : `- ${esc(l)}`)).join('\n')}\n\n[See the full report](${url})\n\nYou get this because you followed ${esc(d.name)} on TownView.`;
  return { tag: followTag(d.id), subject, body };
}

async function main() {
  const args = parseArgs();
  if (!args.base || !args.head) throw new Error('Usage: notify-changes.mjs --base <sha> --head <sha> [--dry-run]');
  // A brand-new branch has no previous commit to compare against.
  if (/^0+$/.test(args.base)) { console.log('No base commit; nothing to compare.'); return; }
  const key = process.env.BUTTONDOWN_API_KEY;
  const dry = Boolean(args['dry-run']) || !key;
  const files = changedFiles(args.base, args.head);
  const { before, after } = townVersions(args.base, args.head, files);
  // A town new to the site has no followers yet.
  const diffs = diffDatasets(before, after).filter((d) => !d.added);
  console.log(`${files.length} data file(s) changed, ${diffs.length} town(s) with changed books${dry ? ' (dry run)' : ''}`);
  // Only towns someone follows get an email; a bulk data refresh must not send thousands.
  const tags = dry ? null : await followedTags(key);
  const targets = tags ? diffs.filter((d) => tags.has(followTag(d.id))) : diffs;
  if (tags) console.log(`${targets.length} of them have followers`);
  let failed = 0;
  for (const d of targets) {
    const email = composeEmail(d);
    if (dry) { console.log(`\n--- to tag ${email.tag}\nSubject: ${email.subject}\n${email.body}`); continue; }
    try { await sendToTag(key, email); console.log(`sent: ${email.tag}`); } catch (err) { failed++; console.error(`failed: ${email.tag}: ${err.message}`); }
  }
  if (failed) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err.message); process.exit(1); });
