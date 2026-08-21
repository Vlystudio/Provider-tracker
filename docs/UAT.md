# User acceptance checklist

This is a checklist, not a record of completed testing. The named business testers must enter results in the staging acceptance record.

## Test data

Use a controlled staging copy of the final workbooks. Include examples for leading-zero ZIP codes, blank and unknown answers, inactive facilities, duplicate calls, unmatched facilities, new specialties, invalid dates, hidden rows, formulas with saved values, and a facility with newer application data.

## Migration operator

- [ ] Admin can open Data Migration; non-admin roles cannot.
- [ ] Preview accepts `.xlsx` and rejects `.xlsm`, links, embedded objects, bad sheets, and bad headers.
- [ ] Preview shows correct filenames, hashes, sheet counts, formula counts, hidden-row counts, and row totals.
- [ ] Facility match decisions, specialty mappings, diagnosis mappings, skip, and defer actions are clear.
- [ ] Another administrator cannot overwrite a review decision made from an older screen version.
- [ ] Apply requires the same files and an approval note.
- [ ] A repeated apply does not duplicate calls.
- [ ] A simulated failure leaves no partial provider or call rows.
- [ ] Concurrent apply attempts allow only one runner.
- [ ] Diagnostics CSV opens safely and matches the screen.

## URA user

- [ ] Provider search returns migrated facilities with the expected city, phone, ZIP, specialty, and status.
- [ ] Leading-zero ZIP searches work.
- [ ] Inactive facilities do not appear as active options.
- [ ] Call history dates, caller initials, authorization, diagnosis, specialty, and result are correct.
- [ ] Blank, unknown, not asked, unable to verify, and not applicable are not displayed as no.
- [ ] A failed contact does not make a provider look freshly verified.
- [ ] A newer staging edit remains after the legacy import.

## Report viewer

- [ ] Weekly and monthly totals match the reconciliation record.
- [ ] Accepting-rate numerator and denominator match the documented rule.
- [ ] Unknown and not-applicable values are excluded from the yes/no denominator.
- [ ] Drilldowns add up to the displayed totals.

## Administrator and auditor

- [ ] Preview, review, apply, failure, and reversal actions appear in the audit log.
- [ ] Audit records contain IDs, hashes, counts, reasons, and actors but no passwords, session cookies, workbook contents, or local paths.
- [ ] Imported initials appear as legacy actors, not made-up staff accounts.
- [ ] Initial automation creates expected work without sending a backlog flood.
- [ ] A later, newly opened work cycle sends the expected notification.

## Sign-off

Record tester, role, build release, database migration, source hashes, run ID, date, result, defects, retest result, and approval. Any unchecked item needs a written exception and owner before GO.
