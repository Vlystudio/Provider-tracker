# Business Rules

## Result phrase

The web app uses stable result codes instead of string comparisons. The presentation labels match the workbook wording.

### Rule set

1. If `did_not_leave_vm` is true, the result phrase is `unable to contact, did not leave voicemail`.
2. Else if `accepting_new_patients` is not `yes`, result is `does not meet availability guidelines`.
3. Else if `can_treat_diagnosis` is not `yes`, result is `does not meet availability guidelines`.
4. Else if scheduling requires urgent referral, result is `meets availability guidelines - can schedule within 4 weeks with urgent referral`.
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
- Valid repeat calls remain allowed with a reason attached
- Import duplicates are detected using initials/user, timestamp, authorization, facility, specialty, and diagnosis

## Review queue

- `next_review_date = latest relevant call date + 7 days`
- Due window is now to 7 days out
- Rank overdue first, then nearest date, then facility name

## FDM logic

Eligible FDM records require:

- latest observation for facility + specialty + diagnosis
- within 30 days
- accepting = yes
- can treat = yes
- facility-specialty mapping confirmed = yes

## Authorization narrative stop rule

The summary stops after the second successful provider. If fewer than two successes exist, all matching calls are included.

## Reporting definitions

Every KPI in the report layer names its denominator and method. No report should rely on workbook cache cells or volatile `TODAY()` values.
