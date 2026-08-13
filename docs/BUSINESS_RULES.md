# Business Rules

Rules are implemented once in `apps/tracker/services/business_rules.py` and covered by automated tests.

## Result code and phrase

1. Did not leave voicemail → `unable_to_contact`.
2. Accepting is not yes → `does_not_meet_availability_guidelines`.
3. Can treat is not yes → `does_not_meet_availability_guidelines`.
4. Urgent referral required → `meets_availability_guidelines_urgent`.
5. Scheduling within four weeks is yes → `meets_availability_guidelines`.
6. Otherwise → `does_not_meet_availability_guidelines`.

Stable codes are stored separately from presentation phrases.

## Seven-day recommendation

Blank facility returns no recommendation. Unable-to-contact attempts are called again. Accepting and schedulable providers are good to call after diagnosis verification. Accepting providers without a positive schedule, and non-accepting providers, should not be called. Unknown accepting status requires verification. Remaining states are not confirmed.

## Duplicates and reviews

The weekly warning key is facility + diagnosis + Monday week start. A repeat is allowed only with a reason. Imported exact duplicates use caller initials, timestamp, authorization, facility, specialty, and diagnosis.

The default review date is the relevant call date plus seven days. Open queues order by due date, then priority, facility, and stable title.

## FDM

Eligibility requires the latest facility/specialty/diagnosis observation, age no greater than 30 days, accepting yes, treatment yes, and a confirmed facility-specialty mapping.

## Authorization narrative

The narrative uses named authorization and call fields. It includes attempts through the second successful provider. If fewer than two successes exist, it includes all matching calls.

## Reporting

Success includes normal and urgent-referral success codes. Success rate is successful calls divided by all completed calls in the selected period. Unable-to-contact rate uses the same completed-call denominator. Zero denominators return zero, not a fabricated change.
