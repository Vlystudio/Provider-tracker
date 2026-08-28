# HIPAA technical readiness gap map

Last reviewed: 2026-08-22

## Applicability statement

Provider Tracker is PHI-capable because authorization identifiers, member ZIP, diagnosis data, and free text can be linked to an individual. Whether the organization is a HIPAA covered entity or business associate, and whether a specific use contains ePHI, must be decided by authorized privacy/legal staff.

This is a technical mapping, not a claim of HIPAA compliance or certification.

The current HHS Security Rule protects ePHI created, received, maintained, or transmitted by regulated entities and requires administrative, physical, and technical safeguards. See the [HHS Security Rule](https://www.hhs.gov/hipaa/for-professionals/security/index.html), the [current HHS Security Rule summary](https://www.hhs.gov/hipaa/for-professionals/security/laws-regulations/index.html), and [NIST SP 800-66 Rev. 2](https://csrc.nist.gov/pubs/sp/800/66/r2/final).

## Technical safeguard map

| Area | Application status | Repository evidence | External gap/owner |
| --- | --- | --- | --- |
| Unique user identification | Implemented for local accounts | UUID user, unique email, actor-attributed events | Corporate identifier/duplicate-linking rule: identity owner |
| Access control | Implemented at app/service layer | Central permissions, ownership queries, direct-request tests | Final role/job mapping and IdP groups: operations/identity |
| Emergency access/revocation | Implemented for revocation; emergency clinical access not established as applicable | Emergency revoke, session invalidation, runbook | Organization must decide any emergency-access procedure |
| Automatic logoff/session control | Implemented | Absolute and idle timeouts, touch interval, revoked/expired tests | Production value approval and IdP session alignment |
| Authentication | Implemented locally; corporate path pending | Password policy, scrypt hash, secure cookies, rate limit, enumeration controls | Corporate OIDC/MFA, issuer/claim testing: identity owner |
| Audit controls | Implemented application-side | Authentication, denial, change, export, migration, access-review, retention, investigation events | Central log collection/retention and DB audit logs: IT |
| Audit integrity | Strong application/runtime control | Runtime role cannot update/delete audit table; integrity command | Database-owner/superuser and immutable external sink controls |
| Integrity of operational history | Implemented in key workflows | Immutable verification/contact/merge/migration events, constraints, optimistic locks | Approved correction procedure/data stewardship |
| Transmission security | Required by configuration, not locally proved | HTTPS-only production auth URL, HSTS, private-VPN assertion | TLS termination, database TLS, VPN/private DNS/origin block validation |
| Data at rest | Infrastructure-dependent | Secrets excluded from source/logs; password hashing | Disk/backup encryption, key management, token-encryption decision |
| Person/entity authentication | Application implemented, enterprise pending | Better Auth sessions and recent-login checks | IdP MFA, lifecycle, conditional access |
| Minimum necessary | Technical controls implemented; policy pending | Role/data matrix, field exposure, scoped APIs/exports | Approved purposes and workforce policy: privacy/operations |
| Security incident procedures | Application tooling implemented | Security timeline, account report, holds, revocation, breach runbook | Incident team, counsel, notification procedure, evidence stores |
| Contingency/availability | Application guidance present | Health/readiness endpoints, backup/restore scripts | Managed backup, DR target, restore exercise, downtime process |
| Risk analysis/management | Not an application certification | Threat/security/privacy assessments in repository | Formal organization-wide risk assessment and treatment plan |
| Workforce security/training | Not application-controlled | Access review/revocation support | Screening, training, sanctions, termination process |
| Facility/workstation/media controls | Not application-controlled | No persistent browser storage; no public exports | Endpoint, print, removable media, device disposal, physical access |
| Business associate/vendor controls | Inventory only | Third-party data-flow inventory | Contract/BAA/vendor review and evidence |

## Privacy/minimum-necessary note

HHS states that covered entities generally must make reasonable efforts to limit PHI use, disclosure, and requests to the minimum necessary for the intended purpose, subject to rule exceptions. The application supports role/ownership limits, aggregate report access, field-limited exports, and data minimization. The organization must define the permitted purpose and approve which fields each workforce role needs. See the [HHS minimum necessary guidance](https://www.hhs.gov/hipaa/for-professionals/privacy/guidance/minimum-necessary-requirement/index.html).

## Known blockers before PHI use

- Formal HIPAA/privacy applicability decision and risk analysis.
- Approved minimum-necessary role/field policy.
- Corporate identity, MFA, termination, and claim-mapping validation.
- VPN/private DNS/direct-origin and TLS proof.
- PostgreSQL/PostGIS staging with restricted roles and encryption evidence.
- Managed encrypted backups, expiry, restore, and incident-hold procedure.
- Centralized application/proxy/IdP/database logging and retention.
- Vendor/BAA review for every service receiving ePHI.
- Workforce training, sanctions, export/print/shared-device policy.
- Real UAT using approved synthetic or de-identified data until authorization for real data exists.

Production with PHI remains blocked until the authorized owners close or formally accept these gaps.
