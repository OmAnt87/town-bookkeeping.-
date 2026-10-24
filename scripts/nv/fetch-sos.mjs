#!/usr/bin/env node
// Downloads Nevada Secretary of State campaign finance data into data/raw/nv/sos/ (gitignored),
// from the public "C&E / FD Report Search" (Aurora):
//   - candidates.json: every candidate filing with each county and city in each election year
//     since three years ago, with the office from their candidate page
//   - contributions-<year>-<month>.csv: every contribution reported since three years ago, from
//     the contribution search's "export only" CSV, one month at a time
//
//   node scripts/nv/fetch-sos.mjs      then: node scripts/nv/build-county.mjs --all
//   (--contributions-only keeps candidates.json from an earlier run; --from=YYYY-MM resumes
//   the monthly downloads there)
//
// The site is behind a bot check that turns away curl and headless browsers, so this drives a
// visible Chromium with Playwright (npm i playwright), under xvfb-run when there is no display.

import { execFileSync, spawnSync } from 'node:child_process';
import { createPublicKey, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOS_SEARCH, parseCandidateLinks, parseOffice } from './sos-map.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'nv', 'sos');
const FIRST_YEAR = new Date().getFullYear() - 3;
const THIS_YEAR = new Date().getFullYear();
const FROM = process.argv.find((a) => a.startsWith('--from='))?.slice(7);

// A visible browser needs a display: re-run under a virtual one.
if (!process.env.DISPLAY && process.platform === 'linux') {
  const r = spawnSync('xvfb-run', ['-a', process.execPath, ...process.argv.slice(1)], { stdio: 'inherit' });
  if (r.error) { console.error('No display and no xvfb-run: install xvfb, or run on a desktop.'); process.exit(1); }
  process.exit(r.status ?? 1);
}

async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall through to a global install */ }
  try {
    const root = execFileSync('npm', ['root', '-g']).toString().trim();
    return createRequire(join(root, 'noop.js'))('playwright');
  } catch { return null; }
}

// The agent proxy re-signs TLS; Chromium is told to trust only the proxy's certificate.
function proxyCaArgs() {
  const ca = process.env.PROXY_CA_CERT || '/root/.ccr/agent-proxy-ca.crt';
  if (!process.env.HTTPS_PROXY || !existsSync(ca)) return [];
  const spki = createPublicKey(readFileSync(ca)).export({ type: 'spki', format: 'der' });
  return [`--ignore-certificate-errors-spki-list=${createHash('sha256').update(spki).digest('base64')}`];
}

const pw = await loadPlaywright();
if (!pw) { console.error('Playwright is not installed: npm i playwright'); process.exit(1); }
mkdirSync(RAW, { recursive: true });
const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
const executablePath = existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined;
const browser = await pw.chromium.launch({ headless: false, executablePath, proxy, args: ['--disable-blink-features=AutomationControlled', ...proxyCaArgs()] });
const ctx = await browser.newContext({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', acceptDownloads: true });
const page = await ctx.newPage();

// The search page, with the bot check passed and the page's scripts loaded.
async function openSearch() {
  for (let attempt = 1; ; attempt++) {
    try {
      await page.goto(SOS_SEARCH, { waitUntil: 'load', timeout: 90000 });
      await page.waitForFunction(() => window.$find && document.getElementById('ctl00_MainContent_ddlJurisdiction'), null, { timeout: 30000 });
      return;
    } catch (e) {
      if (attempt >= 4) throw e;
      await page.waitForTimeout(5000 * attempt);
    }
  }
}

// Every candidate for one jurisdiction and year, from every page of the results grid.
async function candidates(jurisdiction, year) {
  await openSearch();
  await page.selectOption('#ctl00_MainContent_ddlJurisdiction', jurisdiction);
  await page.selectOption('#ctl00_MainContent_ddlElectionYear', String(year));
  await Promise.all([page.waitForNavigation({ waitUntil: 'load', timeout: 90000 }), page.click('#ctl00_MainContent_btnSearchMaster')]);
  const found = parseCandidateLinks(await page.content());
  const pages = Number((await page.content()).match(/Page <strong>1<\/strong> of <strong>(\d+)<\/strong>/)?.[1] || 1);
  // 25 to a page: click through the grid's page numbers.
  for (let n = 2; n <= pages; n++) {
    await page.click(`.rgNumPart a:has-text("${n}")`).catch(() => page.click('.rgNumPart a:has-text("...") >> nth=-1'));
    await page.waitForFunction((k) => new RegExp(`Page <strong>${k}</strong> of`).test(document.body.innerHTML), n, { timeout: 120000 });
    found.push(...parseCandidateLinks(await page.content()));
  }
  return found;
}

// The office on a candidate's page, fetched inside the browser so it carries the session.
const officeOf = (href) => page.evaluate(async (u) => (await fetch(u)).text(), new URL(href, SOS_SEARCH).href).then(parseOffice);

// Contributions dated between two days (YYYY-MM-DD) as the search's CSV export text.
async function exportRange(first, last) {
  await openSearch();
  await page.evaluate(([a, b]) => {
    location.hash = '#contribution_search';
    document.getElementById('search_type').value = '#contribution_search';
    document.getElementById('ctl00_MainContent_txtRecipientName').value = '';
    document.getElementById('ctl00_MainContent_chkContExportOnly').checked = true;
    $find('ctl00_MainContent_txtRadContDateMin').set_selectedDate(new Date(a));
    $find('ctl00_MainContent_txtRadContDateMax').set_selectedDate(new Date(b));
  }, [`${first}T12:00`, `${last}T12:00`]);
  const download = page.waitForEvent('download', { timeout: 300000 });
  await page.click('#ctl00_MainContent_btnSearchMaster');
  return readFileSync(await (await download).path(), 'utf8').replace(/^\uFEFF/, '');
}

const addDays = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);

// The export sometimes never arrives, and a busy month (a filing deadline) can be too big for
// one: after two misses the span is split in half, down to single days.
async function exportSpan(first, last) {
  for (let attempt = 1; attempt <= 2; attempt++) {
    try { return await exportRange(first, last); } catch (e) {
      console.log(`${first} to ${last}: no export (${attempt})`);
    }
  }
  const span = daysBetween(first, last);
  if (span < 1) {
    const text = await exportRange(first, last).catch(() => null);
    if (text === null) throw new Error(`No contribution export for ${first}`);
    return text;
  }
  const mid = addDays(first, Math.floor(span / 2));
  const a = await exportSpan(first, mid);
  const b = await exportSpan(addDays(mid, 1), last);
  return a.trimEnd() + '\n' + b.split(/\r?\n/).slice(1).join('\n');
}

async function fetchCandidates() {
  const jurisdictions = (await page.$$eval('#ctl00_MainContent_ddlJurisdiction option', (os) => os.map((o) => ({ id: o.value, name: o.textContent.trim() }))))
    .filter((j) => j.id && /county|city/i.test(j.name));
  const list = [];
  for (let year = FIRST_YEAR; year <= THIS_YEAR; year++) {
    for (const j of jurisdictions) {
      const found = await candidates(j.id, year);
      for (const c of found) list.push({ year, jurisdiction: j.name, name: c.name, href: c.href });
      if (found.length) console.log(`${year} ${j.name}: ${found.length} candidates`);
    }
  }
  // One page visit per candidate: the office rarely changes between years.
  const offices = new Map();
  for (const c of list) {
    const id = c.href.match(/[?&]o=([^&]+)/)?.[1] || c.href;
    if (!offices.has(id)) offices.set(id, await officeOf(c.href).catch(() => ''));
    c.office = offices.get(id);
    delete c.href;
  }
  writeFileSync(join(RAW, 'candidates.json'), `${JSON.stringify(list)}\n`);
  console.log(`${list.length} candidate-years, ${offices.size} candidate pages`);
}

try {
  await openSearch();
  // --contributions-only keeps the candidate list from an earlier run.
  if (!process.argv.includes('--contributions-only') || !existsSync(join(RAW, 'candidates.json'))) await fetchCandidates();

  const now = new Date();
  for (let year = FIRST_YEAR; year <= THIS_YEAR; year++) {
    for (let month = 1; month <= 12; month++) {
      if (year === THIS_YEAR && month > now.getUTCMonth() + 1) break;
      const ym = `${year}-${String(month).padStart(2, '0')}`;
      // Every month again (reports filed later add to earlier months), unless resuming with --from=YYYY-MM.
      if (FROM && ym < FROM) continue;
      const lastDay = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
      writeFileSync(join(RAW, `contributions-${ym}.csv`), await exportSpan(`${ym}-01`, lastDay));
      console.log(`${year}-${month}: contributions`);
    }
  }
} finally {
  await browser.close();
}
console.log('Done. Next: node scripts/nv/build-county.mjs --all');
