#!/usr/bin/env node
// Writes docs/NE_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'NE',
  name: 'Nebraska',
  townWord: null,
  kinds: ['County', 'City', 'Village'],
  text: () => ({
    intro: 'Nebraska has 93 counties, about 150 cities and 380 villages, and township governments in some counties. Public schools are run by separate school districts. Each county\'s file holds the county and the cities and villages whose people mostly live in it.',
    sources: ['Almost every Nebraska city and village reported to the Census in 2022, so municipal coverage is nearly complete.'],
    differs: [
      '**County treasurers collect property tax** for every government, so city and village reports show only their own levy.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to Nebraska county and local candidates were not loaded.',
      '**About half the counties are missing:** the Census estimated, or has incomplete records for, 45 Nebraska counties, including Douglas County.',
    ],
  }),
});
