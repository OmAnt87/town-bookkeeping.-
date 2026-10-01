#!/usr/bin/env node
// Downloads contributions to candidates for each NY town, village and city from the
// State Board of Elections datasets on data.ny.gov (Socrata API), one county at a time.
// Cached in data/raw/ny/politics/<county>.json as { byGov: { <OSC code>: [rows] } }.
//
//   node scripts/ny/fetch-politics.mjs --county Albany     (or --all; --refresh to re-download)
//
// Requests go through curl, one at a time.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, slugify } from '../lib.mjs';
import { isCandidateFiler, isCountedOffice, NY_TYPE_CATEGORY } from './politics-map.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const RAW = join(ROOT, 'data', 'raw', 'ny');
const DIR = join(RAW, 'politics');
const API = 'https://data.ny.gov/resource';
const FILERS = '7x2g-h32p';
const CONTRIBUTIONS = '4j2b-6a2j';
// Contributions from four years back plus a margin; the build applies the exact window.
const SINCE = `${new Date().getFullYear() - 5}-01-01`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function soql(dataset, params) {
  const qs = new URLSearchParams(params).toString();
  const out = execFileSync('curl', ['-sS', '-m', '300', '--retry', '3', `${API}/${dataset}.json?${qs}`], { maxBuffer: 1 << 29 }).toString();
  const json = JSON.parse(out);
  if (!Array.isArray(json)) throw new Error(out.slice(0, 300));
  return json;
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const norm = (s) => String(s).toLowerCase().replace(/\bst\.?\s/g, 'saint ').replace(/\bmt\.?\s/g, 'mount ').replace(/[.'’]/g, '').replace(/-/g, ' ').replace(/\s+/g, ' ').trim();

async function fetchCounty(county, osc) {
  const filers = soql(FILERS, {
    $select: 'filer_id,filer_name,office_desc,compliance_type_desc,committee_type_desc,municipality_desc_subdivision',
    $where: `filer_type_desc='County' AND county_desc=${q(county)} AND (municipality_desc_subdivision like '%,Town' OR municipality_desc_subdivision like '%,Village' OR municipality_desc_subdivision like '%,City')`,
    $limit: '50000',
  }).filter((f) => isCandidateFiler(f) && isCountedOffice(f.office_desc));

  // "Huntington,Town" -> OSC government in this county (or, for villages spanning counties, anywhere).
  const govs = Object.entries(osc);
  const govFor = (label) => {
    const [rawName, kind] = label.split(',');
    const name = rawName.replace(/^(Town|Village|City) of /i, '');
    const want = norm(`${kind} of ${name}`);
    // Filers spell names loosely ("Lagrange" for LaGrange, "Wappinger Falls" for Wappingers Falls).
    const loose = (x) => norm(x).split(' ').map((w) => w.replace(/s$/, '')).join('');
    return (govs.find(([, g]) => g.county === county && norm(g.name) === want)
      || govs.find(([, g]) => g.class === kind && norm(g.name) === want)
      || govs.find(([, g]) => g.county === county && loose(g.name) === loose(want))
      || [])[0];
  };
  const filerGov = new Map();
  const unmatched = new Set();
  for (const f of filers) {
    const code = govFor(f.municipality_desc_subdivision);
    if (code) filerGov.set(f.filer_id, code);
    else unmatched.add(f.municipality_desc_subdivision);
  }

  const types = Object.keys(NY_TYPE_CATEGORY).concat('Individual').map(q).join(',');
  const ids = [...filerGov.keys()];
  const byGov = {};
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100);
    for (let offset = 0; ; offset += 50000) {
      const rows = soql(CONTRIBUTIONS, {
        $select: 'filer_id,cand_comm_name,office_desc,election_year,election_type,sched_date,cntrbr_type_desc,filing_sched_desc,flng_ent_name,flng_ent_first_name,flng_ent_last_name,org_amt,trans_number',
        $where: `filer_id in (${batch.map(q).join(',')}) AND sched_date >= ${q(SINCE)} AND (cntrbr_type_desc in (${types}) OR (cntrbr_type_desc IS NULL AND filing_sched_desc like '%From Corporation%'))`,
        $order: 'trans_number',
        $limit: '50000',
        $offset: String(offset),
      });
      for (const r of rows) {
        // Individual gifts are only needed as a total; drop their names and details.
        const row = r.cntrbr_type_desc === 'Individual'
          ? { sched_date: r.sched_date, org_amt: r.org_amt, cntrbr_type_desc: 'Individual' }
          : r;
        (byGov[filerGov.get(r.filer_id)] ||= []).push(row);
      }
      await sleep(300);
      if (rows.length < 50000) break;
    }
  }
  return { county, fetched: new Date().toISOString(), filers: filers.length, matchedFilers: filerGov.size, unmatched: [...unmatched], byGov };
}

const args = parseArgs();
mkdirSync(DIR, { recursive: true });
const osc = JSON.parse(readFileSync(join(RAW, 'osc.json'), 'utf8'));
const allCounties = [...new Set(Object.values(osc).map((g) => g.county))].sort();
const counties = args.all ? allCounties : [allCounties.find((c) => c.toLowerCase() === String(args.county || '').toLowerCase())];
if (!counties[0]) { console.error('Usage: node scripts/ny/fetch-politics.mjs --county <name> | --all [--refresh]'); process.exit(1); }
for (const county of counties) {
  const file = join(DIR, `${slugify(county)}.json`);
  if (!args.refresh && existsSync(file)) { console.log(`${county}: cached`); continue; }
  try {
    const d = await fetchCounty(county, osc);
    writeFileSync(file, JSON.stringify(d));
    const n = Object.values(d.byGov).reduce((a, r) => a + r.length, 0);
    console.log(`${county}: ${d.matchedFilers}/${d.filers} candidate filers matched, ${n} contribution rows${d.unmatched.length ? `; unmatched: ${d.unmatched.join(' | ')}` : ''}`);
  } catch (err) {
    console.log(`${county}: ERROR ${err.message.split('\n')[0]}`);
  }
}
