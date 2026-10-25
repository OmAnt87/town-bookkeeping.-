#!/usr/bin/env node
// Writes docs/OK_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'OK',
  name: 'Oklahoma',
  townWord: null,
  kinds: ['County', 'City', 'Town'],
  text: () => ({
    intro: 'Oklahoma has 77 counties and about 590 cities and towns, and no townships. Each county\'s file holds the county and the cities and towns whose people mostly live in it.',
    sources: [],
    differs: [
      '**Cities run on sales tax.** Oklahoma cities cannot levy a property tax for operations, so most of their revenue is sales tax.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money** comes from the Ethics Commission\'s bulk contribution files (run `node scripts/ok/fetch-guardian.mjs`): cash from PACs, unions and businesses to county and municipal candidates since three years ago. Each candidate committee is placed by the jurisdiction on its registration page. Few local candidates in Oklahoma raise money from organizations, so only the counties and cities where one did are scored; Oklahoma bans corporate contributions to candidates, and tribes, individuals and party committees are not counted.',
    ],
  }),
});
