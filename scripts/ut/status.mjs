#!/usr/bin/env node
// Writes docs/UT_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'UT',
  name: 'Utah',
  townWord: null,
  kinds: ['County', 'City', 'Town'],
  text: () => ({
    intro: 'Utah has 29 counties and about 250 cities and towns, and no townships. Each county\'s file holds the county and the cities and towns whose people mostly live in it.',
    sources: [],
    differs: [
      '**Special service districts are separate** (many fire, water and sewer services), so some services residents pay for are not in city or county reports.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to Utah local candidates were not loaded.',
    ],
  }),
});
