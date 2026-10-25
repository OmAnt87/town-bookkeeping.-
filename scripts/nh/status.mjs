#!/usr/bin/env node
// Writes docs/NH_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'NH',
  name: 'New Hampshire',
  kinds: ['County', 'City', 'Town'],
  text: ({ members, adjusted }) => ({
    intro: 'New Hampshire\'s 221 towns and 13 cities are its main local governments; its ten counties run nursing homes, jails, sheriffs and county attorneys. Most public schools are run by separate school districts, but several cities run their own school departments. Each county\'s file holds the county and its cities and towns.',
    sources: ['The Department of Revenue Administration collects each town\'s annual financial report (MS-535) but publishes them only as individual documents, and its website refused connections from the build environment.'],
    differs: [
      `**One tax bill, several governments.** Each town and city collects the whole property tax bill, including the shares for the school district, the county and the state education tax, and pays them over. ${adjusted} of the ${members} cities and towns reported the whole levy to the Census as their own property tax. For those, only the town's own share is counted: what its spending needed beyond its other revenue, which is how the Department of Revenue Administration sets the town rate. That also means they show no surplus or deficit for the year. Each affected town's report says so and gives the amounts.`,
      '**City school departments.** Cities such as Manchester, Nashua, Dover, Rochester and Somersworth run their own schools, so school spending is part of their reports; school spending is left out of the services and overhead shares, as in Connecticut and Massachusetts.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Town and city candidates file with their clerk, not the state. County candidates file with the Secretary of State, whose campaign finance system refused connections from the build environment.',
      '**Not in the Census files:** unincorporated places (locations, grants and purchases, mostly in Coos County) have no government of their own.',
    ],
    imputedNote: 'This includes Concord, Portsmouth and Rockingham County.',
  }),
});
