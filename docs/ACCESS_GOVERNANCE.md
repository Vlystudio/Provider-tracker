# Access governance

Last reviewed: 2026-08-22

## Role-to-data matrix

`Own` means creator/assignee/recipient scope is enforced by the service, not only by the page.

| Data/action | Administrator | URA user | Report viewer | Auditor |
| --- | --- | --- | --- | --- |
| Provider directory rows | Read/write | Read/write | No row access | No row access |
| Provider-row CSV | Authorized, bounded | Authorized, bounded | Blocked | Blocked |
| Authorizations | All rows; delete | Own rows; update | Blocked | Blocked |
| Verification/contact history | Read/write | Read/write | Aggregate report only | Audit event only |
| Assigned work | All operational scope | Own assigned work | Blocked | Blocked |
| Reports | Read/drilldown | Read/drilldown | Aggregate/approved drilldown | Read |
| Notifications/digests | Own recipient records | Own | Own | Own |
| Coverage watches | Manage/read | Read | Read | Blocked |
| User administration | Manage | Blocked | Blocked | Blocked |
| Access-review account list | Read/write decisions | Blocked | Blocked | Read-only |
| Emergency revocation | Manage | Blocked | Blocked | Blocked |
| Retention policies/holds | Manage | Blocked | Blocked | Read-only |
| Security investigation | Run | Blocked | Blocked | Run/read-only |
| Audit log | Read | Blocked | Blocked | Read |
| Audit mutation | Blocked by runtime DB privilege | Blocked | Blocked | Blocked |
| Automation configuration/run | Manage | Blocked | Blocked | Blocked |
| Migration preview/apply/reverse/export | Manage | Blocked | Blocked | Blocked |
| Database credentials/tokens | Never returned | Never returned | Never returned | Never returned |

Routes call a server permission check. Ownership checks are part of the database query for authorization, notification, session, and work-item records. A hidden link or direct API request does not grant access.

## Dormant account review

`GOVERNANCE_DORMANT_ACCOUNT_DAYS` controls the review flag. The default development value is 90 days; production must use the approved access policy. An active account is flagged when its last recorded sign-in—or its creation date if it has never signed in—is older than that value.

The flag does not disable the account. It gives the reviewer a list. Corporate identity status remains authoritative after OIDC is connected.

## Quarterly access certification

The governance page uses `YYYY-Qn` review periods. An administrator records one of:

- `retain`
- `modify`
- `disable`
- `investigate`

The record captures reviewer, reviewed account, role/status snapshot, last sign-in, decision, period, and time. It stores no narrative. The matching `access-review.decision` audit event stores the role and decision.

Recording `modify` or `disable` does not silently change the account. The authorized administrator must complete the role/status action in account administration or use emergency revocation. That separation prevents a report from becoming an automatic access-control engine.

Auditors can read review state but cannot submit decisions.

## Privileged review

Administrators are marked privileged. The review lists role assignment date when known, last sign-in, status, dormant state, latest decision, last security action, and a 90-day security-action count. Existing administrators receive a role-assignment baseline only after a recorded role change; the application does not invent a historical assignment date.

Review at least the following outside the application: corporate employment status, job need, MFA status, group membership, exception approvals, and separation of duties.

## Emergency revocation

Use the governance page or `POST /api/governance/users/{id}/emergency-revoke`.

The operation:

1. Requires `governance:manage` and a recent login.
2. Rejects self-revocation and removal of the last active administrator.
3. Disables the account.
4. Removes a privileged role by returning the account to `ura_user` while inactive.
5. Deletes every active session.
6. Counts open/assigned/in-progress/blocked work for manual reassignment review.
7. Writes `user.emergency-revoke` with prior role, prior status, session count, and work count.

Old session reuse is blocked. The operation does not reassign work.

## Employee departure

1. Disable the employee in the corporate identity provider when connected.
2. Run Provider Tracker emergency revocation.
3. Review open work and reassign under the operations owner’s rules.
4. Confirm privileged group removal at the identity provider.
5. Preserve audit/access-review evidence under the approved retention rule.
6. If compromise is suspected, place an incident hold and run the account investigation.

Upstream disablement, SCIM/deprovision events, group removal, and MFA enforcement remain identity-team work. They must be staging-tested before production.

## Acceptance checks

- Active, inactive, dormant, report-viewer, auditor, and admin accounts appear with role, status, and last sign-in.
- A human decision is saved and audited.
- URA, report-viewer, and auditor decision writes are blocked.
- Disabled users cannot create new sessions.
- Emergency revocation invalidates the old session and removes privilege.
- Session inventory never returns the session token, password, IP/HMAC, or user-agent value.
