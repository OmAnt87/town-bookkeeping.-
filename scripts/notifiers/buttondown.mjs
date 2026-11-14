// Buttondown, the mailing list behind email alerts for followed towns.
// Swap this module to change providers.
// API: https://docs.buttondown.com/api-introduction

const API = 'https://api.buttondown.com/v1';

async function call(apiKey, path, init = {}, fetcher = fetch) {
  const res = await fetcher(path.startsWith('http') ? path : `${API}${path}`, {
    ...init,
    headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
  if (!res.ok) throw new Error(`Buttondown ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Confirmed subscribers per town tag ({ "town:<id>": count }), from one paged listing.
// Unconfirmed (double opt-in pending) and unsubscribed addresses are not counted.
export async function followerCounts(apiKey, fetcher = fetch) {
  const counts = {};
  let next = '/subscribers?type=regular';
  while (next) {
    const page = await call(apiKey, next, {}, fetcher);
    for (const s of page.results || []) for (const tag of s.tags || []) if (tag.startsWith('town:')) counts[tag] = (counts[tag] || 0) + 1;
    next = page.next || null;
  }
  return counts;
}

// One email to the confirmed subscribers carrying `tag`. Buttondown adds the unsubscribe link.
export function sendToTag(apiKey, { tag, subject, body }, fetcher = fetch) {
  return call(apiKey, '/emails', {
    method: 'POST',
    body: JSON.stringify({
      subject,
      body,
      status: 'about_to_send',
      filters: { predicate: 'and', groups: [], filters: [{ field: 'subscriber.tags', operator: 'contains', value: tag }] },
    }),
  }, fetcher);
}
