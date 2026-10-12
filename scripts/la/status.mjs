#!/usr/bin/env node
// Writes docs/LA_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'LA',
  name: 'Louisiana',
  townWord: null,
  kinds: ['County', 'City', 'Town', 'Village'],
  text: () => ({
    intro: 'Louisiana has 64 parishes (listed as counties) and about 300 cities, towns and villages. Each parish\'s file holds the parish and the municipalities whose people mostly live in it.',
    sources: [],
    differs: [
      '**Parishes are listed as counties.** Sheriffs, assessors and clerks of court are separate offices with their own budgets and are not in parish reports.',
      '**Consolidated city-parish governments** (such as New Orleans and Baton Rouge) are listed the way the Census files them.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to Louisiana local candidates were not loaded.',
    ],
  }),
});
