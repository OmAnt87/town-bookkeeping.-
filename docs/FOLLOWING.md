# Following towns

Readers can press **☆ Follow** on any town report to save it to their
**Following** page.

## How it works

- Followed towns are kept in this browser only, in `localStorage['tv-follows']`
  (`js/follows.js`). Nothing is sent to a server or third party, and no email
  or other personal data is collected.
- Each saved town stores a fingerprint of its books (`townFingerprint` in
  `js/engine/changes.js`): fiscal year, data date, population, debt and the
  revenue, spending, political-money and tax-break figures, rounded to the
  nearest $100 so rounding noise does not count.
- When the published data changes, the fingerprint no longer matches. The
  Following page then marks the town **Books updated**, and its report shows a
  note. Opening the report marks it as seen.

The fingerprint uses only fields that `data/real/summary.json` also carries,
so the Following page can check every saved town without loading its ledger.
