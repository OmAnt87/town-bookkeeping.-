#!/usr/bin/env node
// Writes docs/WY_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'WY',
  name: 'Wyoming',
  townWord: null,
  kinds: ['County', 'City', 'Town'],
  text: () => ({
    intro: 'Wyoming has 23 counties and 99 cities and towns, and no townships. Each county\'s file holds the county and the cities and towns whose people mostly live in it.',
    sources: [],
    differs: [
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to Wyoming local candidates were not loaded.',
    ],
  }),
});
