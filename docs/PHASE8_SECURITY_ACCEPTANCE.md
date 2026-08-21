# Phase 8 security acceptance

## Phase 8 Status

SECURITY ACCEPTANCE PASSED — INFRASTRUCTURE VALIDATION PENDING

The repository has no open Critical or High application finding. Production remains blocked until IT proves the VPN, private origin/database paths, MFA, TLS, secrets, egress, logging, image, and backup controls listed in `SECURITY_INFRASTRUCTURE_HANDOFF.md`.

## Executive Security Summary

| Severity | Found | Fixed in repository | Infrastructure-dependent | Accepted/open application risk |
| --- | ---: | ---: | ---: | ---: |
| Critical | 0 | 0 | 0 | 0 |
| High | 9 | 6 | 3 | 0 |
| Medium | 6 | 4 | 1 | 1 |
| Low | 0 | 0 | 0 | 0 |
| Informational | 3 | 0 | 0 | 3 |

The accepted Medium item is the four-advisory esbuild development-tool chain under `drizzle-kit`. It is absent from the standalone production runtime and does not expose an esbuild server. The production dependency audit reports zero vulnerabilities. Upgrade the development chain when a compatible Drizzle Kit release removes it.

The three High infrastructure findings are unproved VPN/origin/database isolation, password-only authentication without corporate MFA, and unproved production TLS/storage encryption. The Medium infrastructure finding is unproved deny-by-default egress and immutable central detection. These are deployment blockers where marked in the handoff.

## VPN Security

Intended topology: no public route; company VPN; private DNS; internal TLS ingress; exact application Host; Better Auth; server RBAC; restricted runtime database identity; private PostgreSQL/PostGIS.

The app rejects unexpected production Host values, ignores forwarded host/protocol, requires explicit sanitized-ingress configuration before trusting proxy-supplied IDs, and uses configured origins for redirects. This does not prove the network. No staging hostname, origin, VPN, firewall, or private DNS was available from this workstation. The outside-VPN probe is implemented but was not run because only IT can establish an authorized outside-VPN position and target.

VPN-ONLY ACCESS REQUIRES IT STAGING VALIDATION

## Attack Surface

The reviewed surfaces are 23 page files, 36 API route files, authentication/session storage, PostgreSQL/PostGIS queries and roles, protected workbook migration, generated CSV, scheduled commands, logs/metrics, migrations/backups, npm/CI, Docker build/runtime, and deployment configuration. There are no Server Actions, WebSockets, GraphQL endpoints, rich HTML inputs, plug-in loaders, dynamic package endpoints, or application features accepting an arbitrary outbound URL.

Full inventory: `SECURITY_ATTACK_SURFACE.md`. Route-by-route controls: `SECURITY_ROUTE_INVENTORY.md`. Trust boundaries and blast radius: `SECURITY_THREAT_MODEL.md`.

## Vulnerability Findings

| ID | Severity | Component | Description / prerequisite / impact | Evidence and remediation | Final status |
| --- | --- | --- | --- | --- | --- |
| P8-01 | High | Proxy | Host/forwarded-host manipulation could poison redirects when the origin was taken from the request | Exact Host gate; configured-origin redirects; dynamic `421` and spoof tests | Fixed |
| P8-02 | High | Client IP | A caller-supplied proxy header could affect rate/audit attribution without an explicit trust model | Sanitized-ingress mode, trusted CIDRs, header sanitation handoff, spoof tests | Fixed in app; proxy proof pending |
| P8-03 | High | Sessions | Rolling sessions lacked app idle timeout, user inventory and recent login for sensitive work | Fixed eight-hour max, 30-minute idle, recent login, user/admin revocation; dynamic tests | Fixed |
| P8-04 | High | XLSX | Crafted ZIP/XML could exhaust resources or carry active/external content | Signature, entries, ratio, bytes, row/column/cell/string, traversal, macro/external/DTD limits and tests | Fixed |
| P8-05 | Medium | Links | Scheme-relative/control-character notification paths could leave the app | Shared internal-path check plus DB constraint/migration/tests | Fixed |
| P8-06 | High | Database role | Runtime identity was not expressed or independently tested for dangerous grants | Runtime SQL and 12 escalation tests | Fixed in repo; staging grant proof pending |
| P8-07 | High | Network defaults | Example app/DB ports could be published too broadly | Loopback-only development ports; production example has no direct published ports | Fixed in repo; staging firewall proof pending |
| P8-08 | Medium | Container | Runtime install/filesystem/capability surface was broader than needed | Pinned standalone non-root image; read-only/tmpfs/cap-drop/no-new-privileges example | Fixed in repo; runtime proof pending |
| P8-09 | Medium | Supply chain | Mutable actions and incomplete lock/script checks weakened tamper detection | Commit/digest pins, lock integrity, lifecycle allowlist, SBOM, scanner gate | Fixed; container scan evidence pending |
| P8-10 | Medium | Passwords | Common long passwords passed the length check | Local 3,000-entry corpus check and tests | Fixed |
| P8-11 | High | VPN/origin | Public or direct-origin reachability would expose the app | Outside/on-VPN/origin probe instructions | Infrastructure-dependent; blocks deployment |
| P8-12 | High | Authentication | A stolen password is one-factor access | Corporate OIDC/SSO with MFA and assertion/recovery tests required | Infrastructure-dependent; blocks deployment |
| P8-13 | High | Transport/storage | Unproved app/DB TLS and at-rest/backup encryption | Exact certificate/plaintext/storage/restore tests in handoff | Infrastructure-dependent; blocks deployment |
| P8-14 | Medium | Egress/detection | Compromised process could exfiltrate if network is open and logs mutable | Deny-by-default egress and immutable SIEM requirements | Infrastructure-dependent |
| P8-15 | Medium | Development tool | esbuild dev-server advisory through Drizzle Kit | Production audit clean; dev server kept local and excluded from runtime | Accepted and tracked |

Each finding's attack prerequisite, impact, likelihood, evidence and verification detail is expanded in `SECURITY_ATTACK_SURFACE.md`.

## RCE / Trojan Resistance

Potential code-execution entry points are npm lifecycle scripts, CI actions, Docker bases/build scripts, trusted migration SQL, and allowlisted scheduler commands. HTTP, workbook, database record, and ordinary user inputs cannot choose an executable, shell fragment, package, module, template, or arbitrary server-side URL. Runtime source contains no `eval`, `new Function`, Node VM, raw HTML insertion, or user-controlled dynamic import.

A workbook cannot execute macros or formulas. It cannot load external relationships, DTD/entities, executable package entries, or paths outside the ZIP. Migration SQL remains trusted release content and runs under a separate identity.

Untrusted input cannot install a package, execute an OS command, or obtain database credentials through a supported function. A compromised application process can read its runtime environment and use its DB grant; it can make outbound connections if IT leaves egress open. The read-only non-root container and restricted DB identity reduce persistence and host/database escalation. Full review: `MALICIOUS_CODE_RESISTANCE.md`.

## Database Security

- Runtime privilege suite: 12/12 passed, including role/extension/table/schema escalation, server files/programs, and audit update/delete.
- SQL/PostGIS construction uses parameters and allowlisted structure. Hostile search input did not change query structure or execute script.
- Runtime, migration and backup identities are separate in the deployment design. Only runtime identity behavior was simulated locally.
- Runtime credential remains server-side and is not in source, browser output, logs, or image configuration.
- Public/VPN database reachability, actual staging grants, DB TLS, storage encryption, managed credential injection and backup ACLs remain IT evidence.
- Local PostgreSQL did not include PostGIS, so spatial staging and provider performance gates could not run here.

## Authentication

Better Auth 1.7.1 uses PostgreSQL sessions, scrypt password hashes, opaque CSPRNG tokens, secure/HttpOnly/SameSite cookies in production, disabled public registration, exact trusted origins and no cookie cache. Passwords are 15-128 characters, accept any composition/paste/password managers, are checked against a local common-password corpus, and require the current password for self-change.

Sessions have fixed eight-hour and 30-minute idle limits. Fixation, logout, expiry, idle expiry, disable/delete, password reset/change, targeted revocation, other-session revocation and malformed-cookie tests pass. Sign-in and sensitive actions are database-rate-limited. User/admin session views omit credentials. Client-IP use is disabled unless the sanitized proxy model is configured.

Corporate MFA is not implemented. IT must connect the approved OIDC/SSO provider and prove MFA, issuer/audience/signature, state/nonce/PKCE, replay defense, role mapping, disable/recovery and authentication strength/recentness before production.

## Authorization

Thirty-two of 36 API route files require an application session. The four other files are the restricted authentication gateway, minimal liveness/readiness probes, and separately token-protected metrics; all still require private network placement. Every operational page checks a server permission. Services repeat permission and ownership rules.

Tested roles are `ura_user`, `report_viewer`, `auditor`, and `admin`. IDOR, cross-owner reads/writes/deletes, role escalation, self-demotion, last-admin protection, mass assignment, migration permissions, job permissions, notification ownership and work assignment tests pass. Sensitive administrative/migration actions require a recent login.

## Injection Testing

| Class | Result |
| --- | --- |
| SQL/PostGIS | Blocked by parameters and allowlisted query structure; hostile dynamic test passed |
| OS command | No untrusted input path; static source audit passed |
| Reflected/stored XSS | React text encoding, no raw HTML API, nonce CSP; hostile reflected payload test passed |
| SSRF | No arbitrary outbound URL feature; internal target paths use a single-leading-slash allowlist |
| Path traversal | ZIP entry and workbook relationship paths reject absolute, backslash and parent traversal |
| Formula injection/execution | Workbook formulas are counted but never calculated; generated CSV uses the controlled export path |
| Prototype pollution | Strict schemas reject unknown fields; no unsafe recursive object merge found |
| Deserialization/XXE | JSON remains data-only; DTD/entities rejected anywhere in parsed workbook XML |

## Supply Chain

- Exact direct versions and one committed lockfile.
- 760 lock records checked for npm registry provenance/SHA-512 integrity; bundled entries require an integrity-checked parent.
- Five exact lifecycle-script packages reviewed and allowlisted; a new/change entry fails the audit.
- Production npm audit: zero vulnerabilities. Full development audit: four Moderate esbuild advisories through Drizzle Kit.
- Next.js upgraded from 16.3.0 to 16.3.2; Better Auth reviewed at 1.7.1 using only core email/password/session behavior.
- CI actions and Docker bases pinned to full commits/digests; CI token defaults read-only.
- CI produces a CycloneDX production SBOM and fails on any fixed or unfixed High/Critical Trivy result.
- Local container build/scan not run: Docker Desktop's engine is unavailable on this workstation. Both Compose files passed configuration validation.
- Secret scan passed 287 repository files and all 33 commits, including the two Phase 8 local commits.

## OWASP

All ten OWASP Top 10:2025 categories are mapped in `OWASP_TOP_10_2025_SECURITY_MATRIX.md`. Application controls pass. A02, A03, A04, A06, A07, A08 and A09 retain explicitly named infrastructure evidence before production.

## ASVS

This is an internal verification against ASVS 5.0.0, not a formal external certification.

| Baseline | Applicable in application | Pass | Fail | Infrastructure-dependent | N/A |
| --- | ---: | ---: | ---: | ---: | ---: |
| Level 1 native requirements | 52 | 52 | 0 | 3 | 15 |
| Additional Level 2 native requirements | 101 | 101 | 0 | 15 | 67 |

Level 3 is not claimed. Main gaps are phishing-resistant MFA and alerts, IdP step-up, administrator reset that does not reveal the final password to help desk, hardware-backed key lifecycle, stronger internal service identity, enforced retention/data minimization, and immutable detection. Every Level 1/2 section and applicable ID is recorded in `ASVS_5_SECURITY_MATRIX.md`.

## Security Testing

| Test | Result |
| --- | --- |
| Static runtime/API audit | PASS: 133 runtime source files, 36 API route files |
| Dynamic hostile-request matrix | PASS: 86 scenarios after final CSP propagation test |
| Database privilege matrix | PASS: 12 scenarios |
| Unit/component/service tests | PASS: 29 files, 126 tests |
| Supply lock/lifecycle audit | PASS: 760 lock records, 5 reviewed scripts |
| Production dependency audit | PASS: 0 vulnerabilities |
| Secret repository/history scan | PASS: 287 files and all 33 commits |
| Audit integrity | PASS: 0 missing actors, invalid timestamps, unknown actions or broken actors |
| Compose validation | PASS: development and production example |
| Container build/scan | PENDING: local Docker engine unavailable; CI gate configured |
| DAST/manual VPN bypass test | PENDING: requires authorized IT staging target |
| Fuzzing | Workbook malformed/limit unit cases and hostile API schemas passed; broader proxy/DAST fuzzing pending staging |

## Regression

| Gate | Result |
| --- | --- |
| ESLint | PASS |
| TypeScript | PASS |
| Production build | PASS, Next.js 16.3.2 production compile and route generation |
| Unit/integration | PASS, 126/126 |
| Security | PASS, 86/86 after final run |
| Database security | PASS, 12/12 |
| Automation | PASS, 16/16 |
| Automation performance | PASS, six operations over 10,000 rows |
| Migration/reconciliation | PASS, 11/11 |
| Migration performance | PASS, 1,000/10,000/50,000 row sizes |
| Dependency failure/maintenance | PASS, liveness/readiness/redaction/metrics and maintenance routing |
| Audit integrity | PASS |
| Dependency/lock/static/secret checks | PASS as listed above |
| PostGIS/provider performance | PENDING: local PostgreSQL distribution has no PostGIS extension |
| Backup/restore | PENDING: `pg_dump`/`pg_restore` are not installed on this workstation |
| Deployment smoke | PENDING: no production-equivalent PostGIS staging target |

Security controls did not regress tested workflow timings. Remaining performance, restore and smoke gates are staging deployment requirements, not waived failures.

## Repository

- Starting HEAD: `4da191eb205480d5a0b17d543e48b52fe6084ddc`
- Final HEAD: use `git rev-parse HEAD` after the acceptance documentation commit; recorded in the delivery summary
- Branch: `master`
- Commits: local Phase 8 implementation and documentation commits
- Working tree: required clean state after commits
- Remote: none configured
- Push status: not pushed, as required by the Phase 8 brief

## Remaining Infrastructure Security Work

| Owner | Configuration requirement | Required test | Blocks deployment |
| --- | --- | --- | --- |
| Network | VPN-only route, private DNS, private ingress, origin firewall | Outside-VPN hostname/origin/health/API probes and on-VPN reachability | Yes |
| Network/DBA | PostgreSQL private subnet/ACL; no ordinary VPN-client route | Public and VPN TCP fail; app/migration/backup approved paths pass | Yes |
| Ingress/Security | Approved TLS and header/parser sanitation | TLS scan, plaintext rejection, Host/SNI, duplicate/conflicting header and smuggling tests | Yes |
| Identity/Security | Corporate OIDC/SSO and MFA, especially admin | Full assertion, replay, mapping, disabled-user, recovery and step-up test | Yes |
| Platform/Security | Managed secrets with independent rotation | Staging rotation drill and old-credential rejection | Yes |
| Platform/Network | Deny-by-default egress | Approved destinations pass; arbitrary internet/metadata service fail | Yes |
| Logging/Security | Immutable off-host logs/SIEM and alert delivery | Tamper/access test and alert exercises | Yes |
| Backup/DBA | Encrypted immutable backups and isolated restore | Current backup restore plus schema/data/security/smoke checks | Yes |
| Release/Security | Container scan, SBOM, signature/provenance and admission | High/Critical gate and rejection of unapproved digest | Yes |
| Operations | Production monitoring/capacity | Login/search/report/work/load plus failure and alert tests | Yes |

Exact commands and evidence fields are in `SECURITY_INFRASTRUCTURE_HANDOFF.md`.

## Final Directive

Production access must require a company VPN connection, then Provider Tracker authentication, then server-side authorization. The public internet must not have a usable route to Provider Tracker or PostgreSQL. Do not deploy until every blocking IT validation has evidence and approval.
