#!/usr/bin/env node
// Caches Delaware campaign finance data from the Department of Elections' Campaign Finance
// Reporting System (CFRS) into data/raw/de/cfrs/:
//   committees-CO.csv, committees-MO.csv  county and municipal office committees, whose
//                                         "Office" names the county or municipality
//   contributions-<year>.csv               every contribution reported, since January three
//                                         years ago (build-county.mjs keeps local ones)
//
//   npm i playwright && node scripts/de/fetch-cfrs.mjs [--force]
//   (or with a global install: NODE_PATH=$(npm root -g) node scripts/de/fetch-cfrs.mjs)
//
// CFRS sits behind a Cloudflare browser check and its CSV exports follow a search made in the
// same session, so the searches run in Playwright's Chromium. Behind a TLS-inspecting proxy,
// Chromium trusts the proxy CA's key only (not all certificates).

import { createPublicKey, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from '../lib.mjs';

const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'de', 'cfrs');
export const CFRS = 'https://cfrs.elections.delaware.gov';
const args = parseArgs();

function proxyCaArgs() {
  const ca = process.env.PROXY_CA_CERT || '/root/.ccr/agent-proxy-ca.crt';
  if (!process.env.HTTPS_PROXY || !existsSync(ca)) return [];
  const spki = createPublicKey(readFileSync(ca)).export({ type: 'spki', format: 'der' });
  return [`--ignore-certificate-errors-spki-list=${createHash('sha256').update(spki).digest('base64')}`];
}

async function search(page, path, fill) {
  await page.goto(`${CFRS}${path}`, { timeout: 90000 });
  await page.waitForTimeout(2000);
  await fill(page);
  await Promise.all([page.waitForLoadState('load', { timeout: 300000 }), page.click('#btnSearch')]);
  await page.waitForTimeout(3000);
  const html = await page.content();
  const m = html.match(/href="(\/Public\/Export(?:CSVNew|toCsv)[^"]*)"/);
  return m ? m[1].replace(/&amp;/g, '&') : null;
}

async function save(ctx, href, out) {
  const res = await ctx.request.get(CFRS + href, { timeout: 600000 });
  if (!res.ok()) throw new Error(`HTTP ${res.status()} for ${href}`);
  const body = await res.text();
  writeFileSync(out, body);
  return body.split('\n').length - 2;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  // A global install is found through NODE_PATH, which only require() reads.
  const { chromium } = await import('playwright').catch(() => createRequire(import.meta.url)('playwright'));
  mkdirSync(DIR, { recursive: true });
  const proxy = process.env.HTTPS_PROXY ? { server: process.env.HTTPS_PROXY } : undefined;
  const browser = await chromium.launch({ proxy, args: proxyCaArgs() });
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    for (const type of ['CO', 'MO']) {
      const out = join(DIR, `committees-${type}.csv`);
      const href = await search(page, '/Public/ViewCommittees', async (p) => { await p.selectOption('#ddlOffice', type); await p.waitForTimeout(1500); });
      if (!href) throw new Error(`No committee export for ${type}`);
      console.log(`committees ${type}: ${await save(ctx, href, out)}`);
    }
    const now = new Date();
    for (let y = now.getFullYear() - 3; y <= now.getFullYear(); y++) {
      const out = join(DIR, `contributions-${y}.csv`);
      if (existsSync(out) && statSync(out).size > 1000 && !args.force && y < now.getFullYear() - 1) { console.log(`cached ${out}`); continue; }
      const href = await search(page, '/Public/ViewReceipts', async (p) => { await p.fill('#dtStartDate', `01/01/${y}`); await p.fill('#dtEndDate', `12/31/${y}`); });
      if (!href) throw new Error(`No contribution export for ${y}`);
      console.log(`contributions ${y}: ${await save(ctx, href, out)}`);
    }
  } finally { await browser.close(); }
}
