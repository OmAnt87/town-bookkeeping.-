#!/usr/bin/env node
// Writes docs/MO_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'MO',
  name: 'Missouri',
  townWord: 'townships',
  kinds: ['County', 'City', 'Town', 'Village', 'Township'],
  text: () => ({
    intro: 'Missouri has 114 counties, the independent City of St. Louis, about 940 cities, towns and villages, and about 280 townships in the counties that have township government. Public schools are run by separate school districts. Each county\'s file holds the county and the governments whose people mostly live in it; St. Louis has its own file.',
    sources: [],
    differs: [
      '**St. Louis is outside any county**, so its report covers both city and county services.',
      '**County collectors gather property tax** for every government, so city, town, village and township reports show only their own levy.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to Missouri county and local candidates were not loaded.',
      '**Coverage is about half.** The Census estimated, or has incomplete records for, about 730 Missouri governments, including 57 counties and St. Joseph, so they are not listed.',
    ],
  }),
});
