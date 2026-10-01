#!/usr/bin/env python3
"""Condense NY Office of the State Comptroller (OSC) local finance files into
per-government, per-year totals keyed by fund, section and OSC category.

Input:  data/raw/ny/{town,village,city}/<year>_<Class>.csv  (from the OSC bulk zips)
        data/raw/ny/debt_<year>.csv                           (OSC debt detail)
Output: data/raw/ny/osc.json
  { "<municipal code>": { "name", "class", "county",
      "years": { "<year>": { "periodEnd", "lines": { "<FUND>|<SECTION>|<L1>|<L2>|<FN>": amount } } },
      "debt": { "<year>": outstanding } } }

<FN> is the four-digit function or revenue code for General Government and
Proceeds of Debt lines (e.g. 1420 Law, 5792 Current Refunding Bonds), blank otherwise. Only REVENUE and EXPENDITURE rows are kept.

Usage: python3 scripts/ny/osc-to-json.py [first_year]   (default 2016)
"""
import csv
import glob
import json
import os
import re
import sys

RAW = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'raw', 'ny')
FIRST = int(sys.argv[1]) if len(sys.argv) > 1 else 2016
out = {}

for path in sorted(glob.glob(os.path.join(RAW, '*', '*_*.csv'))):
    m = re.match(r'(\d{4})_(Town|Village|City)\.csv$', os.path.basename(path))
    if not m or int(m.group(1)) < FIRST:
        continue
    with open(path, encoding='latin-1', newline='') as f:
        for r in csv.DictReader(f):
            section = r['ACCOUNT_CODE_SECTION']
            if section not in ('REVENUE', 'EXPENDITURE'):
                continue
            code = r['MUNICIPAL_CODE']
            ent = out.setdefault(code, {'name': r['ENTITY_NAME'], 'class': r['CLASS_DESCRIPTION'], 'county': r['COUNTY'], 'years': {}, 'debt': {}})
            year = ent['years'].setdefault(r['CALENDAR_YEAR'], {'periodEnd': r['PERIOD_END'], 'lines': {}})
            acct = r['ACCOUNT_CODE']
            fund = re.match(r'[A-Z]+', acct).group(0)
            fn = ''
            if r['LEVEL_1_CATEGORY'] in ('General Government', 'Proceeds of Debt'):
                digits = acct[len(fund):]
                fn = digits[:4]
            key = '|'.join([fund, section, r['LEVEL_1_CATEGORY'], r['LEVEL_2_CATEGORY'], fn])
            try:
                amt = float(r['AMOUNT'] or 0)
            except ValueError:
                continue
            year['lines'][key] = round(year['lines'].get(key, 0) + amt, 2)
    print(os.path.basename(path), len(out))

# Debt outstanding at year end. Revenue/tax anticipation notes are short-term
# cash-flow borrowing repaid within the year, so they are left out.
for path in sorted(glob.glob(os.path.join(RAW, 'debt_*.csv'))):
    with open(path, encoding='latin-1', newline='') as f:
        for r in csv.DictReader(f):
            if r['SUB_GOVT_TYPE'] not in ('Town', 'Village', 'City') or r['MUNICIPAL_CODE'] not in out:
                continue
            if re.search(r'(Revenue|Tax) Anticipation', r['DEBT_TYPE_DESC']):
                continue
            try:
                amt = float(r['ENDING_YEAR_BALANCE_SUM'] or 0)
            except ValueError:
                continue
            d = out[r['MUNICIPAL_CODE']]['debt']
            d[r['CALENDAR_YEAR']] = round(d.get(r['CALENDAR_YEAR'], 0) + amt, 2)

with open(os.path.join(RAW, 'osc.json'), 'w') as f:
    json.dump(out, f)
print('governments', len(out))
