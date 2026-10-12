#!/usr/bin/env node
// Writes docs/KY_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'KY',
  name: 'Kentucky',
  townWord: null,
  kinds: ['County', 'City'],
  text: () => ({
    intro: 'Kentucky has 120 counties and about 410 cities, and no townships. Lexington-Fayette and Louisville-Jefferson County are merged city-county governments. Each county\'s file holds the county and the cities whose people mostly live in it.',
    sources: [],
    differs: [
      '**Lexington-Fayette and Louisville Metro** are merged city-county governments and are shown once, at their county\'s center. Smaller cities inside Jefferson County are listed separately.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to Kentucky local candidates were not loaded.',
    ],
  }),
});
