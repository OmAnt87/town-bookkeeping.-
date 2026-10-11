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
    sources: ['**Political money:** Illinois State Board of Elections [campaign disclosure data](https://www.elections.il.gov/campaigndisclosure/downloadcddatafiles.aspx): contributions to county, municipal and township candidates\' committees, placed by the office each candidate filed for, and classified by schedule, contributor name and the committee registry.'],
    differs: [
      '**Special districts are separate.** Park districts, library districts, fire protection districts, sanitary districts and the Metropolitan Water Reclamation District are their own governments with their own taxes, so city and village reports often leave out services those districts provide.',
      '**Business money is allowed.** Illinois lets businesses give to candidates; contributions from organizations without a first name count as business money unless the name or the committee registry says PAC or union, and transfers from political action committees count as PAC money. Party committees, legislative caucus funds and other candidates\' committees are not counted.',
      '**County collectors gather property tax** for every government, so city, village and township reports show only their own levy.',
      '**Payments to other governments are left out**, as in the Carolinas and Delaware.',
    ],
    gaps: [
      '**Chicago scores very low.** Its Census report puts $4.5 billion under financial administration, far more than any other city, and that counts as overhead. Pension contributions filed under administration may explain part of it, but the Census files do not say, so the figure is shown as reported.',
      '**Political money covers committees, not every candidate.** Candidates who raise and spend $5,000 or less need not form a committee, so most small villages and townships have no reported contributions and political money is not scored for them. A candidate whose district name matches more than one government (same-named townships) without a residence county is not placed.',
    ],
  }),
});
