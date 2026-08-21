# Security architecture

## Trust boundaries

The browser is untrusted. Cookies, route parameters, request bodies, headers, and visible role labels can all be changed by the caller. Identity comes only from a Better Auth session record read by the server. Permissions come from the role stored on the current user record.

The production request path is:

```text
company VPN -> private DNS -> internal TLS ingress -> Next.js proxy
            -> page or route handler -> Better Auth -> authorization helper
            -> authorized service/query -> Drizzle -> restricted runtime identity
            -> private PostgreSQL/PostGIS
```

The public internet must have no route to the ingress, application origin, or database. VPN access supplies reachability only; it does not create an application session or permission.

The proxy handles early page redirects. Every protected page repeats its permission check. API route handlers return `401` or `403`, and data services assert permissions again before reading or changing sensitive rows.

## Resource map

- Public: `/sign-in`, static assets, `POST /api/auth/sign-in/email`, `POST /api/auth/sign-out`, and `GET /api/auth/get-session`.
- Authenticated: dashboard and workflow pages plus `GET /api/session`.
- Operations: provider, call, facility, review, and authorization views. Write operations require `operations:write`.
- Reports: `/reports` requires `reports:read`.
- Administrator: `/admin`, `/data-quality`, `/duplicates`, staff provisioning, role and activation changes, password resets, merges, duplicate decisions, bulk assignment, and authorization deletion.
- User-owned: authorization reads and updates by `ura_user` include `created_by = authenticated user ID`. Administrators can read across owners.
- Protected migration operation: administrators with migration permissions can preview a bounded workbook upload and explicitly apply an approved run. A local command supports controlled IT migration. Workbook bytes are not retained.

## Roles and permissions

| Role | Intended use | Permissions |
|---|---|---|
| `ura_user` | daily provider work | app access, operations read/write, reports read |
| `report_viewer` | read-only reporting | app access, reports read |
| `auditor` | reporting and audit review | app access, reports read, audit read |
| `admin` | account and system administration | all permissions |

New staff accounts default to `ura_user` inside the identity adapter. A protected administrator operation may select a different valid role. Role, activation, and service-account fields are rejected from public identity input.

## HTTP operations

| Operation | Identity | Permission and ownership | Failure |
|---|---|---|---|
| Sign in | email/password | active, non-service account; rate limited | generic `401` or `429` |
| Sign out | database session | current session | session removed |
| Read session | database session | active user | `401` |
| Read authorization | database session | `operations:read`; owner match unless admin | `401`, `403`, or non-disclosing `404` |
| Update authorization | database session | `operations:write`; owner match unless admin | `401`, `403`, `404`, `413`, or validation `400` |
| Delete authorization | database session | `admin:manage-data` | `401`, `403`, or `404` |
| Read facility and history | database session | `operations:read` | `401`, `403`, or `404` |
| Update facility | database session | `operations:write`; optimistic version | `401`, `403`, `404`, `409`, or validation `400` |
| Create verification | database session | `operations:write`; optimistic version | `401`, `403`, `404`, `409`, or validation `400` |
| Record contact attempt | database session | `operations:write` | `401`, `403`, `404`, or validation `400` |
| Review data quality | database session | `admin:read` | `401` or `403` |
| Decide duplicate | database session | `admin:manage-data` | `401`, `403`, `404`, or validation `400` |
| Merge facilities | database session | `admin:manage-data`; typed confirmation and two optimistic versions | `401`, `403`, `404`, `409`, or validation `400` |
| Bulk assign reverification | database session | `admin:manage-data`; all selected facilities validated in one transaction | `401`, `403`, `409`, or validation `400` |
| Create staff account | database session | `admin:manage-users` | `401`, `403`, `429`, or validation `400` |
| Change role/activation | database session | `admin:manage-users`; not self; last admin protected | `401`, `403`, `404`, or `409` |
| Reset staff password | database session | `admin:manage-users` | `401`, `403`, `404`, or validation `400` |
| Change own password | database session plus current password | current user; revokes other sessions | `400`, `401`, or `429` |
| List/revoke own sessions | database session | current user and owned session; recent login for revocation | `401`, `404`, or `429` |

All mutation APIs require a configured same-origin `Origin`, reject cross-site fetches, accept only JSON, reject unknown fields, and enforce a 16 KiB request limit. Better Auth also validates origins for cookie-authenticated identity requests.

## Sessions

Sessions are opaque random tokens backed by PostgreSQL rows. Cookie contents do not carry trusted roles. Sessions have a fixed eight-hour maximum and a 30-minute idle timeout; bounded activity touches update the idle clock without extending absolute expiry. Cookie caching is disabled so revocation, deactivation, and role changes take effect on the next request. Logout deletes the session. Password changes/resets, role changes, and activation changes delete other or all target sessions as appropriate. Users and administrators can review safe session metadata and revoke sessions. User deletion cascades to sessions.

## Rate limits and client addresses

Sign-in allows five attempts per minute for a client key. Administrative, authorization, verification, contact, merge, duplicate, and bulk-assignment mutations have separate database-backed limits and return `429` with `Retry-After`.

Forwarded client addresses are ignored by default. `AUTH_CLIENT_IP_HEADER` is accepted only when `PROXY_TRUST_MODE=sanitized-ingress` and the direct peer is within `AUTH_TRUSTED_PROXY_CIDRS`; the proxy must strip the client's version and replace it. Stored rate-limit keys and audit addresses are HMAC values, not raw addresses.

## Audit events

The audit table records actor, action, target type and ID, time, result, request ID, a hashed source address when available, and small allowlisted metadata. Covered events include sign-in success/failure, sign-out, initial admin creation, staff creation, role and activation changes, password resets, authorization changes, facility verification and edits, contact attempts, duplicate decisions, merges, bulk assignments, and imports.

Passwords, cookies, tokens, authorization headers, reset values, and raw network addresses are not stored in audit metadata.

## Environment and errors

Production startup requires private-VPN mode, a PostgreSQL URL, an exact HTTPS application origin, matching trusted origins, explicit proxy trust settings, an authentication secret of at least 32 characters, and a separate audit HMAC salt of at least 32 characters. Placeholder secrets, demo data mode, malformed proxy CIDRs, unsafe timing values, and non-HTTPS origins are rejected.

API errors use fixed public messages. Database exceptions, stack traces, paths, and environment values are not returned to callers. Server logs retain diagnostic context without credentials or tokens.
