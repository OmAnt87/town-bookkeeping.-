#!/usr/bin/env node
// Writes docs/WA_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'WA',
  name: 'Washington',
  townWord: null,
  kinds: ['County', 'City', 'Town'],
  text: () => ({
    intro: 'Washington has 39 counties and about 280 cities and towns, and no townships. Counties provide city-type services in unincorporated areas. Public schools, ports, fire, library and public utility districts are separate governments. Each county\'s file holds the county and the cities and towns whose people mostly live in it.',
    sources: ['Every Washington county and almost every city and town reported to the Census in 2022, so coverage is nearly complete.'],
    differs: [
      '**Special districts are separate.** Fire, water, park, library and port districts have their own budgets, so some services residents pay for are not in city or county reports.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to Washington county and city candidates were not loaded.',
      '**Eight governments are missing:** the Census estimated their figures.',
    ],
  }),
});
