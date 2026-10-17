#!/usr/bin/env node
// Writes docs/IN_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'IN',
  name: 'Indiana',
  townWord: 'townships',
  kinds: ['County', 'City', 'Town', 'Township'],
  text: () => ({
    intro: 'Indiana has 92 counties, about 120 cities, 450 towns and 1,008 townships. Townships cover the whole state, cities and towns included, so most residents pay a county, a township and, in a city or town, a municipality. Township trustees provide poor relief and, in many townships, fire protection. Public schools are run by separate school corporations. Each county\'s file holds the county and the governments whose people mostly live in it.',
    sources: ['Indiana\'s Gateway portal holds each government\'s annual financial report, but the Census files are used so Indiana is built the same way as its neighbors.'],
    differs: [
      '**Indianapolis is consolidated with Marion County** and reports as one city government, which serves the whole county except the excluded cities of Beech Grove, Lawrence, Southport and Speedway.',
      '**County hospitals are included.** Several counties own hospitals, which the Census counts as county spending (Hamilton County\'s is most of its budget).',
      '**County treasurers collect property tax** for every government, so city, town and township reports show only their own levy.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** County and local candidates file campaign finance reports with their county election board, not with the state.',
      '**Indianapolis is not listed:** the Census estimated most of its figures in every year.',
      '**Many township records are incomplete** in the Census files (no property tax, or no operating spending), so about 250 townships are left out.',
    ],
    skippedNote: 'not in the Census 2025 population estimates',
  }),
});
