# Security attack surface

This inventory covers the code and deployment files in this repository. Network claims remain unverified until IT runs the staging checks in `SECURITY_INFRASTRUCTURE_HANDOFF.md`.

## Entry points

| Surface | Input | Boundary and control | Residual risk |
| --- | --- | --- | --- |
| Private web ingress | HTTP method, path, query, headers, cookies, body | VPN/private route, TLS proxy, exact host/origin checks, nonce CSP, request-size limits | VPN, origin firewall, proxy parsing, and TLS require staging proof |
| Authentication | Email, password, session cookie | Better Auth, scrypt hashes, 15-character minimum, common-password check, rate limit, opaque server sessions | Corporate IdP and MFA are not connected yet |
| Application pages | 23 page routes | Server-side session and permission checks; no operational data in static public pages | A stolen account retains that role's access until disabled or revoked |
| API | 36 route handlers | Permission checks, ownership filters, strict schemas, same-origin checks on mutations, rate limits | Business-specific abuse still needs monitoring and tuning |
| Workbook intake | Local file path or protected migration upload | ZIP signature, entry, size, ratio, row, column, cell, XML, path, macro, and external-reference checks | Antivirus/CDR at the staging intake boundary is IT-owned |
| PostgreSQL/PostGIS | Parameterized Drizzle/`pg` queries | Private network, separate migration/runtime/backup roles, restricted runtime grants | Network ACL, TLS, and managed credentials require staging proof |
| Scheduled commands | Approved job name and flags | No in-process scheduler; allowlisted commands, locks, service identity, dry-run path | Scheduler host and credential isolation are IT-owned |
| Logs and metrics | Structured events and fixed labels | Central redaction, line-safe JSON, HMAC identifiers, bearer-protected metrics | Immutable off-host storage and alert delivery are IT-owned |
| CI and image | Source, lockfile, actions, base images | Exact direct versions, lock integrity, reviewed lifecycle scripts, commit-pinned actions, SBOM, Trivy gate | CI branch rules, image signing, and registry policy are IT-owned |
| Backups and migrations | Database URL, target confirmation, artifact path | Environment guards, separate role design, checksums, isolated restore instructions | Encryption, retention, and restore evidence are IT-owned |

There are no Server Actions, WebSockets, GraphQL endpoints, rich-text/HTML inputs, executable plug-in uploads, dynamic package installation paths, or application routes that accept an arbitrary outbound URL.

## Findings

| ID | Severity | Component | Attack prerequisite | Impact | Evidence | Remediation | Status |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P8-01 | High | Proxy redirects | Send an unexpected `Host` or forwarded host | Phishing/open redirect and poisoned links | Reproduced in code review; regression expects `421` and a configured-origin redirect | Exact production host allowlist; redirects use configured origin; forwarded host/protocol ignored | Fixed and tested |
| P8-02 | High | Proxy client IP | Supply a trusted-looking client-IP header directly | Rate-limit and audit attribution bypass | Trust path previously lacked a proxy/CIDR gate | Header trust now requires sanitized ingress mode and approved proxy CIDRs | Fixed and tested |
| P8-03 | High | Session management | Steal or retain a valid session | Longer unauthorized access and sensitive admin action | Sessions previously rolled for eight hours without app idle timeout or recent-login checks | Fixed absolute expiry, 30-minute idle timeout, session inventory/revocation, recent login for privileged operations | Fixed and tested |
| P8-04 | High | Workbook parser | Submit a crafted archive | Memory/CPU exhaustion or unsafe workbook processing | Parser lacked entry, compression-ratio, column, cell, and shared-string ceilings | Added ZIP signature and structural/resource limits; macros, external references, traversal, DTD/entity content remain blocked | Fixed and tested |
| P8-05 | Medium | Notification links | Store a scheme-relative or control-character path | Redirect outside the application | Existing database rule allowed more than a single safe internal path | Shared path validator, database constraint, and migration cleanup | Fixed and tested |
| P8-06 | High | PostgreSQL runtime identity | Obtain runtime database credentials or SQL execution | Schema/role/OS escalation and audit deletion | Prior docs did not enforce a tested runtime role | Runtime role SQL and a 12-case database privilege acceptance test | Fixed in repository; staging role grant pending |
| P8-07 | High | Container/network defaults | Start example Compose files on a networked host | Accidental public app or database port | Development Compose did not bind explicitly to loopback | Development ports bind to `127.0.0.1`; production example publishes neither app nor DB directly | Fixed in repository; staging ACL proof pending |
| P8-08 | Medium | Container runtime | Compromise application process | Write application files, add capabilities, persist in image layer | Runtime previously included a broader install layout | Standalone non-root image; production example uses read-only root, tmpfs, no capabilities, no-new-privileges | Fixed in repository; runtime proof pending |
| P8-09 | Medium | Dependency intake | Change resolution or add lifecycle code | Malicious build/runtime code | CI used mutable action tags; lock provenance was not enforced | Commit-pinned actions, exact direct versions, SHA-512 registry check, reviewed script allowlist, SBOM, Trivy job | Fixed; local image scan unavailable |
| P8-10 | Medium | Password policy | Choose a common long password | Easier credential guessing | Length check alone accepted common long passwords | Local 3,000-entry policy-compatible corpus check, no external lookup | Fixed and tested |
| P8-11 | High | VPN/public exposure | Reach staging from outside approved VPN | Public attack surface and possible credential attacks | No production network is available from this workstation | IT must prove private DNS, private ingress, origin lockdown, and outside-VPN blocking | Infrastructure-dependent; deployment blocker |
| P8-12 | High | Authentication strength | Steal a privileged password | Admin access with one factor | Local authentication is password-only | Connect corporate OIDC/SSO with MFA or obtain a documented security exception with equivalent controls | Infrastructure-dependent; deployment blocker |
| P8-13 | High | Data transport/storage | Control or observe infrastructure path/storage | Credential or operational-data disclosure | Production TLS, DB TLS, disk encryption, and backup encryption are outside the repo | IT validation checklist requires approved TLS and encryption evidence | Infrastructure-dependent; deployment blocker |
| P8-14 | Medium | Egress and detection | Compromise app process | Data exfiltration and reduced incident visibility | Repository cannot enforce the hosting network or SIEM | Deny-by-default egress and immutable centralized security logs | Infrastructure-dependent |
| P8-15 | Medium | Development dependency | Expose the obsolete esbuild development server to a hostile origin | Development response exposure | `npm audit` traces four moderate advisories through `drizzle-kit`; production dependency audit is clean | Keep development local/private; do not ship dev packages; update Drizzle Kit when its chain is fixed | Accepted development-only risk; tracked |

No open Critical or High repository-remediable finding remains. P8-11 through P8-13 block production until IT records staging evidence.

## Required attack matrices

### VPN

| Scenario | Expected | Local status |
| --- | --- | --- |
| Internet to application hostname/origin/health/metrics/auth/API | BLOCKED | Not locally testable; staging blocker |
| VPN to application | REACHABLE | Not locally testable |
| VPN plus anonymous to protected page | AUTH REQUIRED | Application control passed; VPN path pending |
| VPN plus valid URA user to URA resource | PASS | Application control passed; VPN path pending |
| VPN plus URA user to admin resource | BLOCKED | Application control passed; VPN path pending |
| VPN plus admin to admin resource | PASS | Application control passed; VPN path pending |
| VPN client to PostgreSQL | BLOCKED unless approved | Staging blocker |
| Application to PostgreSQL | PASS | Local test passed; staging pending |
| Public to PostgreSQL | BLOCKED | Staging blocker |

### Application

| Attack | Expected | Evidence |
| --- | --- | --- |
| SQL/PostGIS injection | BLOCKED | Parameterized queries, strict numeric/enum schemas, hostile search test |
| OS command injection | BLOCKED | No user input reaches process execution; static scan |
| Stored/reflected XSS | BLOCKED | React escaping, no raw HTML API, nonce CSP, hostile search test |
| CSRF/CORS/open redirect/Host poisoning | BLOCKED | Exact origin/host enforcement and hostile request tests |
| IDOR/role escalation/mass assignment | BLOCKED | Ownership predicates, permission matrix, strict schemas, dynamic tests |
| SSRF to local/internal targets | BLOCKED | No arbitrary outbound URL feature; safe internal-path allowlist |
| Traversal/macro/ZIP bomb/workbook execution | BLOCKED | Workbook parser unit and acceptance tests |
| Oversized request/resource exhaustion | BLOCKED | Proxy, JSON, workbook, query, and pagination limits |
| Session fixation/revoked-session reuse/proxy-IP spoofing | BLOCKED | Dynamic security acceptance |
| Unauthorized metrics/migration/job execution | BLOCKED | Token/permission checks and dynamic acceptance |

### Supply chain

| Threat | Expected | Status |
| --- | --- | --- |
| Unlocked direct dependency | NOT PRESENT | Pass |
| Unexpected lifecycle script | REVIEWED/BLOCKED | Five exact entries allowlisted; any change fails CI |
| Critical/High production advisory | NONE | Pass |
| Secret in repository/build output | NONE | Repository scan passes; final artifact/container evidence pending |
| Lockfile tampering | DETECTABLE | Registry and SHA-512 audit passes |
| Critical container vulnerability | NONE UNMITIGATED | CI gate configured; local Docker unavailable |
| Broad CI token permissions | NOT PRESENT | Read-only default permissions |
| Untrusted change gets deployment secrets | BLOCKED | Workflow has no deployment secrets; environment protections remain IT-owned |

### Database compromise

| Attempt | Expected | Local result |
| --- | --- | --- |
| Public or ordinary VPN client connects | BLOCKED | Staging blocker |
| Runtime creates role/extension/table or alters schema | BLOCKED | Pass |
| Runtime reads server files or runs OS program | BLOCKED | Pass |
| Runtime updates/deletes audit history | BLOCKED | Pass |
| SQL input changes query structure | BLOCKED | Pass |
