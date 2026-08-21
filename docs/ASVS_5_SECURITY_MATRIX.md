# ASVS 5.0.0 security matrix

Internal assessment against OWASP ASVS 5.0.0, release 5.0.0. This is not an external certification. `PASS` means the repository has an implementation and local evidence. `N/A` means the feature is absent. `INFRASTRUCTURE-DEPENDENT` means production evidence must come from IT staging.

## Baseline count

| Baseline | Application-applicable | Pass | Fail | Infrastructure-dependent | Not applicable |
| --- | ---: | ---: | ---: | ---: | ---: |
| Level 1 requirements (`L=1`) | 52 | 52 | 0 | 3 | 15 |
| Additional Level 2 requirements (`L=2`) | 101 | 101 | 0 | 15 | 67 |

The counts use the requirement's native `L` field, so the full Level 2 target is the Level 1 row plus the additional Level 2 row. Infrastructure-dependent controls are not counted as passes. They block production where identified in the handoff.

## Level 1 and Level 2 requirements

| Section | Requirement IDs | Status | Implementation, test, and remaining work |
| --- | --- | --- | --- |
| V1.1 Encoding architecture | V1.1.1, V1.1.2 | PASS | Canonical parsing through URL, JSON, Zod, and workbook parsers; validation precedes use. Static review and unit tests. |
| V1.2 Injection prevention | V1.2.1-V1.2.9 | PASS | React/context encoding, safe internal URLs, parameterized SQL/PostGIS, no user shell/LDAP/XPath/template input. Static and hostile-request tests. |
| V1.3 Sanitization | V1.3.1-V1.3.11 | PASS except V1.3.1, V1.3.4, V1.3.5, V1.3.8, V1.3.9, V1.3.11 N/A | No rich HTML, SVG, Markdown/CSS templates, JNDI, memcache, or mail input. No dynamic code/templates or arbitrary outbound URL. Format and internal paths are controlled. |
| V1.4 Memory/unmanaged code | V1.4.1-V1.4.3 | N/A | Runtime is managed TypeScript/JavaScript; no native application memory operations. Native dependencies remain covered by SCA/image scanning. |
| V1.5 Deserialization | V1.5.1, V1.5.2 | PASS | XML DTD/entities and unsafe ZIP structures blocked; JSON is data-only and strictly validated. Workbook and static tests. |
| V2.1 Validation documentation | V2.1.1-V2.1.3 | PASS | Route inventory, business rules, schemas, limits, roles, state and concurrency rules are documented. |
| V2.2 Input validation | V2.2.1-V2.2.3 | PASS | Server-side positive validation for IDs, enums, dates, numbers, sorting, pagination, bodies, and workbooks. |
| V2.3 Business logic | V2.3.1-V2.3.4 | PASS | Migration readiness/apply ordering, optimistic locks, ownership checks, merge invariants, job locks, and audit tests. |
| V2.4 Anti-automation | V2.4.1 | PASS | Database rate limits on sign-in and sensitive actions; job and bulk-operation controls. Edge tuning remains a staging task. |
| V3.2 Content interpretation | V3.2.1, V3.2.2 | PASS | Correct content types, React text rendering, fixed CSV response, no raw HTML, MIME-sniff protection. |
| V3.3 Cookies | V3.3.1-V3.3.4 | PASS | Secure, HttpOnly, SameSite=Lax, host-only, `/` path, opaque session; verified dynamically. |
| V3.4 Browser headers | V3.4.1-V3.4.6 | PASS | HSTS, nonce CSP, frame denial, nosniff, referrer, permissions and cross-origin headers; header tests. TLS itself is under V12. |
| V3.5 Origin separation | V3.5.1-V3.5.5 | PASS | Exact same-origin mutation enforcement, no permissive CORS, configured origin and host, safe internal redirects. |
| V3.7 Other browser controls | V3.7.1, V3.7.2 | PASS | Safe link handling and restrictive browser policy; no sensitive cross-window messaging. |
| V4.1 Web services | V4.1.1-V4.1.3 | PASS | Explicit content types, bounded JSON, protected methods, uniform route security. |
| V4.2 HTTP structure | V4.2.1 | PASS in app; proxy validation pending | Next parser plus body limits and exact host/origin checks. IT must test ingress desync/request-smuggling behavior. |
| V4.3 GraphQL | V4.3.1, V4.3.2 | N/A | No GraphQL endpoint. |
| V4.4 WebSocket | V4.4.1-V4.4.4 | N/A | No WebSocket endpoint. |
| V5.1 File documentation | V5.1.1 | PASS | Workbook threat surface, accepted files, processing, non-retention, and limits documented. |
| V5.2 File content | V5.2.1-V5.2.3 | PASS | Size and expansion bounds, `.xlsx` signature/type checks, macro/external/encrypted/DTD rejection. |
| V5.3 File storage | V5.3.1, V5.3.2 | N/A | Workbook bytes are not placed in a public/executable file store; source paths are trusted command arguments or protected temp handling. |
| V5.4 File download | V5.4.1, V5.4.2 PASS; V5.4.3 N/A | PASS / N/A | Diagnostic CSV is generated from database data with a fixed filename; the app does not re-serve uploaded files. |
| V6.1 Auth documentation | V6.1.1-V6.1.3 | PASS | Authentication architecture, rate limits, roles, session settings, account administration, and recovery ownership documented. |
| V6.2 Passwords | V6.2.1-V6.2.12 | PASS | Minimum 15, maximum 128, no composition rule or normalization, paste/password managers allowed, current password required, 3,000-entry common-password check, no periodic expiry. |
| V6.3 General auth | V6.3.1, V6.3.2, V6.3.4 PASS; V6.3.3 INFRASTRUCTURE-DEPENDENT | PASS / INFRASTRUCTURE-DEPENDENT | Rate limiting, no default login, one documented auth path. Corporate IdP/MFA is a production blocker. |
| V6.4 Factor lifecycle/recovery | V6.4.2 PASS; V6.4.1, V6.4.3, V6.4.4 N/A | PASS / N/A | No generated initial secret, hints/questions, public forgotten-password flow, or app MFA recovery. Admin reset uses organizational identity proofing and revokes sessions. |
| V6.5 MFA mechanisms | V6.5.1-V6.5.5 | N/A pending identity choice | The local app does not implement OTP/OOB factors. IT must select an approved corporate IdP/MFA; its mechanism is assessed before production. |
| V6.6 OOB authentication | V6.6.1-V6.6.3 | N/A | No OOB authentication code flow. |
| V6.8 Identity provider | V6.8.1-V6.8.4 | N/A pending identity choice | No current federation. If OIDC/SSO is connected, issuer, signature, replay, `acr`/`amr`/`auth_time`, and account-linking tests become mandatory. |
| V7.1 Session documentation | V7.1.1-V7.1.3 | PASS | Opaque database sessions, multiple-session policy, expiry, idle timeout, recent login, and revocation documented. |
| V7.2 Session fundamentals | V7.2.1-V7.2.4 | PASS | Backend verification, CSPRNG opaque tokens, fixation rotation, no client trust; dynamic tests. |
| V7.3 Timeout | V7.3.1, V7.3.2 | PASS | Fixed eight-hour absolute and 30-minute idle expiry; bounded activity touches; tests. |
| V7.4 Termination | V7.4.1-V7.4.5 | PASS | Logout, expiry, disable/delete, password reset/change, role/status change, and admin/user revocation invalidate database sessions. |
| V7.5 Session abuse | V7.5.1, V7.5.2 | PASS | Current password or recent login protects account changes; users can list and terminate other sessions; audit and dynamic test. |
| V7.6 Federated reauthentication | V7.6.1, V7.6.2 | N/A | No federation; reassess with IdP integration. |
| V8.1 Authorization docs | V8.1.1, V8.1.2 | PASS | Roles, permissions, ownership, admin/data boundaries, and route map documented. |
| V8.2 Authorization design | V8.2.1-V8.2.3 | PASS | Deny by default, server enforcement, ownership predicates, service rechecks, audit denial events. |
| V8.3 Operation authorization | V8.3.1 | PASS | Every protected handler and service operation checks explicit permission/ownership. |
| V8.4 Other authorization | V8.4.1 | N/A | One organization deployment; no customer/tenant boundary. |
| V9.1 Token source/integrity | V9.1.1-V9.1.3 | N/A | Sessions are opaque reference tokens, not self-contained JWT/JWS tokens. |
| V9.2 Token content | V9.2.1-V9.2.4 | N/A | No self-contained application authorization token. |
| V10.1 OAuth/OIDC general | V10.1.1, V10.1.2 | N/A | No OAuth/OIDC implementation today. |
| V10.2 OAuth client | V10.2.1, V10.2.2 | N/A | No OAuth client. |
| V10.3 Resource server | V10.3.1-V10.3.4 | N/A | No bearer-token resource server. |
| V10.4 Authorization server | V10.4.1-V10.4.11 | N/A | The application is not an OAuth authorization server. |
| V10.5 OIDC client | V10.5.1-V10.5.5 | N/A pending identity choice | Reassess all five before corporate OIDC is enabled. |
| V10.6 OpenID provider | V10.6.1, V10.6.2 | N/A | The application is not an OpenID Provider. |
| V10.7 Consent | V10.7.1-V10.7.3 | N/A | No delegated OAuth consent flow. |
| V11.1 Crypto inventory | V11.1.1, V11.1.2 | INFRASTRUCTURE-DEPENDENT | App inventory includes scrypt, CSPRNG tokens/secrets, HMAC identifiers, TLS expectations. IT must own key/certificate lifecycle and inventory. |
| V11.2 Crypto implementation | V11.2.1-V11.2.3 | PASS | Maintained platform/library primitives; no custom cipher protocol; secrets kept server-side. |
| V11.3 Encryption algorithms | V11.3.1-V11.3.3 | N/A in app | No application-defined symmetric encryption. TLS/storage algorithm choice is infrastructure-controlled. |
| V11.4 Hashing | V11.4.1-V11.4.4 | PASS | Better Auth scrypt, SHA-256 corpus/artifact hashes, SHA-256 HMAC identifiers; random salts/secrets. |
| V11.5 Random values | V11.5.1 | PASS | Node/Better Auth CSPRNG for secrets, tokens, IDs, and test credentials. |
| V11.6 Public-key crypto | V11.6.1 | N/A in app | No application-owned public-key operation. TLS/IdP verification becomes infrastructure/integration scope. |
| V12.1 TLS guidance | V12.1.1-V12.1.3 | INFRASTRUCTURE-DEPENDENT | Production config requires HTTPS and HSTS; IT must prove protocols, cipher policy, certificate validation, and DB TLS. |
| V12.2 External HTTPS | V12.2.1, V12.2.2 | INFRASTRUCTURE-DEPENDENT | Approved certificate and no HTTP path must be proved at staging ingress. |
| V12.3 Service TLS | V12.3.1-V12.3.4 | INFRASTRUCTURE-DEPENDENT | Private PostgreSQL and service links must authenticate peers and validate certificates. |
| V13.1 Config docs | V13.1.1 | PASS | Environment schema, fail-closed production checks, examples, deployment and handoff docs. |
| V13.2 Backend communication | V13.2.2-V13.2.5 PASS; V13.2.1 INFRASTRUCTURE-DEPENDENT | PASS / INFRASTRUCTURE-DEPENDENT | Least DB role and no arbitrary outbound app feature. IT owns short-lived/rotated service credential and network egress allowlist enforcement. |
| V13.3 Secret management | V13.3.1, V13.3.2 | INFRASTRUCTURE-DEPENDENT | No secret is committed/bundled/client-exposed; approved vault, ACL, injection, and rotation evidence are required. |
| V13.4 Information leakage | V13.4.1-V13.4.5 | PASS | Standalone artifact, no `.git`/docs/tests/env files, source maps off, minimal health, generic errors, redacted logs. |
| V14.1 Data protection docs | V14.1.1, V14.1.2 | PASS | Sensitive operational/auth/audit data and required handling are documented. IT approves retention/encryption policy. |
| V14.2 General data protection | V14.2.1-V14.2.3 PASS; V14.2.4 INFRASTRUCTURE-DEPENDENT | PASS / INFRASTRUCTURE-DEPENDENT | No secrets in URLs, no trackers, no-store responses; at-rest encryption/retention enforcement needs IT evidence. |
| V14.3 Client data | V14.3.1-V14.3.3 | PASS | No local/session storage of operational data or tokens; HttpOnly cookie; logout/session invalidation; restrictive caching. |
| V15.1 Secure coding docs | V15.1.1-V15.1.3 | PASS | Severity/remediation model, coding constraints, review commands, and update policy documented. |
| V15.2 Architecture/dependencies | V15.2.1-V15.2.3 | PASS | Maintained Next/Auth versions, production audit, integrity gate, SBOM, threat/architecture review. |
| V15.3 Defensive coding | V15.3.1-V15.3.7 | PASS | Minimum response fields, bounded resources, safe failures, no unsafe APIs, numeric validation, no prototype merge/deserialization path. |
| V16.1 Logging docs | V16.1.1 | PASS | Event fields, redaction, request IDs, retention owner, audit integrity and incident use documented. |
| V16.2 General logging | V16.2.1-V16.2.5 | PASS | Structured JSON, safe timestamps/levels, no credentials/body dumps, fixed fields and line-injection test. |
| V16.3 Security events | V16.3.1-V16.3.4 | PASS | Sign-in/out, denial, user/admin, session, migration, merge, verification, and job actions audited. |
| V16.4 Log protection | V16.4.1 PASS; V16.4.2, V16.4.3 INFRASTRUCTURE-DEPENDENT | PASS / INFRASTRUCTURE-DEPENDENT | Encoding/redaction pass; immutable off-host transport, access controls, SIEM analysis and alerting require staging proof. |
| V16.5 Error handling | V16.5.1-V16.5.3 | PASS | Central generic client errors, detailed redacted server logs, fail-closed readiness/configuration, graceful dependency failure. |
| V17.1 TURN | V17.1.1 | N/A | No TURN/WebRTC. |
| V17.2 Media | V17.2.1-V17.2.4 | N/A | No WebRTC media. |
| V17.3 Signaling | V17.3.1, V17.3.2 | N/A | No WebRTC signaling. |

## Level 3 gap analysis

Level 3 is not claimed. Controls justified by the data and administrator risk are tracked below.

| Area and representative IDs | Current position | Required next step |
| --- | --- | --- |
| Phishing-resistant authentication, alerts, factor lifecycle: V6.3.3, V6.3.5-V6.3.8, V6.5.6-V6.5.8 | Password-only local authentication; rate limiting and audit are present | Corporate OIDC with phishing-resistant MFA for administrators, authentication alerts, tested recovery and revocation |
| Administrator password reset: V6.4.6 | Administrator currently chooses the replacement password | Prefer IdP-owned reset or one-time user-completed enrollment so help desk never knows the final password |
| Sensitive-operation step-up: V7.5.3 and V7.6 | Recent primary login required for high-impact routes | Validate IdP `auth_time`/`acr`/`amr` and require an approved step-up method |
| Hardware-backed keys and crypto discovery: V11.1.3-V11.1.4, V13.3.3-V13.3.4 | Environment secrets and documented inventory | Vault/HSM-backed lifecycle where policy requires it; automated crypto/secret inventory and rotation evidence |
| Strong service identity and TLS: V12 and V13 Level 3 controls | Repository specifies boundaries only | Mutual authentication/certificate policy for internal services where risk assessment requires it |
| Data minimization/retention: V14.2.5-V14.2.8 | Response minimization and no-store are present | Approved retention schedule, automatic deletion, cache-deception test, UI masking review |
| Advanced detection/tamper evidence: V16 Level 3 controls | App audit and metrics exist | Immutable SIEM, correlated identity/network/database events, tested alert and forensic retention |
| ReDoS: V1.3.12 | Static review found no user-controlled catastrophic regex path | Add regex-specific review when introducing a new complex expression or parser |

## Evidence commands

```bash
npm run lint
npm run typecheck
npm test
npm run build
npm run audit:static-security
npm run audit:supply-chain
npm run audit:production
npm run scan:secrets
npm run test:security
npm run test:database-security
```

Infrastructure rows use the exact tests in `SECURITY_INFRASTRUCTURE_HANDOFF.md`. A local application pass cannot convert those rows to `PASS`.
