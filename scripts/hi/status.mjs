#!/usr/bin/env node
// Writes docs/HI_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'HI',
  name: 'Hawaii',
  townWord: null,
  kinds: ['County'],
  text: () => ({
    intro: 'Hawaii has no city or town governments: its four counties, including the City and County of Honolulu, provide all local services. Kalawao County is run by the state. Each county has its own file.',
    sources: [],
    differs: [
      '**Counties are the only local governments.** They provide the services cities provide elsewhere, so county overhead and services are measured like a city\'s.',
      '**Honolulu** is a consolidated city and county and is shown at the county\'s center.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to Hawaii county candidates were not loaded.',
    ],
  }),
});
