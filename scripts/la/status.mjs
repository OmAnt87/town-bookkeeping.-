#!/usr/bin/env node
// Writes docs/LA_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'LA',
  name: 'Louisiana',
  townWord: null,
  kinds: ['County', 'City', 'Town', 'Village'],
  text: () => ({
    intro: 'Louisiana has 64 parishes (listed as counties) and about 300 cities, towns and villages. Each parish\'s file holds the parish and the municipalities whose people mostly live in it.',
    sources: [],
    differs: [
      '**Parishes are listed as counties.** Sheriffs, assessors and clerks of court are separate offices with their own budgets and are not in parish reports.',
      '**Consolidated city-parish governments** (such as New Orleans and Baton Rouge) are listed the way the Census files them.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money** comes from the Board of Ethics (`node scripts/la/fetch-ethics.mjs`): its bulk file of e-filed contributions, joined by filer name to its e-filer search, which lists the office each candidate typed when filing. Offices are placed by title (parish: president, council or police jury, sheriff, assessor, coroner, constable, justice of the peace; municipal: mayor, council or aldermen, chief of police) and by the parish or municipality named. Reports filed on paper are not included, and offices typed without a recognizable place are skipped, so coverage is partial.',
    ],
  }),
});
