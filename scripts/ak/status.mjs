#!/usr/bin/env node
// Writes docs/AK_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'AK',
  name: 'Alaska',
  townWord: null,
  kinds: ['County', 'City'],
  text: () => ({
    intro: 'Alaska has 19 organized boroughs (listed as counties) and about 145 cities. Much of the state is the Unorganized Borough, which has no borough government. Anchorage, Juneau, Sitka and Wrangell are consolidated city-boroughs. Each borough\'s file holds the borough and the cities whose people mostly live in it.',
    sources: [],
    differs: [
      '**Boroughs are listed as counties.** Census areas in the Unorganized Borough have no government of their own and are not listed.',
      '**Schools are part of borough and some city governments**, so their spending is included and kept out of the services and overhead shares, as in Connecticut.',
      '**Anchorage, Juneau, Sitka and Wrangell** are consolidated city-boroughs and are shown once, at their borough\'s center.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money** comes from the Alaska Public Offices Commission (`node scripts/ak/fetch-apoc.mjs`): the CSV export of its campaign disclosure income search, one report year at a time. Each report names the municipality and office, so mayor, assembly and city council candidates are placed directly. Some municipalities run their own campaign disclosure, so a borough or city with no APOC reports may still have candidates who raised money.',
    ],
  }),
});
