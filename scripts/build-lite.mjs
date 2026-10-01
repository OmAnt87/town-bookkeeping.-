#!/usr/bin/env node
// Builds the fast-loading dataset the site actually fetches on startup:
//   data/lite/all.json          every town without its transaction ledger
//   data/lite/ledger/<id>.json  one town's ledger, fetched when its page opens
// Source files (data/real/*.json, data/towns.json) stay the single source of truth.
// Run `npm run build:lite` after changing any of them.
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const DATA = join(dirname(fileURLToPath(import.meta.url)), '..', 'data');
const readJSON = async (p) => JSON.parse(await readFile(join(DATA, p), 'utf8'));

const { files = [] } = await readJSON('real/index.json');
const real = (await Promise.all(files.map((f) => readJSON(`real/${f}`)))).flatMap((d) => d.towns || []).map((t) => ({ ...t, demo: false }));
const realIds = new Set(real.map((t) => t.id));
const demo = (await readJSON('towns.json')).towns.filter((t) => !realIds.has(t.id));

await rm(join(DATA, 'lite'), { recursive: true, force: true });
await mkdir(join(DATA, 'lite', 'ledger'), { recursive: true });

const towns = [];
for (const t of [...real, ...demo]) {
  const { ledger, ...rest } = t;
  if (ledger?.length) {
    rest.ledgerCount = ledger.length;
    await writeFile(join(DATA, 'lite', 'ledger', `${t.id}.json`), JSON.stringify(ledger));
  }
  towns.push(rest);
}
await writeFile(join(DATA, 'lite', 'all.json'), JSON.stringify({ towns }));
console.log(`Wrote ${towns.length} towns (${real.length} real, ${demo.length} demo).`);
