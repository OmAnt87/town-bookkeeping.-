#!/usr/bin/env node
// Downloads the raw Michigan inputs into data/raw/mi/ (gitignored):
//   - every county's, city's, village's and township's F-65 Annual Local Unit Fiscal Report, as
//     published by the Department of Treasury's MI Community Financial Dashboard (an ArcGIS
//     feature service: expenditure and revenue lines by fund, and per-unit metrics including
//     long-term debt), fiscal years 2023-2025, into f65/<layer>-<year>.json
//   - Census 2025 population estimates for MI and the 2024 gazetteers (counties, places and
//     county subdivisions)
//
//   node scripts/mi/f65-download.mjs      then: node scripts/mi/f65-build.mjs --all

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const RAW = join(HERE, '..', '..', 'data', 'raw', 'mi');
const DIR = join(RAW, 'f65');
export const F65_PAGE = 'https://micommunityfinancials.michigan.gov/';
export const F65_SERVICE = 'https://gisago-qa.mcgi.state.mi.us/arcgis/rest/services/CSS/TreasuryFinancialDashboard/FeatureServer';
export const F65_YEARS = [2023, 2024, 2025];
const LAYERS = {
  expenditure: { id: 0, year: 'FiscalYear', fields: 'LocalUnitID,Name,Type,CountyCd,FIPSCode,FiscalYear,YEMonth,Fund,Account,ExpenditureDescription,Amount' },
  revenue: { id: 2, year: 'FiscalYear', fields: 'LocalUnitID,Name,Type,CountyCd,FIPSCode,FiscalYear,YEMonth,Fund,Account,RevenueDescription,SubCategory,Amount' },
  metrics: { id: 1, year: 'FY', fields: 'LU_ID,LU_NAME,FY,FIELD_NAME,FIELD_VALUE', where: "FIELD_NAME IN ('Total Long Term Debt','Total General Fund Revenue','Total General Fund Expenditure')" },
};
const GAZ = 'https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer';
const POP = 'https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/cities/totals/sub-est2025_26.csv';
const curl = (...a) => execFileSync('curl', ['-sSfL', '--retry', '4', '--retry-all-errors', '-m', '900', '-A', 'Mozilla/5.0', ...a], { maxBuffer: 1 << 30 });

const query = (layer, params) => {
  const url = `${F65_SERVICE}/${layer.id}/query?${new URLSearchParams({ returnGeometry: 'false', f: 'json', ...params })}`;
  const page = JSON.parse(curl(url).toString());
  if (page.error) throw new Error(`${url}: ${JSON.stringify(page.error)}`);
  return page;
};

// The service's object id is the local unit, shared by all of a unit's rows, so offset paging is
// unreliable: list the year's units, then fetch them a few dozen at a time, splitting any batch
// that hits the 2,000-record limit.
function fetchLayer(layer, year) {
  const idField = layer.id === 1 ? 'LU_ID' : 'LocalUnitID';
  const base = `${layer.year}=${year}${layer.where ? ` AND ${layer.where}` : ''}`;
  const ids = query(layer, { where: base, groupByFieldsForStatistics: idField, outStatistics: JSON.stringify([{ statisticType: 'count', onStatisticField: idField, outStatisticFieldName: 'n' }]) })
    .features.map((f) => f.attributes[idField]).sort((a, b) => a - b);
  const rows = [];
  const fetchBatch = (batch) => {
    const page = query(layer, { where: `${base} AND ${idField} IN (${batch.join(',')})`, outFields: layer.fields, resultRecordCount: '2000' });
    if ((page.exceededTransferLimit || page.features.length >= 2000) && batch.length > 1) {
      fetchBatch(batch.slice(0, batch.length >> 1));
      fetchBatch(batch.slice(batch.length >> 1));
      return;
    }
    for (const f of page.features) {
      const a = f.attributes;
      if (a.Amount !== undefined && !Number(a.Amount)) continue;
      rows.push(a);
    }
  };
  const size = layer.id === 1 ? 300 : 40;
  for (let i = 0; i < ids.length; i += size) fetchBatch(ids.slice(i, i + size));
  return { units: ids.length, rows };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  mkdirSync(DIR, { recursive: true });
  for (const [name, layer] of Object.entries(LAYERS)) {
    for (const y of F65_YEARS) {
      const { units, rows } = fetchLayer(layer, y);
      writeFileSync(join(DIR, `${name}-${y}.json`), JSON.stringify(rows));
      console.log(`${name} ${y}: ${units} units, ${rows.length} rows`);
    }
  }
  execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '300', '-o', join(RAW, 'popest.csv'), POP], { stdio: 'inherit' });
  for (const g of ['counties', 'place', 'cousubs']) {
    execFileSync('curl', ['-sSfL', '--retry', '4', '-m', '300', '-o', join(RAW, `gaz-${g}.zip`), `${GAZ}/2024_Gaz_${g}_national.zip`], { stdio: 'inherit' });
    execFileSync('unzip', ['-o', '-q', join(RAW, `gaz-${g}.zip`), '-d', RAW], { stdio: 'inherit' });
  }
  console.log('Done. Next: node scripts/mi/f65-build.mjs --all');
}
