#!/usr/bin/env node
// Writes docs/CO_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'CO',
  name: 'Colorado',
  townWord: null,
  kinds: ['County', 'City', 'Town'],
  text: () => ({
    intro: 'Colorado has 64 counties and about 270 cities and towns, and no townships. Counties provide city-type services in unincorporated areas. Public schools and many special districts (metropolitan, fire, water, park and recreation districts) are separate governments. Each county\'s file holds the county and the cities and towns whose people mostly live in it.',
    sources: ['Almost every Colorado county, city and town reported to the Census in 2022, so coverage is nearly complete.'],
    differs: [
      '**Denver and Broomfield are consolidated cities and counties** and report as one city each, covering city and county services.',
      '**Special districts are separate.** Colorado has many metropolitan, fire, water and park districts with their own taxes, so some services residents pay for are not in city or county reports.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to Colorado county and city candidates were not loaded.',
    ],
  }),
});
