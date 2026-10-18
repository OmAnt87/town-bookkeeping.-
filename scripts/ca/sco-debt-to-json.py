#!/usr/bin/env python3
"""Condenses the State Controller's raw-data workbooks (cities and counties) into
data/raw/ca/sco/debt.json: for each entity and fiscal year, principal outstanding at year end
(bonds and certificates, other long-term debt, construction financing and leases) and debt
payments made from enterprise funds (principal and interest).

    pip install openpyxl && python3 scripts/ca/sco-debt-to-json.py
"""
import json
import os
import openpyxl

RAW = os.path.join(os.path.dirname(__file__), '..', '..', 'data', 'raw', 'ca', 'sco')


def num(v):
    return v if isinstance(v, (int, float)) else 0


def sheet(wb, suffix):
    for ws in wb.worksheets:
        if ws.title.split(' ', 1)[-1].strip() == suffix or ws.title.endswith(suffix):
            rows = ws.iter_rows(values_only=True)
            head = [str(h).strip() if h is not None else '' for h in next(rows)]
            for r in rows:
                yield dict(zip(head, r))
            return


# Principal outstanding at year end, by sheet.
OUTSTANDING = {
    'CIX_LT_DEBT': 'Principal Payable, End of Fiscal Year',
    'CIX_OTHER_LT_DEBT': 'Principal Outstanding, End of Fiscal Year',
    'CIX_CONST_FIN': 'Principal Outstanding, End of Fiscal Year',
    'CIX_LEASE_OBLIG': 'Ending Balances of Current Fiscal Year_Principal',
}

out = {}
for kind, file in (('city', 'cities-raw.xlsx'), ('county', 'counties-raw.xlsx')):
    wb = openpyxl.load_workbook(os.path.join(RAW, file), read_only=True)
    for name, col in OUTSTANDING.items():
        for r in sheet(wb, name):
            if not r.get('Entity Name'):
                continue
            key = f"{kind}|{str(r['Entity Name']).strip()}"
            y = out.setdefault(key, {}).setdefault(str(r['Fiscal Year']), {'debt': 0, 'enterpriseDebtPayments': 0})
            y['debt'] += num(r.get(col))
    for r in sheet(wb, 'CIX_DEBT_SERV_RECON'):
        if not r.get('Entity Name'):
            continue
        key = f"{kind}|{str(r['Entity Name']).strip()}"
        y = out.setdefault(key, {}).setdefault(str(r['Fiscal Year']), {'debt': 0, 'enterpriseDebtPayments': 0})
        col = next((c for c in r if c.startswith('Total Debt Payments from Debt Forms_Enterprise Funds')), None)
        y['enterpriseDebtPayments'] += num(r.get(col)) if col else 0

for years in out.values():
    for y in years.values():
        y['debt'] = round(y['debt'])
        y['enterpriseDebtPayments'] = round(y['enterpriseDebtPayments'])
with open(os.path.join(RAW, 'debt.json'), 'w') as f:
    json.dump(out, f)
print(f'{len(out)} entities -> data/raw/ca/sco/debt.json')
