# New Jersey real data — status

_Last updated: 2026-10-01_

## Summary

**Not started.** This session's environment can't reach any of the source hosts. No New Jersey data was downloaded or imported, and nothing was estimated or made up. `data/real/index.json` still has an empty `files` list, and there are no `data/real/nj-*.json` files yet.

## Network check (Step 0), 2026-10-01

Every request failed at the egress proxy before it reached the server. curl reported `CONNECT tunnel failed, response 403`, and the proxy logged each one as `connect_rejected` ("gateway answered 403 to CONNECT (policy denial or upstream failure)"). curl shows HTTP code `000` because no response came back from the server.

| Source | URL | Result |
|---|---|---|
| Holmdel Township site | https://holmdeltownship.com/ | blocked (proxy 403) |
| NJ DLGS (budgets, debt statements) | https://www.nj.gov/dca/divisions/dlgs/ | blocked (proxy 403) |
| Census API (population) | https://api.census.gov/data/2020/dec/pl | blocked (proxy 403) |
| Census Gazetteer (coordinates) | https://www2.census.gov/geo/docs/maps-data/data/gazetteer/ | blocked (proxy 403) |
| USAspending (federal grants) | https://api.usaspending.gov/api/v2/references/toptier_agencies/ | blocked (proxy 403) |
| NJ ELEC (political money) | https://www.elec.nj.gov/ | blocked (proxy 403) |

The previous session hit the same block.

## How to unblock

In the cloud environment's settings (environment menu → Edit → Network access), pick a broader access level or add these allowed domains:

- `www.nj.gov`, `nj.gov` (DLGS budget, financial statement and debt statement files)
- `api.census.gov`, `www2.census.gov` (municipal list, population, coordinates)
- `api.usaspending.gov` (federal grants)
- `www.elec.nj.gov`, `elec.nj.gov` (campaign contributions, pay-to-play filings)
- municipal websites such as `holmdeltownship.com` (only needed as a fallback for per-town budget PDFs and for transparency checks)

See https://code.claude.com/docs/en/claude-code-on-the-web for the access levels. Then run the import again starting with Monmouth County.

## Per-county status

| County | Towns loaded | Budget | Debt | Grants | Political | Transparency | Data year | Notes |
|---|---|---|---|---|---|---|---|---|
| Monmouth (incl. Holmdel Twp) | 0 | — | — | — | — | — | — | sources unreachable |
| Atlantic | 0 | — | — | — | — | — | — | sources unreachable |
| Bergen | 0 | — | — | — | — | — | — | sources unreachable |
| Burlington | 0 | — | — | — | — | — | — | sources unreachable |
| Camden | 0 | — | — | — | — | — | — | sources unreachable |
| Cape May | 0 | — | — | — | — | — | — | sources unreachable |
| Cumberland | 0 | — | — | — | — | — | — | sources unreachable |
| Essex | 0 | — | — | — | — | — | — | sources unreachable |
| Gloucester | 0 | — | — | — | — | — | — | sources unreachable |
| Hudson | 0 | — | — | — | — | — | — | sources unreachable |
| Hunterdon | 0 | — | — | — | — | — | — | sources unreachable |
| Mercer | 0 | — | — | — | — | — | — | sources unreachable |
| Middlesex | 0 | — | — | — | — | — | — | sources unreachable |
| Morris | 0 | — | — | — | — | — | — | sources unreachable |
| Ocean | 0 | — | — | — | — | — | — | sources unreachable |
| Passaic | 0 | — | — | — | — | — | — | sources unreachable |
| Salem | 0 | — | — | — | — | — | — | sources unreachable |
| Somerset | 0 | — | — | — | — | — | — | sources unreachable |
| Sussex | 0 | — | — | — | — | — | — | sources unreachable |
| Union | 0 | — | — | — | — | — | — | sources unreachable |
| Warren | 0 | — | — | — | — | — | — | sources unreachable |

Total: 0 of 564 municipalities.
