#!/usr/bin/env node
// Writes docs/NM_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'NM',
  name: 'New Mexico',
  townWord: null,
  kinds: ['County', 'City', 'Town', 'Village'],
  text: () => ({
    intro: 'New Mexico has 33 counties and about 105 cities, towns and villages. Los Alamos is an incorporated county. Each county\'s file holds the county and the municipalities whose people mostly live in it.',
    sources: [],
    differs: [
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to New Mexico local candidates were not loaded.',
    ],
  }),
});
