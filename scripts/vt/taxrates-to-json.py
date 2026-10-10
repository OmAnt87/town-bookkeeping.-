#!/usr/bin/env python3
# Converts the Vermont Department of Taxes "Taxes and Tax Rates by County" workbooks (PVR annual
# report data, one per tax year) into JSON: { name: { taxYear: { edu, muni } } }, where edu is the
# education property tax (homestead plus nonhomestead) billed in the town and muni the town's
# own municipal property tax. Only whole-town rows (district 0) are kept; fire, police and
# village districts are separate rows.
#
#   python3 -I scripts/vt/taxrates-to-json.py <dir with <year>.xlsx> <out.json>
#
# Names are lowercased letters only, with "Jct." spelled out ("essexjunction"); towns that share
# a name with a city keep their suffix ("barrecity", "barretown").
import json
import os
import re
import sys

import openpyxl

# Column names changed in 2023.
ALIASES = {
    'name': ('Town Name', 'TNAME'),
    'district': ('District ID', 'District'),
    'eduHomestead': ('Education Homestead Taxes', 'EdHSTaxes'),
    'eduNonhomestead': ('Education Nonhomestead Taxes', 'EdNRTaxes'),
    'muni': ('Municipal Taxes', 'MuniTaxes'),
}


def norm(name):
    s = str(name).lower().replace('jct.', 'junction')
    return re.sub(r'[^a-z]', '', s)


def read_year(path):
    ws = openpyxl.load_workbook(path, read_only=True, data_only=True).worksheets[0]
    rows = ws.iter_rows(values_only=True)
    header = [str(c).strip() if c is not None else '' for c in next(rows)]
    col = {}
    for key, names in ALIASES.items():
        found = [header.index(n) for n in names if n in header]
        if not found:
            raise SystemExit(f'{path}: no column for {key} in {header}')
        col[key] = found[0]
    out = {}
    for r in rows:
        name = r[col['name']]
        if not name or str(r[col['district']]).strip() not in ('0', '0.0'):
            continue
        num = lambda k: float(r[col[k]] or 0)
        out[norm(name)] = {'edu': round(num('eduHomestead') + num('eduNonhomestead')), 'muni': round(num('muni'))}
    return out


def main(src, dest):
    result = {}
    for f in sorted(os.listdir(src)):
        m = re.fullmatch(r'(\d{4})\.xlsx', f)
        if not m:
            continue
        for name, v in read_year(os.path.join(src, f)).items():
            result.setdefault(name, {})[m.group(1)] = v
    with open(dest, 'w') as fh:
        json.dump(result, fh, indent=1, sort_keys=True)
    print(f'{dest}: {len(result)} towns')


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2])
