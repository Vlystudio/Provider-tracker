# Figma handoff

The Phase 3 design file is [Provider Tracker — Phase 3 UX Handoff](https://www.figma.com/design/EIlEOhqddNczCVCRUc4aaw).

The file contains editable captures from the verified local application at 1440×900:

| Screen | Figma node | Coverage |
| --- | --- | --- |
| Authorizations | `2:2` | URA list, selected record, status, notes, save control |
| URA dashboard | `3:2` | Role-specific starting point and recent work |
| Provider search | `4:2` | Location and specialty filters, match reasons, verification age |
| Reports | `5:2` | Date range, total, denominator details, source, generated time |

The Starter-plan Figma call limit was reached after these four captures. The remaining screen/state inventory and behavior notes below complete the handoff without changing the implemented product. The application and the screenshots under `work/phase3-audit/final/` remain the visual source of truth.

## Screen and state inventory

| File | State |
| --- | --- |
| `01-sign-in.png` | Signed-out form |
| `02-validation-error.png` | Client validation and focus target |
| `03-dashboard.png` | URA dashboard |
| `04-authorization-workflow.png` | Selected authorization |
| `05-authorization-success.png` | Successful save feedback |
| `06-provider-search.png` | Search results |
| `07-data-table.png` | Call log table |
| `07-admin.png` | Account administration |
| `08-audit.png` | Audit log and filters |
| `09-reports.png` | Reporting range and denominators |
| `10-forbidden.png` | Forbidden route |
| `11-empty-state.png` | No matching provider results |
| `role-report-viewer.png` | Report-viewer dashboard |
| `role-auditor.png` | Auditor dashboard |

Responsive references cover 1920×1080, 1440×900, 1366×768, and 768×1024.

## Component inventory

The implemented components to reproduce or maintain in Figma are:

- App header and collapsible navigation drawer
- Page header and section header
- Primary, secondary, quiet, and danger buttons
- Text input, select, date input, and text area
- Field label, help text, and error text
- Filter bar, active-filter count, results count, reset action
- Status badge: positive, warning, negative, informational, and unknown
- Inline success, information, warning, and error messages
- Dense data table, row metadata, and row action
- Empty result state
- Account role editor and inline deactivation confirmation
- Report metric row with value and denominator

Foundations and measurements are in [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md).

## Role navigation

| Role | Navigation |
| --- | --- |
| Administrator | Dashboard; Provider Search; Facilities; Call Log; Authorizations; Review Queue; Reports; Audit; Administration |
| URA user | Dashboard; Provider Search; Facilities; Call Log; Authorizations; Review Queue; Reports |
| Report viewer | Dashboard; Reports |
| Auditor | Dashboard; Reports; Audit |

Navigation visibility is only a usability layer. Direct page and API access remain protected on the server.

## Behavior annotations

- The drawer is closed by default. Opening it moves focus to Close menu; Escape closes it and returns focus to Open menu.
- Tab and Shift+Tab loop inside the open drawer.
- The skip link is the first keyboard stop and moves focus to the main region.
- Filter values are visible in the URL, the active-filter count, and the control values. Reset clears only the current page filters.
- Tables keep their header and row semantics. At tablet width, the table scrolls inside its own container while the document stays fixed.
- Save and account actions disable duplicate submission and announce success or failure inline.
- Validation moves focus to the first invalid field and leaves entered values in place.
- Account deactivation requires a second deliberate action and states which account will lose access.
- Server-side permission checks remain authoritative even when a navigation item is hidden.
- Date-only values retain their source calendar date. Timestamps are displayed in Eastern Time.
- Print styles remove the app header, navigation controls, filter actions, and row action controls.

## Handoff rule

If the implementation changes, update the application first, verify the changed workflow, then refresh the affected Figma screen and screenshot. Do not use the Figma file to introduce controls or states that do not exist in the product.
