#!/usr/bin/env node
// Writes docs/AZ_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'AZ',
  name: 'Arizona',
  townWord: null,
  kinds: ['County', 'City', 'Town'],
  text: () => ({
    intro: 'Arizona has 15 counties and 91 cities and towns, and no townships. Counties provide city-type services in unincorporated areas, and much of the state is tribal or federal land outside any city. Public schools, fire districts and other special districts are separate governments. Each county\'s file holds the county and the cities and towns whose people mostly live in it.',
    sources: [],
    differs: [
      '**Special districts are separate.** Fire districts, water and irrigation districts and others have their own budgets, so some services residents pay for are not in city or county reports.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to Arizona county and city candidates were not loaded.',
      '**Coverage is about two thirds.** The Census estimated, or has incomplete records for, 39 Arizona governments, including 4 counties and small cities such as Nogales, Bisbee and Globe, so they are not listed. The largest cities are included.',
    ],
  }),
});
