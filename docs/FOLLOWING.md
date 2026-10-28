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

## RSS feeds

Every town also has an RSS feed at `feeds/<town id>.xml` (for example
`https://townview.org/feeds/city-and-borough-of-juneau-ak.xml`), linked from
its report and from the Following page. Readers who want to hear about
changes without visiting can add it to any feed reader; nothing about them
reaches TownView.

The feeds are not stored in the repository. At each deploy,
`.github/workflows/pages.yml` runs `scripts/build-feeds.mjs`, which walks the
recent data commits on main (first-parent history, last 90 days, up to 60
commits), compares each changed town with its record before that commit
(`diffDatasets` in `js/engine/changes.js`) and writes one item per change,
newest first, up to 20 per feed. Each item's id is the town and commit, so
rebuilding never shows a reader the same change twice. Towns new to the site
and changes that only move the data date are left out.

Build them locally (needs full git history; writes the ignored `feeds/`):

```sh
node scripts/build-feeds.mjs
```
