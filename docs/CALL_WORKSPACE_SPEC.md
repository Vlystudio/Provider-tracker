# Call Workspace specification

## Purpose

Make manual provider calling faster and more reliable without integrating a phone system or introducing a patient/payer authorization number. The application-generated Tracking ID is the only workflow identifier shown to users.

## Non-negotiable constraints

- Calls happen outside Provider Tracker and are logged manually.
- No payer-issued authorization number, member name, date of birth, or other external patient identifier is collected.
- Every saved call remains queryable for the life of its retention period; there is no global display ceiling.
- Call creation, provider-history updates, contact attempts, and audit events remain atomic and retry-safe.
- Free text is optional and must not be required for routine outcomes.

## Primary user outcome

A staff member can open or start one tracking record, work through a provider list, record each call with minimal typing, see what has already been recorded, and finish after the workflow objective is met.

## Target workflow

1. Open an existing tracking record or start a new one.
2. Enter shared context once: line of business, member ZIP when approved, specialty, and diagnosis.
3. Search for candidate providers without leaving the workspace.
4. Select **Log call** on a provider. Facility, phone, and shared context are prefilled.
5. Explicitly select the contact outcome. No outcome is preselected.
6. Answer only questions that apply to that outcome.
7. Save with **Save & next provider**.
8. Review the saved-call timeline and progress toward two successful providers.
9. Select **Finish tracking record** when complete.

## Workspace structure

### Tracking header

- Tracking ID with a copy action.
- Status: Open, Complete, or Cancelled.
- Shared line of business, ZIP, specialty, and diagnosis.
- Progress: successful providers, calls recorded, and remaining objective.
- Actions: Save context, Finish, Cancel, Start new tracking record.

The Tracking ID is created before the first call so the record can be resumed after navigation, logout, or an interrupted session.

### Candidate provider queue

- Uses the existing provider-search ranking and filters.
- Each provider row shows name, city, phone, distance, freshness, accepting status, and why it matched.
- Primary row action: **Log call**.
- Secondary action: open provider history.
- Providers already called under the tracking record show their latest outcome and call count.

### Call entry panel

Always visible:

- Facility and phone used.
- Call date/time, defaulted to now but editable.
- Required contact outcome.
- Optional safe note.

Shown after **Reached facility**:

- Accepting new patients.
- Specialty confirmed.
- Can treat diagnosis.
- Can schedule within four weeks.

Answers must distinguish **Not asked**, **Unknown after asking**, **Yes**, **No**, and **Not applicable**. Triage and urgent-referral values remain available where relevant. Operations should approve dependency rules; for example, scheduling can default to Not applicable when the facility is not accepting new patients.

Routine outcomes use keyboard-accessible quick choices. The full controlled vocabulary remains available without requiring free-text explanations.

### Saved-call timeline

After each save, show:

- Provider and phone used.
- Call time and staff member.
- Contact outcome and verification result.
- Follow-up/data-quality action created, if any.
- **Correct entry** action when the user has permission.

Corrections are append-only amendments linked to the original call. The original audited record is never silently overwritten or deleted.

## Outcome and next-action rules

| Contact outcome | Immediate next action |
| --- | --- |
| Reached and verified | Update provider verification history; resolve related reverification/follow-up work |
| No answer | Create retry work using the configured retry interval |
| Voicemail left | Create retry work with a voicemail marker |
| Voicemail not left | Create retry work |
| Callback requested | Create callback work with an explicit due time |
| Disconnected number | Create data-quality work for phone correction |
| Wrong number | Create data-quality work for phone correction |
| Fax-only line | Create data-quality work for phone correction |
| Unable to verify | Create follow-up or review work according to the selected reason |

Scheduled scans remain reconciliation controls. They should recreate missing work safely but should not be the normal trigger for a newly logged call.

## Navigation and deep-link contract

Provider search, facility detail, reverification queue, and work inbox expose **Log call** links. The link may contain only application-controlled identifiers and non-sensitive filter context:

```text
/new-call?trackingId=<uuid>&facilityId=<uuid>&specialtyId=<uuid>&diagnosisId=<uuid>&lobId=<uuid>
```

The server validates access to every supplied identifier. URL values are conveniences, never authority.

## Call-log requirements

- Filters execute in PostgreSQL before pagination.
- Pagination is by Tracking ID group, not individual call, so a tracking group is never split across pages.
- All calls in a displayed tracking group are returned together.
- Total calls and total tracking groups reflect the complete filtered dataset.
- Search covers Tracking ID, provider, outcome, staff member, line of business, specialty, and diagnosis.
- Date filters include the entire selected end date.
- Calls without a Tracking ID are not incorrectly combined into one unrelated group.
- The UI says calls are **recorded**, not completed.
- Page size is a transport/performance setting, not a retention or visibility ceiling.

## Data integrity requirements

- One successful form submission creates exactly one call.
- Retrying the same submission after a network failure returns the existing call.
- The call stores the provider, phone, line of business, specialty, diagnosis, result, answers, note, staff attribution, and timestamp snapshots used at the time of the call.
- Successful verification updates and history events share the call transaction.
- Failed contact attempts share the call transaction.
- Follow-up creation is idempotent and traceable to the call.
- Newer verified facts cannot be replaced by an older backdated call.
- Tracking records and calls use server-generated UUIDs; the formatted Tracking ID is a display value.

## Privacy requirements

- Replace remaining user-facing “Authorization” terminology with “Tracking record.”
- Retain internal compatibility names only until a separately reviewed schema/API rename can be completed safely.
- Show brief guidance near notes: do not enter names, dates of birth, external identifiers, credentials, or unnecessary medical detail.
- Do not copy notes into notifications, metrics, URLs, or broad exports.

## Delivery plan

### Phase 0 — complete call-log access

- Remove the 500-row display ceiling.
- Move search, status, date filtering, sorting, counting, and pagination into PostgreSQL.
- Paginate tracking groups while returning every call in each selected group.
- Add complete-dataset totals and Previous/Next navigation.
- Add regression coverage for pagination and missing Tracking IDs.

### Phase 1 — persistent tracking workspace

- Add create/resume tracking-record endpoints.
- Move shared context into a workspace header.
- Add the saved-call timeline and two-success progress.
- Add Finish and Start new tracking record actions.
- Rename remaining user-facing Authorization terminology.

### Phase 2 — fast call entry

- Add prefilled Log call links from provider search, facility detail, queues, and work inbox.
- Require an explicit outcome.
- Add Not asked values and approved conditional-question rules.
- Add quick outcome controls, keyboard flow, safe note templates, and Save & next provider.

### Phase 3 — event-driven operational work

- Create retry, callback, or data-quality work when the call is saved.
- Resolve related work after successful verification.
- Use an outbox/idempotency key for notification delivery.
- Keep daily scans as reconciliation.

### Phase 4 — corrections and measurement

- Add append-only call amendments.
- Measure time to first call, entry duration, calls per tracking record, duplicate/retry rate, Not asked/Unknown rate, and time to two successful providers.
- Tune indexes and page size from production query plans and observed use.

## Acceptance criteria

- A dataset containing more than 500 calls can find and display the oldest call by Tracking ID, provider, outcome, staff member, or date.
- Paging from the first to last result produces no hidden ceiling, duplicate calls, missing calls, or split tracking groups.
- Counts match direct database counts for the same filters.
- A tracking record survives navigation and can be resumed by its authorized creator or an administrator.
- A repeated save caused by retry does not create a second call or second provider-history event.
- Failed outcomes create the correct operational work immediately and idempotently.
- The workflow visibly stops prompting after the second successful provider while preserving all earlier attempts.
- Routine call entry can be completed without typing a note.
- No user-facing screen or export asks for or displays a payer-issued authorization number.
