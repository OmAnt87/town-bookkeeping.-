import test from 'node:test';
import assert from 'node:assert/strict';
import { composeEmail, plannedEmails } from '../scripts/notify-changes.mjs';
import { followerCounts, sendToTag } from '../scripts/notifiers/buttondown.mjs';
import { followTag } from '../js/engine/changes.js';
import { BUTTONDOWN_USER, subscribeUrl } from '../js/follows.js';

const diff = (id, changes, extra = {}) => ({ id, name: `Town <${id}>`, state: 'PA', changes, ...extra });
const debt = { kind: 'total', key: 'debt', before: 1000000, after: 1500000 };
const asOf = { kind: 'field', key: 'asOf', before: '2026-10-01', after: '2026-11-01' };

test('an alert lists the changes, escapes the name and links the town page', () => {
  const e = composeEmail(diff('a-pa', [asOf, debt]));
  assert.equal(e.tag, 'town:a-pa');
  assert.equal(e.subject, 'Town <a-pa>, PA: the town\'s books were updated');
  assert.ok(!e.body.includes('<a-pa>'));
  assert.match(e.body, /Town &lt;a-pa&gt;, PA/);
  assert.match(e.body, /- Debt: \$1\.0M → \$1\.5M/);
  // The retrieval date goes last, after the changes to the books.
  assert.ok(e.body.indexOf('Debt') < e.body.indexOf('Data as of'));
  assert.match(e.body, /\(https:\/\/townview\.org\/town\/a-pa\/\)/);
});

test('only changed towns with confirmed followers get an email', () => {
  const diffs = [diff('a', [debt]), diff('b', [debt]), diff('c', [asOf]), diff('d', [], { added: true })];
  const counts = { [followTag('a')]: 2, [followTag('c')]: 1, [followTag('d')]: 1 };
  assert.deepEqual(plannedEmails(diffs, counts).map((e) => e.tag), ['town:a']);
});

test('follower counts page through confirmed subscribers and keep only town tags', async () => {
  const calls = [];
  const pages = {
    'https://api.buttondown.com/v1/subscribers?type=regular': { results: [{ tags: ['town:a', 'press'] }, { tags: ['town:a', 'town:b'] }], next: 'https://api.buttondown.com/v1/subscribers?type=regular&page=2' },
    'https://api.buttondown.com/v1/subscribers?type=regular&page=2': { results: [{ tags: [] }, { tags: ['town:b'] }], next: null },
  };
  const fetcher = async (url, init) => { calls.push([url, init.headers.Authorization]); return { ok: true, json: async () => pages[url] }; };
  assert.deepEqual(await followerCounts('k', fetcher), { 'town:a': 2, 'town:b': 2 });
  assert.equal(calls.length, 2);
  assert.ok(calls.every(([, auth]) => auth === 'Token k'));
});

test('an alert is sent to the town tag only, and API errors surface', async () => {
  let sent;
  const ok = async (url, init) => { sent = { url, body: JSON.parse(init.body) }; return { ok: true, json: async () => ({ id: 'e1' }) }; };
  await sendToTag('k', { tag: 'town:a', subject: 's', body: 'b' }, ok);
  assert.equal(sent.url, 'https://api.buttondown.com/v1/emails');
  assert.equal(sent.body.status, 'about_to_send');
  assert.deepEqual(sent.body.filters.filters, [{ field: 'subscriber.tags', operator: 'contains', value: 'town:a' }]);
  const bad = async () => ({ ok: false, status: 401, text: async () => 'bad token' });
  await assert.rejects(sendToTag('k', { tag: 'town:a', subject: 's', body: 'b' }, bad), /Buttondown 401: bad token/);
});

test('email signup ships switched off until a newsletter is set', () => {
  assert.equal(BUTTONDOWN_USER, '');
  assert.equal(subscribeUrl('townview'), 'https://buttondown.com/api/emails/embed-subscribe/townview');
});
