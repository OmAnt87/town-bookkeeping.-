import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreAll, renderTownPage, renderStatePage, renderStateIndex, renderSitemap, townDescription, townPath, statePath, SITE } from '../scripts/build-pages.mjs';
import { shareUrl } from '../js/views/share-ui.js';
import { stateSummary } from '../js/engine/states.js';

const town = (o = {}) => ({
  id: 'test-town-pa', name: 'Test Town', state: 'PA', stateName: 'Pennsylvania', county: 'Test County', type: 'Borough',
  lat: 40, lng: -75, population: 1000, fiscalYear: 2024, asOf: '2026-10-01', detailFile: 'pa-test.json',
  revenue: { propertyTax: 600000, stateAid: 400000 }, spending: { publicSafety: 700000, administration: 200000, debtService: 100000 },
  debt: 250000, influence: { pacContributions: 500 }, transparency: { budgetOnline: true, auditOnTime: true }, redFlags: [], ...o,
});
const ldOf = (html) => JSON.parse(html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s)[1]);

test('town page carries its own title, description, canonical and link into the report', () => {
  const [entry] = scoreAll([town()]);
  const html = renderTownPage(entry);
  assert.match(html, /<title>Test Town, PA budget: where the money goes - TownView<\/title>/);
  assert.match(html, /<link rel="canonical" href="https:\/\/townview\.org\/town\/test-town-pa\/">/);
  assert.match(html, /<meta property="og:url" content="https:\/\/townview\.org\/town\/test-town-pa\/">/);
  assert.match(html, /href="\/#\/town\/test-town-pa"/);
  assert.match(html, /href="\/feeds\/test-town-pa\.xml"/);
  assert.match(html, /href="\/state\/pa\/"/);
  assert.match(html, /\$1\.0M/);
  assert.match(townDescription(entry), /took in \$1\.0M and spent \$1\.0M in fiscal year 2024/);
  const ld = ldOf(html);
  const dataset = ld['@graph'].find((x) => x['@type'] === 'Dataset');
  assert.equal(dataset.url, `${SITE}town/test-town-pa/`);
  assert.equal(dataset.distribution[0].contentUrl, `${SITE}data/real/pa-test.json`);
  assert.equal(ld['@graph'][0].itemListElement.length, 3);
});

test('town page escapes names and keeps JSON-LD from closing its script', () => {
  const [entry] = scoreAll([town({ name: 'O\'Neil </script><b>&"Town"', county: '<i>County</i>' })]);
  const html = renderTownPage(entry);
  assert.ok(!html.includes('<b>&"Town"'));
  assert.ok(!html.includes('<i>County</i>'));
  // The theme script, the JSON-LD and the visit counter: the name added none.
  assert.equal(html.match(/<\/script>/g).length, 3);
  assert.equal(ldOf(html)['@graph'][1].spatialCoverage.name, 'O\'Neil </script><b>&"Town", Pennsylvania');
});

test('town page says what is missing instead of showing zeros', () => {
  const bare = town({ id: 'bare-pa', name: 'Bare', debt: undefined, influence: undefined, transparency: undefined, redFlags: undefined, spending: { otherSpending: 1000000 } });
  const [entry] = scoreAll([bare]);
  assert.equal(entry.s.grade, '?');
  const html = renderTownPage(entry);
  assert.match(html, /Not graded/);
  assert.match(html, /No debt statement loaded/);
  assert.match(html, /No filings loaded/);
  assert.match(townDescription(entry), /Not graded yet\./);
  assert.ok(!/NaN|undefined|Infinity/.test(html));
});

test('town page lists other governments in the county, largest first, without itself', () => {
  const entries = scoreAll([town(), town({ id: 'small-pa', name: 'Small', population: 50 }), town({ id: 'big-pa', name: 'Big', population: 9000 })]);
  const html = renderTownPage(entries[0], entries);
  const list = html.slice(html.indexOf('Also in Test County'));
  assert.ok(list.indexOf('/town/big-pa/') < list.indexOf('/town/small-pa/'));
  assert.ok(!list.includes('href="/town/test-town-pa/"'));
});

test('state pages link every town; sitemap lists every page once', () => {
  const entries = scoreAll([town(), town({ id: 'b-pa', name: 'B', county: 'Other County' }), town({ id: 'c-nj', name: 'C', state: 'NJ', stateName: 'New Jersey', asOf: 'unknown' })]);
  const sums = stateSummary(entries);
  const pa = renderStatePage(sums.find((s) => s.state === 'PA'), entries.filter((e) => e.town.state === 'PA'));
  assert.match(pa, /href="\/town\/test-town-pa\/"/);
  assert.match(pa, /href="\/town\/b-pa\/"/);
  assert.ok(!pa.includes('/town/c-nj/'));
  assert.match(pa, /<h3>Other County<\/h3>/);
  const index = renderStateIndex(sums);
  assert.match(index, /href="\/state\/nj\/"/);
  assert.match(index, /href="\/state\/pa\/"/);
  const urls = [{ path: '' }, { path: 'state/' }, ...sums.map((s) => ({ path: statePath(s.state) })), ...entries.map((e) => ({ path: townPath(e.town.id), lastmod: e.town.asOf }))];
  const xml = renderSitemap(urls);
  assert.equal(xml.match(/<url>/g).length, 2 + 2 + 3);
  assert.match(xml, /<loc>https:\/\/townview\.org\/town\/test-town-pa\/<\/loc><lastmod>2026-10-01<\/lastmod>/);
  // A date that is not a date is left out rather than written into the sitemap.
  assert.match(xml, /<loc>https:\/\/townview\.org\/town\/c-nj\/<\/loc><\/url>/);
});

test('share link is the town page for public-record towns, the current address otherwise', () => {
  const loc = { origin: 'https://townview.org', href: 'https://townview.org/#/town/x' };
  assert.equal(shareUrl({ id: 'test-town-pa' }, 'real', loc), 'https://townview.org/town/test-town-pa/');
  assert.equal(shareUrl({ id: 'test-town-pa' }, 'import', loc), loc.href);
});

test('static pages count their landing view and the button into the report', () => {
  const [entry] = scoreAll([town()]);
  const html = renderTownPage(entry);
  assert.match(html, /import\{pageview,wireEvents\}from'\/js\/track\.js';pageview\(location\.pathname\);wireEvents\(\)/);
  assert.match(html, /data-track="full-report"/);
  assert.match(html, /href="\/privacy\.html"/);
});

test('town pages use the preview image for their grade, cite and link to error reports', async () => {
  const { reportErrorUrl } = await import('../js/engine/cite.js');
  const [entry] = scoreAll([town()]);
  const html = renderTownPage(entry);
  const img = html.match(/<meta property="og:image" content="([^"]+)">/)[1];
  assert.match(img, /^https:\/\/townview\.org\/img\/og\/grade-(A|B|C|D|F|none)\.png$/);
  assert.ok(img.endsWith(`grade-${/^[A-F]$/.test(entry.s.grade) ? entry.s.grade : 'none'}.png`));
  assert.match(html, /<meta property="og:image:alt" content="Test Town, PA/);
  assert.match(html, /<strong>Cite:<\/strong> TownView, &quot;Test Town, PA: where the money goes,&quot; fiscal year 2024, data as of 2026-10-01, https:\/\/townview\.org\/town\/test-town-pa\//);
  const url = new URL(reportErrorUrl(entry.town));
  assert.equal(url.origin + url.pathname, 'https://github.com/OmAnt87/town-bookkeeping.-/issues/new');
  assert.equal(url.searchParams.get('template'), 'data-error.yml');
  assert.equal(url.searchParams.get('title'), 'Data error: Test Town, PA');
  assert.match(url.searchParams.get('town'), /test-town-pa.*fiscal year 2024\nhttps:\/\/townview\.org\/town\/test-town-pa\//s);
  assert.ok(html.includes(reportErrorUrl(entry.town).replace(/&/g, '&amp;')));
});
