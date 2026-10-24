#!/usr/bin/env node
// Writes docs/TX_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'TX',
  name: 'Texas',
  townWord: null,
  kinds: ['County', 'City', 'Town', 'Village'],
  text: () => ({
    intro: 'Texas has 254 counties and about 1,220 cities, towns and villages, and no townships. Public schools are run by independent school districts, and many services come from special districts (municipal utility, hospital, emergency services and others) that are separate governments. Each county\'s file holds the county and the municipalities whose people mostly live in it.',
    sources: [],
    differs: [
      '**Special districts are separate.** Municipal utility districts, hospital districts and emergency services districts have their own taxes, so some services residents pay for are not in city or county reports.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to Texas county and city candidates were not loaded.',
      '**Coverage is about half.** The Census estimated, or has incomplete records for, about 700 Texas governments, mostly small cities and towns, plus about 110 counties, so they are not listed. The 15 largest cities are included; McAllen is among those left out.',
    ],
  }),
});
