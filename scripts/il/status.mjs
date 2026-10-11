#!/usr/bin/env node
// Writes docs/IL_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'IL',
  name: 'Illinois',
  townWord: 'townships',
  kinds: ['County', 'City', 'Village', 'Town', 'Township'],
  text: () => ({
    intro: 'Illinois has more local governments than any other state: 102 counties, about 1,300 cities, villages and towns, and 1,426 townships in the 85 counties that have them, plus school, park, library, fire and other special districts. Townships maintain township roads, assess property and provide general assistance, and most also cover the cities and villages inside them. Each county\'s file holds the county and the governments whose people mostly live in it.',
    sources: [],
    differs: [
      '**Special districts are separate.** Park districts, library districts, fire protection districts, sanitary districts and the Metropolitan Water Reclamation District are their own governments with their own taxes, so city and village reports often leave out services those districts provide.',
      '**County collectors gather property tax** for every government, so city, village and township reports show only their own levy.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Chicago scores very low.** Its Census report puts $4.5 billion under financial administration, far more than any other city, and that counts as overhead. Pension contributions filed under administration may explain part of it, but the Census files do not say, so the figure is shown as reported.',
      '**Political money is not scored yet.** Illinois local candidates file with the State Board of Elections, so it can be added.',
    ],
  }),
});
