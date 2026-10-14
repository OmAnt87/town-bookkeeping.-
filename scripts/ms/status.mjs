#!/usr/bin/env node
// Writes docs/MS_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'MS',
  name: 'Mississippi',
  townWord: null,
  kinds: ['County', 'City', 'Town', 'Village'],
  text: () => ({
    intro: 'Mississippi has 82 counties and about 300 cities, towns and villages. Each county\'s file holds the county and the municipalities whose people mostly live in it.',
    sources: [],
    differs: [
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to Mississippi local candidates were not loaded.',
    ],
  }),
});
