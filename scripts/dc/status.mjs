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
      '**Political money is not scored.** Contributions to District of Columbia District candidates were not loaded.',
    ],
  }),
});
