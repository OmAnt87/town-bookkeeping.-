import test from 'node:test';
import assert from 'node:assert/strict';
import { trackingAllowed, appPath, countUrl, GOATCOUNTER_CODE } from '../js/track.js';

const ok = { code: 'test', host: 'townview.org' };

test('counting runs only on townview.org with a code and no opt-out signal', () => {
  assert.equal(trackingAllowed(ok), true);
  assert.equal(trackingAllowed({ ...ok, host: 'www.townview.org' }), true);
  assert.equal(trackingAllowed({ ...ok, code: '' }), false);
  assert.equal(trackingAllowed({ ...ok, host: 'localhost' }), false);
  assert.equal(trackingAllowed({ ...ok, host: 'omant87.github.io' }), false);
  assert.equal(trackingAllowed({ ...ok, dnt: true }), false);
  assert.equal(trackingAllowed({ ...ok, gpc: true }), false);
  assert.equal(trackingAllowed({ ...ok, optOut: true }), false);
});

test('counting ships switched off until a site code is set', () => {
  assert.equal(GOATCOUNTER_CODE, '');
  assert.equal(trackingAllowed({ host: 'townview.org' }), false);
});

test('app views count under /app and drop query strings', () => {
  assert.equal(appPath('map'), '/app/map');
  assert.equal(appPath('town', 'city-of-hartford-ct'), '/app/town/city-of-hartford-ct');
  assert.equal(appPath('rankings?state=NJ'), '/app/rankings');
  assert.equal(appPath('compare', 'a?x=1'), '/app/compare/a');
  assert.equal(appPath(''), '/app/map');
});

test('a count carries only path, title, referrer and the event flag', () => {
  const page = new URL(countUrl({ code: 'test', path: '/town/x/', title: 'X, PA - TownView', referrer: 'https://news.example' }));
  assert.equal(page.origin, 'https://test.goatcounter.com');
  assert.equal(page.pathname, '/count');
  assert.equal(page.searchParams.get('p'), '/town/x/');
  assert.equal(page.searchParams.get('t'), 'X, PA - TownView');
  assert.equal(page.searchParams.get('r'), 'https://news.example');
  assert.equal(page.searchParams.get('e'), null);
  assert.deepEqual([...page.searchParams.keys()].sort(), ['p', 'r', 'rnd', 't']);
  const ev = new URL(countUrl({ code: 'test', path: 'search-map', title: 'Map - TownView', event: true }));
  assert.equal(ev.searchParams.get('e'), 'true');
  assert.equal(ev.searchParams.get('r'), null);
  assert.deepEqual([...ev.searchParams.keys()].sort(), ['e', 'p', 'rnd', 't']);
});
