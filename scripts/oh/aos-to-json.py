#!/usr/bin/env python3
# Converts the Ohio Auditor of State's Summarized Annual Financial Reports (one workbook per entity
# type, filing year and basis: <Type>_<Year>_<Basis>.xlsx) into JSON. For each workbook it keeps
# the governmental funds operating statement (total governmental funds), each enterprise fund
# operating statement and the long-term obligations, as ordered [header, value] pairs per entity,
# so the mapping can tell revenue columns from spending columns by position:
#   { "<Type>_<Year>_<Basis>": { "gov": { "<name>|<county>": [[h, v], ...] },
#                                "ent": { "<name>|<county>": [[[h, v], ...], ...] },
#                                "debt": { "<name>|<county>": [[h, v], ...] } } }
#
#   python3 -I scripts/oh/aos-to-json.py <dir with the workbooks> <out.json>
import json
import os
import re
import sys

import openpyxl


def kind_of(title):
    t = title.replace('_', '').upper()
    if title.startswith(('SONP', 'BS', 'SOA', 'OI', 'Info')):
        return None
    if title.startswith('LTOAYE'):
        return 'debt'
    if 'NP' in t and title.startswith(('SOREACINP', 'SORDACINP', 'SORDACIFBNP')):
        return 'ent'
    if title.startswith('CSOCRCDACIFCB') and 'ENTERPRISE' in t:
        return 'ent'
    if title.startswith(('SOREACIFB', 'SORDACIFB', 'CSOCRCDACIFCB')) and 'TOTAL' in t:
        return 'gov'
    return None


def read_book(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    out = {'gov': {}, 'ent': {}, 'debt': {}}
    for ws in wb.worksheets:
        kind = kind_of(ws.title.strip())
        if not kind:
            continue
        head = None
        for r in ws.iter_rows(values_only=True):
            if not r:
                continue
            first = r[0] if isinstance(r[0], str) else ''
            if head is None:
                if first.strip().endswith('Entity Name'):
                    head = [re.sub(r'\s+', ' ', str(h)).strip() if h not in (None, '') else '' for h in r]
                continue
            if not first.strip():
                continue
            # The county is the first non-empty cell after the name (some sheets leave a gap).
            county = next((str(c).strip() for c in r[1:3] if isinstance(c, str) and c.strip()), '')
            key = f'{first.strip()}|{county}'
            pairs = [[h, v] for h, v in zip(head[1:], r[1:]) if h and h != 'County' and isinstance(v, (int, float))]
            if kind == 'ent':
                out['ent'].setdefault(key, []).append(pairs)
            else:
                out[kind][key] = pairs
    return out


def main(src, dest):
    result = {}
    for f in sorted(os.listdir(src)):
        m = re.fullmatch(r'(Township|Village|City|County)_(\d{4})_(CASH|GAAP|MOD|REG)\.xlsx', f)
        if m:
            result[f[:-5]] = read_book(os.path.join(src, f))
            print(f'{f}: {len(result[f[:-5]]["gov"])} governmental, {len(result[f[:-5]]["ent"])} with enterprise funds', flush=True)
    with open(dest, 'w') as fh:
        json.dump(result, fh)


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
