// Helpers for the campaign-finance sites several states run on the same vendor's platform
// (Civix): Colorado TRACER, Oklahoma Guardian, Nebraska NADC. Each publishes yearly bulk
// contribution files at <site>/PublicSite/Docs/BulkDataDownloads/ and a public candidate search
// that can export every candidate with the jurisdiction and office they ran for.

import { isPartyOrCandidate, UNION_NAME } from './political.mjs';

// The bulk files quote every field but leave stray quotes inside some ("12" PIPE"), which a
// general CSV parser misreads; fields are split on '","' instead, joining lines a field breaks
// across. Keys are lower-cased with spaces kept, like the header ("receipt source type").
export function parseCivix(text) {
  const lines = text.split(/\r?\n/);
  const split = (l) => l.replace(/^"/, '').replace(/"$/, '').split('","');
  const keys = split(lines[0]).map((h) => h.trim().toLowerCase());
  const rows = [];
  let buf = '';
  for (const line of lines.slice(1)) {
    buf = buf ? `${buf} ${line}` : line;
    const cells = split(buf);
    if (cells.length < keys.length) continue;
    if (cells.length === keys.length) rows.push(Object.fromEntries(keys.map((k, i) => [k, cells[i].trim()])));
    buf = '';
  }
  return rows;
}

// Contributor types across the three sites. Returns { key } for counted money, or null.
// Individuals, candidates' own money, party and candidate committees, tribes and "other"
// sources whose name shows neither a union nor a PAC are not counted.
const PAC_TYPES = /^pac\b|political action committee|political committee|small donor committee|527 political organization|federal pac|independent expenditure committee|ballot question committee/i;
const BUSINESS_TYPES = /^(business|corporation|partnership|limited liability company|llc)\b/i;
export function classifyContributor(type, name) {
  const t = String(type || '').trim();
  const n = String(name || '').trim();
  if (!n || isPartyOrCandidate(n)) return null;
  if (/candidate|party|individual|self|spouse|tribe/i.test(t)) return null;
  if (/labor union|^union\b/i.test(t)) return { key: 'unionContributions' };
  if (PAC_TYPES.test(t)) return { key: UNION_NAME.test(n) ? 'unionContributions' : 'pacContributions' };
  if (BUSINESS_TYPES.test(t)) return { key: UNION_NAME.test(n) ? 'unionContributions' : 'developerContributions' };
  if (/^other\b/i.test(t)) return UNION_NAME.test(n) ? { key: 'unionContributions' } : /\bpac\b|political action/i.test(n) ? { key: 'pacContributions' } : null;
  return null;
}

// "LOWE, JASON A" and "Jason A. Lowe Jr" -> "jason lowe": first given name and surname, so the
// candidate export and the contribution files (which spell names differently) line up.
export function personKey(name) {
  let s = String(name || '').toLowerCase().replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, '').replace(/"[^"]*"|\([^)]*\)/g, ' ');
  let first;
  let last;
  if (s.includes(',')) {
    const [l, f = ''] = s.split(',');
    last = l;
    first = f.trim().split(/\s+/)[0];
  } else {
    const parts = s.replace(/[^a-z' -]/g, ' ').trim().split(/\s+/);
    first = parts[0];
    last = parts.at(-1);
  }
  const clean = (x) => String(x || '').replace(/[^a-z]/g, '');
  return `${clean(first)} ${clean(last)}`.trim();
}

// Playwright, from the project (npm i playwright) or a path in PLAYWRIGHT_MODULE.
export async function loadPlaywright() {
  try { return await import('playwright'); } catch { /* fall through */ }
  if (process.env.PLAYWRIGHT_MODULE) return import(process.env.PLAYWRIGHT_MODULE);
  throw new Error('Playwright is needed for the candidate search (npm i playwright, or set PLAYWRIGHT_MODULE to its index.mjs).');
}

const CANDIDATE_HOOK = '1F26BA5E-71EA-48E4-8D50-C1013E9FE0A7';

// Exports every candidate in the given jurisdiction types ('COUNTY', 'MUNICIPAL') for each
// election from `sinceYear` on, through the site's candidate search. Returns rows with
// name, jurisdiction, office, district and election (lower-cased keys).
export async function fetchCandidates(site, { types, sinceYear, log = () => {} }) {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  const rows = [];
  try {
    const page = await (await browser.newContext({ acceptDownloads: true })).newPage();
    const postback = async (fn) => {
      await Promise.all([page.waitForNavigation({ waitUntil: 'networkidle', timeout: 60000 }).catch(() => {}), fn()]);
      await page.waitForTimeout(300);
    };
    const url = `${site}/PublicSite/SearchPages/Search.aspx?SearchTypeCodeHook=${CANDIDATE_HOOK}`;
    const sel = (name) => `select[name$="${name}$ctl01"]`;
    await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
    const elections = (await page.$$eval(`${sel('ElectionID')} option`, (o) => o.map((x) => ({ value: x.value, label: x.textContent.trim() }))))
      .filter((e) => e.value && Number(e.label.match(/\d{4}/)?.[0]) >= sinceYear && !/NON-CANDIDATE|STATE QUESTION|PARTY FILING/i.test(e.label));
    for (const election of elections) {
      for (const type of types) {
        await page.goto(url, { waitUntil: 'networkidle', timeout: 120000 });
        await postback(() => page.selectOption(sel('ElectionID'), election.value));
        await postback(() => page.selectOption(sel('JurisdictionTypeCodeID'), { label: type }));
        await postback(() => page.click('input[name$="Candidate_SearchButton$ctl01"]'));
        const link = await page.$('[title*="comma-delimited"]');
        if (!link) { log(`${election.label} ${type}: no results`); continue; }
        const [download] = await Promise.all([page.waitForEvent('download', { timeout: 120000 }), link.click()]);
        const text = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString('utf8'));
        const found = parseCivix(text.replace(/^﻿/, ''));
        log(`${election.label} ${type}: ${found.length} candidates`);
        rows.push(...found);
      }
    }
  } finally {
    await browser.close();
  }
  return rows;
}
