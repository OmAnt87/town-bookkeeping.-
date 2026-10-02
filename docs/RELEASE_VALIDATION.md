# Trust and usability release validation

Validated against the bundled data on October 1, 2026.

## Automated checks

`npm test`: 42 passing tests, including all 29 original tests.

- Missing versus explicit-zero amounts; unitemized services; ungraded scores.
- Missing values last in ascending and descending sorts.
- Comparison metadata, political period and recipient-scope compatibility.
- Invalid import shapes, duplicate IDs, finite amounts and coordinate bounds.
- Failed/invalid county request eviction and successful retry.
- Route and dataset identity guards for pending rendering.
- Complete export hydration and named failure without a partial result.
- Validation and summary/full-record score parity for all 4,808 public-record
  towns in all 154 county files.
- Original summary fields and scoring engine unchanged; only reporting metadata
  and the summary generation date were added/updated.

## Browser checks

Local preview at port 8087; temporary fault-injection proxy at port 8088.

- Empty Compare, searchable selectors, North Canaan versus Forest City:
  ungraded score suppressed, unknown services/political money labeled, no winners.
- Rankings: 50 rows, next page, search, four public-record state options.
- NJ Cherry Hill, NY Oneida Castle, PA Forest City and CT North Canaan reports.
- PA political map: all 2,549 records unavailable, excluded from heat.
- County 503 displayed with Retry; recovery opens the report.
- Confirmed pending county request followed by navigation to Data: delayed error
  leaves Data intact.
- Public-data startup outage explicitly displays demo-only fallback; Retry restores
  4,808 public-record towns plus 121 fictional examples.
- Complete export outage names Absecon City and nj-atlantic.json; no partial file.
- Complete export recovered successfully and downloaded all 4,929 loaded towns.
- Invalid coordinate/object import rejected; all 4,929 existing towns retained.
- Valid one-town demo import updates the loaded count and clears incompatible filters;
  restoring bundled data recovers the original dataset.
- Keyboard Tab moves from town search to its labeled selector.
- Desktop 1280×900 and phone 390×844 layouts reviewed in light and dark themes.

## Limits

External government sources were not refreshed. Financial values, score weights,
and thresholds are unchanged. Reporting metadata describes existing source notes;
missing metadata remains unknown. Different reporting scopes remain a limitation
of comparisons. Red-flag/tax-break records do not establish comparable research
coverage, so those rows do not highlight a winner. The existing partial-transparency
scoring policy is documented and unchanged.
