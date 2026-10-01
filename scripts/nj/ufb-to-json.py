#!/usr/bin/env python3
"""Convert the NJ DLGS "User Friendly Budget Database" workbook to JSON.

Source: https://www.nj.gov/dca/dlgs/programs/mc_budget_docs/UFB Database - FINAL.xlsm
(linked from https://datahub.dca.nj.gov/datasets/user-friendly-budget-database)

Output: {"<year>": [{"<Group>|<Label>": value, ...}, ...]} for every "<year> Summary"
sheet. Column keys combine the sheet's group header row with its label row so the
importer can address fields by name instead of position.

Usage: pip install openpyxl && python3 scripts/nj/ufb-to-json.py data/raw/nj/ufb-database.xlsm data/raw/nj/ufb.json
"""
import json
import re
import sys

import openpyxl

src, out = sys.argv[1], sys.argv[2]
wb = openpyxl.load_workbook(src, read_only=True, data_only=True)
result = {}
for ws in wb.worksheets:
    m = re.match(r"(\d{4}) Summary", ws.title)
    if not m:
        continue
    rows = list(ws.iter_rows(values_only=True))
    groups, labels = rows[3], rows[4]
    keys, group = [], ""
    for g, l in zip(groups, labels):
        if g:
            group = str(g).strip()
        keys.append(f"{group}|{str(l).strip()}" if l else None)
    towns = []
    for r in rows[5:]:
        if not r or not r[2] or not r[3]:
            continue
        rec = {}
        for k, v in zip(keys, r):
            if k and k not in rec:
                rec[k] = v
        towns.append(rec)
    result[m.group(1)] = towns
    print(ws.title, len(towns))
with open(out, "w") as f:
    json.dump(result, f, default=str)
