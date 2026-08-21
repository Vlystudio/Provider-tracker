# Security infrastructure handoff

Production is allowed only after every blocking row has dated evidence and an owner approval. Repository settings do not prove a VPN, firewall, certificate, private database, vault, log collector, or encrypted backup.

Phase 9 evidence is recorded outside Git. Create the full blank gate list with `npm run phase9:status -- --template > work/phase9-evidence.json`, attach dated evidence and approvers, then evaluate it with `npm run phase9:status -- --file work/phase9-evidence.json`. The evaluator cannot approve a gate that lacks availability/configuration/testability fields, dated evidence, and an approver.

## Required topology

```text
Internet: no application or database route
                         X
Company-managed device -> company VPN -> private DNS -> internal TLS ingress
                                                     -> Next.js application
                                                        -> Better Auth session
                                                        -> server RBAC/services
                                                        -> restricted runtime DB identity
                                                        -> private PostgreSQL/PostGIS

Secret manager -> application, migration, backup, scheduler (separate identities)
Scheduler private runner -> allowlisted application job command
Migration runner -> migration DB identity
Backup runner -> backup DB identity -> encrypted immutable backup store
Application logs/metrics -> private collector -> access-controlled immutable SIEM
```

Required access order: company VPN connection, then Provider Tracker authentication, then server-side authorization.

## Deployment gates

| Owner | Requirement | Validation and retained evidence | Blocks production |
| --- | --- | --- | --- |
| Network | No public application route | From two approved outside-VPN networks, run `PUBLIC_PROBE_BASE_URL=https://<private-name> PUBLIC_PROBE_CONFIRM_OUTSIDE_VPN=YES npm run test:public-exposure`; retain JSON, source IP/network, DNS result, timestamp. Any HTTP response is a failure. | Yes |
| Network | No direct origin bypass | Probe every load-balancer/origin IP and hostname with expected and hostile Host/SNI values from outside VPN. Packet capture/firewall logs must show denial, not an application `401`. | Yes |
| Network/DNS | Private DNS only | Outside VPN: name absent or resolves only to an unreachable private address. On VPN: name resolves to approved private ingress. Retain `Resolve-DnsName`/resolver logs. | Yes |
| Network | VPN route works but does not authenticate | On VPN, sign-in page reachable; protected page redirects to sign-in; valid user gets only role-authorized data. | Yes |
| Ingress | TLS for every app request | Scanner and browser proof of approved certificate, name, chain, expiry, TLS 1.2/1.3, HTTP disabled or internal redirect only, HSTS present. | Yes |
| Ingress | Origin/forwarded-header sanitation | Strip client `Forwarded`, `X-Forwarded-*`, `X-Real-IP`, and request-ID headers; replace with ingress values. Send duplicates, conflicting lengths, invalid chunks, absolute-form targets, hostile Host, and HTTP/2-to-1 downgrade cases. Expected: proxy rejects or app returns safe `4xx`; never route/smuggle. Record proxy product/version/config. | Yes |
| Ingress | Request limits and edge abuse controls | Set body/header/time/rate/concurrency limits at least as strict as documented app limits; load-test login, search, report and workbook preview without bypassing app correctness. | Yes |
| Identity/Security | Corporate OIDC/SSO with MFA | Validate issuer/audience/signature/nonce/state/PKCE, exact redirect URI, replay rejection, account linking, group/role mapping, disabled-user behavior, `acr`/`amr`/`auth_time`, admin MFA and recovery. Keep local auth disabled or formally approved as break-glass only. | Yes |
| Database/Network | PostgreSQL never public or directly reachable by ordinary VPN users | Outside VPN and from ordinary VPN client, TCP probe to DB host/port must fail. From app subnet it succeeds; migration and backup runners succeed only during approved paths. Retain firewall flow logs. | Yes |
| DBA | Separate DB identities and least privilege | Apply/adapt `config/postgres/runtime-role.sql`; run `npm run test:database-security` against disposable staging. Runtime cannot create roles/extensions/schema, access server files/programs, or mutate audit history. | Yes |
| DBA | Database TLS and certificate validation | Require TLS from app/migration/backup; validate CA and hostname; reject plaintext and an untrusted certificate. Record `sslmode` policy and server settings. | Yes |
| Platform/Security | Approved secret store and independent rotation | Inject app auth secret, audit HMAC salt, DB identities, metrics token, IdP secret, and backup secret at runtime. No secret in image, source, CI log, browser, or support bundle. Document access and rotation. | Yes |
| Platform/Network | Deny-by-default runtime egress | Permit only private PostgreSQL, approved DNS/NTP, log/metric collector, and explicitly approved IdP endpoints. Prove arbitrary public IP/domain and metadata-service access fail. | Yes |
| Platform | Hardened container/workload | Read-only root, dedicated tmpfs, UID 10001/non-root, no capabilities, no-new-privileges, PID/memory/CPU limits, no host mounts or runtime socket. Retain platform manifest and runtime inspection. | Yes |
| Release/Security | Image and artifact integrity | Build reviewed commit; retain image digest, CycloneDX SBOM, High/Critical scan result, provenance and signature. Admission must reject unsigned/unapproved digest. | Yes |
| Logging/Security | Off-host immutable security logs and alerts | Send stdout/audit/ingress/IdP/DB events to an access-controlled store the app identity cannot alter. Test alert delivery and time sync. | Yes |
| Backup/DBA | Encrypted protected backups and proven restore | Encrypt in transit/at rest, separate backup identity, immutable retention, access logging. Restore latest approved artifact into isolated staging and run restore acceptance. | Yes |
| Security | Staging penetration-test environment | Production-equivalent ingress, identity, database roles, secrets integration, image policy, logging, egress, and test data. Authorize DAST/manual testing and retain report/remediation. | Yes |
| Operations | Monitoring and capacity | Alert on public-route change, auth spray, repeated denials, admin/session/migration actions, audit failures, 5xx, latency, pool pressure, job failure, backup failure, secret/cert expiry, image/advisory changes. | Yes |

## Outside-VPN exposure test

Run only from an authorized system that is definitely outside the company VPN:

```powershell
$env:PUBLIC_PROBE_BASE_URL='https://provider-tracker.internal.example'
$env:PUBLIC_PROBE_CONFIRM_OUTSIDE_VPN='YES'
$env:PUBLIC_PROBE_DATABASE_HOST='provider-db.internal.example'
$env:PUBLIC_PROBE_DATABASE_PORT='5432'
npm run test:public-exposure
```

Add `PUBLIC_PROBE_ADDITIONAL_BASE_URLS`, `PUBLIC_PROBE_ORIGIN_TARGETS`, and `PUBLIC_PROBE_APPLICATION_HOSTNAME` so every alternate hostname and direct origin is covered. The command tests pages, authentication, health, readiness, session, metrics, user/admin APIs, direct origins, and the optional database TCP endpoint. DNS is recorded as an observation. Any HTTP response, direct-origin application response, or database TCP connection is `EXPOSED` and fails. An application `401`, `403`, `404`, or redirect is still public reachability and is therefore a failure.

Also probe the origin directly, not just the friendly hostname. Repeat from more than one external network. Save the exact command environment without secrets, output, tester, source network, date, ingress/firewall logs, and final approval.

## On-VPN and internal segmentation tests

Start with the ordinary-client check in `NETWORK_SECURITY_VALIDATION.md` (`npm run test:staging-network`), then:

1. Connect through the approved VPN and resolve the private name.
2. Confirm the sign-in page is reachable over valid HTTPS.
3. Confirm an anonymous request to a protected page requires authentication.
4. Confirm a valid URA account can use URA routes and receives `403`/safe denial on admin routes.
5. Confirm an administrator with MFA can use approved admin routes and recent-login checks.
6. From an ordinary VPN client, attempt TCP access to PostgreSQL; it must fail.
7. From the application workload, connect with the runtime identity and run application smoke/security checks.
8. From migration and backup runners, confirm only their required access. Confirm other subnets/identities fail.
9. Record open listeners on every workload. Expected app-facing listener is only the private ingress path; PostgreSQL listens only on the private database interface/security group.

## Proxy trust configuration

Set `NETWORK_ACCESS_MODE=private-vpn` and `PROXY_TRUST_MODE=sanitized-ingress` only after the ingress tests pass. `AUTH_TRUSTED_PROXY_CIDRS` must contain only addresses/subnets that can originate from the approved proxy tier. Set `AUTH_CLIENT_IP_HEADER` only to the header the proxy overwrites. Do not allow clients to reach the application port around the proxy.

The application rejects an unexpected production Host with `421`, ignores forwarded host/protocol, and uses the configured public origin for redirects. These are defense-in-depth controls, not substitutes for origin firewall rules.

## Credential rotation drill

Use disposable staging credentials. Never rotate production credentials as part of a test without an approved change.

| Credential | Drill |
| --- | --- |
| Runtime database password | Create new vault version; update DB role; restart one staging instance with new version; verify readiness/security; replace remaining instances; terminate old DB sessions; revoke old value; verify old connection fails. |
| Better Auth secret | Review Better Auth rotation behavior for the deployed version. If existing sessions cannot span secrets, schedule a forced global logout; load new vault version, restart all instances, verify old sessions fail and new sign-in succeeds. |
| Audit HMAC salt | Rotation changes future HMAC identifiers and can break historical correlation. Record a versioned cutover date; preserve the prior salt only in restricted forensic custody for the approved retention window; never rewrite audit history. |
| Metrics token | Add new collector secret and application version, verify collection, remove old version, prove old bearer token returns `404`. |
| IdP client secret/certificate | Follow IdP dual-key overlap if available; verify issuer/audience/signature and MFA claims; revoke old credential after all workloads use the new one. |
| Backup credential/key | Rotate in the approved store; create and restore a new encrypted backup; preserve access to retained backups according to key escrow policy. |

## Alerts to configure and exercise

- public firewall or DNS exposure change;
- repeated failed sign-ins, distributed spraying, or rate-limit events;
- authorization denials and object-ownership failures above baseline;
- user disable/role/password/session changes, especially administrator targets;
- migration preview/apply/reverse and manual job runs;
- runtime-role permission violations and unusual DB reads/exports;
- audit integrity failure, logging gap, collector lag, or clock skew;
- unexpected egress, metadata-service attempt, shell/process anomaly, or write outside approved temp paths;
- new Critical/High dependency or image finding, signature failure, or unapproved digest;
- backup/restore failure and secret/certificate expiry.

Each alert test records trigger, expected owner, delivery time, ticket, containment decision, and closure.

## Hard blockers

Do not deploy when any of these is true:

1. Application is reachable without VPN.
2. Direct origin bypass exists.
3. PostgreSQL is publicly or ordinarily VPN-client reachable.
4. A Critical/High authentication bypass remains.
5. A Critical/High authorization bypass remains.
6. SQL injection is confirmed.
7. OS command injection or untrusted code execution is confirmed.
8. A workbook can execute code.
9. A production secret is exposed to the browser, repository, image, or logs.
10. A Critical supply-chain finding is unresolved.
11. Runtime database identity has dangerous unnecessary privileges.
12. Security-critical staging acceptance is incomplete.

## Required final statement

VPN-ONLY ACCESS REQUIRES IT STAGING VALIDATION
