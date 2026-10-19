#!/usr/bin/env python3
# Converts the Wisconsin Department of Revenue "County and Municipal Revenues and Expenditures"
# workbooks (one per calendar year, sheets Cities, Villages, Towns and Counties) into JSON:
# { year: [ { column: value, ... }, ... ] }, one object per government with the workbook's own
# column names.
#
#   python3 -I scripts/wi/cmre-to-json.py <dir with <year>.xlsx> <out.json>
import json
import os
import re
import sys

import openpyxl


def read_year(path):
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    out = []
    for ws in wb.worksheets:
        rows = ws.iter_rows(values_only=True)
        head = [str(c).strip() if c is not None else '' for c in next(rows)]
        for r in rows:
            if not r or all(c is None for c in r):
                continue
            row = {h: (v.strip() if isinstance(v, str) else v) for h, v in zip(head, r) if h}
            if row.get('Municipality'):
                out.append(row)
    return out


def main(src, dest):
    result = {}
    for f in sorted(os.listdir(src)):
        m = re.fullmatch(r'(\d{4})\.xlsx', f)
        if m:
            result[m.group(1)] = read_year(os.path.join(src, f))
    with open(dest, 'w') as fh:
        json.dump(result, fh)
    print(f'{dest}: ' + ', '.join(f'{y}: {len(v)}' for y, v in result.items()))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
