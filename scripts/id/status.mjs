#!/usr/bin/env node
// Writes docs/ID_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'ID',
  name: 'Idaho',
  townWord: null,
  kinds: ['County', 'City'],
  text: () => ({
    intro: 'Idaho has 44 counties and about 200 cities, and no townships. Each county\'s file holds the county and the cities whose people mostly live in it.',
    sources: [],
    differs: [
      '**Highway districts and fire districts are separate** in much of Idaho, so some road and fire spending is not in city or county reports.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to Idaho local candidates were not loaded.',
    ],
  }),
});
