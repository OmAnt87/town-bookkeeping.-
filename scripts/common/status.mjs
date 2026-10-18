// Status-doc lines shared by every state: red flags (from scripts/red-flags.mjs)
// and the annual-report filing check (from scripts/transparency.mjs).
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const n = (x) => x.toLocaleString('en-US');

// towns: every town in the state's files. Returns markdown bullet lines.
export function redFlagLines(st, towns) {
  const file = join(ROOT, 'data', 'raw', st.toLowerCase(), 'red-flags-report.json');
  const checked = towns.filter((t) => Array.isArray(t.redFlags));
  if (!checked.length) return ['- **Red flags** (surveillance tech, data center deals) have not been checked yet, so they are not scored.'];
  const flagged = checked.filter((t) => t.redFlags.some((f) => f.scored !== false)).length;
  const unscored = checked.reduce((a, t) => a + t.redFlags.filter((f) => f.scored === false).length, 0);
  const r = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  const unmatched = r ? [...new Set(r.atlasUnmatched)] : [];
  return [
    `- **Red flags:** ${n(flagged)} of ${n(checked.length)} governments have at least one scored red flag, from police surveillance programs in the [EFF Atlas of Surveillance](https://atlasofsurveillance.org/) (plate readers, drones, gunshot detection, face recognition and similar${r ? `; ${n(r.atlas)} records matched` : ''}) and license-plate cameras mapped in OpenStreetMap, as shown by [DeFlock](https://deflock.org/)${r ? ` (${n(r.camerasPlaced)} cameras inside a government's borders${r.camerasFrom === 'DeFlock' ? ", taken from DeFlock's published copy of the map data" : ''})` : ''}. Any Flock camera counts; other camera brands count only when the government is the recorded operator. Red flags are only as complete as public reporting, and most records give no dollar amount, so they are scored by count.${unscored ? ` ${n(unscored)} records for access every police department in the state gets through a statewide contract are shown but not scored.` : ''}`,
    ...(unmatched.length ? [`- **Atlas records not matched** to a government (${n(unmatched.length)}), because the name fits more than one (a city and a town of the same name), the government is not loaded, or Atlas has the name or county wrong: ${unmatched.join('; ')}.`] : []),
  ];
}

export function filingLines(towns, report) {
  const checked = towns.filter((t) => typeof t.transparency?.auditOnTime === 'boolean');
  if (!checked.length) return ['- **Transparency practices** have not been checked yet, so they are not scored.'];
  const late = checked.filter((t) => t.transparency.auditOnTime === false);
  return [`- **Transparency:** one of the six practices is checked from state records: whether each government has filed its ${report} for the latest year most have filed. ${n(late.length)} of ${n(checked.length)} have not${late.length && late.length <= 60 ? ` (${late.map((t) => t.name).join(', ')})` : ''}. The other five practices (budget and checkbook online, competitive bidding, recorded meetings, conflict-of-interest disclosures) have no statewide source yet, so they are left out of the score.`];
}

export function stateTowns(st) {
  const { files } = JSON.parse(readFileSync(join(ROOT, 'data', 'real', 'index.json'), 'utf8'));
  return files.filter((f) => f.startsWith(`${st.toLowerCase()}-`))
    .flatMap((f) => JSON.parse(readFileSync(join(ROOT, 'data', 'real', f), 'utf8')).towns);
}
