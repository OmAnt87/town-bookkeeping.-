#!/usr/bin/env node
// Writes docs/ND_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'ND',
  name: 'North Dakota',
  townWord: 'townships',
  kinds: ['County', 'City', 'Township'],
  text: () => ({
    intro: 'North Dakota has 53 counties, about 355 cities and about 1,300 organized townships. Townships govern rural areas outside cities, mainly maintaining township roads; unorganized areas are served by the county. Public schools are run by separate school districts. Each county\'s file holds the county and the governments whose people mostly live in it.',
    sources: [],
    differs: [
      '**Townships often show surpluses.** Many small townships take in more than they spend in a year, holding road reserves; in the oil-producing west they also receive a share of oil tax revenue.',
      '**County treasurers collect property tax** for every government, so city and township reports show only their own levy.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to North Dakota county and local candidates were not loaded.',
      '**Coverage is about half.** The Census estimated, or has incomplete records for, about 800 North Dakota governments, mostly townships and small cities, plus 26 counties, so they are not listed.',
    ],
  }),
});
