# Roadmap

What is planned for TownView, in order. Shipped releases are in [CHANGELOG.md](../CHANGELOG.md). Each release is one pull request into `main`, a changelog entry, a version bump in `package.json` and a `vX.Y.0` tag.

| Release | Theme | Outcome | Status |
|---|---|---|---|
| 0.2.0 | Findability | A crawlable page per town and state, full sitemap, share button | Built |
| 0.3.0 | Measurement | Cookieless page and event counts, Search Console | Built; waits on owner steps |
| 0.4.0 | Email alerts | Opt-in follow-by-email, sent when a town's books change | Next |
| 0.5.0 | First visit | Find my town by ZIP or location, faster first load, clearer landing | Built |
| 0.6.0 | Reach | Grade preview images, embeddable score badge, "report an error", state standouts | Built |

## 0.3.0 Measurement

Built: `js/track.js`, `privacy.html`, `data-track` events across the views. See CHANGELOG.md.

Owner steps before it counts anything:

1. Create a site at goatcounter.com (free for non-commercial use) and set `GOATCOUNTER_CODE` in `js/track.js` to its code.
2. Verify townview.org in Google Search Console with a DNS TXT record at IONOS, then submit `https://townview.org/sitemap.xml`.
- Numbers to watch: search impressions and clicks, visits per week, most-viewed towns, share and follow clicks per visit.

## 0.4.0 Email alerts

- Port the Buttondown flow from the old `claude/hopeful-gates-zi03ou` branch (`scripts/notify-changes.mjs`, `scripts/notifiers/buttondown.mjs`, the workflow, the email dialog). Email is an optional step after Follow; browser-only follow and RSS stay.
- Emails reuse `changeLines` from `scripts/build-feeds.mjs`, and each subscriber gets one digest per data push rather than one email per town.
- Owner: Buttondown newsletter with double opt-in; `BUTTONDOWN_API_KEY` repository secret.

## 0.5.0 First visit

Built: ZIP and location finder, continue-where-you-left-off, loading screen, compact summary file. See CHANGELOG.md.

Still open: scoring 28,844 towns at startup takes about 0.7 s on a desktop and several times that on a phone. Moving it to a background worker, or precomputing scores at build time, is the next step if first-load time matters in the counts.

## 0.6.0 Reach

Built: grade preview images, score badges and citations, report-an-error form, state standouts. See CHANGELOG.md.

Left for later:

- **Preview image per town.** A 1200x630 image for each of 28,844 towns would add 1 to 2 GB, past the GitHub Pages limit. The grade cards stand in for now.
- **A national standouts page.** Across states, the extremes were mostly gaps in the records (counties with only school spending on file, debt figures in the hundreds of thousands per resident). It needs a data-quality pass first; error reports will help find the gaps.
- **Commenting without a GitHub account.** It needs a server or a hosted comment service.

## Housekeeping

- Set the repository's default branch to `main`. It is still `claude/hopeful-gates-zi03ou`, an old four-state copy of the site.
- Merge or close the open state-rebuild pull requests (18, 19, 20, 27, 28, 29, 30, 31, 64).
- Deployed size is about 780 MB against the GitHub Pages limit of 1 GB (data about 395 MB, town and state pages with badges about 350 MB, feeds). The county detail files are the place to slim next.
