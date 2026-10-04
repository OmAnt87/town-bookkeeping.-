#!/usr/bin/env python3
"""Condenses the Virginia Auditor of Public Accounts "Comparative Report of Local Government
Revenues and Expenditures" workbooks (data/raw/va/cr-<year>.xlsx) into data/raw/va/apa.json.

    pip install openpyxl && python3 scripts/va/apa-to-json.py

Each exhibit sheet lists the cities, then the counties, then the towns ("City of:",
"County of:", "Town of:"). Values are kept by their column label; per capita, percent and
population columns, and spreadsheet formulas (totals), are left out.

Output: { "<year>": { "<City|County|Town>|<name>": { "<exhibit>": { "<column label>": value } } } }
"""
import glob
import json
import os
import re

import openpyxl

RAW = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'raw', 'va')
EXHIBITS = ['Exhibit A', 'Exhibit B', 'Exhibit B1', 'Exhibit B2', 'Exhibit C', 'Exhibit C1', 'Exhibit C2', 'Exhibit C3', 'Exhibit C4',
            'Exhibit C5', 'Exhibit C6', 'Exhibit C7', 'Exhibit C8', 'Exhibit D', 'Exhibit E', 'Exhibit F', 'Exhibit G']
SKIP = re.compile(r'per capita|percent|population|average', re.I)
SECTION = re.compile(r'(City|County|Town) of', re.I)


def label(s):
    return re.sub(r'\s+', ' ', str(s)).strip()


def parse_sheet(ws):
    rows = list(ws.iter_rows(values_only=True))
    # Header: the row (near the top) with the most text cells.
    hi = max(range(min(10, len(rows))), key=lambda i: sum(1 for c in rows[i] if isinstance(c, str)))
    head = rows[hi]
    # Group headings one or two rows above ("Redemption of Debt", "Gross Debt") disambiguate repeats.
    cols = {}
    for i, c in enumerate(head):
        if isinstance(c, str) and not SKIP.search(c) and not SECTION.search(c) and label(c) not in ('No.',):
            name = label(c)
            if name in cols.values():
                name = f'{name} ({i})'
            cols[i] = name
    out = {}
    section = None
    for r in rows:
        text = ' '.join(str(c) for c in r[:4] if isinstance(c, str))
        m = SECTION.search(text)
        if m:
            section = m.group(1).title()
        if not isinstance(r[0], (int, float)) or r is head:
            continue
        name = next((label(c) for c in r[1:4] if isinstance(c, str) and label(c) and not SECTION.search(c)), None)
        if not name or name.startswith('#') or name.startswith('Total') or not section:
            continue
        vals = {}
        for i, col in cols.items():
            v = r[i] if i < len(r) else None
            if isinstance(v, (int, float)):
                vals[col] = v
        pop = next((c for i, c in enumerate(r) if isinstance(c, (int, float)) and i < len(head) and isinstance(head[i], str) and 'Population' in head[i]), None)
        if pop:
            vals['_population'] = pop
        out[f'{section}|{name}'] = vals
    return out


result = {}
for path in sorted(glob.glob(os.path.join(RAW, 'cr-*.xlsx'))):
    year = re.search(r'(\d{4})', os.path.basename(path)).group(1)
    wb = openpyxl.load_workbook(path, read_only=True)
    ents = {}
    for sh in EXHIBITS:
        if sh not in wb.sheetnames:
            continue
        for k, vals in parse_sheet(wb[sh]).items():
            ents.setdefault(k, {})[sh.replace('Exhibit ', '')] = vals
    result[year] = ents
    kinds = {}
    for k in ents:
        kinds[k.split('|')[0]] = kinds.get(k.split('|')[0], 0) + 1
    print(f'FY {year}: {len(ents)} localities {kinds}')
with open(os.path.join(RAW, 'apa.json'), 'w') as f:
    json.dump(result, f)
