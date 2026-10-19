#!/usr/bin/env node
// Writes docs/WV_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'WV',
  name: 'West Virginia',
  townWord: null,
  kinds: ['County', 'City', 'Town', 'Village'],
  text: () => ({
    intro: 'West Virginia has 55 counties and about 230 cities, towns and villages. Each county\'s file holds the county and the municipalities whose people mostly live in it.',
    sources: [],
    differs: [
      '**The state runs almost all roads**, so county road spending is small.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to West Virginia local candidates were not loaded.',
    ],
  }),
});
