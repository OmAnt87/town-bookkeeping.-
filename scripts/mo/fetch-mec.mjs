#!/usr/bin/env node
// Downloads Missouri Ethics Commission data into data/raw/mo/mec/ (gitignored): the committee list,
// itemized contributions for the last four years (keeping those to candidate committees from
// businesses and other committees), and each such committee's page for the office it sought. The
// MEC site sits behind a bot check, so this needs Playwright (see scripts/common/browser.mjs).
// Committee pages are cached; a rerun only fetches new ones.
//
//   node scripts/mo/fetch-mec.mjs      then: node scripts/mo/build-county.mjs --all

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCSV } from '../lib.mjs';
import { launchBrowser } from '../common/browser.mjs';
import { MEC_PAGE, MEC_COMMITTEE } from './mec-map.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'mo', 'mec');
const NOW = new Date().getFullYear();
const F = 'ctl00$ctl00$ContentPlaceHolder$ContentPlaceHolder1$';
mkdirSync(RAW, { recursive: true });

const { browser, context } = await launchBrowser();
// Each export gets its own browser: after one download the bot check stops serving the form to
// that browser.
// Files already downloaded are reused (the current year is always fetched again), and the site
// rate-limits, so exports are a minute apart.
let exported = 0;
async function exportCsv(type, year) {
  const file = join(RAW, `${type}${year ? `-${year}` : ''}.csv`);
  if (existsSync(file) && year !== NOW) return parseCSV(readFileSync(file, 'latin1'));
  if (exported++) await new Promise((resolve) => setTimeout(resolve, 60000));
  const own = await launchBrowser();
  const ctx = own.context;
  const page = await ctx.newPage();
  try {
    // The bot check keeps the network busy, so wait for the form instead of an idle network.
    await page.goto(MEC_PAGE, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector(`select[name="${F}ddReportType"]`, { state: 'attached', timeout: 120000 });
    await Promise.all([page.waitForNavigation({ timeout: 8000 }).catch(() => {}), page.selectOption(`select[name="${F}ddReportType"]`, type)]);
    await page.waitForTimeout(1500);
    if (year) {
      await page.waitForSelector(`select[name="${F}ddReportYear"]`, { state: 'attached', timeout: 120000 });
      await Promise.all([page.waitForNavigation({ timeout: 8000 }).catch(() => {}), page.selectOption(`select[name="${F}ddReportYear"]`, String(year))]);
    }
    await page.waitForSelector(`input[name="${F}btnExport"]`, { state: 'attached', timeout: 120000 }).catch(async (e) => {
      await page.screenshot({ path: join(RAW, 'export-error.png'), fullPage: true });
      throw e;
    });
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 600000 }), page.click(`input[name="${F}btnExport"]`)]);
    await download.saveAs(file);
    return parseCSV(readFileSync(file, 'latin1'));
  } finally {
    await own.browser.close();
  }
}

try {
  const committees = await exportCsv('CommitteeData');
  const candidates = new Map(committees.filter((c) => c.committee_type === 'Candidate').map((c) => [c.mecid, c.committee_name]));
  console.log(`${committees.length} committees, ${candidates.size} candidate committees`);
  const kept = [];
  for (let year = NOW - 3; year <= NOW; year++) {
    const rows = await exportCsv('CD1_A', year);
    for (const r of rows) {
      const id = String(r.mecid || '').trim();
      if (candidates.has(id) && (String(r.company || '').trim() || String(r.committee || '').trim())) kept.push({ ...r, mecid: id });
    }
    console.log(`${year}: ${rows.length} itemized contributions`);
  }
  writeFileSync(join(RAW, 'contributions.json'), JSON.stringify(kept));
  console.log(`${kept.length} contributions from businesses and committees to candidate committees`);

  // The office each committee ran for, newest election first.
  const cacheFile = join(RAW, 'committees.json');
  const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
  const todo = [...new Set(kept.map((r) => r.mecid))].filter((id) => !(id in cache));
  console.log(`${todo.length} committee pages to read`);
  // The site serves a bot-check page instead of the committee page once it has seen a few
  // requests from one address. Those are not cached; after a run of them the fetch stops, and a
  // later rerun picks up where it left off.
  let done = 0;
  let blocked = 0;
  const page = await context.newPage();
  while (todo.length && blocked < 5) {
    const id = todo.shift();
    try {
      await page.goto(MEC_COMMITTEE(id), { waitUntil: 'domcontentloaded', timeout: 90000 });
      const ok = await page.waitForSelector('text=Political Office', { timeout: 20000 }).then(() => true).catch(() => false);
      if (!ok) { blocked++; continue; }
      blocked = 0;
      const rows = await page.$$eval('table tr', (tr) => tr.map((r) => [...r.cells].map((c) => c.innerText.trim())));
      const start = rows.findIndex((r) => r[0] === 'Election' && r[1] === 'Political Office');
      const elections = [];
      for (const r of rows.slice(start + 1)) { if (r.length !== 2 || !/\d{4}/.test(r[0])) break; elections.push({ election: r[0], office: r[1] }); }
      cache[id] = { name: candidates.get(id), elections };
    } catch (e) {
      console.log(`${id}: ${e.message.split('\n')[0]}`);
    }
    if (++done % 100 === 0) { console.log(`${done} committee pages read`); writeFileSync(cacheFile, JSON.stringify(cache)); }
  }
  writeFileSync(cacheFile, JSON.stringify(cache));
  const left = todo.length + (blocked ? blocked : 0);
  if (left) {
    console.log(`The MEC site is refusing committee pages from this address (${left} left). Rerun later to continue; ${Object.keys(cache).length} are cached.`);
    process.exitCode = 2;
  } else {
    console.log('Done. Next: node scripts/mo/build-county.mjs --all');
  }
} finally {
  await browser.close();
}
