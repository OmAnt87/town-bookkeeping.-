#!/usr/bin/env node
// Writes docs/OR_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'OR',
  name: 'Oregon',
  townWord: null,
  kinds: ['County', 'City', 'Town'],
  text: () => ({
    intro: 'Oregon has 36 counties and about 240 cities, and no townships. Counties provide city-type services in unincorporated areas. Public schools, fire, water and park districts are separate governments. Each county\'s file holds the county and the cities whose people mostly live in it.',
    sources: [],
    differs: [
      '**Special districts are separate.** Fire, water, park, library and port districts have their own budgets, so some services residents pay for are not in city or county reports.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to Oregon county and city candidates were not loaded.',
      '**Coverage is about two thirds.** The Census estimated, or has incomplete records for, 86 Oregon governments, including 8 counties and Beaverton, so they are not listed.',
    ],
  }),
});
