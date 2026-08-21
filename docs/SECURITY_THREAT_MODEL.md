# Security threat model

## Scope and assets

The system protects provider availability, facility contacts, authorization records, follow-up work, migration data, user credentials, sessions, audit history, database credentials, backups, and release artifacts. The repository has no production network, certificate, secret store, or backup destination, so those controls are requirements rather than verified facts.

## Trust boundaries

```text
Public internet -- no route allowed -- [company VPN boundary]
                                           |
                                     private DNS
                                           |
                              [internal TLS ingress boundary]
                                           |
                         Next.js proxy and route handlers
                                           |
                          Better Auth -> RBAC -> services
                                           |
                              [database network boundary]
                                           |
                   restricted runtime PostgreSQL identity
                                           |
                            private PostgreSQL/PostGIS

Separate paths:
  approved scheduler -> allowlisted job command -> database
  release operator -> migration identity -> database schema
  backup service -> read/backup identity -> encrypted storage
  app stdout/metrics -> protected collector -> immutable log/SIEM store
  secret manager -> app, migration, backup, and scheduler identities
```

The browser is untrusted. VPN membership establishes network reachability only. It does not authenticate a user or grant a role.

## Threat actors

- An unauthenticated internet user searching for the hostname or origin.
- A VPN user without an application account.
- A normal user changing IDs, methods, bodies, origins, and headers.
- A user or administrator whose credentials or session were stolen.
- A malicious or careless administrator, DBA, release operator, or scheduler operator.
- A compromised dependency, CI job, image, application process, or runtime database credential.
- A person supplying a deliberately malformed workbook.

## STRIDE review

| Threat | Abuse case | Main controls | Remaining exposure |
| --- | --- | --- | --- |
| Spoofing | Forge session, client IP, origin, host, or identity-provider assertion | Opaque database sessions, exact origin/host checks, trusted proxy CIDRs, session rotation, signed IdP assertion requirement | Corporate IdP/MFA and ingress sanitation need staging proof |
| Tampering | Change another user's record, audit row, migration, dependency, or image | Server RBAC and ownership, optimistic versions, audit append-only runtime grants, lock integrity, pinned actions, immutable image process | CI branch protection, image signing, and immutable log store are IT-owned |
| Repudiation | Deny an admin, migration, merge, or session-revocation action | Structured audit events, request IDs, actor IDs, timestamps, HMAC identifiers, audit integrity check | Off-host retention and clock/source validation are IT-owned |
| Information disclosure | Read other users' data, logs, health details, secrets, backups, or source maps | Ownership predicates, response field selection, redaction, minimal probes, no browser secrets, production source maps off | Egress, TLS, storage encryption, and backup ACLs require staging evidence |
| Denial of service | Password spray, huge body, ZIP bomb, wide search, job flood, connection exhaustion | Database rate limits, size/row/ratio ceilings, pagination, pool bounds, job locks, readiness and graceful shutdown | Edge rate controls and capacity testing are IT-owned |
| Elevation of privilege | Normal user calls admin/migration/job path; runtime DB user changes roles/schema or runs OS code | Permission checks at route and service layers, recent login, separate DB identities, dangerous grants blocked | Admin MFA and privileged infrastructure access remain IT-owned |

## Compromise blast radius

| Compromise | Attacker can do | Limits | Next containment step |
| --- | --- | --- | --- |
| Browser | Read and act as the signed-in user while the session is valid | HttpOnly cookie, CSP, same-origin mutation checks, role and ownership rules, no browser secrets | Revoke session; reset credential if needed |
| Normal account | Access normal operational features and that user's private authorization records | Cannot administer users, migrate, merge, bulk assign, configure/run automation, or read another user's private rows | Disable account; revoke sessions; review audit trail |
| Admin account | Use supported admin functions and view operational data | Recent login on privileged actions, no schema/OS/database-role rights, audit events | Disable account and revoke sessions; rotate credentials; inspect admin events |
| Application process | Read runtime environment, call allowed network destinations, and use runtime database grants | Non-root/read-only container, no capabilities/socket, no schema/role/OS DB privileges, audit history not mutable | Isolate workload, revoke runtime secret and auth secret, block egress, replace image |
| CI/build | Alter an artifact if review and environment controls fail | Pinned actions, lock/script checks, SBOM and scanner, no deployment secrets in current workflow | Disable pipeline, revoke CI credentials, discard artifacts, and create a new artifact from the reviewed commit |
| Runtime DB credential | Read/write application tables and insert/read audit rows | Cannot manage roles/databases/extensions/schema, access server files, execute programs, or update/delete audit history | Revoke/rotate role; terminate sessions; examine DB and application logs |

If runtime egress is unrestricted, application-process compromise can still exfiltrate accessible data. Deny-by-default egress is therefore a staging requirement, not an optional improvement.

## Security assumptions that must be proved

- The application hostname and origin have no usable public route.
- PostgreSQL has no public listener or public firewall path.
- The proxy strips and replaces forwarding and client-IP headers.
- TLS is enforced for browser-to-ingress and app-to-database traffic.
- Secrets come from an approved store and are independently rotatable.
- Logs leave the runtime and cannot be altered by the application identity.
- Backups are encrypted, access-controlled, and restore-tested.
- Corporate SSO/OIDC enforces MFA for application and privileged access.

Any failed assumption above blocks production.
