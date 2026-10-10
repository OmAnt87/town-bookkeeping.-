// Builds real Town Ledger records for a northern New England state (New Hampshire, Vermont,
// Maine) from the Census individual unit files: its counties, cities and towns (Census township
// governments), plus villages or plantations where the state has them. Each county's file holds
// the county and the governments in it.
//
// Figures are what each government reported to the Census Bureau's Annual Survey of State and
// Local Government Finances (every government in the 2022 Census of Governments, a sample in
// other years). Units whose figures the Census mostly estimated (imputed), or that carry only a
// few lines, are left out. Property tax a town collects for its school district, the county or
// the state is taken out where the town reported it as its own (see levy.mjs).
//
// The state script passes a config:
//   code, name, fips              'NH', 'New Hampshire', '33'
//   cousubKinds                   { city: 'City', town: 'Town' }: Census county subdivisions by
//                                 the last word of their name (cities and towns are county
//                                 subdivisions, so a unit's place code is its subdivision code)
//   placeKinds                    { village: 'Village' }: governments that are places inside a town
//   countyScope, countyNote       text for county records
//   sharesText                    whose shares a town's tax bill collects
//   politicalNote(isCounty)       why political money is or is not scored
//   memberNote(g)                 optional extra note for a city, town or village
//   ownLevyKinds                  kinds whose tax bill carries only their own levy (['Village'])

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, parseCSV, slugify } from '../lib.mjs';
import { CENSUS_PAGE, YEARS, readUnits, aggregateUnit } from './census-units.mjs';
import { aggregateLevy, ASSESSMENT_SHARE } from './levy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT = join(ROOT, 'data', 'real');
const POP_PAGE = 'https://www.census.gov/data/tables/time-series/demo/popest/2020s-total-cities-and-towns.html';
const GAZ_PAGE = 'https://www.census.gov/geographies/reference-files/time-series/geo/gazetteer-files.html';

const money = (n) => `$${Math.round(n).toLocaleString('en-US')}`;
const sum = (o) => Object.values(o).reduce((s, v) => s + v, 0);

export function buildState(cfg) {
  const st = cfg.code.toLowerCase();
  const RAW = join(ROOT, 'data', 'raw', st);
  const args = parseArgs();
  const pop = parseCSV(readFileSync(join(RAW, 'popest.csv'), 'latin1'));
  const POP_YEAR = Object.keys(pop[0]).filter((k) => k.startsWith('popestimate')).sort().at(-1);
  const gaz = (file, key, xcol) => new Map(readFileSync(join(RAW, file), 'utf8').split('\n').slice(1)
    .map((l) => l.split('\t').map((c) => c.trim())).filter((c) => c[0] === cfg.code).map((c) => [key(c[1]), [Number(c[xcol]), Number(c[xcol + 1])]]));
  const countyXY = gaz('2024_Gaz_counties_national.txt', (id) => id, 8);
  const cousubXY = gaz('2024_Gaz_cousubs_national.txt', (id) => id.slice(5), 9);
  const placeXY = gaz('2024_Gaz_place_national.txt', (id) => id.slice(2), 10);

  const units = readUnits(RAW, cfg.fips, '123');

  // Census geography: counties by FIPS, cities and towns by county subdivision code, villages
  // and other governments inside a town by place code (in the county holding most of their people).
  const geo = new Map(); // key -> info; key 'County|33009', 'Cousub|40180' or 'Place|12345'
  const countyName = new Map();
  const fileOf = (county) => slugify(county.replace(/ County$/, ''));
  for (const r of pop.filter((p) => p.sumlev === '050')) {
    const geoid = `${cfg.fips}${r.county}`;
    countyName.set(geoid, r.name);
    geo.set(`County|${geoid}`, { key: `County|${geoid}`, kind: 'County', display: r.name, geoid, pop: Number(r[POP_YEAR]), xy: countyXY.get(geoid), county: r.name, file: fileOf(r.name) });
  }
  const kindRe = (kinds) => new RegExp(`^(.+) (${Object.keys(kinds).join('|')})$`);
  for (const r of pop.filter((p) => p.sumlev === '061')) {
    const m = r.name.match(kindRe(cfg.cousubKinds));
    if (!m) continue;
    const kind = cfg.cousubKinds[m[2]];
    const county = countyName.get(`${cfg.fips}${r.county}`);
    geo.set(`Cousub|${r.cousub}`, { key: `Cousub|${r.cousub}`, kind, display: `${kind} of ${m[1]}`, geoid: `${cfg.fips}${r.county}${r.cousub}`, pop: Number(r[POP_YEAR]), xy: cousubXY.get(r.cousub), county, file: fileOf(county) });
  }
  if (cfg.placeKinds) {
    const placeCounty = new Map();
    for (const r of pop.filter((p) => p.sumlev === '157')) {
      const cur = placeCounty.get(r.place);
      if (!cur || Number(r[POP_YEAR]) > cur.pop) placeCounty.set(r.place, { county: `${cfg.fips}${r.county}`, pop: Number(r[POP_YEAR]) });
    }
    for (const r of pop.filter((p) => p.sumlev === '162')) {
      const m = r.name.match(kindRe(cfg.placeKinds));
      if (!m) continue;
      const kind = cfg.placeKinds[m[2]];
      const county = countyName.get(placeCounty.get(r.place)?.county);
      geo.set(`Place|${r.place}`, { key: `Place|${r.place}`, kind, display: `${kind} of ${m[1]}`, geoid: `${cfg.fips}${r.place}`, pop: Number(r[POP_YEAR]), xy: placeXY.get(r.place), county, file: county && fileOf(county) });
    }
  }
  const geoKey = (u) => (u.kind === 'county' ? `County|${cfg.fips}${u.place.slice(2)}`
    : u.kind === 'muni' && !geo.has(`Cousub|${u.place}`) ? `Place|${u.place}` : `Cousub|${u.place}`);

  function buildUnit(key, byYear, report) {
    const g = geo.get(key);
    const any = Object.values(byYear)[0];
    const label = any.name;
    const isCounty = any.kind === 'county';
    const filed = (y) => { const x = aggregateUnit(byYear[y].items); return !x.imputed && !x.incomplete; };
    const reported = Object.keys(byYear).filter(filed).sort();
    const year = reported.at(-1);
    if (!year) {
      const latest = aggregateUnit(Object.entries(byYear).sort().at(-1)[1].items);
      report[latest.imputed ? 'imputed' : 'incomplete'].push(g?.display || label);
      return null;
    }
    if (!g || !g.xy || !g.file) { report.skipped.push(`${label}: no Census match`); return null; }
    const u = byYear[year];
    const ownLevyOnly = isCounty || (cfg.ownLevyKinds || []).includes(g.kind);
    const a = aggregateLevy(u.items, ownLevyOnly);
    if (a.unmapped.length) report.unmapped.push(`${g.display} ${year}: ${a.unmapped.join(' ')}`);
    if (Math.abs(sum(a.revenue) - a.lineTotals.revenue) > 2 || Math.abs(sum(a.spending) - a.lineTotals.spending) > 2) report.mismatch.push(`${g.display} ${year}`);
    if (a.passThrough) report.passThrough.push(`${g.display} (${money(a.passThrough)})`);
    if (a.assessments) report.assessments.push(`${g.display} (${money(a.assessments)})`);
    const lastYear = Object.keys(byYear).sort().at(-1);
    if (lastYear > year) report.older.push(`${g.display} (FY ${year}; FY ${lastYear} ${aggregateUnit(byYear[lastYear].items).imputed ? 'estimated' : 'incomplete'})`);

    const history = reported.map((y) => {
      const h = aggregateLevy(byYear[y].items, ownLevyOnly);
      return { year: Number(y), revenue: sum(h.revenue), spending: sum(h.spending), basis: 'actual' };
    });
    const src = CENSUS_PAGE(year);
    const ledger = a.lines.filter((l) => l.amount && l.group !== 'debt').map((l) => ({
      date: u.fyEnd, flow: l.group === 'revenue' ? 'in' : 'out', category: l.key, counterparty: 'Annual Survey of Local Government Finances',
      description: l.label, amount: l.amount, source: src,
    })).sort((x, y) => (x.flow === y.flow ? y.amount - x.amount : x.flow === 'in' ? -1 : 1));

    const schools = (a.spending.education || 0) > 0.1 * sum(a.spending);
    const asOf = new Date().toISOString().slice(0, 10);
    const fyEndText = new Date(`${u.fyEnd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
    const kindText = isCounty ? 'county' : g.kind.toLowerCase();
    const memberNote = !isCounty && cfg.memberNote ? cfg.memberNote(g) : null;
    return {
      file: g.file,
      town: {
        id: slugify(`${g.display} ${st}`),
        name: g.display,
        state: cfg.code,
        stateName: cfg.name,
        county: g.county,
        type: g.kind,
        lat: Math.round(g.xy[0] * 1e5) / 1e5,
        lng: Math.round(g.xy[1] * 1e5) / 1e5,
        population: g.pop || 1,
        fiscalYear: Number(year),
        asOf,
        censusGeoid: g.geoid,
        revenue: a.revenue,
        spending: a.spending,
        debt: a.debt,
        reporting: {
          basis: 'Actual results (as reported to the Census Bureau\'s Annual Survey of Local Government Finances)',
          scope: isCounty
            ? cfg.countyScope
            : `All ${kindText} funds, including utilities; ${schools ? `the ${kindText}'s school department is included` : 'schools are run by a separate school district'}`,
        },
        history,
        ledger,
        sources: [
          { label: `U.S. Census Bureau, ${year} Annual Survey of State and Local Government Finances, individual unit file`, url: src },
          { label: `U.S. Census Bureau ${POP_YEAR.slice(-4)} population estimates`, url: POP_PAGE },
          { label: 'U.S. Census Bureau 2024 Gazetteer (map location)', url: GAZ_PAGE },
        ],
        notes: [
          `Actual results for the fiscal year ended ${fyEndText}, as the ${kindText} reported them to the Census Bureau's Annual Survey of State and Local Government Finances. Not a budget.`,
          ...(Number(year) < YEARS.at(-1) ? [`The Census surveys every government only in Census of Governments years (2022) and a sample in other years, so FY ${year} is the latest available.`] : []),
          isCounty
            ? cfg.countyNote(g)
            : ownLevyOnly
              ? `Public schools are run by a separate school district. ${g.kind} residents pay the school and county taxes through the town.`
              : schools
              ? `The ${kindText} runs its own school department, so school spending is included. Residents also pay ${g.county} through the same tax bill.`
              : `Public schools are run by a separate school district. The ${kindText}'s tax bill also collects the taxes for ${cfg.sharesText}; residents pay all of them, but only the ${kindText}'s share is counted here.`,
          ...(memberNote ? [memberNote] : []),
          ...(a.assessments ? [`The ${kindText} reported ${money(a.assessments)} of "other general government" spending, more than ${Math.round(ASSESSMENT_SHARE * 100)}% of its budget. That is almost certainly its assessments for ${cfg.sharesText} filed as its own spending, so it is treated as a payment to other governments and left out.`] : []),
          ...(a.passThrough ? [`The ${kindText} reported ${money(a.passThrough + (a.revenue.propertyTax || 0))} of property tax, which includes the shares it collects for ${cfg.sharesText}. Only the ${kindText}'s own share, ${money(a.revenue.propertyTax || 0)} (what its spending needed beyond its other revenue, which is how the ${kindText} tax rate is set), is counted, so the ${kindText} shows no surplus or deficit for the year.`] : []),
          'Covers every fund, including water, sewer, electric and other utilities. Debt service counts interest and principal repaid; borrowing and transfers between funds are left out.',
          ...(a.intergovernmental ? [`Payments to other governments (${money(a.intergovernmental)}) are left out, because the government receiving them reports that spending.`] : []),
          'Courts, legal services, public buildings, housing and community development count as overhead.',
          'Debt is long-term debt outstanding plus short-term debt at year end.',
          cfg.politicalNote(isCounty),
          'Transparency practices have not been checked yet, so they are not scored.',
        ],
      },
    };
  }

  const keys = new Map();
  for (const y of YEARS) for (const u of units[y].values()) {
    const k = geoKey(u);
    (keys.get(k) || keys.set(k, {}).get(k))[y] = u;
  }
  const built = [];
  const report = { skipped: [], imputed: [], incomplete: [], mismatch: [], unmapped: [], older: [], passThrough: [], assessments: [] };
  for (const [k, byYear] of keys) {
    const b = buildUnit(k, byYear, report);
    if (b) built.push(b);
  }
  const files = [...new Set(built.map((b) => b.file))].sort();
  const pick = args.all ? files : files.filter((f) => f.startsWith(slugify(String(args.county || '-'))));
  if (!pick.length) { console.error(`Usage: node scripts/${st}/build-county.mjs --county <county> | --all\nFiles: ${files.join(', ')}`); process.exit(1); }
  const index = existsSync(join(OUT, 'index.json')) ? JSON.parse(readFileSync(join(OUT, 'index.json'), 'utf8')) : { files: [] };
  mkdirSync(OUT, { recursive: true });
  for (const f of pick) {
    const towns = built.filter((b) => b.file === f).map((b) => b.town).sort((x, y) => ((x.type === 'County') === (y.type === 'County') ? x.name.localeCompare(y.name) : x.type === 'County' ? -1 : 1));
    const file = `${st}-${f}.json`;
    writeFileSync(join(OUT, file), `${JSON.stringify({ towns }, null, 1)}\n`);
    if (!index.files.includes(file)) index.files.push(file);
  }
  index.files.sort();
  writeFileSync(join(OUT, 'index.json'), `${JSON.stringify(index, null, 2)}\n`);
  if (args.all) writeFileSync(join(RAW, 'build-report.json'), `${JSON.stringify(report, null, 1)}\n`);
  const types = built.reduce((m, b) => ({ ...m, [b.town.type]: (m[b.town.type] || 0) + 1 }), {});
  console.log(JSON.stringify({ files: pick.length, governments: built.length, types, ...report, imputed: report.imputed.length, incomplete: report.incomplete.length, older: report.older.length, passThrough: report.passThrough.length }, null, 1));
}
