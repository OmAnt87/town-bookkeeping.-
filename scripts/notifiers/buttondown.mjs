// Sends one email through Buttondown to the subscribers carrying `tag`.
// Swap this module to change mailing-list providers.
// API: https://docs.buttondown.com/api-emails-introduction

const API = 'https://api.buttondown.com/v1/emails';
const SUBSCRIBERS = 'https://api.buttondown.com/v1/subscribers';

export async function sendToTag(apiKey, { tag, subject, body }) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { Authorization: `Token ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      subject,
      body,
      status: 'about_to_send',
      filters: { predicate: 'and', groups: [], filters: [{ field: 'subscriber.tags', operator: 'contains', value: tag }] },
    }),
  });
  if (!res.ok) throw new Error(`Buttondown ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

// Every tag carried by at least one subscriber, so emails go only to towns someone follows.
export async function followedTags(apiKey) {
  const tags = new Set();
  for (let url = SUBSCRIBERS; url;) {
    const res = await fetch(url, { headers: { Authorization: `Token ${apiKey}` } });
    if (!res.ok) throw new Error(`Buttondown ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const page = await res.json();
    for (const s of page.results || []) for (const t of s.tags || []) tags.add(t);
    url = page.next;
  }
  return tags;
}
