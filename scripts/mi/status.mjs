#!/usr/bin/env node
// Writes docs/MI_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'MI',
  name: 'Michigan',
  townWord: 'townships',
  kinds: ['County', 'City', 'Village', 'Charter Township', 'Township'],
  text: () => ({
    intro: 'Michigan has 83 counties, about 280 cities, 250 villages and 1,240 townships, about 140 of them charter townships with more powers. Cities are independent of townships; villages stay part of their township, so village residents pay both. Public schools are run by separate school districts. Each county\'s file holds the county and the governments whose people mostly live in it.',
    sources: ['Almost every Michigan government reported to the Census in 2022, so coverage is close to complete.'],
    differs: [
      '**Charter townships** are listed separately from general law townships.',
      '**Small townships score low on overhead.** County road commissions maintain most township roads, and county sheriffs police most townships, so many small townships spend mainly on assessing, elections, tax collection and the township hall, which count as overhead.',
      '**Tax bills carry other levies.** Townships and cities collect school and county taxes on their summer and winter bills, but their Census figures show only their own levy (revenue is close to spending), so the property tax rules used for northern New England are not applied.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** County and local candidates file campaign finance reports with their county clerk, not with the state.',
    ],
  }),
});
