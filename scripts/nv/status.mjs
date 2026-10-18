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
      '**Political money** comes from the Secretary of State\'s C&E / FD Report Search (`node scripts/nv/fetch-sos.mjs`, which drives a browser with Playwright because the site turns away scripts): each county\'s and city\'s candidates by election year, with the office from each candidate\'s page, and the contribution search\'s CSV export month by month. The export names the recipient but not the office, so contributions are joined to candidates by name, and a name filed in more than one place is skipped. It has no contributor type either, so businesses, unions and PACs are recognized by name and some are missed.',
    ],
  }),
});
