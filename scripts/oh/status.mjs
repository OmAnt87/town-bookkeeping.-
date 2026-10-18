#!/usr/bin/env node
// Writes docs/OH_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'OH',
  name: 'Ohio',
  townWord: 'townships',
  kinds: ['County', 'City', 'Village', 'Township'],
  text: () => ({
    intro: 'Ohio has 88 counties, about 250 cities, 680 villages and 1,300 townships. Townships serve the areas outside cities and usually include the villages inside them, so village residents typically pay a village and a township. Public schools are run by separate school districts. Each county\'s file holds the county and the governments whose people mostly live in it.',
    sources: ['The Auditor of State publishes each government\'s audit individually, and Ohio Checkbook covers only the local governments that opt in.'],
    differs: [
      '**Income taxes.** Most Ohio cities and villages levy a municipal income tax, often their largest revenue; the Census files count it with other local taxes, shown as "Sales and other local taxes".',
      '**County treasurers collect property tax** for every government, so city, village and township reports show only their own levy, and the property tax rules used for northern New England are not needed.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** County and local candidates file campaign finance reports with their county board of elections, not with the state.',
      '**Coverage is about half.** In 2022 the Census estimated rather than received figures for roughly 1,000 Ohio governments, mostly small townships and villages; Youngstown and 35 counties are among them, so they are not listed.',
    ],
  }),
});
