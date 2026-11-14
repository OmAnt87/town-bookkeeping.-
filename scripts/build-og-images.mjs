#!/usr/bin/env node
// Renders the link-preview images used by town pages, one per grade:
// img/og/grade-A.png ... grade-F.png and grade-none.png (1200x630).
// Run by hand when the design changes; the images are committed, so the
// deploy does not need a browser.
//
//   node scripts/build-og-images.mjs        (needs Playwright and Chromium)

import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GRADE_COLORS } from '../js/engine/badge.js';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'img', 'og');
const WORDS = { A: 'Most of the money reaches residents', B: 'Good return on public money', C: 'Middling return on public money', D: 'Weak return on public money', F: 'Little of the money reaches residents', none: 'See where the money goes' };

export function cardHTML(grade) {
  const known = grade !== 'none';
  return `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@500;600&family=Source+Serif+4:opsz,wght@8..60,700&display=swap">
<style>
  body { margin: 0; width: 1200px; height: 630px; font-family: Inter, sans-serif; background: #f6f5f0; color: #18202e; overflow: hidden; }
  .top { height: 10px; background: linear-gradient(90deg, #1b3768, #14967f); }
  .wrap { display: flex; align-items: center; gap: 64px; padding: 70px 90px 0; }
  .grade { flex: none; width: 300px; height: 300px; border-radius: 56px; background: ${GRADE_COLORS[grade]}; color: #fff; display: grid; place-items: center;
    font: 700 ${known ? 220 : 170}px/1 'Source Serif 4', serif; box-shadow: inset 0 -10px 0 rgba(0,0,0,.12); }
  .k { font-size: 28px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase; color: #0e7a6c; }
  h1 { font: 700 64px/1.08 'Source Serif 4', serif; margin: 18px 0 0; letter-spacing: -.01em; }
  .brand { position: absolute; left: 90px; bottom: 56px; font: 700 44px/1 'Source Serif 4', serif; }
  .brand span { color: #14967f; }
  .url { position: absolute; right: 90px; bottom: 60px; font-size: 30px; color: #4a5160; }
</style></head><body><div class="top"></div>
<div class="wrap"><div class="grade">${known ? grade : '?'}</div>
<div><div class="k">${known ? `Grade ${grade}` : 'Community Return Score'}</div><h1>${WORDS[grade]}</h1></div></div>
<div class="brand">Town<span>View</span></div><div class="url">townview.org</div></body></html>`;
}

async function main() {
  const { chromium } = createRequire(import.meta.url)('playwright');
  mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
  for (const grade of ['A', 'B', 'C', 'D', 'F', 'none']) {
    await page.setContent(cardHTML(grade), { waitUntil: 'networkidle' });
    await page.screenshot({ path: join(OUT, `grade-${grade}.png`) });
  }
  await browser.close();
  console.log(`Wrote 6 preview images to ${OUT}`);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
