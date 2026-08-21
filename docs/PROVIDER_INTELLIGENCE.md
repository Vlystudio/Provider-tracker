# Provider intelligence

## Source of truth

A facility is the stable operational identity. Its UUID does not change when its name, address, phone, status, or specialty changes. The imported workbooks contain facilities, not individual practitioners, so the application does not maintain a second provider-person master.

The main record types are:

- `facilities`: identity, contact details, coordinates, current status snapshot, archive state, and optimistic version
- `facility_verification_events`: append-only facts confirmed at a point in time
- `facility_contact_attempts`: failed or incomplete contact activity that does not refresh verification
- `facility_specialties`: controlled specialty relationships and their verification date
- `facility_diagnosis_capabilities`: explicit diagnosis capability; specialty alone does not imply it
- `calls`: authorization workflow evidence and original workbook provenance
- `facility_duplicate_candidates` and `facility_merge_records`: review decisions and merge recovery data

## Field ownership

User-entered fields include facility corrections, verification facts, contact outcomes, comments, duplicate decisions, and assignments. Imported values retain the batch, source hash, sheet, and row. Local source paths are not stored in normal UI records.

Current accepting, scheduling, urgent-referral, next-date, and wait fields are performance snapshots. A verification transaction writes history and updates only the fields supplied by the user. Yes, no, and not applicable refresh that field's verified timestamp. Unknown, not asked, and unable to verify remain distinct and do not make old facts look fresh.

A failed contact writes `facility_contact_attempts` only. It never changes a verification timestamp.

## Freshness

Freshness thresholds are centralized and can be changed through environment configuration.

| Category | Fresh through | Aging through | Stale after |
| --- | ---: | ---: | ---: |
| Accepting | 30 days | 45 days | 45 days |
| Scheduling | 30 days | 45 days | 45 days |
| Diagnosis | 90 days | 120 days | 120 days |
| Specialty | 180 days | 240 days | 240 days |
| Contact details | 180 days | 365 days | 365 days |

A missing timestamp is never verified. The queue score is deterministic. It uses age, unknown fields, recent calls, failed contacts, and conflicting recent answers. Every score is accompanied by reason labels.

## Search

Radius search starts from a validated ZIP centroid and runs in PostgreSQL with `ST_DWithin` on geography casts. Distance is returned in miles. A functional GiST index supports the geography expression.

Records without coordinates stay in the facility directory but are excluded from radius results. ZIP-centroid coordinates are labeled as such. The browser never supplies a trusted distance.

Diagnosis filters require an active, explicit yes relationship. No, unknown, not asked, unable to verify, and not applicable do not match. Specialty filters use controlled specialty records and aliases.

Recommended order is deterministic:

1. requested specialty and diagnosis match
2. accepting status
3. four-week scheduling
4. urgent-referral capability
5. verification freshness
6. distance
7. wait and record completeness

Users can also sort by distance, verification date, soonest availability, or name.

## Duplicate handling

Candidate detection uses exact normalized names, phone, ZIP, and coordinate proximity. Fuzzy name similarity alone never causes a merge. Probable and possible matches stay pending until an administrator decides.

A merge requires typed confirmation, two current optimistic versions, and an administrator permission. The duplicate record is archived rather than deleted. Its verification, contact, call, and audit history remains attached to its stable UUID. Specialty and diagnosis relationships are copied to the surviving record, with the newer verified relationship winning. The merge record stores the source, survivor, actor, reason, versions, and copied relationship IDs.

## Retention

Verification, contact, call, merge, and audit history has no automatic deletion job. Archived facilities are excluded from active search and remain available to authorized historical views. Any future retention policy needs a separate approved migration and runbook.
