#!/usr/bin/env node
// Writes docs/MN_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'MN',
  name: 'Minnesota',
  townWord: 'townships',
  kinds: ['County', 'City', 'Township'],
  text: () => ({
    intro: 'Minnesota has 87 counties, about 850 cities and 1,780 townships. Townships govern the areas outside cities, mostly maintaining township roads; cities are separate from the township around them. Counties run human services, public health and county highways. Public schools are run by separate school districts. Each county\'s file holds the county and the governments whose people mostly live in it.',
    sources: [],
    differs: [
      '**County auditors and treasurers collect property tax** for every government, so city and township reports show only their own levy.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Local and county candidates file campaign finance reports locally, not with the state Campaign Finance Board.',
    ],
    skippedNote: 'renamed, newly incorporated or reorganized after the 2024 Census geography',
  }),
});
