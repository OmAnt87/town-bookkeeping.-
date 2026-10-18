#!/usr/bin/env python3
# Converts the Iowa Department of Management's Annual Financial Report datasets (zipped CSV from
# data.iowa.gov: 923 city expenditures, 924 city revenues, 936 county revenues, 938 county
# expenditures) into compact JSON for the years asked for, keeping only non-zero amounts:
#   { city: { year: { city_id_code: { name, gnis, rev: [[type, item, fund, amount]],
#                                      exp: [[program, item, fund, amount]] } } },
#     county: { year: { fips: { rev: {column: value}, exp: {column: value} } } } }
#
#   python3 -I scripts/ia/afr-to-json.py <dir with 923.zip 924.zip 936.zip 938.zip> <out.json> 2023 2024 2025
import csv
import io
import json
import os
import sys
import zipfile


def rows(path):
    with zipfile.ZipFile(path) as z:
        for name in sorted(z.namelist()):
            with z.open(name) as f:
                yield from csv.DictReader(io.TextIOWrapper(f, encoding='utf-8', newline=''))


def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def main(src, dest, years):
    out = {'city': {y: {} for y in years}, 'county': {y: {} for y in years}}
    for ds, kind, amt, cols in (('924', 'rev', 'revenue_amount', ('revenue_type', 'revenue_line_item', 'fund')),
                                ('923', 'exp', 'expenditure_amount', ('expenditure_program', 'line_item', 'fund'))):
        for r in rows(os.path.join(src, f'{ds}.zip')):
            y = r['fiscal_year']
            a = num(r[amt])
            if y not in out['city'] or not a:
                continue
            c = out['city'][y].setdefault(r['city_id_code'], {'name': r['city_name'], 'gnis': r['gnis_feature_id'], 'rev': [], 'exp': []})
            c[kind].append([*(r[k].strip() for k in cols), a])
    for ds, kind in (('936', 'rev'), ('938', 'exp')):
        for r in rows(os.path.join(src, f'{ds}.zip')):
            y = r['fiscal_year']
            if y in out['county']:
                out['county'][y].setdefault(r['county_fips_code'], {})[kind] = r
    with open(dest, 'w') as fh:
        json.dump(out, fh)
    print(f'{dest}: ' + ', '.join(f'{k} {y}: {len(v)}' for k, ys in out.items() for y, v in ys.items()))


if __name__ == '__main__':
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
