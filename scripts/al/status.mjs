#!/usr/bin/env node
// Writes docs/AL_DATA_STATUS.md from the county files in data/real/ and the last
// `build-county.mjs --all` report.
import { writeStatus } from '../common/town-census-status.mjs';

writeStatus({
  code: 'AL',
  name: 'Alabama',
  townWord: null,
  kinds: ['County', 'City', 'Town'],
  text: () => ({
    intro: 'Alabama has 67 counties and about 460 cities and towns, and no townships. Each county\'s file holds the county and the cities and towns whose people mostly live in it.',
    sources: [],
    differs: [
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Political money** comes from the Secretary of State\'s Fair Campaign Practices Act site (`node scripts/al/fetch-fcpa.mjs`): its yearly bulk contribution files, joined by committee ID to its list of candidate committees. County offices (commission, sheriff, revenue commissioner, tax assessor and collector, license commissioner, treasurer, coroner, constable) are placed by the county the committee lists; mayor and city council candidates are listed with no municipality, so they are placed by the city of their mailing address, which can be wrong for candidates with a mailing address in a neighboring town. Only itemized cash contributions are counted.',
    ],
  }),
});
