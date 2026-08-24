# Provider Tracker interface guide

This guide describes the interface that is implemented in the application. The application is the source of truth; design files and screenshots should follow it.

## Foundations

| Area | Standard |
| --- | --- |
| Font | Segoe UI, with Tahoma and Arial as system fallbacks |
| Page background | Cool gray (`slate-50`) |
| Main text | Near-black slate (`slate-950`) |
| Secondary text | `slate-600` |
| Border | `slate-300` for controls, `slate-200` for panels and rows |
| Main action | Solid navy (`slate-900`) |
| Focus | Visible blue ring with a light offset |
| Radius | 6px for panels and controls; pills only for compact statuses |
| Shadow | None on routine panels; the navigation drawer uses one light shadow |

The spacing scale is 4, 8, 12, 16, 20, 24, and 32px. Routine forms and tables use the tighter end of the scale. Page sections use 20–32px only when separation helps scanning.

## Type hierarchy

- Application name: 16px, semibold.
- Page title: 28px, bold.
- Section title: 18px, semibold.
- Body and form controls: 14px.
- Labels and table headers: 12–13px, semibold.
- Metadata and helper text: 12px.
- Errors: 13px, medium weight, with an error icon or explicit wording where needed.

Page titles stay short. Supporting copy explains the task in one sentence and avoids technical language.

## Surfaces and layout

- `panel` is the standard bordered white surface.
- `page-header` holds the area label, title, summary, and optional context.
- `filter-bar` contains search, filters, a results summary, reset, and submit actions.
- `table-shell` provides the bordered table container; `table-scroll` contains wide tables when a desktop window is reduced or zoomed.
- Navigation is a drawer, closed by default. It traps focus while open, closes with Escape, and returns focus to the menu button.
- Dialog-like interruptions are reserved for risky actions. Account deactivation uses an inline two-step confirmation so the affected account remains visible.

## Controls

Buttons, inputs, selects, date fields, and text areas share a 40px minimum control height and the same border, radius, focus ring, disabled treatment, and text size.

## Provider intelligence patterns

- Freshness always uses a text label with the badge; color is secondary.
- Search results show short match reasons in the row instead of an unexplained score.
- Facility history uses one chronological list for verification and contact activity.
- Partial verification forms state that omitted fields are unchanged.
- Failed contact forms state that verification freshness is not changed.
- Facility merge stays inside a collapsed danger section and requires the user to type `MERGE`.
- Data-quality totals link to the records behind the number.

Button use:

- Primary: one main action in a section.
- Secondary: safe supporting action.
- Quiet: navigation or low-emphasis action.
- Danger: confirmed destructive action only.

Forms use visible labels, nearby help text, inline validation, `aria-describedby` associations, and a disabled pending state. Failed submissions keep the entered values.

## Status language

Status badges combine text and color. Color is never the only signal.

| Meaning | Treatment | Example |
| --- | --- | --- |
| Positive | Green tint and explicit label | Active, Accepting, Success |
| Attention | Amber tint and explicit label | Pending, Needs attention, Stale |
| Negative | Red tint and explicit label | Inactive, Not accepting, Failed |
| Informational | Blue tint and explicit label | Open, In review |
| Unknown | Gray tint and explicit label | Unknown, Not verified |

Unknown, negative, and stale states remain distinct. Verification dates are shown whenever the source data contains them.

## Shared interface patterns

The reusable React patterns live in `src/components/ui.tsx` and the shared styles live in `src/app/globals.css`.

- `PageHeader`
- `StatusBadge`
- `InlineMessage`
- `EmptyState`
- `ResultsSummary`
- shared button variants
- shared form controls and help/error text
- shared filters and tables

## Desktop and accessibility rules

- The supported layout is a corporate desktop browser at 1366×768 or larger.
- Dense tables stay readable at the supported desktop sizes. A table may scroll inside its own container when the window is reduced or zoomed.
- The document itself must not scroll horizontally at supported desktop sizes.
- Phone and tablet layouts are outside the product support scope.
- Focus remains visible on links, controls, row actions, and the navigation drawer.
- A skip link is the first keyboard stop.
- Headings follow page title, section title, then subsection title order.
- Status and mutation feedback use live regions.
- Print output removes navigation and controls that do not belong in a report.
- Reduced-motion preferences disable nonessential transitions.
