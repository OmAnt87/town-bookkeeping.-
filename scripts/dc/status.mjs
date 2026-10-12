#!/usr/bin/env node
// Writes docs/DC_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'DC',
  name: 'District of Columbia',
  townWord: null,
  kinds: ['County', 'City'],
  text: () => ({
    intro: 'The District of Columbia is a single government that does the work of a state, a county and a city. Its file holds the District alone.',
    sources: [],
    differs: [
      '**One government does everything.** The District\'s figures include services that a state, a county and a school district provide elsewhere, so they are not directly comparable with a city\'s.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money** comes from the Office of Campaign Finance (principal campaign committees\' contributions, exported from its Download Data search; run `node scripts/dc/fetch-ocf.mjs`). Contributions from businesses, unions and PACs to candidates for mayor, council and attorney general since three years ago are counted. Committees for the shadow congressional seats and the State Board of Education are left out, as are candidates\' transfers between their own committees. Candidates in the Fair Elections program may not take business or PAC money, so totals are small.',
    ],
  }),
});
