# Changelog

Releases of TownView (townview.org). Newest first.

## 0.6.0 - Reach

- **Link previews show the grade.** Each town page's preview image is the card for its grade (`img/og/grade-*.png`, rendered once by `scripts/build-og-images.mjs`), with alt text naming the town and score.
- **Embeddable score badge** for every town at `/badge/<id>.svg`, built at deploy. Town reports have an "Embed, cite or report an error" panel with copy buttons for the badge code and a citation; the plain town pages carry the citation too.
- **Report an error**: a link on every town report and town page opens a GitHub issue form (`.github/ISSUE_TEMPLATE/data-error.yml`) with the town filled in.
- **Standouts** on state pages: the top five towns on score (high and low), debt per resident, share spent on services, political money per resident and documented red flags. Only places of 2,500 people or more whose records pass every data check and back at least 80% of the score are listed, and towns with a figure more than five times the state's typical one are left off as likely gaps in the records. 21 states have enough such towns to show lists.
- Counted actions: `embed-copy`, `cite-copy`, `report-error`.

## 0.5.0 - First visit

- **Find your town** at the top of the map: type a ZIP code or use your location to see the five nearest governments with their grades and distances, plus their county where it has a report. It works in the browser; the only request is for one small table of ZIP areas named by the ZIP's first three digits (`data/zip/`, built from the Census 2024 ZIP Code Tabulation Areas by `scripts/build-zips.mjs`).
- The map offers to **continue** with the last town you viewed, or shows an example town on a first visit.
- A **loading screen** shows at once instead of a blank page while the data loads, with a link to browse by state.
- `data/real/summary.json` stores repeated reporting notes, camera-map sources and state names once: 18 MB instead of 26 MB to parse, with the same content.
- Counted actions: `find-zip`, `find-location`, `find-result`, `continue-last`, `example-town`. ZIP codes and locations are never sent.

0.4.0 (email alerts) is still to come; it waits on a Buttondown account.

## 0.3.0 - Measurement

- Cookieless visit counts with GoatCounter. Each count is one request holding a path or action name, the page title and, on the first page only, the referring site. No cookies, no identifiers, and nothing typed into the site is sent. No third-party script is loaded.
- Counted actions: share, follow, RSS, compare, forum, downloads, map and rankings search (that a search happened, not what was typed), state filters, and the button from a town page into the full report. App views count under `/app/...`, apart from the town and state pages.
- Nothing is counted off townview.org, under Do Not Track or Global Privacy Control, or after a visitor turns counting off on the new privacy page.
- New `privacy.html`. The footer now reads "Open data, no cookies, no personal data" and links to it.
- Counting ships switched off: it starts once `GOATCOUNTER_CODE` in `js/track.js` is set.

## 0.2.0 - Findability

- Every town, city and county has its own page at `/town/<id>/` that search engines and link previews can read: score, key numbers, money in and out, red flags, and a link into the full interactive report.
- Every state has a page at `/state/<st>/` linking each government in it; `/state/` lists the states.
- `sitemap.xml` lists all of these pages (it listed only the home page before).
- New **Share** button on town reports. It uses the device share sheet where there is one and copies the link otherwise.
- RSS feed items link to the town's page.
- Unknown `/town/...` and `/state/...` addresses open in the app instead of showing a bare 404.

The pages are built at deploy by `scripts/build-pages.mjs` and are not committed. Preview them with `npm run build:pages`.
