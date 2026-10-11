#!/usr/bin/env node
// Writes docs/CA_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'CA',
  name: 'California',
  townWord: null,
  kinds: ['County', 'City', 'Town'],
  text: () => ({
    intro: 'California has 58 counties and about 480 cities and towns. Counties run social services, public health, jails and courts for everyone, and provide city-type services in unincorporated areas. Public schools are run by school districts, and many services come from special districts. Each county\'s file holds the county and the cities and towns whose people mostly live in it.',
    sources: ['Every California county and almost every city reported to the Census in 2022, so coverage is nearly complete.'],
    differs: [
      '**San Francisco is a consolidated city and county** and reports as one city government, covering city and county services, the airport, utilities and its public hospitals.',
      '**Special districts are separate.** Water, fire, park and other special districts have their own budgets, so some services residents pay for are not in city or county reports.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to California county and city candidates were not loaded.',
      '**Large cities often show deficits.** Borrowing is not counted as revenue, so years with heavy capital spending (Los Angeles, San Diego, San Francisco) show spending above revenue.',
    ],
  }),
});
