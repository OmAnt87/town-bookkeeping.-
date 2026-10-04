#!/usr/bin/env python3
"""Extracts Maryland municipal finances from the Department of Legislative Services' annual
"Local Government Finances in Maryland" reports (data/raw/md/lgf-<year>.pdf) into
data/raw/md/lgf.json.

    pip install pdfplumber && python3 scripts/md/lgf-to-json.py

The reports print two governments per page in "Statements of Revenues and Expenditures"
(Table II): governmental operating, governmental capital, enterprise and total columns, by
source and by function. "Debt and Assessable Base Summaries" (Table I) prints up to ten
governments per page. Part 1 covers the counties and Baltimore City, Part 2 the municipalities
and State-created special districts. Cells are assigned to columns by their position, since
blank cells are not printed.

Output: { "<year>": { "<county>|<name>": { "county", "name", "part", "noData",
          "rows": { "<section>/<label>": [operating, capital, enterprise, total] },
          "debt": total public debt, "assessableBase": ... } } }
"""
import glob
import json
import os
import re

import pdfplumber

RAW = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'raw', 'md')
NUM = re.compile(r'^\(?-?[\d,]+\)?$')
PARENTS = {'Intergovernmental', 'Public Safety', 'Public Works', 'Debt Service'}
CHILDREN = {'Federal Grants': 'Intergovernmental', 'State Grants': 'Intergovernmental', 'County Grants': 'Intergovernmental', 'Other Grants': 'Intergovernmental',
            'Police': 'Public Safety', 'Fire': 'Public Safety', 'Transportation': 'Public Works', 'Sewer/Solid Waste/Water': 'Public Works',
            'Principal': 'Debt Service', 'Interest': 'Debt Service'}
COUNTY = re.compile(r"^(.+? County|Baltimore City)$")


def num(s):
    neg = s.startswith('(') or s.startswith('-')
    v = float(s.strip('()-').replace(',', '') or 0)
    return -v if neg else v


def lines(words, tol=2.5):
    """Groups words into lines by their top position."""
    out = []
    for w in sorted(words, key=lambda w: (round(w['top']), w['x0'])):
        if out and abs(out[-1][0]['top'] - w['top']) <= tol:
            out[-1].append(w)
        else:
            out.append([w])
    return [sorted(l, key=lambda w: w['x0']) for l in out]


def clean_name(s):
    """Footnote marks were already split off as superscripts (see words_with_marks); a
    trailing "^" flags one."""
    s = re.sub(r'\s+', ' ', s).strip()
    return (s[:-1].strip(), True) if s.endswith('^') else (s, False)


def words_with_marks(page):
    """Words, with superscript footnote digits (smaller type) replaced by "^"."""
    ws = page.extract_words(extra_attrs=['size'])
    sizes = sorted(w['size'] for w in ws)
    body = sizes[len(sizes) // 2]
    out = []
    for w in ws:
        chars = [c for c in page.chars if w['x0'] - 0.5 <= c['x0'] <= w['x1'] + 0.5 and abs(c['top'] - w['top']) < 6]
        small = ''.join(c['text'] for c in chars if c['size'] < body * 0.8 and c['text'].isdigit())
        if small and w['text'].endswith(small) and len(w['text']) > len(small):
            w = {**w, 'text': w['text'][:-len(small)] + '^'}
        elif small and w['text'] == small:
            w = {**w, 'text': '^'}
        out.append(w)
    return out


def statement_page(page, county, part, out, year):
    ws = words_with_marks(page)
    ls = lines(ws)
    # Column headers: the line with "Operating Capital Operations Total Total Capita" (x2).
    head = next((l for l in ls if [w['text'] for w in l].count('Capita') >= 1 and any(w['text'] == 'Operating' for w in l)), None)
    if not head:
        return county
    cols = [w for w in head if w['text'] in ('Operating', 'Capital', 'Operations', 'Total', 'Capita')]
    groups = [cols[i:i + 6] for i in range(0, len(cols), 6)]
    # Names sit above the "Governmental" header line; the county line is above that.
    gov_top = min(w['top'] for w in ws if w['text'] == 'Governmental')
    names = ['' for _ in groups]
    for l in ls:
        if l[0]['top'] >= gov_top:
            break
        text = ' '.join(w['text'] for w in l)
        if text.startswith('Year Ending'):
            continue
        if COUNTY.match(text) and l[0]['x0'] < groups[0][0]['x0']:
            county = text
            continue
        for w in l:
            cx = (w['x0'] + w['x1']) / 2
            g = min(range(len(groups)), key=lambda i: 0 if groups[i][0]['x0'] - 60 <= cx <= groups[i][-1]['x1'] + 10 else min(abs(cx - groups[i][0]['x0']), abs(cx - groups[i][-1]['x1'])))
            names[g] = (names[g] + ' ' + w['text']).strip()
    ents = []
    for g, n in zip(groups, names):
        if not n:
            ents.append(None)
            continue
        name, flagged = clean_name(n.lstrip('^ ').replace(' ^ ', ' ') if not n.endswith('^') else n.lstrip('^ '))
        part = 1 if county is None else 2
        e = out.setdefault(f'{county or name}|{name}', {'county': county or name, 'name': name, 'part': part, 'noData': False, 'rows': {}})
        e['noData'] = e['noData'] or flagged
        ents.append(e)
    section = parent = None
    first_col = groups[0][0]['x0']
    for l in ls:
        if l[0]['top'] <= head[0]['top'] + 2:
            continue
        label_words = [w for w in l if w['x1'] < first_col - 5 and not NUM.match(w['text'])]
        label = ' '.join(w['text'] for w in label_words).strip()
        nums = [w for w in l if NUM.match(w['text']) and w['x0'] >= first_col - 40]
        if label in ('Revenues by Source', 'Expenditures by Function'):
            section, parent = label.split()[0].lower(), None
            continue
        if not label or not section:
            continue
        if label.startswith('Excess of Revenues'):
            break
        # The row layout is fixed, so sub-rows are keyed by their known parent.
        if label in PARENTS:
            parent = label
            if not nums:
                continue
        elif label in CHILDREN:
            parent = CHILDREN[label]
        elif label != 'Other':
            parent = None
        if not nums:
            continue
        if label.startswith('Total '):
            key = f'{section}/Total'
        elif label == 'Other':
            key = f'{section}/{parent or "Other"}/Other'
        else:
            key = f'{section}/{label}'
        for gi, g in enumerate(groups):
            e = ents[gi]
            if not e:
                continue
            vals = [0.0, 0.0, 0.0, 0.0]
            for w in nums:
                # Right-aligned under a header: nearest header right edge.
                h = min(range(6), key=lambda i: abs(g[i]['x1'] - w['x1']))
                if abs(g[h]['x1'] - w['x1']) > 25 or h > 3:
                    continue
                vals[h] = num(w['text'])
            if any(vals) or key.endswith('/Total'):
                e['rows'][key] = vals
    return county


def debt_page(page, out_debt):
    ws = words_with_marks(page)
    ls = lines(ws)
    base = next((l for l in ls if ' '.join(w['text'] for w in l).startswith('Assessable Base - Current Year')), None)
    total = next((l for l in ls if ' '.join(w['text'] for w in l).startswith('Total Public Debt')), None)
    if not base:
        return
    # Columns: cluster the right edges of every number below the header (some rows print
    # only the columns that have values).
    xs = sorted(w['x1'] for w in ws if w['top'] >= base[0]['top'] - 1 and (NUM.match(w['text']) or w['text'].endswith('%')))
    edges = []
    for x in xs:
        if edges and x - edges[-1][-1] <= 6:
            edges[-1].append(x)
        else:
            edges.append([x])
    edges = [max(e) for e in edges if len(e) >= 3]
    base_vals = {min(range(len(edges)), key=lambda i: abs(edges[i] - w['x1'])): num(w['text']) for w in base if NUM.match(w['text'])}
    cols = [{'x1': e, 'text': str(base_vals.get(i, 0))} for i, e in enumerate(edges)]
    county = None
    header = []
    for l in ls:
        if l[0]['top'] >= base[0]['top'] - 12:
            break
        text = ' '.join(w['text'] for w in l)
        if text.startswith('Year Ending') or text == 'Property Valuation':
            continue
        if COUNTY.match(text):
            county = text
            continue
        header.append(l)
    # Names are centred over their columns: group each header line into phrases by spacing and
    # give each phrase to the column whose numbers are centred nearest to it.
    centers = []
    for e in edges:
        cs = [(w['x0'] + w['x1']) / 2 for w in ws if w['top'] >= base[0]['top'] - 1 and NUM.match(w['text']) and abs(w['x1'] - e) <= 6]
        centers.append(sum(cs) / len(cs) if cs else e - 30)
    names = ['' for _ in cols]
    for l in header:
        phrases = []
        for w in l:
            if w['text'] in ('Property', 'Valuation'):
                continue
            if phrases and w['x0'] - phrases[-1][-1]['x1'] < 6:
                phrases[-1].append(w)
            else:
                phrases.append([w])
        for ph in phrases:
            cx = (ph[0]['x0'] + ph[-1]['x1']) / 2
            i = min(range(len(cols)), key=lambda i: abs(centers[i] - cx))
            names[i] = (names[i] + ' ' + ' '.join(w['text'] for w in ph)).strip()
    tvals = {}
    if total:
        for w in total:
            if NUM.match(w['text']):
                i = min(range(len(cols)), key=lambda i: abs(cols[i]['x1'] - w['x1']))
                tvals[i] = num(w['text'])
    for i, c in enumerate(cols):
        name, _ = clean_name(names[i].replace(' ^', '').replace('^ ', '').lstrip('^'))
        if not name or name == 'Total':
            continue
        if county == 'Baltimore City' and name.startswith('City'):
            name = 'Baltimore City'  # the city's own government, not its boards
        out_debt[f'{county or name}|{name}'] = {'debt': tvals.get(i, 0.0), 'assessableBase': num(c['text'])}


def parse(path):
    pdf = pdfplumber.open(path)
    out, debt = {}, {}
    part = 1
    county = None
    for page in pdf.pages:
        t = page.extract_text() or ''
        if 'Part II' in t and 'Municipalit' in t and 'Table of Contents' not in t:
            part = 2
        if 'Revenues by Source' in t and 'Governmental' in t and 'Five-year' not in t and 'by County' not in t:
            county = statement_page(page, county, part, out, path)
        elif 'Assessable Base - Current Year' in t and 'Public Debt' in t:
            debt_page(page, debt)
    for k, v in debt.items():
        if k in out:
            out[k].update(v)
    return out


result = {}
for path in sorted(glob.glob(os.path.join(RAW, 'lgf-*.pdf'))):
    year = re.search(r'(\d{4})', os.path.basename(path)).group(1)
    result[year] = parse(path)
    ents = result[year]
    print(f'FY {year}: {len(ents)} governments, {sum(1 for e in ents.values() if "debt" in e)} with debt')
with open(os.path.join(RAW, 'lgf.json'), 'w') as f:
    json.dump(result, f)
