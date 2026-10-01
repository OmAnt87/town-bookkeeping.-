#!/usr/bin/env python3
"""Convert Pennsylvania DCED "Statewide Municipal Annual Financial Reports" spreadsheets
(one per year, data/raw/pa/afr_<year>.xls) into data/raw/pa/afr.json:
  { "<municipality id>": { "name", "type", "county",
      "years": { "<year>": { "status": "A"|"P"|"", "<column header>": value, ... } } } }

Usage: pip install xlrd && python3 scripts/pa/afr-to-json.py
"""
import glob
import json
import os
import re

import xlrd

RAW = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'raw', 'pa')
out = {}
for path in sorted(glob.glob(os.path.join(RAW, 'afr_*.xls'))):
    year = re.search(r'afr_(\d{4})', path).group(1)
    sh = xlrd.open_workbook(path, logfile=open(os.devnull, 'w')).sheet_by_index(0)
    head = [re.sub(r'\s+', ' ', str(c.value)).strip() for c in sh.row(0)]
    for i in range(1, sh.nrows):
        row = dict(zip(head, [c.value for c in sh.row(i)]))
        mid = str(row['Municipality ID']).strip()
        ent = out.setdefault(mid, {'name': row['Municipality Name'], 'type': row['Municipality Type'], 'county': row['County Name'], 'years': {}})
        rec = {'status': row.get('Pending/ Approved', '')}
        for k, v in row.items():
            if k in ('Municipality Name', 'Municipality Type', 'Municipality ID', 'County Name', 'Reporting Year', 'Pending/ Approved', 'Revenues', 'Expenditures'):
                continue
            rec[k] = v if v != '' else None
        ent['years'][year] = rec
    print(year, sh.nrows - 1)
with open(os.path.join(RAW, 'afr.json'), 'w') as f:
    json.dump(out, f)
print('municipalities', len(out))
