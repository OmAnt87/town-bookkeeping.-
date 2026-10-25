// Sends one email through Buttondown to the subscribers carrying `tag`.
// Swap this module to change mailing-list providers.
// API: https://docs.buttondown.com/api-emails-introduction

const API = 'https://api.buttondown.com/v1/emails';

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
