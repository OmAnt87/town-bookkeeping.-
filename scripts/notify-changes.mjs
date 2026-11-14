#!/usr/bin/env node
// Emails the people who follow a town by email when a push changes its books.
//   node scripts/notify-changes.mjs --base <sha> --head <sha> [--dry-run]
// Run by .github/workflows/notify-followers.yml after data reaches main.
// Without BUTTONDOWN_API_KEY it always runs dry and prints the emails.
//
// The change lines are the same ones the town's RSS feed shows
// (changeLines in scripts/build-feeds.mjs). Only towns with at least one
// confirmed follower get an email, so a statewide rebuild does not queue
// thousands of empty sends.

import { parseArgs } from './lib.mjs';
import { diffDatasets, followTag } from '../js/engine/changes.js';
import { changeLines, changedFiles, townVersions, readAt } from './build-feeds.mjs';
import { followerCounts, sendToTag } from './notifiers/buttondown.mjs';

const SITE = 'https://townview.org/';
// More changed towns with followers than this in one push is more likely a
// pipeline mistake than news; the run stops and asks for a look first.
export const MAX_SENDS = 300;

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

export function composeEmail(d) {
  const url = `${SITE}town/${encodeURIComponent(d.id)}/`;
  const place = `${d.name}${d.state ? `, ${d.state}` : ''}`;
  const lines = changeLines(d).sort((a, b) => a.startsWith('Data as of') - b.startsWith('Data as of'));
  return {
    tag: followTag(d.id),
    subject: `${place}: the town's books were updated`,
    body: `The public records for **${esc(place)}** on TownView changed.\n\n${lines.map((l) => `- ${esc(l)}`).join('\n')}\n\n[See the full report](${url})\n\nYou get this because you asked for email about ${esc(d.name)} on TownView. Use the unsubscribe link below to stop all TownView emails.`,
  };
}

// The emails one push should send: changed towns (not just a newer retrieval
// date, not newly added towns) that have confirmed followers.
export function plannedEmails(diffs, counts) {
  return diffs
    .filter((d) => !d.added && d.changes.some((c) => c.key !== 'asOf'))
    .filter((d) => (counts[followTag(d.id)] || 0) > 0)
    .map(composeEmail);
}

async function main() {
  const args = parseArgs();
  if (!args.base || !args.head) throw new Error('Usage: notify-changes.mjs --base <sha> --head <sha> [--dry-run]');
  // A brand-new branch has no previous commit to compare against.
  if (/^0+$/.test(args.base)) { console.log('No base commit; nothing to compare.'); return; }
  const key = process.env.BUTTONDOWN_API_KEY;
  const dry = Boolean(args['dry-run']) || !key;
  const files = changedFiles(args.base, args.head);
  const { before, after } = townVersions(args.base, args.head, files, readAt);
  const diffs = diffDatasets(before, after);
  // A dry run without a key pretends every changed town has a follower, to show the emails.
  const counts = key ? await followerCounts(key) : Object.fromEntries(diffs.map((d) => [followTag(d.id), 1]));
  const emails = plannedEmails(diffs, counts);
  console.log(`${files.length} data file(s) changed, ${diffs.length} town(s) with changed books, ${emails.length} with email followers${dry ? ' (dry run)' : ''}`);
  if (!dry && emails.length > MAX_SENDS) {
    console.error(`Refusing to send ${emails.length} emails in one run (limit ${MAX_SENDS}). Check the data push, then run the workflow by hand.`);
    process.exit(1);
  }
  let failed = 0;
  for (const email of emails) {
    if (dry) { console.log(`\n--- to tag ${email.tag}\nSubject: ${email.subject}\n${email.body}`); continue; }
    try { await sendToTag(key, email); console.log(`sent: ${email.tag}`); } catch (err) { failed++; console.error(`failed: ${email.tag}: ${err.message}`); }
  }
  if (failed) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((err) => { console.error(err.message); process.exit(1); });
