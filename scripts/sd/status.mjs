#!/usr/bin/env node
// Writes docs/SD_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'SD',
  name: 'South Dakota',
  townWord: 'townships',
  kinds: ['County', 'City', 'Town', 'Village', 'Township'],
  text: () => ({
    intro: 'South Dakota has 66 counties, about 155 cities, 150 towns and about 900 organized townships. Townships govern rural areas outside cities and towns, mainly maintaining township roads. Public schools are run by separate school districts. Each county\'s file holds the county and the governments whose people mostly live in it.',
    sources: [],
    differs: [
      '**County treasurers collect property tax** for every government, so city, town and township reports show only their own levy.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to South Dakota county and local candidates were not loaded.',
      '**Coverage is about a third.** The Census estimated, or has incomplete records for, about 800 South Dakota governments, mostly townships and small towns, plus 25 counties, so they are not listed.',
    ],
  }),
});
