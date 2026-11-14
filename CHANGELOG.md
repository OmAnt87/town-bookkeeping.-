# Changelog

Releases of TownView (townview.org). Newest first.

## 0.2.0 - Findability

- Every town, city and county has its own page at `/town/<id>/` that search engines and link previews can read: score, key numbers, money in and out, red flags, and a link into the full interactive report.
- Every state has a page at `/state/<st>/` linking each government in it; `/state/` lists the states.
- `sitemap.xml` lists all of these pages (it listed only the home page before).
- New **Share** button on town reports. It uses the device share sheet where there is one and copies the link otherwise.
- RSS feed items link to the town's page.
- Unknown `/town/...` and `/state/...` addresses open in the app instead of showing a bare 404.

The pages are built at deploy by `scripts/build-pages.mjs` and are not committed. Preview them with `npm run build:pages`.
