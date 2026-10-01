// Builds data/us-county-borders.json and data/us-state-borders.json (line meshes) from us-atlas.
// Usage: npm i --no-save topojson-client us-atlas@3 && node scripts/build-borders.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { mesh } from 'topojson-client';

const topo = JSON.parse(readFileSync('node_modules/us-atlas/counties-10m.json', 'utf8'));
const round = (n) => Math.round(n * 1000) / 1000;
const lines = (geom) => ({
  type: 'Feature',
  properties: {},
  geometry: { type: geom.type, coordinates: geom.coordinates.map((l) => l.map(([x, y]) => [round(x), round(y)])) },
});
// Interior county lines only (a === b keeps nothing; a !== b keeps shared borders, state lines drawn separately).
const counties = mesh(topo, topo.objects.counties, (a, b) => a !== b && String(a.id).slice(0, 2) === String(b.id).slice(0, 2));
const states = mesh(topo, topo.objects.states, (a, b) => a !== b);
writeFileSync('data/us-county-borders.json', JSON.stringify(lines(counties)));
writeFileSync('data/us-state-borders.json', JSON.stringify(lines(states)));
