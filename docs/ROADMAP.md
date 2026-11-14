# Roadmap

What is planned for TownView, in order. Shipped releases are in [CHANGELOG.md](../CHANGELOG.md). Each release is one pull request into `main`, a changelog entry, a version bump in `package.json` and a `vX.Y.0` tag.

| Release | Theme | Outcome | Status |
|---|---|---|---|
| 0.2.0 | Findability | A crawlable page per town and state, full sitemap, share button | Built |
| 0.3.0 | Measurement | Cookieless page and event counts, Search Console | Next |
| 0.4.0 | Email alerts | Opt-in follow-by-email, sent when a town's books change | Planned |
| 0.5.0 | First visit | Find my town by ZIP or location, faster first load, clearer landing | Planned |
| 0.6.0 | Reach | Per-town preview images, embeddable score badge, "report an error", state stories | Planned |

## 0.3.0 Measurement

- `js/track.js`: a page view on every route change and events for search, Follow, Share, RSS, CSV export, Compare, forum and state filter. Cookieless counter (GoatCounter), no personal data, honors Do Not Track and Global Privacy Control. The static town pages carry the same snippet so search landings are counted.
- Footer and How scores work change from "no tracking" to "no cookies, no personal data"; add `docs/PRIVACY.md`.
- Owner: create the GoatCounter site; verify townview.org in Google Search Console and submit `sitemap.xml`.
- Numbers to watch: search impressions and clicks, visits per week, most-viewed towns, share and follow clicks per visit.

## 0.4.0 Email alerts

- Port the Buttondown flow from the old `claude/hopeful-gates-zi03ou` branch (`scripts/notify-changes.mjs`, `scripts/notifiers/buttondown.mjs`, the workflow, the email dialog). Email is an optional step after Follow; browser-only follow and RSS stay.
- Emails reuse `changeLines` from `scripts/build-feeds.mjs`, and each subscriber gets one digest per data push rather than one email per town.
- Owner: Buttondown newsletter with double opt-in; `BUTTONDOWN_API_KEY` repository secret.

## 0.5.0 First visit

- Find my town: nearest town from browser location (computed in the browser) and ZIP lookup.
- First load: `data/real/summary.json` is 26 MB before compression. Split it by state or cut it to the fields the map needs.
- Landing copy that explains the site in one screen; reopen the last viewed town.

## 0.6.0 Reach

- Per-town social preview images built at deploy.
- Embeddable score badge and a "cite this" link for local news.
- "Report an error" on every town report, as a prefilled GitHub issue.
- State stories (highest debt per resident, most surveillance programs) as shareable pages.
- A way to comment without a GitHub account.

## Housekeeping

- Set the repository's default branch to `main`. It is still `claude/hopeful-gates-zi03ou`, an old four-state copy of the site.
- Merge or close the open state-rebuild pull requests (18, 19, 20, 27, 28, 29, 30, 31, 64).
- Deployed size is about 690 MB against the GitHub Pages limit of 1 GB. Slimming the data (0.5.0) keeps room for more states' detail.
