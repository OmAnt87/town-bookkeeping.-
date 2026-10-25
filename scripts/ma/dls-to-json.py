#!/usr/bin/env python3
"""Condenses the Massachusetts DLS Excel exports in data/raw/ma/ into data/raw/ma/dls.json.

    pip install openpyxl && python3 scripts/ma/dls-to-json.py

Output: { "towns": { "<DOR code>": { "name": ..., "gf": { "<year>": { "revenue": {...}, "spending": {...} } },
          "receipts": { "<year>": { "<receipt type>": actual } }, "debt": { "<year>": outstanding } } } }
Years where a town reported nothing (all zero) are left out.
"""
import glob
import json
import os
import re

import openpyxl

RAW = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'raw', 'ma')


def rows(path):
    it = openpyxl.load_workbook(path, read_only=True).active.iter_rows(values_only=True)
    head = next(it)
    return [dict(zip(head, r)) for r in it if r and str(r[0]).isdigit()]


towns = {}


def town(r):
    return towns.setdefault(str(r['DOR Code']).zfill(3), {'name': r['Municipality'], 'gf': {}, 'receipts': {}, 'debt': {}})


for path in sorted(glob.glob(os.path.join(RAW, 'gf-*-*.xlsx'))):
    kind, year = re.search(r'gf-(revenues|expenditures)-(\d{4})', path).groups()
    for r in rows(path):
        vals = {k: v or 0 for k, v in r.items() if k not in ('DOR Code', 'Municipality', 'Fiscal Year')}
        if any(vals.values()):
            town(r)['gf'].setdefault(year, {})['revenue' if kind == 'revenues' else 'spending'] = vals

for path in sorted(glob.glob(os.path.join(RAW, 'local-receipts-*.xlsx'))):
    year = re.search(r'(\d{4})', os.path.basename(path)).group(1)
    for r in rows(path):
        if r['Actual']:
            town(r)['receipts'].setdefault(year, {})[r['Receipt Description']] = r['Actual']

for r in rows(os.path.join(RAW, 'long-term-debt.xlsx')):
    v = r['Total Outstanding Debt (Schedule A Part 10)']
    if v is not None:
        town(r)['debt'][str(r['Fiscal Year'])] = v

with open(os.path.join(RAW, 'dls.json'), 'w') as f:
    json.dump({'towns': towns}, f)
years = sorted({y for t in towns.values() for y in t['gf']})
print(f'{len(towns)} municipalities, Schedule A years {years[0]}-{years[-1]} -> data/raw/ma/dls.json')
