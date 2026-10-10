#!/usr/bin/env node
// Writes docs/VT_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'VT',
  name: 'Vermont',
  kinds: ['County', 'City', 'Town', 'Village'],
  text: ({ members, adjusted }) => ({
    intro: 'Vermont\'s towns and cities are its main local governments. Incorporated villages are a second layer inside a town, so village residents pay both. Counties have small budgets, mostly the courthouse; the state pays most of the cost of sheriffs and state\'s attorneys. Public schools are run by school districts and paid for through the statewide education tax. Each county\'s file holds the county and the governments in it.',
    sources: ['Vermont has no statewide compilation of town finances; towns publish annual reports and audits individually.'],
    differs: [
      `**One tax bill, several governments.** Each town and city collects the state education property tax (homestead and non-homestead), which pays for schools through the state Education Fund, and the county tax, and pays them over. ${adjusted} of the ${members} cities, towns and villages reported the whole levy to the Census as their own property tax. For those, only the town's own share is counted: what its spending needed beyond its other revenue, which is how the town rate is set. That also means they show no surplus or deficit for the year. Each affected town's report says so and gives the amounts.`,
      '**Villages are counted separately from their towns.** A village\'s report covers the village government only (often an electric or water utility); its residents also pay the town, which has its own report.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** City, town and village candidates do not file campaign finance reports with the state, and contributions to county candidates were not loaded.',
      '**Not in the Census files:** unorganized towns and gores (mostly in Essex County) have no government of their own.',
    ],
    imputedNote: 'This includes Bennington and Washington Counties.',
    skippedNote: 'merged into the Town of Lyndon in 2024',
  }),
});
