#!/usr/bin/env node
// Writes docs/WI_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'WI',
  name: 'Wisconsin',
  kinds: ['County', 'City', 'Village', 'Town'],
  text: () => ({
    intro: 'Wisconsin has 72 counties, about 190 cities, 420 villages and 1,240 towns. Towns govern the rural areas outside cities and villages, and cities and villages are separate from the town around them, so each resident has one municipality and one county. Public schools are run by separate school districts. Each county\'s file holds the county and the governments whose people mostly live in it.',
    sources: ['Every Wisconsin county, city, village and town reported to the Census in 2022, so coverage is nearly complete.'],
    differs: [
      '**One bill, several levies.** Municipal treasurers collect the school district, county and technical college levies on the same tax bill, but their Census figures show only their own levy (revenue is close to spending), so the property tax rules used for northern New England are not applied.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Local candidates file campaign finance reports with their municipal clerk, and contributions to county candidates were not loaded.',
    ],
    skippedNote: 'the Town of Madison was dissolved into Madison and Fitchburg in 2022',
  }),
});
