# Identity integration

## Current decision

The application currently uses Better Auth email/password accounts, database sessions, fixed session limits, server-side roles, and disabled public registration. Corporate identity and MFA have not been selected or configured. That decision belongs to the company identity and security owners and blocks the production pilot.

No identity provider was added speculatively. An integration cannot be reviewed safely without an approved issuer, client registration, claims, MFA rule, lifecycle source, and account-linking decision.

## Decision record required from IT

Choose and approve one production model:

1. existing application accounts with an approved supported MFA mechanism;
2. corporate OIDC sign-in with MFA enforced by the identity provider;
3. another documented enterprise identity pattern.

Record:

- identity owner and security approver;
- provider product and supported protocol;
- exact issuer/discovery URL and tenant boundary;
- exact redirect URI;
- client type and credential storage/rotation;
- required scopes;
- immutable subject claim and issuer behavior;
- verified email/display-name claims;
- MFA policy and the accepted `acr`, `amr`, and `auth_time` evidence;
- disabled-user and employment-termination behavior;
- group ownership and whether any group is allowed to affect access;
- recovery and break-glass policy;
- whether local password sign-in remains allowed after cutover.

Do not put tenant values or client credentials in this document or Git.

## Stable account mapping

Provider Tracker user IDs and roles stay authoritative inside the application. If OIDC is selected, the stable external key is the approved issuer plus the provider's immutable subject. Link that key to one existing Provider Tracker user ID.

Email is useful for a reviewed migration match, but it is not the permanent identity key. Before enabling sign-in:

1. export the active Provider Tracker users needed for the pilot;
2. obtain the authorized corporate identity list;
3. match each employee to exactly one application user;
4. resolve name or email conflicts manually;
5. create the approved provider-account link;
6. test the link with a staging account;
7. confirm the existing role, ownership, audit actor, and history stay on the same application user ID.

Do not create a second user when an existing employee begins using corporate sign-in. Do not create users or assign roles solely from an unreviewed email domain or client-supplied claim.

## Role rules

The application roles remain `ura_user`, `report_viewer`, `auditor`, and `admin`. Corporate groups may be used only if identity/security owns them and the mapping is explicitly approved. Otherwise, an administrator assigns the application role after the identity link exists.

Role changes, deactivation, and identity unlinking must revoke active application sessions. A corporate user who is valid at the provider but inactive in Provider Tracker stays blocked.

## MFA acceptance

At minimum, MFA is mandatory for administrators, migration operators, and other security-sensitive privileged access. Prefer provider-enforced phishing-resistant MFA when the corporate platform supports it.

Test each case:

| Scenario | Expected |
| --- | --- |
| Unknown identity | Blocked |
| Disabled corporate identity | Blocked |
| Inactive Provider Tracker user | Blocked |
| Missing required MFA | Blocked before an application session is usable |
| Invalid or expired challenge | Blocked |
| Replayed authorization response | Blocked |
| Wrong issuer, audience, signature, state, nonce, or redirect | Blocked |
| Valid identity without an approved application link | Blocked |
| Linked user with approved MFA | Application session created |
| Client-side role change | Ignored/blocked |
| Role or activation change during a session | Session revoked |
| Privileged action after the recent-login window | Reauthentication required |

Retain the provider policy, sanitized authentication record, application audit event, test time, tester, and approver for each result.

## Authentication path cutover

Keep the working local path during staging integration. Disable it in production only after corporate sign-in, recovery, account linking, MFA, disablement, and rollback have passed. A local break-glass account is allowed only under a written security policy with vault custody, MFA where supported, use alerts, session revocation, and a test schedule.

Public registration, temporary review accounts, shared credentials, and development sign-in paths remain prohibited.
