# Notifications

Provider Tracker currently delivers notifications in the app. Email, SMS, and push delivery are not configured or shown as options.

## Recipients

- URA users can receive assigned work, follow-up, verified provider changes, coverage changes, and summaries.
- Report viewers can receive provider-change, coverage, and summary notices.
- Auditors can receive audit-oriented summaries. They do not receive provider work links.
- Administrators can receive all operational categories, including job and data-quality attention.

The server checks the recipient role before inserting a notification. A notification link is still protected by the page and API permission checks. Notification lists and read-state updates always include the signed-in recipient ID in the database condition. A missing item and another user's item both return not found.

## Preferences

Each user can turn in-app notifications on or off, choose daily, weekly, or no summary, select allowed categories, and set a minimum severity. The server removes categories that the user's role cannot receive. Preferences affect future notifications; they do not delete existing history.

Severities are:

- `informational`: useful context with no immediate action
- `attention`: work or a change worth reviewing
- `important`: a substantial availability change, a high-priority issue, or a coverage threshold crossing

Unread status is shown with text as well as styling. The notification center supports marking one item or all items read, keyboard navigation, visible focus, and screen-reader status updates.

## Deduplication

Every automated notification has a stable key. The database permits one key per recipient. Re-running a job, retrying an insert, or scanning an unchanged issue does not create another notice.

Work and coverage alerts use cycle numbers. Resolution closes the derived state. If the same issue returns later, its cycle increases and one new notice is allowed. Coverage escalation also has one key per cycle.

## Content

Messages are short and avoid unnecessary provider details. The link takes an authorized user to the work inbox, change feed, coverage page, or saved summary. The application remains the authorization gate for the full record.

Stored daily and weekly summaries are available at the bottom of the notification center. Each shows the fixed period and section counts recorded when it was generated.
