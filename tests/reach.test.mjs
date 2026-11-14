import test from 'node:test';
import assert from 'node:assert/strict';
import { badgeSVG, GRADE_COLORS } from '../js/engine/badge.js';
import { standouts, listable, MIN_LIST } from '../js/engine/standouts.js';
import { citationText, embedHTML } from '../js/engine/cite.js';
import { scoreAll } from '../scripts/build-pages.mjs';

const town = (id, o = {}) => ({
  id, name: id, state: 'PA', stateName: 'Pennsylvania', county: 'Test County', type: 'Borough', lat: 40, lng: -75, population: 5000, fiscalYear: 2024, asOf: '2026-10-01',
  revenue: { propertyTax: 600000, stateAid: 400000 }, spending: { publicSafety: 700000, administration: 200000, debtService: 100000 },
  debt: 250000, influence: { pacContributions: 500 }, transparency: { budgetOnline: true, auditOnTime: true, competitiveBidding: true }, redFlags: [], ...o,
});

test('badge shows grade and score in the grade color, and never the town name', () => {
  const [e] = scoreAll([town('Evil <script>alert(1)</script>')]);
  const svg = badgeSVG(e);
  assert.match(svg, /^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"[^>]*role="img"/);
  assert.ok(!svg.includes('Evil') && !svg.includes('<script'));
  if (/^[A-F]$/.test(e.s.grade)) {
    assert.ok(svg.includes(GRADE_COLORS[e.s.grade]));
    assert.ok(svg.includes(`${e.s.grade} · ${e.s.score.toFixed(1)}`));
  }
  const ungraded = badgeSVG({ s: { grade: '?', score: 0 } });
  assert.match(ungraded, /not graded/);
  assert.ok(ungraded.includes(GRADE_COLORS.none));
  // Every tag that opens closes.
  for (const svgText of [svg, ungraded]) assert.equal((svgText.match(/<(rect|text|g|clipPath|svg|title)\b/g) || []).length, (svgText.match(/<\/(rect|text|g|clipPath|svg|title)>|\/>/g) || []).length);
});

test('citation and embed code point at the town page', () => {
  const [e] = scoreAll([town('test-pa')]);
  assert.equal(citationText(e.town), 'TownView, "test-pa, PA: where the money goes," fiscal year 2024, data as of 2026-10-01, https://townview.org/town/test-pa/');
  const html = embedHTML(e.town, e.s);
  assert.match(html, /^<a href="https:\/\/townview\.org\/town\/test-pa\/"><img src="https:\/\/townview\.org\/badge\/test-pa\.svg" alt="[^"<>]+" height="20"><\/a>$/);
});

test('standouts leave out small, incomplete and outlying towns', () => {
  const entries = scoreAll([
    ...[1, 2, 3, 4, 5, 6].map((i) => town(`t${i}`, { debt: 100000 * i })),
    town('tiny', { population: 300, debt: 9e6 }),
    town('gap', { debt: 5e9 }), // far beyond the state's typical debt: a likely data gap
    town('no-politics', { influence: undefined, debt: 900000 }),
  ]);
  assert.equal(listable(entries.find((e) => e.town.id === 'tiny')), false);
  assert.equal(listable(entries.find((e) => e.town.id === 'no-politics')), false, 'less of the score is backed by data');
  const lists = standouts(entries);
  const debt = lists.find((l) => l.key === 'debtPerResident');
  assert.deepEqual(debt.rows.map((r) => r.entry.town.id), ['t6', 't5', 't4', 't3', 't2']);
  assert.ok(lists.every((l) => l.rows.length >= MIN_LIST));
  assert.ok(lists.every((l) => l.rows.every((r) => !['tiny', 'gap', 'no-politics'].includes(r.entry.town.id))));
  // Red-flag lists need towns that actually have red flags.
  assert.equal(lists.find((l) => l.key === 'redFlagCount'), undefined);
  assert.deepEqual(standouts(entries.slice(0, 2)), []);
});
