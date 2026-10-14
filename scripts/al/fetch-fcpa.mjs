#!/usr/bin/env node
// Downloads Alabama Fair Campaign Practices Act (FCPA) data into data/raw/al/fcpa/ (gitignored),
// from the Secretary of State's public FCPA reporting site:
//   - <year>_CashContributionsExtract1.csv: every contribution filed each year since three years
//     ago (the site's "Data Download" files)
//   - committees.json: every principal campaign committee, with the candidate's office, county
//     jurisdiction and mailing city
//
//   node scripts/al/fetch-fcpa.mjs      then: node scripts/al/build-county.mjs --all
//
// The site turns away curl's own user agent, so requests carry a browser's.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FCPA_SITE } from './fcpa-map.mjs';

const RAW = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'raw', 'al', 'fcpa');
const JAR = join(RAW, 'cookies.txt');
const FIRST_YEAR = new Date().getFullYear() - 3;
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36';
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '900', '-A', UA, '-c', JAR, '-b', JAR, ...a], { maxBuffer: 1 << 28 }).toString('utf8');
const page = (name, params = {}) => `${FCPA_SITE}/page.request.do?${new URLSearchParams({ page: name, ...params })}`;

mkdirSync(RAW, { recursive: true });
curl('-o', '/dev/null', page('page.acfPublicPrincipalCampaignCommitteeSearch'));

const downloads = JSON.parse(curl(page('com.acf.common.page.transactiondatadownloadsresults', { pageSize: 100, pageNumber: 1, sortDirection: 'DESC', sortBy: 'year' }))).data.list;
for (const d of downloads.filter((x) => x.DATATYPE === 'Cash Contribution' && x.YEAR >= FIRST_YEAR)) {
  const zip = join(RAW, `${d.YEAR}.zip`);
  curl('-o', zip, page('getTransactionData', { id: d.DOWNLOAD }));
  execFileSync('unzip', ['-oq', zip, '-d', RAW]);
  rmSync(zip);
  console.log(`${d.YEAR} contributions (updated ${d.LASTUPDATED})`);
}

const committees = [];
const criteria = JSON.stringify([{ field_key: 'committeeType', comparison_type: 'equalTo', comparison_value_1: '1' }]);
for (let n = 1; ; n++) {
  const { data } = JSON.parse(curl(page('com.acf.common.page.committeesearchresults', { pageNumber: n, pageSize: 1000, sortDirection: 'ASC', sortBy: 'candidateLastName', criteria })));
  committees.push(...data.list);
  if (!data.list.length || committees.length >= data.totalRecords) break;
}
writeFileSync(join(RAW, 'committees.json'), `${JSON.stringify(committees)}\n`);
rmSync(JAR, { force: true });
console.log(`Done: ${committees.length} candidate committees. Next: node scripts/al/build-county.mjs --all`);
