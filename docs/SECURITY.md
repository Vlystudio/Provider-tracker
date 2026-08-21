# Security

## Application controls

- Better Auth verifies email/password credentials and stores sessions in PostgreSQL.
- Passwords use Better Auth's scrypt implementation. The staff provisioning and reset paths require at least 14 characters with upper case, lower case, a number, and a symbol.
- Public registration and unused authentication endpoints are not exposed.
- Sessions last eight hours, use database records, and are revoked on password reset, role change, or account activation change.
- Production cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, host-only, and scoped to `/`.
- Page checks, route-handler checks, and service-layer checks use the same role and permission policy.
- User-owned authorization queries include the authenticated user ID. A mismatched ID returns `404`.
- State-changing application routes require an approved `Origin`, JSON bodies, strict schemas, and a 16 KiB body limit.
- Sign-in and sensitive application routes use database-backed rate limits.
- Authentication failures and security-sensitive account or record changes create structured audit events. IP addresses and email lookup values are HMAC-hashed before storage.
- Facility verification, contact attempts, edits, duplicate decisions, merges, and bulk assignments use server permissions, same-origin checks, strict body schemas, rate limits, and safe audit metadata.
- Facility and relationship writes use optimistic versions where concurrent edits would otherwise lose data.

## Browser and transport controls

Responses include Content Security Policy, clickjacking protection, MIME-sniffing protection, a strict referrer policy, permissions controls, and cross-origin isolation headers. Production adds HSTS and removes the Next.js identification header. Cross-origin browser access is not enabled.

TLS must terminate at the application host or at a trusted reverse proxy. `AUTH_CLIENT_IP_HEADER` stays unset unless that proxy overwrites the selected header and strips values supplied by clients.

## Data and files

Authorization numbers, provider data, diagnosis codes, notes, and reports are sensitive operational data. The web app does not provide file upload or download endpoints. Workbook intake is a local command with bounded ZIP/XML parsing, file-size and row limits, and no macro or formula execution. Source workbooks and exports are excluded from Git.

Database credentials stay in server environment variables. The production database account should have only the permissions needed by the app. Run migrations with a separate release identity when the hosting platform supports it.

## Dependency audit note

The deployable package set passes:

```bash
npm audit --omit=dev --omit=optional --omit=peer
```

The broader `npm audit --omit=dev` report currently follows Better Auth's optional `drizzle-kit` peer back to this repository's development tooling and reports four moderate findings under `@esbuild-kit` and `esbuild` (`GHSA-67mh-4wv8-2f99`). The advisory concerns an exposed esbuild development server. The production image removes development, optional, and peer-only packages and does not run an esbuild server. Do not use `npm audit fix --force`; npm currently proposes an incompatible Drizzle Kit downgrade. Upgrade Drizzle Kit when its dependency chain removes the affected package.

## Deployment responsibility

Code alone does not establish HIPAA compliance. Before live use, the organization must approve the host, BAA coverage, database encryption, backups and restore tests, network controls, monitoring, retention, and incident procedures.
