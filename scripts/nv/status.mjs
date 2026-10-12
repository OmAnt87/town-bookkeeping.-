#!/usr/bin/env node
// Writes docs/NV_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'NV',
  name: 'Nevada',
  townWord: null,
  kinds: ['County', 'City'],
  text: () => ({
    intro: 'Nevada has 16 counties, Carson City (a consolidated city and county) and 18 other cities. Counties provide most services in unincorporated areas, including the Las Vegas Strip. Each county\'s file holds the county and the cities whose people mostly live in it.',
    sources: [],
    differs: [
      '**Counties run large urban areas.** Clark County governs the Las Vegas Strip and much of the metro area outside the cities.',
      '**Carson City** is a consolidated city and county and is shown once.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money is not scored.** Contributions to Nevada local candidates were not loaded.',
    ],
  }),
});
