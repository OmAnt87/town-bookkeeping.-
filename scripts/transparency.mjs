#!/usr/bin/env node
// Sets the transparency checks that can be read from state records already loaded
// into data/real/. Safe to re-run; run it after any build-county script, then
// scripts/build-summary.mjs.
//
//   node scripts/transparency.mjs --all        (or --state NY)
//
// auditOnTime: whether the government has filed its annual audit or annual financial
// report with the state for the latest fiscal year most governments in the state have
// filed. NJ is not checked: its statewide data is adopted budgets, which says nothing
// about audits. Other practices have no statewide source yet and stay unchecked.

import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from './lib.mjs';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'real');
const FILINGS = {
  NY: { report: 'annual financial report', agency: 'the Office of the State Comptroller' },
  PA: { report: 'annual audit and financial report', agency: 'the Department of Community and Economic Development' },
  CT: { report: 'audited financial statements', agency: 'the Office of Policy and Management' },
  MA: { report: 'Schedule A annual financial report', agency: 'the Division of Local Services' },
};
const MARK = 'Transparency:';

const args = parseArgs();
const picked = args.all ? Object.keys(FILINGS) : [String(args.state || '').toUpperCase()];
if (!picked.every((s) => FILINGS[s])) {
  console.error(`Usage: node scripts/transparency.mjs --state <${Object.keys(FILINGS).join('|')}> | --all`);
  process.exit(1);
}

const { files } = JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8'));
for (const st of picked) {
  const f = FILINGS[st];
  const datasets = files.filter((x) => x.startsWith(`${st.toLowerCase()}-`)).map((file) => ({ file, data: JSON.parse(readFileSync(join(OUT, file), 'utf8')) }));
  const towns = datasets.flatMap((d) => d.data.towns);
  const latest = (t) => Math.max(t.fiscalYear || 0, ...(t.history || []).map((h) => h.year));
  const counts = {};
  for (const t of towns) counts[latest(t)] = (counts[latest(t)] || 0) + 1;
  const expected = Number(Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0]);
  let late = 0;
  for (const t of towns) {
    const y = latest(t);
    const onTime = y >= expected;
    if (!onTime) late++;
    t.transparency = { ...(t.transparency || {}), auditOnTime: onTime };
    t.notes = (t.notes || []).filter((n) => !n.startsWith(MARK) && !n.startsWith('Transparency practices have not been checked'));
    t.notes.push(`${MARK} ${onTime
      ? `${t.name} has filed its ${f.report} with ${f.agency} for FY ${y}, the latest year most ${st} governments have filed.`
      : `${t.name}'s latest ${f.report} on file with ${f.agency} is for FY ${y}; most ${st} governments have filed FY ${expected}.`} This is a check that the report was filed, not an opinion on its contents. The other five practices have not been checked yet, so they are left out of the score.`);
  }
  for (const d of datasets) writeFileSync(join(OUT, d.file), `${JSON.stringify(d.data, null, 1)}\n`);
  console.log(`${st}: latest year most have filed FY ${expected}; ${late} of ${towns.length} behind`);
}
