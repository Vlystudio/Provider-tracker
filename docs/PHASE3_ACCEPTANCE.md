# Phase 3 acceptance record

Run date: August 21, 2026  
Browser: Chrome  
Data: isolated local demo mode plus a disposable PostgreSQL test database

## Workflow checks

| Role | Scenario | Result |
| --- | --- | --- |
| URA user | Sign in, open Authorizations, update a record, read persistent inline success, return to the list | Pass |
| URA user | Search providers, change filters and sort, see match details and verification age, reach a useful zero-result state | Pass |
| Report viewer | Sign in, see only Dashboard and Reports, set a date range, read total and denominators, clear the range | Pass |
| Report viewer | Open an operations URL directly | Redirected to Forbidden |
| Auditor | Sign in, see only Dashboard, Reports, and Audit; filter events by actor; read actor, target, result, and timestamp | Pass |
| Auditor | Open an authorization URL directly | Redirected to Forbidden |
| Administrator | Change a staff role, receive inline success, restore the original role | Pass |
| Administrator | Start account deactivation, read the affected account and consequence, cancel without changing the account | Pass |
| Administrator | Attempt to edit the current administrator account | Controls are disabled with an explanation |

The role-change check revoked the affected account’s active sessions as intended. Test fixture roles were restored after the check.

## Authentication and state checks

- Empty sign-in submission identifies the first invalid field and moves focus to it.
- Invalid credentials use a generic message and do not expose implementation details.
- Signed-out and session-required states have separate messages.
- Authorization save feedback remains visible after the request finishes.
- Failed and invalid form states keep entered values.
- Provider search distinguishes no match, not accepting, unknown, and stale verification states.
- Forbidden pages provide a route back to the user’s dashboard.
- Account deactivation requires a deliberate second action.

## Keyboard checks

- The skip link is the first Tab stop.
- The navigation drawer opens from the keyboard.
- Focus moves to Close menu when the drawer opens.
- Tab and Shift+Tab stay inside the open drawer.
- Escape closes the drawer and returns focus to Open menu.
- Forms, filter controls, row links, save actions, and confirmation controls are reachable in a logical order.
- Validation and mutation messages are announced with status or alert semantics.

## Responsive checks

| Viewport | Screen | Result |
| --- | --- | --- |
| 1920×1080 | Authorizations | No document overflow; detail and table remain readable |
| 1440×900 | Provider search | No document overflow; all filters and table columns remain usable |
| 1366×768 | Call log | Dense table remains readable; horizontal overflow stays inside the table container |
| 768×1024 | Authorizations | Filters and detail stack; table scrolls inside its container; no document overflow |

Print styles were inspected for reports and operational tables. Navigation, filter actions, and row actions are removed from printed output.

## Security regression

The 37-scenario production security matrix passed in full. It verifies anonymous access, CORS behavior, authenticated routes, owner scoping, cross-user mutation, mass assignment, body limits, route validation, unsupported methods, direct API bypass, admin boundaries, client-role tampering, CSRF, last-administrator protection, account provisioning, password reset and revocation, report-viewer boundaries, expired/revoked/logout sessions, malformed sessions, disabled users, brute-force limiting, deleted users, and audit events.

A separate live header check confirmed:

- Content Security Policy
- Referrer Policy
- MIME sniffing protection
- frame protection
- opener and resource isolation
- Permissions Policy
- anonymous `/admin` redirect to sign-in
- anonymous administrator mutation returns HTTP 403

## Engineering gate

| Check | Result |
| --- | --- |
| Regression and UI-focused tests | 51/51 passed across 11 files |
| Production security acceptance | 37/37 passed |
| ESLint | Passed, no warnings |
| TypeScript | Passed |
| Next.js production build | Passed; 17 routes generated |
| Production dependency audit | 0 vulnerabilities |
| Repository secret scan | Passed for 117 repository files and 5 existing commits |
| Diff whitespace check | Passed |
| Public-language check | No implementation-session or prior-version wording found |

## Figma and visual evidence

The Figma file and screen inventory are recorded in [FIGMA_HANDOFF.md](./FIGMA_HANDOFF.md). Four implemented screens were captured as editable layers before the Starter-plan Figma call limit was reached. Eleven representative application states, two role-specific dashboards, and four responsive references were captured locally for review.

No production credentials or real member information appear in the captures.
