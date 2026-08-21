# OWASP Top 10:2025 security matrix

This is an internal code and test review against the OWASP Top 10:2025. It is not an external certification or penetration test.

| Category | Status | Repository evidence | Remaining infrastructure work |
| --- | --- | --- | --- |
| A01 Broken Access Control | Pass in application; staging pending | 36-route inventory, server RBAC, ownership-bound queries, recent login, strict admin/migration/job permissions, IDOR and role tests | Prove VPN-only ingress, origin lockdown, and privileged access controls |
| A02 Security Misconfiguration | Pass in application; staging pending | Production fail-closed config, exact HTTPS origin/host, nonce CSP, minimal probes, no source maps, standalone non-root image, loopback dev ports, hardened production Compose | Validate proxy parser/header rules, private DNS, TLS, read-only runtime, and firewall policy |
| A03 Software Supply Chain Failures | Pass with one accepted development-only advisory; image proof pending | Exact direct dependencies, lock registry/SHA-512 audit, reviewed lifecycle scripts, pinned CI actions/base digests, SBOM and Trivy CI jobs, zero production advisories | Run/retain container scan, sign image/provenance, enforce repository and environment protection |
| A04 Cryptographic Failures | Pass in application; staging pending | Better Auth scrypt password hashes, CSPRNG sessions/secrets, HMAC audit identifiers, secure cookies, no weak custom crypto | Enforce approved TLS for app/DB, managed key lifecycle, disk and backup encryption |
| A05 Injection | Pass | Parameterized Drizzle/`pg` queries, allowlisted sort/order values, strict schemas, React escaping, no dynamic code/command path, workbook XML protections; hostile SQL/XSS tests | Keep proxy and PostgreSQL patched; run staging DAST |
| A06 Insecure Design | Pass in application; staging pending | Threat model, layered network/auth/RBAC/service/DB controls, no public registration, recent login, migration preview/readiness/apply separation, compromise blast-radius review | Corporate MFA, egress controls, central detection, and approved break-glass procedure |
| A07 Authentication Failures | Pass for local auth; MFA pending | 15-character minimum, 3,000-entry common-password check, no composition rule, rate limits, fixed/idle session expiry, fixation defense, revocation, self-service password/session controls, generic failures | Integrate corporate OIDC/SSO with MFA and verify assertion strength/recentness |
| A08 Software or Data Integrity Failures | Pass in repository; staging pending | Reviewed migrations, workbook hashes and apply gates, audit append restriction, dependency integrity, pinned actions/images, immutable release identity | Signed image/provenance, protected deployment approvals, immutable off-host audit retention |
| A09 Security Logging and Alerting Failures | Pass for event creation; detection pending | Structured line-safe JSON, centralized redaction, request IDs, security/admin/migration/session audit events, audit integrity command, protected fixed-label metrics | Ship to access-controlled immutable SIEM; configure and exercise alert rules |
| A10 Mishandling of Exceptional Conditions | Pass | Central safe error responses, no stack traces to clients, readiness fails closed, optimistic concurrency, transaction boundaries, shutdown handling, parser/resource limits, test failure cleanup | Exercise proxy/database/container failure and capacity conditions in staging |

## Test mapping

- `npm run test:security`: authentication, authorization, CSRF, CORS, host/proxy spoofing, injection, sessions, admin, migration, job, metrics, and audit scenarios.
- `npm run test:database-security`: runtime role escalation, extension/schema creation, server file/program access, and audit-history mutation.
- `npm run audit:static-security`: dangerous runtime API and mutation-origin review.
- `npm run audit:supply-chain`: lock provenance, integrity, exact direct versions, and lifecycle-script review.
- `npm run audit:production`: deployable dependency advisory gate.
- `npm run scan:secrets`: tracked files and history.
- CI: production SBOM, Docker build, and High/Critical container scan.
