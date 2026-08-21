# Legacy data mapping

This document is the field contract for `ura-workbook-v1`. Comparisons ignore case, repeated spaces, and harmless punctuation unless noted.

## Workbook sheets

| Workbook | Required sheets | Accepted supporting sheets |
| --- | --- | --- |
| Admin | Facilities; Facility-Specialty Map; Zip Coordinates; tblWeeklyCallLog; Monthly Archive | Weekly Report Snapshot; Monthly Report Snapshot; Monthly Report Archive; Scheduling Trend Tracker; `_Config` |
| User | Facilities; Facility-Specialty Map; Weekly Call Log; Zip Coordinates | Provider search; tbl30DayLookBack; Authorization Output; Lists |

An unexpected sheet stops the preview. This prevents a file from silently changing shape.

## Facility

| Source | Target | Rule |
| --- | --- | --- |
| Facility / Facility Name / Facility Key | `facilities.facility_name`, `display_key` | Split the last `|` into name and city when a combined key is used. |
| City | `facilities.city` | Required directly or through the facility key. |
| Facility Type | `facilities.facility_type` | Defaults to Hospital only when the source is blank. |
| Auto Fill Specialty? | `facilities.auto_fill_specialty` | Yes/true/1 become true. |
| Phone Number / Phone | raw and normalized phone | Keep the source text. Normalize digits for matching. |
| Zipcode / ZIP Code / Postal Code | `facilities.postal_code` | Pad a short numeric ZIP to five digits. |
| Latitude / Longitude | facility coordinates | Both must be present and valid. ZIP centroid is fallback data, not an exact address. |
| Record Status / Status / Active | `facilities.active` and source metadata | Inactive, archived, no, false, and 0 become inactive. The original text is kept. |

Facility identity is normalized name plus normalized city. Exact identity matches use the existing row. Similar name/city, phone, or ZIP matches are review items and are not merged automatically.

## Facility specialty

| Source | Target | Rule |
| --- | --- | --- |
| Facility Key / Facility Name | facility relationship | Must resolve to a facility. |
| Specialty | specialty relationship | Exact canonical name or alias maps automatically. New text is shown in review before it is added. |
| Can Treat / Treatment status | `treatment_status` | yes, no, unknown, unable to tell without triage, or not applicable. |
| Notes | `notes` | Kept as source notes. |

An existing specialty confirmation with a newer `last_confirmed_at` is not overwritten.

## Weekly and archived calls

| Source | Target | Rule |
| --- | --- | --- |
| Call Date/Time / Call Date | `calls.call_at` | Excel serial or explicit four-digit-year date. Two-digit years are invalid. |
| Caller Initials | `legacy_actors` plus call snapshot | Link to a current active user only on one exact match. |
| LOB | line of business plus call snapshot | Keep the source code. |
| Authorization Number | authorization plus call snapshot | Blank remains null. |
| Facility Name / Facility Key | facility relationship plus snapshot | Unresolved facilities are blocking review items. |
| Diagnosis Code / Description | diagnosis plus call snapshot | Exact code or alias maps. New codes are reviewed. |
| Specialty | specialty plus call snapshot | Uses the specialty mapping rules above. |
| Accepting New Patients | status and legacy answer metadata | Preserve yes, no, unknown, blank, not asked, unable to verify, and not applicable. |
| Can Treat Diagnosis | treatment status and legacy answer metadata | Preserve the source state; triage-only answers map to unable to verify for verification history. |
| Can Schedule Within 4 Weeks | scheduling status and legacy answer metadata | Urgent referral remains distinct in the call rule result. |
| Specialty Confirmed | status and legacy answer metadata | Blank is not converted to no. |
| Did Not Leave VM | contact outcome | Creates a contact attempt; it does not refresh verification freshness. |
| Result phrase | source metadata | Stored for comparison only. The application recalculates the result from current rules. |

The stable call fingerprint uses source business fields and normalized values. The weekly duplicate key remains separate from exact import identity.

## ZIP coordinates

| Source | Target | Rule |
| --- | --- | --- |
| Zip Code / Zipcode / Postal Code | `postal_code_centroids.zip_code` | Required and normalized. |
| Latitude | `latitude` | -90 through 90. |
| Longitude | `longitude` | -180 through 180. |

An existing database centroid is not overwritten by a legacy workbook centroid.

## Source tracking

Each staged row keeps workbook kind, sanitized filename, source hash, sheet, row number, fingerprint, normalized data, issues, and final row status. Local paths and workbook contents are not exposed in the public summary.
