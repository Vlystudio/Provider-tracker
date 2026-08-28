# Route security inventory

Inventory date: 2026-08-21. There are 23 page files and 36 API route files. Thirty-two API route files require an application session. The other four are the restricted authentication gateway, two minimal probes, and token-protected metrics.

All application mutations require the configured same origin before parsing the body. Better Auth applies its own trusted-origin checks inside the restricted authentication gateway. Schemas are strict: unknown fields fail instead of being copied to database writes.

## Pages

| Path | Access |
| --- | --- |
| `/sign-in` | Public; no operational data |
| `/maintenance` | Public operational notice; no dependency details |
| `/forbidden` | Signed-in response; no operational data |
| `/` | `app:access` |
| `/account` | `app:access`; own password and sessions only |
| `/facilities`, `/facilities/[id]`, `/provider-search` | `operations:read` |
| `/new-call`, `/call-log`, `/review-queue`, `/work` | `operations:write` or the page-specific operations permission |
| `/authorization-summary` | `operations:read` |
| `/notifications` | `notifications:read` |
| `/coverage` | `coverage:read` |
| `/reports` | `reports:read` |
| `/data-quality`, `/duplicates`, `/changes` | administrative data-review permissions |
| `/automation` | `automation:read` |
| `/migration` | `migration:read` |
| `/audit` | `audit:read` |
| `/admin` | `admin:read` |

The page shell is not an authorization control. Each page checks its permission on the server, and protected data services check again.

## Public and operational endpoints

| Route | Methods | Authentication | Notes |
| --- | --- | --- | --- |
| `/api/auth/[...all]` | GET, POST | Endpoint allowlist | Only session, email sign-in, and sign-out operations are exposed; registration and unused recovery/plugin paths return `404` |
| `/api/health` | GET | Network boundary | Returns only `{"status":"ok"}`; no dependency or release detail in the body |
| `/api/ready` | GET | Network boundary | Returns only ready/not-ready status; detailed failures go to redacted server logs |
| `/api/metrics` | GET | Separate bearer token | Disabled as `404` when token is absent or wrong; never available to an ordinary user session |

IT must keep all four behind the VPN/private ingress. A route being unauthenticated for a load-balancer probe does not make it public.

## Signed-in account and work routes

| Route | Methods | Required access | Object rule |
| --- | --- | --- | --- |
| `/api/session` | GET | Any active signed-in user | Current principal only |
| `/api/account/password` | POST | Any active signed-in user | Current password required; changes own account; revokes other sessions |
| `/api/account/sessions` | GET, DELETE | Any active signed-in user | Lists own sessions; DELETE removes only other own sessions and requires recent login |
| `/api/account/sessions/[sessionId]` | DELETE | Any active signed-in user | Session ID must belong to caller; current session is not a valid target; recent login required |
| `/api/authorizations/[id]` | GET, PATCH, DELETE | Authorization read/write | Normal users are filtered by owner ID; cross-owner lookup is hidden or denied |
| `/api/facilities/[id]` | GET, PATCH | Operations read/write | Facility ID validated; update uses expected version |
| `/api/facilities/[id]/verifications` | POST | Operations write | Facility ID, strict enum/date body, expected version |
| `/api/notification-preferences` | GET, PATCH | Notifications | Current user's preferences only |
| `/api/notifications` | GET, PATCH | Notifications | Current user's notification rows only |
| `/api/notifications/[id]` | PATCH | Notifications | Notification ID must belong to current user |
| `/api/work-items/[id]` | PATCH | Work access | Assignee or authorized administrator only |

## Administrative data and automation routes

| Route | Methods | Permission | Extra control |
| --- | --- | --- | --- |
| `/api/admin/automation/settings` | GET, PATCH | `automation:read` / `automation:manage` | PATCH same-origin; recent login |
| `/api/admin/automation/run` | POST | `automation:manage` | Allowlisted job, rate limit, recent login |
| `/api/admin/coverage-watches` | POST | `coverage:manage` | Strict schema |
| `/api/admin/coverage-watches/[id]` | PATCH | `coverage:manage` | Strict ID/body |
| `/api/admin/duplicates/refresh` | POST | `admin:manage-data` | Rate limited job trigger |
| `/api/admin/duplicates/[id]` | PATCH | `admin:manage-data` | Strict decision enum/body |
| `/api/admin/facilities/merge` | POST | `admin:manage-data` | Recent login; transaction preserves related history |
| `/api/admin/reverification/assign` | POST | `admin:manage-data` | Strict bulk request and server selection |

## Migration routes

| Route | Methods | Permission | Extra control |
| --- | --- | --- | --- |
| `/api/admin/migrations` | GET, POST | `migration:read` / `migration:preview` | POST size limit, workbook structural checks, same origin |
| `/api/admin/migrations/[id]` | GET | `migration:read` | Strict run ID |
| `/api/admin/migrations/[id]/readiness` | GET | `migration:read` | Strict run ID |
| `/api/admin/migrations/[id]/diagnostics.csv` | GET | `migration:export` | Generated CSV; fixed safe filename |
| `/api/admin/migrations/[id]/diagnostics/[diagnosticId]` | PATCH | `migration:review` | Strict IDs and review enum |
| `/api/admin/migrations/[id]/apply` | POST | `migration:apply` | Recent login, readiness checks, hash-bound run, transaction |
| `/api/admin/migrations/[id]/reverse` | POST | `migration:reverse` | Recent login, explicit reason, reversible-run checks |

## User administration routes

| Route | Methods | Permission | Extra control |
| --- | --- | --- | --- |
| `/api/admin/users` | POST | `admin:manage-users` | Recent login; strict role/password body; no public registration |
| `/api/admin/users/[id]` | PATCH | `admin:manage-users` | Recent login; blocks last-admin removal and self-demotion; revokes target sessions |
| `/api/admin/users/[id]/password` | POST | `admin:manage-users` | Recent login; password policy; revokes target sessions |
| `/api/admin/users/[id]/sessions` | GET, DELETE | `admin:manage-users` | Safe metadata only; DELETE requires recent login |
| `/api/admin/users/[id]/sessions/[sessionId]` | DELETE | `admin:manage-users` | Target session must belong to target user; recent login |

## Method and response rules

- Unsupported methods are not exported and return `405` through the framework.
- Mutations accept JSON unless the specific migration upload path requires bounded multipart input.
- IDs, numbers, dates, sort keys, enum values, row counts, and page sizes are positively validated.
- Operational and sensitive responses use `Cache-Control: no-store` through the proxy.
- Authorization failures return `401` or `403`; ownership-sensitive lookups use `404` where exposing existence would leak another user's record.
- Redirect targets are internal paths or are built from the configured HTTPS origin, never the request `Host` value.
