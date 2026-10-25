// Helpers for the campaign-finance sites several states run on the same vendor's platform
// (Civix): Colorado TRACER, Oklahoma Guardian, Nebraska NADC. Each publishes yearly bulk
// contribution files at <site>/PublicSite/Docs/BulkDataDownloads/ and a public page per committee
// with the jurisdiction and office it registered for.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { isPartyOrCandidate, UNION_NAME } from './political.mjs';

const run = promisify(execFile);

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

// "01/02/2023" or "2023-01-02 00:00:00" -> "2023-01-02".
export function isoDate(s) {
  const t = String(s || '').trim();
  const us = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return us ? `${us[3]}-${us[1].padStart(2, '0')}-${us[2].padStart(2, '0')}` : t.slice(0, 10);
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

// Each committee's public page lists the jurisdiction, office and district it registered for.
// Fetches the pages for `ids` (a few at a time) and returns { id: { jurisdiction, office, district } },
// reusing and updating the cache file so a rerun only fetches new committees.
export async function fetchOrganizations(site, ids, cacheFile, { log = () => {}, parallel = 8 } = {}) {
  const cache = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, 'utf8')) : {};
  const todo = [...new Set(ids)].filter((id) => id && !(id in cache));
  const field = (text, label) => (text.match(new RegExp(`${label}:\\s*([^:]*?)\\s*(?:Email|Office|District|Party Affiliation|Jurisdiction|Agencies|Status|Phone|$)`)) || [])[1]?.trim() || '';
  let done = 0;
  const next = async () => {
    while (todo.length) {
      const id = todo.shift();
      try {
        const { stdout } = await run('curl', ['-sSfL', '--retry', '3', '-m', '60', '-A', 'Mozilla/5.0', `${site}/PublicSite/SearchPages/OrganizationDetail.aspx?OrganizationID=${id}`], { maxBuffer: 1 << 26 });
        const text = stdout.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ');
        // Oklahoma labels the fields ("Jurisdiction: TULSA COUNTY Office: ..."); Nebraska lists the
        // candidate in a table whose cells are spans named lblJurisdiction (type, then name),
        // lblOfficeDescription and lblDistrictDescription.
        const span = (name) => [...stdout.matchAll(new RegExp(`_${name}">([^<]*)<`, 'g'))].map((m) => m[1].trim());
        const grid = span('lblJurisdiction');
        cache[id] = grid.length
          ? { jurisdictionType: grid[0] || '', jurisdiction: grid.at(-1) || '', office: span('lblOfficeDescription')[0] || '', district: span('lblDistrictDescription')[0] || '' }
          : { jurisdiction: field(text, 'Jurisdiction'), office: field(text, 'Office'), district: field(text, 'District') };
      } catch (e) {
        log(`committee ${id}: ${e.message.split('\n')[0]}`);
      }
      if (++done % 100 === 0) { log(`${done} committees looked up`); writeFileSync(cacheFile, JSON.stringify(cache)); }
    }
  };
  await Promise.all(Array.from({ length: parallel }, next));
  writeFileSync(cacheFile, JSON.stringify(cache));
  return cache;
}

export const normPlace = (s) => String(s || '').toLowerCase().replace(/\b(city|town|village) of\b/g, '').replace(/\b(county|city|town|village)\b/g, '')
  .replace(/\bst\.?\s/g, 'saint ').replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();

// Groups receipts by the government each committee ran in. `placeOf(r)` returns
// { level: 'county' | 'city', name } (names through normPlace) or null for state, school and
// other races. City names shared by two places in the state are skipped.
export function receiptsByGovernment(geo, receipts, placeOf) {
  const counties = new Map();
  const cities = new Map();
  for (const g of geo.values()) {
    if (g.kind === 'County') counties.set(normPlace(g.base), g.key);
    else if (/^(Place|Cousub)\|/.test(g.key)) {
      // Some states list a city as a county subdivision too; the same key twice is not ambiguous.
      const n = normPlace(g.base);
      cities.set(n, cities.has(n) && cities.get(n) !== g.key ? null : g.key);
    }
  }
  const byKey = new Map();
  for (const r of receipts) {
    const p = placeOf(r);
    const key = p && (p.level === 'county' ? counties.get(p.name) : cities.get(p.name));
    if (key && geo.has(key)) (byKey.get(key) || byKey.set(key, []).get(key)).push(r);
  }
  return byKey;
}
