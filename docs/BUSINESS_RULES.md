# Business Rules

## Result phrase

The web app uses stable result codes instead of string comparisons. The presentation labels match the workbook wording.

### Rule set

1. If `did_not_leave_vm` is true, the result phrase is `unable to contact, did not leave voicemail`.
2. Else if `accepting_new_patients` is not `yes`, result is `does not meet availability guidelines`.
3. Else if `can_treat_diagnosis` is not `yes`, result is `does not meet availability guidelines`.
4. Else if the provider requires an urgent referral for scheduling, result is `meets availability guidelines - urgent referral required for scheduling`.
5. Else if `can_schedule_within_four_weeks` is `yes`, result is `meets availability guidelines`.
6. Else result is `does not meet availability guidelines`.

## Seven-day recommendation

1. Blank facility -> blank recommendation.
2. `did_not_leave_vm` -> `Call - previous attempt unable to contact / did not leave voicemail`.
3. Accepting yes and scheduling yes or urgent -> `Provider good to call - verify if they treat diagnosis`.
4. Accepting yes but scheduling not positive -> `Do not call - provider cannot schedule within 4 weeks`.
5. Accepting no -> `Do not call - provider not accepting new patients`.
6. Accepting unknown -> `Call - provider accepting status unknown`.
7. Otherwise -> `Call - provider availability not confirmed`.

## Duplicate detection

- Duplicate warning key: `facility + diagnosis + week_start`
- A group with more than one call is a duplicate warning
- Repeat calls remain visible; duplicate warnings do not delete valid records
- Import duplicates are detected using initials/user, timestamp, authorization, facility, specialty, and diagnosis

## Review queue

- Never verified: +50
- Stale accepting status: +35; aging accepting status: +15
- Stale specialty, diagnosis, or scheduling fact: +12 each
- Conflicting recent accepting status: +25
- High use: +15; regular use: +7
- Unknown fields: +5 each, capped at +15
- Repeated failed contacts: +2 each, capped at +10
- The final score is capped at 100 and displayed with its reason labels

Freshness thresholds are defined once in the server configuration. Failed contact attempts do not satisfy a queue reason.

## Verification state

- Yes, no, unknown, not asked, unable to verify, and not applicable are separate values.
- An omitted field is not changed.
- A supplied unknown or unable-to-verify value can change the displayed current answer but does not refresh that field's verified timestamp.
- Yes, no, and not applicable refresh the verified timestamp.
- A verification event and its current-state update commit together.
- A stale optimistic version returns a conflict instead of overwriting another user's work.

## Search matching

- Radius filtering and distance calculation run in PostGIS.
- Facilities without coordinates do not appear in radius results.
- A diagnosis filter matches only an active explicit yes relationship.
- A specialty filter matches an active controlled relationship or alias.
- Recommended order is deterministic and the result lists the matching reasons.

## Facility duplicates

- Exact name, phone, ZIP, and coordinate signals contribute to a deterministic candidate score.
- Name similarity alone cannot merge records.
- Only an administrator can merge.
- A merge archives the source record, copies current relationships, retains source history, and writes an audit event.

## Authorization narrative stop rule

The summary stops after the second successful provider. If fewer than two successes exist, all matching calls are included.

## Reporting definitions

Every KPI in the report layer names its denominator and method. No report should rely on workbook cache cells or volatile `TODAY()` values.
