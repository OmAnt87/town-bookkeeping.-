#!/usr/bin/env node
// Writes docs/ME_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'ME',
  name: 'Maine',
  kinds: ['County', 'City', 'Town', 'Plantation'],
  text: ({ members, adjusted }) => ({
    intro: 'Maine\'s cities, towns and plantations are its main local governments; plantations are a simpler form of town government. Its sixteen counties run jails, sheriffs and registries of deeds. Larger cities run their own school departments; most towns belong to regional school units or school districts. Each county\'s file holds the county and the governments in it.',
    sources: ['Maine has no statewide compilation of municipal finances; towns publish annual reports and audits individually, and Maine Revenue Services\' municipal valuation return covers taxes, not spending.'],
    differs: [
      `**One tax bill, several governments.** Each city, town and plantation collects the whole property tax bill, including its assessment for the regional school unit or school district and the county tax, and pays them over. ${adjusted} of the ${members} cities, towns and plantations reported the whole levy to the Census as their own property tax. For those, only the town's own share is counted: what its spending needed beyond its other revenue, which is how the town rate is set. That also means they show no surplus or deficit for the year. Each affected town's report says so and gives the amounts.`,
      '**City school departments.** Cities such as Portland, Lewiston, Bangor, Auburn and Augusta run their own schools, so school spending is part of their reports; school spending is left out of the services and overhead shares, as in Connecticut and Massachusetts.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** City, town and plantation candidates file campaign finance reports with their municipal clerk, not the state, and contributions to county candidates were not loaded.',
      '**Overhead may be overstated.** More Maine towns report large "other general government" spending than New Hampshire or Vermont towns do. Some of it may be county or school assessments filed as town spending, which counts as overhead and lowers scores.',
      '**Not in the Census files:** unorganized territory (about half of Maine\'s land area, mostly in the north) has no local government of its own; the state and counties serve it.',
    ],
    imputedNote: 'This includes York, Aroostook, Knox and Waldo Counties and the cities of Belfast, Calais, Eastport, Ellsworth, Gardiner and Hallowell.',
  }),
});
