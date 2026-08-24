# Product UX audit

Audit date: August 21, 2026  
Baseline: `39bf76d`  
Coverage: sign-in, dashboard, navigation, provider search, authorization summary, new call, call log, review queue, facilities, reports, administration, forbidden and not-found states across all four roles.

The audit was run against the local demo environment. Current-state screenshots are stored in the ignored working directory at `work/phase3-audit/current/` so they do not add browser artifacts to the public source tree.

## Critical

### Role workspaces did not match permissions

Report viewers and auditors landed on the same operations dashboard as URA staff. The page contained links to routes those roles could not open. Auditors had no Audit item in navigation and `/audit` returned a 404 even though the role has `audit:read` permission.

Resolution: give each role a focused landing view, add a protected audit route, add Audit to the correct navigation, and keep the existing server-side permission checks in place.

### Core workflows were static or unavailable

Authorization Summary displayed a hard-coded record and New Call displayed a disabled sample form. Neither screen could complete a task. The review queue also used buttons with no action.

Resolution: replace the static authorization summary with an owner-scoped record list and a working update form backed by the existing secured authorization API. Remove unavailable call capture from primary navigation, redirect the old New Call URL to Authorizations, and replace dead review actions with real record links.

### Administration did not expose the secured account workflow

The Phase 2 account APIs worked, but the admin page only showed demo import status. Administrators could not create an account, change a role, or activate/deactivate an account through the product.

Resolution: add a database-backed user table and deliberate account controls that use the existing protected APIs and surface self-change and last-administrator safeguards.

## High

### Operational tables had no working controls

Call Log and Facilities had no search, filter, sort, result count, or clear action. Review Queue did not let a user open a record.

Resolution: add visible GET-based search and filters, active-filter counts, clear links, useful result counts, stable table headings, and working record links.

### Report numbers lacked context

Reports did not show a period, source scope, generated time, or denominator. Change badges implied comparison behavior without explaining it, and there were no date controls.

Resolution: add working date-range controls, clear/reset behavior, a plain-language scope note, and an exact generated timestamp. Remove unsupported comparison claims.

### Provider result states were misleading

Every acceptance badge used the same positive treatment, including “No current openings.” Results repeated the same recommendation as both outcome and next step, and the page did not explain why a result matched.

Resolution: use explicit positive, negative, unknown, and stale treatments; show match details and verification recency when available; and add a real zero-results state.

### Validation and feedback were too generic

Search validation appeared as a page-level message without field association. Sign-in submitted empty fields to the server instead of catching basic client errors first. Successful mutations had no product UI because the workflows were missing.

Resolution: associate errors with controls, preserve form values, announce pending/error/success states, and return focus to the affected control or message.

## Medium

- Page headings used repeated card wrappers and widely tracked eyebrow text, adding visual noise without helping orientation.
- Raw ISO dates were used in tables while other screens used relative language.
- Data tables needed clearer contained overflow and sticky headings for longer result sets.
- The drawer handled Escape and focus return, but needed a full keyboard focus loop and a visible role label.
- The application had no skip link for repeated keyboard navigation.

## Polish

- Standardize button, input, badge, table, empty-state, and message styles.
- Tighten desktop spacing while keeping controls easy to use on a standard work computer.
- Use sentence case consistently and remove duplicated helper copy.
- Keep status meaning in text and shape, not color alone.

## Evidence inventory

The current-state capture includes:

1. Sign-in and invalid credentials
2. Admin dashboard and open navigation
3. Disabled New Call workflow
4. Static Authorization Summary
5. Provider Search
6. Call Log table
7. Reports
8. Admin overview
9. Missing Audit route
10. Report Viewer navigation
11. Forbidden route
12. Auditor navigation
13. URA navigation
14. Review Queue
15. Facilities table

Final-state captures and the Figma handoff are produced after implementation verification so they remain faithful to the application.
