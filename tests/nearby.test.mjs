import test from 'node:test';
import assert from 'node:assert/strict';
import { distanceMiles, nearestTowns, zipFile, MAX_MILES } from '../js/engine/nearby.js';
import { zipShards } from '../scripts/build-zips.mjs';
import { packSummary, unpackSummary, SUMMARY_FORMAT } from '../js/data/summary-format.js';

const e = (id, type, lat, lng, extra = {}) => ({ town: { id, name: id, type, state: 'CT', lat, lng, ...extra }, s: { grade: 'B' } });

test('distances in miles', () => {
  assert.equal(distanceMiles({ lat: 41.7651, lng: -72.6708 }, { lat: 41.7651, lng: -72.6708 }), 0);
  // Hartford to New Haven is about 34 miles in a straight line.
  const d = distanceMiles({ lat: 41.7637, lng: -72.6851 }, { lat: 41.3083, lng: -72.9279 });
  assert.ok(d > 32 && d < 36, String(d));
});

test('nearest towns come in order, skip counties, and stop at the distance limit', () => {
  const entries = [
    e('far', 'Town', 42.5, -72.6), e('mid', 'Town', 41.85, -72.6), e('near', 'City', 41.77, -72.67, { county: 'Hartford County' }),
    e('hartford-county', 'County', 41.77, -72.67, { name: 'Hartford County' }), e('nowhere', 'Town', NaN, NaN),
  ];
  entries[3].town.name = 'Hartford County';
  const { towns, county } = nearestTowns(entries, { lat: 41.7651, lng: -72.6708 });
  assert.deepEqual(towns.map((x) => x.entry.town.id), ['near', 'mid']);
  assert.equal(county.town.id, 'hartford-county');
  assert.ok(towns.every((x) => x.miles <= MAX_MILES));
  assert.equal(nearestTowns(entries, { lat: 30, lng: -60 }).towns.length, 0);
  assert.equal(nearestTowns(entries, { lat: 30, lng: -60 }).county, null);
  assert.equal(nearestTowns(entries, { lat: 41.7651, lng: -72.6708 }, 1).towns.length, 1);
});

test('a county is matched only by name in the same state', () => {
  const entries = [e('t', 'Town', 40, -75, { county: 'Bucks County' }), e('other', 'County', 40, -75, { name: 'Bucks County', state: 'NJ' })];
  entries[1].town.state = 'NJ';
  assert.equal(nearestTowns(entries, { lat: 40, lng: -75 }).county, null);
});

test('ZIP shard paths and gazetteer parsing', () => {
  assert.equal(zipFile('06103'), 'data/zip/061.json');
  assert.equal(zipFile(' 06103 '), 'data/zip/061.json');
  assert.equal(zipFile('6103'), null);
  assert.equal(zipFile('061034'), null);
  assert.equal(zipFile('abcde'), null);
  const text = 'GEOID\tALAND\tAWATER\tALAND_SQMI\tAWATER_SQMI\tINTPTLAT\tINTPTLONG                                                                                                              \n06103\t1\t0\t0\t0\t41.765123\t-72.670789\n06104\t1\t0\t0\t0\tx\t-72\n10001\t1\t0\t0\t0\t40.75\t-73.99\n';
  assert.deepEqual(zipShards(text), { '061': { '06103': [41.7651, -72.6708] }, 100: { 10001: [40.75, -73.99] } });
  assert.throws(() => zipShards('ZIP\tLAT\n'), /Unexpected gazetteer header/);
});

test('compact summary round-trips and passes the old format through', () => {
  const towns = [
    { id: 'a', state: 'CT', stateName: 'Connecticut', reporting: { basis: 'Actual results' }, surveillanceMap: { cameras: 2, source: { label: 'OSM', url: 'https://x' } } },
    { id: 'b', state: 'CT', stateName: 'Connecticut', reporting: { basis: 'Actual results' } },
    { id: 'c', state: 'NJ', stateName: 'New Jersey', reporting: { basis: 'Adopted budget' }, surveillanceMap: { cameras: 1, source: { label: 'OSM', url: 'https://x' } } },
  ];
  const packed = packSummary({ generated: '2026-11-14', towns });
  assert.equal(packed.format, SUMMARY_FORMAT);
  assert.equal(packed.reporting.length, 2);
  assert.equal(packed.cameraSources.length, 1);
  assert.equal(packed.towns[0].stateName, undefined);
  assert.deepEqual(unpackSummary(JSON.parse(JSON.stringify(packed))), { generated: '2026-11-14', towns });
  const old = { generated: 'x', towns };
  assert.equal(unpackSummary(old), old);
});
