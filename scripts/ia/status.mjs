#!/usr/bin/env node
// Writes docs/IA_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'IA',
  name: 'Iowa',
  townWord: null,
  kinds: ['County', 'City'],
  text: () => ({
    intro: 'Iowa has 99 counties and about 940 cities; every incorporated place is a city, however small. Iowa\'s townships are not counted as governments by the Census (their trustees mostly look after cemeteries and contract for fire protection), so none are listed. Public schools are run by separate school districts. Each county\'s file holds the county and the cities whose people mostly live in it.',
    sources: ['Almost every Iowa city reported to the Census in 2022, so city coverage is nearly complete.'],
    differs: [
      '**County treasurers collect property tax** for every government, so city reports show only their own levy.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to city and county candidates were not loaded.',
      '**Many counties are missing:** the Census estimated rather than received figures for about 40 Iowa counties.',
    ],
  }),
});
