// Looks up the education and municipal property tax the Vermont Department of Taxes lists for a
// town (taxrates.json, from taxrates-to-json.py), for the tax year that funds a fiscal year.

const norm = (s) => String(s).toLowerCase().replace(/jct\.?/g, 'junction').replace(/[^a-z]/g, '');

// Tax year that funds a fiscal year: towns on a July-June year bill the grand list of the April
// before; towns on a calendar year bill that year's.
export function taxYearFor(fyEnd) {
  const y = Number(fyEnd.slice(0, 4));
  return Number(fyEnd.slice(5, 7)) <= 6 ? y - 1 : y;
}

// taxes: { name: { year: { edu, muni } } }. Census name "BARRE CITY" or "BRISTOL TOWN"; towns
// that share a name with a city keep the suffix in the tax file. Returns { edu, muni, taxYear }
// or null.
export function taxesFor(taxes, censusName, fyEnd) {
  const t = taxes[norm(censusName)] || taxes[norm(censusName.replace(/ (TOWN|CITY)$/i, ''))];
  if (!t) return null;
  const y = taxYearFor(fyEnd);
  // Essex Junction became a city in July 2022, so its first tax year is a year later.
  const v = t[y] || t[y + 1];
  return v ? { ...v, taxYear: t[y] ? y : y + 1 } : null;
}
