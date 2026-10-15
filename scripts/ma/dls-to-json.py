#!/usr/bin/env python3
"""Convert the Massachusetts DLS Municipal Databank exports in data/raw/ma/ into
data/raw/ma/dls.json:
  { "<DOR code>": { "name",
      "revenues":     { "<fiscal year>": { "<column>": value, ... } },
      "expenditures": { "<fiscal year>": { ... } },
      "debt":         { "<fiscal year>": { ... } },
      "levies":       { "<fiscal year>": { ... } } } }

Usage: pip install openpyxl && python3 scripts/ma/dls-to-json.py
"""
import glob
import json
import os
import re

import openpyxl

RAW = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'raw', 'ma')
out = {}


def load(path, key):
    rows = list(openpyxl.load_workbook(path, read_only=True).active.iter_rows(values_only=True))
    head = [re.sub(r'\s+', ' ', str(h or '')).strip() for h in rows[0]]
    n = 0
    for r in rows[1:]:
        row = dict(zip(head, r))
        code = str(row.get('DOR Code') or '').strip()
        if not re.fullmatch(r'\d{3}', code):
            continue  # the totals row
        ent = out.setdefault(code, {'name': row['Municipality']})
        rec = {k: v for k, v in row.items() if k not in ('DOR Code', 'Municipality', 'Fiscal Year')}
        if all(v in (None, '', 0) for v in rec.values()):
            continue
        ent.setdefault(key, {})[str(row['Fiscal Year'])] = rec
        n += 1
    print(os.path.basename(path), n)


for kind in ('revenues', 'expenditures'):
    for path in sorted(glob.glob(os.path.join(RAW, f'schedA_{kind}_*.xlsx'))):
        load(path, kind)
load(os.path.join(RAW, 'debt.xlsx'), 'debt')
load(os.path.join(RAW, 'levies.xlsx'), 'levies')
with open(os.path.join(RAW, 'dls.json'), 'w') as f:
    json.dump(out, f)
print('municipalities', len(out))
