#!/usr/bin/env node
// Writes docs/MT_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'MT',
  name: 'Montana',
  townWord: null,
  kinds: ['County', 'City', 'Town'],
  text: () => ({
    intro: 'Montana has 56 counties and about 130 cities and towns. Anaconda-Deer Lodge and Butte-Silver Bow are consolidated city-county governments. Each county\'s file holds the county and the cities and towns whose people mostly live in it.',
    sources: [],
    differs: [
      '**Anaconda-Deer Lodge and Butte-Silver Bow** are consolidated city-county governments and are shown once, at their county\'s center.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to Montana local candidates were not loaded.',
    ],
  }),
});
