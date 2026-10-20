#!/usr/bin/env node
// Writes docs/KS_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'KS',
  name: 'Kansas',
  townWord: 'townships',
  kinds: ['County', 'City', 'Township'],
  text: () => ({
    intro: 'Kansas has 105 counties, about 625 cities and about 1,300 townships. Townships govern the rural areas outside cities, mainly maintaining township roads; cities are separate from them. Public schools are run by separate school districts. Each county\'s file holds the county and the governments whose people mostly live in it.',
    sources: [],
    differs: [
      '**Kansas City is unified with Wyandotte County** and reports as one city government.',
      '**County treasurers collect property tax** for every government, so city and township reports show only their own levy.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to Kansas county and local candidates were not loaded.',
      '**Coverage is about a third.** The Census estimated, or has incomplete records for, about 1,200 Kansas governments, mostly townships and small cities, plus 53 counties, so they are not listed.',
    ],
  }),
});
