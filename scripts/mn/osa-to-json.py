#!/usr/bin/env python3
# Converts the Minnesota Office of the State Auditor's financial data workbooks (one per kind of
# government and year: <kind>-<year>.xlsx, kind city, town or county) into JSON:
# { kind: { year: { sheet: [ { column: value, ... }, ... ] } } }, with the workbook's own sheet and
# column names.
#
#   python3 -I scripts/mn/osa-to-json.py <dir with <kind>-<year>.xlsx> <out.json>
import json
import os
import re
import sys

import openpyxl


def read_book(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    out = {}
    for ws in wb.worksheets:
        rows = ws.iter_rows(values_only=True)
        head = [str(c).strip() if c is not None else '' for c in next(rows)]
        recs = []
        for r in rows:
            if not r or all(c is None for c in r):
                continue
            recs.append({h: (v.strip() if isinstance(v, str) else v) for h, v in zip(head, r) if h})
        out[ws.title.strip()] = recs
    return out


def main(src, dest):
    result = {}
    for f in sorted(os.listdir(src)):
        m = re.fullmatch(r'(city|town|county)-(\d{4})\.xlsx', f)
        if m:
            result.setdefault(m.group(1), {})[m.group(2)] = read_book(os.path.join(src, f))
    with open(dest, 'w') as fh:
        json.dump(result, fh)
    print(f'{dest}: ' + ', '.join(f'{k} {y}: ' + '/'.join(str(len(s)) for s in v.values()) for k, ys in result.items() for y, v in ys.items()))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
