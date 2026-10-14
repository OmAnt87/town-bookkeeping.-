#!/usr/bin/env node
// Writes docs/TN_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'TN',
  name: 'Tennessee',
  townWord: null,
  kinds: ['County', 'City', 'Town'],
  text: () => ({
    intro: 'Tennessee has 95 counties and about 345 cities and towns. Nashville-Davidson and Lynchburg-Moore are metropolitan governments. Each county\'s file holds the county and the cities and towns whose people mostly live in it.',
    sources: [],
    differs: [
      '**Schools are part of county and some city governments**, so their spending is included and kept out of the services and overhead shares, as in Connecticut.',
      '**Nashville-Davidson and Lynchburg-Moore** are metropolitan governments and are shown once, at their county\'s center.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to Tennessee local candidates were not loaded.',
    ],
  }),
});
