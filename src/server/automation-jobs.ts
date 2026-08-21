import type { PoolClient } from 'pg';
import {
  decideFailedContactWork,
  decideReverificationWork,
  detectMeaningfulChanges,
  emptyJobCounts,
  evaluateCoverageTransition,
  severityMeetsMinimum,
  type AutomationJobType,
  type JobCounts,
  type NotificationSeverity,
} from '@/lib/automation';
import { dailyDigestPeriod, formatLocalDate, weeklyDigestPeriod } from '@/lib/automation-time';
import { DEFAULT_FRESHNESS_POLICY } from '@/lib/provider-intelligence';
import type { UserRole } from '@/lib/access-control';
import { automationSettingsSchema, defaultAutomationSettings, type AutomationSettings } from '@/lib/automation-config';
import { incrementMetric, setMetricGauge } from './metrics';
import { getReleaseIdentifier } from './release';

type JobContext = {
  client: PoolClient;
  executionId: string;
  executionKey: string;
  scheduledFor: Date;
  dryRun: boolean;
};

type HandlerResult = { counts: JobCounts; metadata: Record<string, unknown> };

type Recipient = { id: string; role: UserRole };

async function loadSettings(client: PoolClient): Promise<AutomationSettings> {
  const result = await client.query('SELECT * FROM automation_settings WHERE scope=$1', ['global']);
  const row = result.rows[0];
  if (!row) return defaultAutomationSettings;
  return automationSettingsSchema.parse({
    timeZone: row.time_zone,
    upcomingStaleDays: row.upcoming_stale_days,
    meaningfulWaitIncreaseDays: row.meaningful_wait_increase_days,
    meaningfulWaitIncreasePercent: row.meaningful_wait_increase_percent,
    highPriorityEscalationDays: row.high_priority_escalation_days,
    dailyDigestHour: row.daily_digest_hour,
    weeklyDigestDay: row.weekly_digest_day,
    batchSize: row.batch_size,
  });
}

const allowedCategoryByRole: Record<UserRole, ReadonlySet<string>> = {
  admin: new Set(['work', 'changes', 'coverage', 'digest', 'audit', 'automation']),
  ura_user: new Set(['work', 'changes', 'coverage', 'digest']),
  report_viewer: new Set(['changes', 'coverage', 'digest']),
  auditor: new Set(['audit', 'digest']),
};

async function systemRecipients(client: PoolClient, roles: UserRole[]): Promise<Recipient[]> {
  const result = await client.query<Recipient>(`
    SELECT id, role FROM users
    WHERE is_active = true AND is_service_account = false AND role = ANY($1::user_role[])
    ORDER BY created_at, id`, [roles]);
  return result.rows;
}

async function createNotification(client: PoolClient, input: {
  recipient: Recipient;
  type: string;
  category: string;
  severity: NotificationSeverity;
  title: string;
  message: string;
  targetPath: string;
  source: string;
  deduplicationKey: string;
  issueKey?: string;
}): Promise<boolean> {
  if (!allowedCategoryByRole[input.recipient.role].has(input.category)) return false;
  const preference = await client.query<{ in_app_enabled: boolean; categories: string[]; minimum_severity: NotificationSeverity }>(`
    SELECT in_app_enabled, categories, minimum_severity
    FROM notification_preferences WHERE user_id = $1`, [input.recipient.id]);
  const settings = preference.rows[0];
  if (settings && (!settings.in_app_enabled || !settings.categories.includes(input.category) || !severityMeetsMinimum(input.severity, settings.minimum_severity))) return false;
  try {
    const created = await client.query(`
      INSERT INTO notifications
        (recipient_id, type, category, severity, title, message, target_path, source, deduplication_key, issue_key)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (recipient_id, deduplication_key) DO NOTHING`, [
      input.recipient.id,
      input.type,
      input.category,
      input.severity,
      input.title.slice(0, 120),
      input.message.slice(0, 300),
      input.targetPath,
      input.source,
      input.deduplicationKey,
      input.issueKey ?? null,
    ]);
    if ((created.rowCount ?? 0) > 0) incrementMetric('provider_tracker_notifications_generated_total', { operation: input.category });
    return (created.rowCount ?? 0) > 0;
  } catch (error) {
    incrementMetric('provider_tracker_notifications_failed_total', { operation: input.category });
    throw error;
  }
}

export async function notifyAutomationFailure(client: PoolClient, executionId: string, jobType: AutomationJobType): Promise<void> {
  const admins = await systemRecipients(client, ['admin']);
  for (const recipient of admins) {
    await createNotification(client, {
      recipient,
      type: 'automation_failure',
      category: 'automation',
      severity: 'important',
      title: 'Automation job failed',
      message: `${jobType.replaceAll('_', ' ')} did not finish. Review the execution history.`,
      targetPath: '/automation',
      source: 'automation_runner',
      deduplicationKey: `job-failure:${executionId}`,
      issueKey: `job:${jobType}`,
    });
  }
}

async function upsertWorkItem(client: PoolClient, input: {
  workType: string;
  priority: NotificationSeverity;
  targetType: string;
  targetId: string;
  dueAt: Date | null;
  reasonCodes: string[];
  assignedTo?: string | null;
  source: string;
  deduplicationKey: string;
}): Promise<{ id: string; cycle: number; inserted: boolean }> {
  const result = await client.query<{ id: string; cycle: number; inserted: boolean }>(`
    INSERT INTO operational_work_items
      (work_type, priority, target_type, target_id, due_at, reason_codes, assigned_to, status, source, deduplication_key)
    VALUES ($1,$2,$3,$4,$5,$6,$7,CASE WHEN $7::uuid IS NULL THEN 'open'::work_item_status ELSE 'assigned'::work_item_status END,$8,$9)
    ON CONFLICT (deduplication_key) DO UPDATE SET
      priority = EXCLUDED.priority,
      due_at = EXCLUDED.due_at,
      reason_codes = EXCLUDED.reason_codes,
      assigned_to = COALESCE(operational_work_items.assigned_to, EXCLUDED.assigned_to),
      status = CASE
        WHEN operational_work_items.status IN ('completed','dismissed') THEN
          CASE WHEN COALESCE(operational_work_items.assigned_to, EXCLUDED.assigned_to) IS NULL THEN 'open'::work_item_status ELSE 'assigned'::work_item_status END
        ELSE operational_work_items.status
      END,
      cycle = CASE WHEN operational_work_items.status IN ('completed','dismissed') THEN operational_work_items.cycle + 1 ELSE operational_work_items.cycle END,
      completed_at = CASE WHEN operational_work_items.status IN ('completed','dismissed') THEN NULL ELSE operational_work_items.completed_at END,
      completed_by = CASE WHEN operational_work_items.status IN ('completed','dismissed') THEN NULL ELSE operational_work_items.completed_by END,
      dismissed_at = CASE WHEN operational_work_items.status IN ('completed','dismissed') THEN NULL ELSE operational_work_items.dismissed_at END,
      dismissed_by = CASE WHEN operational_work_items.status IN ('completed','dismissed') THEN NULL ELSE operational_work_items.dismissed_by END,
      dismissal_reason = CASE WHEN operational_work_items.status IN ('completed','dismissed') THEN NULL ELSE operational_work_items.dismissal_reason END,
      optimistic_lock_version = operational_work_items.optimistic_lock_version + 1,
      updated_at = now()
    RETURNING id, cycle, (xmax = 0) AS inserted`, [input.workType, input.priority, input.targetType, input.targetId, input.dueAt, JSON.stringify(input.reasonCodes), input.assignedTo ?? null, input.source, input.deduplicationKey]);
  const work = result.rows[0];
  if (work.inserted) incrementMetric('provider_tracker_work_items_generated_total', { operation: input.workType });
  return work;
}

async function recordDerivedChange(client: PoolClient, input: {
  facilityId: string;
  eventType: string;
  severity: NotificationSeverity;
  occurredAt: Date;
  sourceType: string;
  sourceId?: string;
  deduplicationKey: string;
  beforeValue?: unknown;
  afterValue?: unknown;
}): Promise<boolean> {
  const stored = (value: unknown) => value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value
    : { value: value ?? null };
  const result = await client.query(`
    INSERT INTO operational_change_events
      (facility_id,event_type,severity,occurred_at,source_type,source_id,deduplication_key,before_value,after_value)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (deduplication_key) DO NOTHING`, [
    input.facilityId, input.eventType, input.severity, input.occurredAt, input.sourceType, input.sourceId ?? null,
    input.deduplicationKey, JSON.stringify(stored(input.beforeValue)), JSON.stringify(stored(input.afterValue)),
  ]);
  if ((result.rowCount ?? 0) > 0) incrementMetric('provider_tracker_change_events_generated_total', { operation: input.eventType });
  return (result.rowCount ?? 0) > 0;
}

async function notifyWork(client: PoolClient, work: { id: string; cycle: number }, recipient: Recipient | undefined, input: {
  workType: string;
  priority: NotificationSeverity;
  title: string;
  message: string;
  source: string;
}, dryRun: boolean): Promise<number> {
  if (!recipient || dryRun) return 0;
  return Number(await createNotification(client, {
    recipient,
    type: `${input.workType}_ready`,
    category: 'work',
    severity: input.priority,
    title: input.title,
    message: input.message,
    targetPath: `/work?id=${work.id}`,
    source: input.source,
    deduplicationKey: `work:${work.id}:cycle:${work.cycle}`,
    issueKey: `work:${work.id}`,
  }));
}

async function runReverificationScan(context: JobContext): Promise<HandlerResult> {
  const settings = await loadSettings(context.client);
  const counts = emptyJobCounts();
  const admins = await systemRecipients(context.client, ['admin']);
  let offset = 0;
  while (true) {
    const result = await context.client.query<{
      id: string;
      last_verified_at: Date | null;
      current_accepting_status: string;
      data_quality_status: string;
      assigned_to: string | null;
      contact_id: string | null;
      attempted_at: Date | null;
      outcome: Parameters<typeof decideFailedContactWork>[0]['outcome'] | null;
    }>(`
      SELECT f.id, f.last_verified_at, f.current_accepting_status, f.data_quality_status,
        assignment.assigned_to, contact.id AS contact_id, contact.attempted_at, contact.outcome
      FROM facilities f
      LEFT JOIN LATERAL (
        SELECT ra.assigned_to FROM reverification_assignments ra
        WHERE ra.facility_id = f.id AND ra.status = 'open'
        ORDER BY ra.created_at DESC LIMIT 1
      ) assignment ON true
      LEFT JOIN LATERAL (
        SELECT ca.id, ca.attempted_at, ca.outcome FROM facility_contact_attempts ca
        WHERE ca.facility_id = f.id ORDER BY ca.attempted_at DESC, ca.id DESC LIMIT 1
      ) contact ON true
      WHERE f.active = true AND f.merged_into_facility_id IS NULL
      ORDER BY f.id LIMIT $1 OFFSET $2`, [settings.batchSize, offset]);
    if (!result.rows.length) break;
    for (const facility of result.rows) {
      counts.processed += 1;
      const assignedRecipient = facility.assigned_to
        ? (await context.client.query<Recipient>('SELECT id, role FROM users WHERE id = $1 AND is_active = true AND is_service_account = false', [facility.assigned_to])).rows[0]
        : undefined;
      const recipient = assignedRecipient ?? admins[0];
      const reverification = decideReverificationWork({
        lastVerifiedAt: facility.last_verified_at,
        now: context.scheduledFor,
        staleDays: DEFAULT_FRESHNESS_POLICY.accepting.staleDays,
        upcomingDays: settings.upcomingStaleDays,
        highPriority: facility.current_accepting_status === 'yes' || facility.data_quality_status === 'needs_review',
      });
      if (reverification) {
        if (context.dryRun) counts.created += 1;
        else {
          const work = await upsertWorkItem(context.client, {
            ...reverification,
            targetType: 'facility',
            targetId: facility.id,
            assignedTo: facility.assigned_to,
            source: 'reverification_scan',
            deduplicationKey: `reverification:${facility.id}`,
          });
          counts.created += Number(work.inserted);
          if (reverification.reasonCodes.includes('stale')) {
            counts.created += Number(await recordDerivedChange(context.client, {
              facilityId: facility.id,
              eventType: 'facility_became_stale',
              severity: reverification.priority,
              occurredAt: context.scheduledFor,
              sourceType: 'reverification_scan',
              sourceId: work.id,
              deduplicationKey: `stale:${facility.id}:cycle:${work.cycle}`,
              beforeValue: 'fresh',
              afterValue: 'stale',
            }));
          }
          counts.created += await notifyWork(context.client, work, recipient, {
            workType: 'reverification',
            priority: reverification.priority,
            title: 'Facility needs reverification',
            message: 'A provider record is due for review.',
            source: 'reverification_scan',
          }, false);
        }
      }

      if (facility.contact_id && facility.attempted_at && facility.outcome) {
        const followUp = decideFailedContactWork({ attemptedAt: facility.attempted_at, outcome: facility.outcome });
        if (followUp) {
          if (context.dryRun) counts.created += 1;
          else {
            const work = await upsertWorkItem(context.client, {
              ...followUp,
              targetType: 'facility',
              targetId: facility.id,
              assignedTo: facility.assigned_to,
              source: 'failed_contact_scan',
              deduplicationKey: `${followUp.workType}:${facility.contact_id}`,
            });
            counts.created += Number(work.inserted);
            counts.created += await notifyWork(context.client, work, recipient, {
              workType: followUp.workType,
              priority: followUp.priority,
              title: followUp.workType === 'data_quality' ? 'Phone information needs review' : 'Contact follow-up is due',
              message: followUp.workType === 'data_quality' ? 'A failed contact points to a phone data issue.' : 'A provider contact attempt needs follow-up.',
              source: 'failed_contact_scan',
            }, false);
          }
        }
      }
    }
    offset += result.rows.length;
    if (result.rows.length < settings.batchSize) break;
  }
  if (!context.dryRun) {
    const resolved = await context.client.query<{ target_id: string; id: string; cycle: number }>(`
      UPDATE operational_work_items w SET status = 'completed', completed_at = now(), completed_by = NULL,
        optimistic_lock_version = w.optimistic_lock_version + 1, updated_at = now()
      FROM facilities f
      WHERE w.target_type = 'facility' AND w.target_id = f.id AND w.source = 'reverification_scan'
        AND w.status IN ('open','assigned','in_progress','blocked')
        AND f.last_verified_at IS NOT NULL
        AND f.last_verified_at + ($1::int * interval '1 day') > $2::timestamptz + ($3::int * interval '1 day')
      RETURNING w.target_id, w.id, w.cycle`, [DEFAULT_FRESHNESS_POLICY.accepting.staleDays, context.scheduledFor, settings.upcomingStaleDays]);
    for (const work of resolved.rows) {
      counts.created += Number(await recordDerivedChange(context.client, {
        facilityId: work.target_id,
        eventType: 'facility_returned_fresh',
        severity: 'informational',
        occurredAt: context.scheduledFor,
        sourceType: 'reverification_scan',
        sourceId: work.id,
        deduplicationKey: `fresh:${work.target_id}:cycle:${work.cycle}`,
        beforeValue: 'stale',
        afterValue: 'fresh',
      }));
    }
  }
  return { counts, metadata: { batchSize: settings.batchSize, dryRun: context.dryRun } };
}

async function runDataQualityScan(context: JobContext): Promise<HandlerResult> {
  const settings = await loadSettings(context.client);
  const counts = emptyJobCounts();
  const admin = (await systemRecipients(context.client, ['admin']))[0];
  let offset = 0;
  while (true) {
    const result = await context.client.query<{ id: string; phone_normalized: string | null; latitude: number | null; longitude: number | null; data_quality_status: string }>(`
      SELECT id, phone_normalized, latitude, longitude, data_quality_status
      FROM facilities WHERE active = true AND merged_into_facility_id IS NULL ORDER BY id LIMIT $1 OFFSET $2`, [settings.batchSize, offset]);
    if (!result.rows.length) break;
    for (const facility of result.rows) {
      counts.processed += 1;
      const reasons = [
        ...(!facility.phone_normalized ? ['missing_phone'] : []),
        ...(facility.latitude === null || facility.longitude === null ? ['missing_coordinates'] : []),
        ...(facility.data_quality_status === 'needs_review' ? ['marked_for_review'] : []),
      ];
      if (!reasons.length) continue;
      if (context.dryRun) counts.created += 1;
      else {
        const work = await upsertWorkItem(context.client, {
          workType: 'data_quality',
          priority: reasons.includes('missing_phone') ? 'important' : 'attention',
          targetType: 'facility',
          targetId: facility.id,
          dueAt: context.scheduledFor,
          reasonCodes: reasons,
          source: 'data_quality_scan',
          deduplicationKey: `data_quality:${facility.id}`,
        });
        counts.created += Number(work.inserted);
        counts.created += await notifyWork(context.client, work, admin, {
          workType: 'data_quality',
          priority: reasons.includes('missing_phone') ? 'important' : 'attention',
          title: 'Provider data needs review',
          message: 'A provider record has missing or flagged information.',
          source: 'data_quality_scan',
        }, false);
      }
    }
    offset += result.rows.length;
    if (result.rows.length < settings.batchSize) break;
  }
  if (!context.dryRun) {
    const resolved = await context.client.query<{ target_id: string; id: string; cycle: number }>(`
      UPDATE operational_work_items w SET status='completed', completed_at=now(), completed_by=NULL,
        optimistic_lock_version=optimistic_lock_version+1, updated_at=now()
      FROM facilities f WHERE w.target_type='facility' AND w.target_id=f.id AND w.source='data_quality_scan'
        AND w.status IN ('open','assigned','in_progress','blocked') AND f.phone_normalized IS NOT NULL
        AND f.latitude IS NOT NULL AND f.longitude IS NOT NULL AND f.data_quality_status <> 'needs_review'
      RETURNING w.target_id,w.id,w.cycle`);
    for (const work of resolved.rows) {
      counts.created += Number(await recordDerivedChange(context.client, {
        facilityId: work.target_id,
        eventType: 'data_quality_issue_resolved',
        severity: 'informational',
        occurredAt: context.scheduledFor,
        sourceType: 'data_quality_scan',
        sourceId: work.id,
        deduplicationKey: `quality-resolved:${work.target_id}:cycle:${work.cycle}`,
        beforeValue: 'needs_review',
        afterValue: 'resolved',
      }));
    }
  }
  return { counts, metadata: { batchSize: settings.batchSize, dryRun: context.dryRun } };
}

async function runDuplicateScan(context: JobContext): Promise<HandlerResult> {
  const settings = await loadSettings(context.client);
  const counts = emptyJobCounts();
  const admin = (await systemRecipients(context.client, ['admin']))[0];
  const pairs = await context.client.query<{ left_id: string; right_id: string; same_phone: boolean; same_name_city: boolean }>(`
    SELECT l.id AS left_id, r.id AS right_id,
      (l.phone_normalized IS NOT NULL AND l.phone_normalized = r.phone_normalized) AS same_phone,
      (l.normalized_name = r.normalized_name AND l.normalized_city = r.normalized_city) AS same_name_city
    FROM facilities l JOIN facilities r ON l.id < r.id AND (
      (l.phone_normalized IS NOT NULL AND l.phone_normalized = r.phone_normalized)
      OR (l.normalized_name = r.normalized_name AND l.normalized_city = r.normalized_city)
    )
    WHERE l.active=true AND r.active=true AND l.merged_into_facility_id IS NULL AND r.merged_into_facility_id IS NULL
      AND NOT EXISTS (SELECT 1 FROM facility_duplicate_candidates c WHERE c.left_facility_id=l.id AND c.right_facility_id=r.id)
    ORDER BY l.id, r.id LIMIT $1`, [settings.batchSize]);
  for (const pair of pairs.rows) {
    counts.processed += 1;
    const score = Math.min(100, (pair.same_name_city ? 60 : 0) + (pair.same_phone ? 40 : 0));
    const confidence = score >= 90 ? 'exact' : score >= 65 ? 'probable' : 'possible';
    const reasons = [...(pair.same_name_city ? ['same_name_and_city'] : []), ...(pair.same_phone ? ['same_phone'] : [])];
    if (context.dryRun) { counts.created += 1; continue; }
    const candidate = await context.client.query<{ id: string }>(`
      INSERT INTO facility_duplicate_candidates (left_facility_id,right_facility_id,confidence,score,reason_codes)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT (left_facility_id,right_facility_id) DO NOTHING RETURNING id`,
    [pair.left_id, pair.right_id, confidence, score, JSON.stringify(reasons)]);
    const id = candidate.rows[0]?.id;
    if (!id) { counts.skipped += 1; continue; }
    incrementMetric('provider_tracker_duplicate_candidates_generated_total', { operation: 'scan' });
    const work = await upsertWorkItem(context.client, {
      workType: 'duplicate_review', priority: confidence === 'exact' ? 'important' : 'attention', targetType: 'duplicate_candidate', targetId: id,
      dueAt: null, reasonCodes: reasons, source: 'duplicate_scan', deduplicationKey: `duplicate:${id}`,
    });
    counts.created += 1;
    counts.created += Number(work.inserted);
    counts.created += Number(await recordDerivedChange(context.client, {
      facilityId: pair.left_id,
      eventType: 'duplicate_candidate_created',
      severity: confidence === 'exact' ? 'important' : 'attention',
      occurredAt: context.scheduledFor,
      sourceType: 'duplicate_scan',
      sourceId: id,
      deduplicationKey: `duplicate-change:${id}`,
      beforeValue: null,
      afterValue: pair.right_id,
    }));
    counts.created += await notifyWork(context.client, work, admin, {
      workType: 'duplicate_review', priority: confidence === 'exact' ? 'important' : 'attention',
      title: 'Possible duplicate provider records', message: 'A provider record pair is ready for review.', source: 'duplicate_scan',
    }, false);
  }
  return { counts, metadata: { batchSize: settings.batchSize, dryRun: context.dryRun } };
}

async function runChangeDetection(context: JobContext): Promise<HandlerResult> {
  const settings = await loadSettings(context.client);
  const counts = emptyJobCounts();
  const previous = await context.client.query<{ last_created_at: string | null; last_id: string | null; audit_last_created_at: string | null; audit_last_id: string | null }>(`
    SELECT metadata->>'lastCreatedAt' AS last_created_at, metadata->>'lastId' AS last_id,
      metadata->>'auditLastCreatedAt' AS audit_last_created_at, metadata->>'auditLastId' AS audit_last_id
    FROM automation_job_executions WHERE job_type='change_detection' AND result='succeeded' AND id <> $1
    ORDER BY finished_at DESC NULLS LAST LIMIT 1`, [context.executionId]);
  const watermark = previous.rows[0]?.last_created_at ?? '1970-01-01T00:00:00.000Z';
  const lastId = previous.rows[0]?.last_id ?? '00000000-0000-0000-0000-000000000000';
  const auditWatermark = previous.rows[0]?.audit_last_created_at ?? '1970-01-01T00:00:00.000Z';
  const auditLastId = previous.rows[0]?.audit_last_id ?? '00000000-0000-0000-0000-000000000000';
  const events = await context.client.query<{
    id: string; facility_id: string; verified_at: Date; created_at: Date; previous_state: Record<string, unknown>; resulting_state: Record<string, unknown>;
    specialty_id: string | null; diagnosis_id: string | null;
  }>(`
    SELECT id, facility_id, verified_at, created_at, previous_state, resulting_state, specialty_id, diagnosis_id
    FROM facility_verification_events
    WHERE (created_at > $1 OR (created_at = $1 AND id > $2)) AND created_at <= $3
    ORDER BY created_at, id LIMIT $4`, [watermark, lastId, context.scheduledFor, settings.batchSize]);
  const recipients = await systemRecipients(context.client, ['admin', 'ura_user', 'report_viewer']);
  for (const event of events.rows) {
    counts.processed += 1;
    const changes = detectMeaningfulChanges({
      previous: event.previous_state,
      resulting: event.resulting_state,
      waitIncreaseDays: settings.meaningfulWaitIncreaseDays,
      waitIncreasePercent: settings.meaningfulWaitIncreasePercent,
      specialtyId: event.specialty_id,
      diagnosisId: event.diagnosis_id,
    });
    for (const change of changes) {
      if (context.dryRun) { counts.created += 1; continue; }
      const deduplicationKey = `verification:${event.id}:${change.eventType}`;
      const created = await context.client.query<{ id: string }>(`
        INSERT INTO operational_change_events
          (facility_id,event_type,severity,occurred_at,source_type,source_id,deduplication_key,before_value,after_value,specialty_id,diagnosis_id)
        VALUES ($1,$2,$3,$4,'verification',$5,$6,$7,$8,$9,$10)
        ON CONFLICT (deduplication_key) DO NOTHING RETURNING id`, [
        event.facility_id, change.eventType, change.severity, event.verified_at, event.id, deduplicationKey,
        JSON.stringify({ value: change.beforeValue }), JSON.stringify({ value: change.afterValue }), event.specialty_id, event.diagnosis_id,
      ]);
      if (!created.rows.length) { counts.skipped += 1; continue; }
      counts.created += 1;
      incrementMetric('provider_tracker_change_events_generated_total', { operation: change.eventType });
      if (change.severity !== 'informational') {
        for (const recipient of recipients) {
          await createNotification(context.client, {
            recipient, type: change.eventType, category: 'changes', severity: change.severity,
            title: 'Provider availability changed', message: 'A verified provider detail changed.',
            targetPath: `/changes?facility=${event.facility_id}`, source: 'change_detection',
            deduplicationKey: `change:${created.rows[0].id}`, issueKey: `facility:${event.facility_id}`,
          });
        }
      }
    }
  }
  const facilityUpdates = await context.client.query<{
    id: string; entity_id: string; created_at: Date; before_json: Record<string, unknown>; after_json: Record<string, unknown>;
  }>(`
    SELECT id,entity_id,created_at,before_json,after_json FROM audit_events
    WHERE action='facility.update' AND entity_id IS NOT NULL
      AND (created_at > $1 OR (created_at = $1 AND id > $2)) AND created_at <= $3
    ORDER BY created_at,id LIMIT $4`, [auditWatermark, auditLastId, context.scheduledFor, settings.batchSize]);
  const contactFields = new Set(['phoneRaw', 'addressLine1', 'addressLine2', 'city', 'stateCode', 'postalCode']);
  for (const update of facilityUpdates.rows) {
    counts.processed += 1;
    const fields = Object.keys(update.after_json ?? {}).filter((field) => contactFields.has(field));
    if (!fields.length) continue;
    if (context.dryRun) { counts.created += 1; continue; }
    const created = await recordDerivedChange(context.client, {
      facilityId: update.entity_id,
      eventType: 'contact_information_changed',
      severity: 'attention',
      occurredAt: update.created_at,
      sourceType: 'facility_update',
      sourceId: update.id,
      deduplicationKey: `facility-update:${update.id}:contact`,
      beforeValue: Object.fromEntries(fields.map((field) => [field, update.before_json?.[field] ?? null])),
      afterValue: Object.fromEntries(fields.map((field) => [field, update.after_json?.[field] ?? null])),
    });
    if (!created) { counts.skipped += 1; continue; }
    counts.created += 1;
    for (const recipient of recipients) {
      await createNotification(context.client, {
        recipient, type: 'contact_information_changed', category: 'changes', severity: 'attention',
        title: 'Provider contact information changed', message: 'A provider address or phone detail changed.',
        targetPath: `/changes?facility=${update.entity_id}`, source: 'change_detection',
        deduplicationKey: `contact-change:${update.id}`, issueKey: `facility:${update.entity_id}`,
      });
    }
  }
  const finalEvent = events.rows.at(-1);
  const finalAudit = facilityUpdates.rows.at(-1);
  return {
    counts,
    metadata: {
      batchSize: settings.batchSize,
      dryRun: context.dryRun,
      lastCreatedAt: finalEvent?.created_at.toISOString() ?? watermark,
      lastId: finalEvent?.id ?? lastId,
      auditLastCreatedAt: finalAudit?.created_at.toISOString() ?? auditWatermark,
      auditLastId: finalAudit?.id ?? auditLastId,
    },
  };
}

export async function countCoverageForWatch(client: PoolClient, watch: {
  postalCode: string; radiusMiles: number; specialtyId: string | null; diagnosisId: string | null; freshnessDays: number;
}): Promise<number> {
  const result = await client.query<{ count: number }>(`
    SELECT count(DISTINCT f.id)::int AS count
    FROM postal_code_centroids origin
    JOIN facilities f ON f.active=true AND f.merged_into_facility_id IS NULL
      AND f.current_accepting_status='yes'
      AND f.accepting_verified_at >= now() - ($5::int * interval '1 day')
      AND f.geog_point IS NOT NULL
      AND ST_DWithin(f.geog_point::geography, origin.geog_point::geography, $2::double precision * 1609.344)
    WHERE origin.zip_code=$1
      AND ($3::uuid IS NULL OR EXISTS (
        SELECT 1 FROM facility_specialties fs WHERE fs.facility_id=f.id AND fs.specialty_id=$3 AND fs.active=true AND fs.verification_status='yes'
      ))
      AND ($4::uuid IS NULL OR EXISTS (
        SELECT 1 FROM facility_diagnosis_capabilities fd WHERE fd.facility_id=f.id AND fd.diagnosis_id=$4 AND fd.active=true AND fd.status='yes'
      ))`, [watch.postalCode, watch.radiusMiles, watch.specialtyId, watch.diagnosisId, watch.freshnessDays]);
  return result.rows[0]?.count ?? 0;
}

type CoverageWatchRow = {
  id: string; name: string; postal_code: string; radius_miles: number; minimum_count: number; freshness_days: number;
  specialty_id: string | null; diagnosis_id: string | null; state: 'unknown' | 'healthy' | 'alerting'; cycle: number;
};

export async function applyCoverageObservation(
  client: PoolClient,
  watch: CoverageWatchRow,
  observedCount: number,
  scheduledFor: Date,
  dryRun = false,
): Promise<{ created: number; skipped: number; nextState: 'healthy' | 'alerting'; nextCycle: number }> {
  const transition = evaluateCoverageTransition({ state: watch.state, cycle: watch.cycle, observedCount, minimumCount: watch.minimum_count });
  if (dryRun) return { created: transition.event ? 1 : 0, skipped: 0, nextState: transition.nextState, nextCycle: transition.nextCycle };
  await client.query(`UPDATE coverage_watches SET state=$2, cycle=$3, last_count=$4, last_evaluated_at=$5, updated_at=now() WHERE id=$1`,
    [watch.id, transition.nextState, transition.nextCycle, observedCount, scheduledFor]);
  if (!transition.event) return { created: 0, skipped: 0, nextState: transition.nextState, nextCycle: transition.nextCycle };
  const alert = await client.query<{ id: string }>(`
    INSERT INTO coverage_alert_events (watch_id,cycle,state,observed_count,threshold_count)
    VALUES ($1,$2,$3,$4,$5) ON CONFLICT (watch_id,cycle,state) DO NOTHING RETURNING id`,
  [watch.id, transition.nextCycle, transition.event, observedCount, watch.minimum_count]);
  if (!alert.rows.length) return { created: 0, skipped: 1, nextState: transition.nextState, nextCycle: transition.nextCycle };
  incrementMetric('provider_tracker_coverage_alerts_generated_total', { operation: transition.event });
  const recipients = await systemRecipients(client, ['admin', 'ura_user', 'report_viewer']);
  for (const recipient of recipients) {
    await createNotification(client, {
      recipient, type: `coverage_${transition.event}`, category: 'coverage', severity: transition.event === 'opened' ? 'important' : 'informational',
      title: transition.event === 'opened' ? 'Coverage watch is below threshold' : 'Coverage watch recovered',
      message: transition.event === 'opened' ? `${watch.name} has ${observedCount} verified options; the threshold is ${watch.minimum_count}.` : `${watch.name} is back at or above its threshold.`,
      targetPath: `/coverage?id=${watch.id}`, source: 'coverage_watch',
      deduplicationKey: `coverage:${watch.id}:${transition.nextCycle}:${transition.event}`, issueKey: `coverage:${watch.id}`,
    });
  }
  return { created: 1, skipped: 0, nextState: transition.nextState, nextCycle: transition.nextCycle };
}

async function runCoverageWatch(context: JobContext): Promise<HandlerResult> {
  const settings = await loadSettings(context.client);
  const counts = emptyJobCounts();
  const watches = await context.client.query<CoverageWatchRow>('SELECT * FROM coverage_watches WHERE enabled=true ORDER BY id LIMIT $1', [settings.batchSize]);
  let activeAlerts = 0;
  for (const watch of watches.rows) {
    counts.processed += 1;
    const observedCount = await countCoverageForWatch(context.client, {
      postalCode: watch.postal_code, radiusMiles: watch.radius_miles, specialtyId: watch.specialty_id,
      diagnosisId: watch.diagnosis_id, freshnessDays: watch.freshness_days,
    });
    const result = await applyCoverageObservation(context.client, watch, observedCount, context.scheduledFor, context.dryRun);
    if (result.nextState === 'alerting') activeAlerts += 1;
    counts.created += result.created;
    counts.skipped += result.skipped;
  }
  if (!context.dryRun) {
    const escalations = await context.client.query<{ id: string; name: string; cycle: number }>(`
      SELECT w.id, w.name, w.cycle FROM coverage_watches w
      JOIN coverage_alert_events e ON e.watch_id=w.id AND e.cycle=w.cycle AND e.state='opened'
      WHERE w.enabled=true AND w.state='alerting' AND e.created_at <= $1 - ($2::int * interval '1 day')`,
    [context.scheduledFor, settings.highPriorityEscalationDays]);
    const admins = await systemRecipients(context.client, ['admin']);
    for (const watch of escalations.rows) {
      for (const recipient of admins) {
        await createNotification(context.client, {
          recipient, type: 'coverage_escalation', category: 'coverage', severity: 'important',
          title: 'Coverage watch is still below threshold', message: `${watch.name} remains below its configured threshold.`,
          targetPath: `/coverage?id=${watch.id}`, source: 'coverage_watch',
          deduplicationKey: `coverage:${watch.id}:${watch.cycle}:escalation`, issueKey: `coverage:${watch.id}`,
        });
      }
    }
  }
  setMetricGauge('provider_tracker_coverage_alerts_active', activeAlerts);
  return { counts, metadata: { evaluated: watches.rows.length, dryRun: context.dryRun } };
}

async function runDigest(context: JobContext, digestType: 'daily' | 'weekly'): Promise<HandlerResult> {
  const settings = await loadSettings(context.client);
  const counts = emptyJobCounts();
  const runDate = formatLocalDate(context.scheduledFor, settings.timeZone);
  const period = digestType === 'daily' ? dailyDigestPeriod(runDate, settings.timeZone) : weeklyDigestPeriod(runDate, settings.timeZone);
  const summary = await context.client.query<{
    change_count: number; stopped_accepting: number; started_accepting: number; coverage_alerts: number;
    open_work: number; data_quality_work: number; duplicate_work: number;
  }>(`
    SELECT
      (SELECT count(*)::int FROM operational_change_events WHERE occurred_at >= $1 AND occurred_at < $2) AS change_count,
      (SELECT count(*)::int FROM operational_change_events WHERE occurred_at >= $1 AND occurred_at < $2 AND event_type='stopped_accepting') AS stopped_accepting,
      (SELECT count(*)::int FROM operational_change_events WHERE occurred_at >= $1 AND occurred_at < $2 AND event_type='started_accepting') AS started_accepting,
      (SELECT count(*)::int FROM coverage_alert_events WHERE created_at >= $1 AND created_at < $2 AND state='opened') AS coverage_alerts,
      (SELECT count(*)::int FROM operational_work_items WHERE status IN ('open','assigned','in_progress','blocked')) AS open_work,
      (SELECT count(*)::int FROM operational_work_items WHERE status IN ('open','assigned','in_progress','blocked') AND work_type='data_quality') AS data_quality_work,
      (SELECT count(*)::int FROM operational_work_items WHERE status IN ('open','assigned','in_progress','blocked') AND work_type='duplicate_review') AS duplicate_work`,
  [period.start, period.end]);
  const row = summary.rows[0];
  const allSections = [
    { key: 'changes', label: 'Provider changes', count: row.change_count },
    { key: 'stopped_accepting', label: 'Stopped accepting', count: row.stopped_accepting },
    { key: 'started_accepting', label: 'Started accepting', count: row.started_accepting },
    { key: 'coverage_alerts', label: 'New coverage gaps', count: row.coverage_alerts },
    { key: 'open_work', label: 'Open work', count: row.open_work },
    { key: 'data_quality', label: 'Data quality work', count: row.data_quality_work },
    { key: 'duplicates', label: 'Duplicate review', count: row.duplicate_work },
  ];
  const users = await context.client.query<Recipient & { digest_frequency: 'none' | 'daily' | 'weekly' }>(`
    SELECT u.id, u.role, COALESCE(p.digest_frequency, 'daily'::digest_frequency) AS digest_frequency
    FROM users u LEFT JOIN notification_preferences p ON p.user_id=u.id
    WHERE u.is_active=true AND u.is_service_account=false ORDER BY u.id`);
  for (const recipient of users.rows) {
    if (recipient.digest_frequency === 'none' || (digestType === 'daily' && recipient.digest_frequency !== 'daily') || (digestType === 'weekly' && recipient.digest_frequency !== 'weekly')) {
      counts.skipped += 1;
      continue;
    }
    counts.processed += 1;
    const sections = recipient.role === 'auditor'
      ? allSections.filter((section) => ['changes'].includes(section.key))
      : recipient.role === 'report_viewer'
        ? allSections.filter((section) => ['changes', 'stopped_accepting', 'started_accepting', 'coverage_alerts'].includes(section.key))
        : recipient.role === 'ura_user'
          ? allSections.filter((section) => !['data_quality', 'duplicates'].includes(section.key))
          : allSections;
    if (context.dryRun) { counts.created += 1; continue; }
    const digest = await context.client.query<{ id: string }>(`
      INSERT INTO operational_digests
        (digest_type,audience_key,recipient_id,period_start,period_end,source_version,sections,execution_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      ON CONFLICT (digest_type,audience_key,period_start,period_end) DO NOTHING RETURNING id`, [
      digestType, `user:${recipient.id}`, recipient.id, period.start, period.end, getReleaseIdentifier(), JSON.stringify(sections), context.executionId,
    ]);
    if (!digest.rows.length) { counts.skipped += 1; continue; }
    counts.created += 1;
    await createNotification(context.client, {
      recipient, type: `${digestType}_digest`, category: 'digest', severity: 'informational',
      title: digestType === 'daily' ? 'Daily summary is ready' : 'Weekly summary is ready',
      message: 'Open the summary to review provider changes and outstanding work.', targetPath: `/notifications?digest=${digest.rows[0].id}`,
      source: `${digestType}_digest`, deduplicationKey: `digest:${digest.rows[0].id}`,
    });
  }
  incrementMetric('provider_tracker_digests_generated_total', { operation: digestType }, counts.created);
  return { counts, metadata: { periodStart: period.start.toISOString(), periodEnd: period.end.toISOString(), timeZone: settings.timeZone, dryRun: context.dryRun } };
}

export async function runAutomationHandler(jobType: AutomationJobType, context: JobContext): Promise<HandlerResult> {
  switch (jobType) {
    case 'reverification_scan': return runReverificationScan(context);
    case 'data_quality_scan': return runDataQualityScan(context);
    case 'duplicate_scan': return runDuplicateScan(context);
    case 'change_detection': return runChangeDetection(context);
    case 'coverage_watch': return runCoverageWatch(context);
    case 'daily_digest': return runDigest(context, 'daily');
    case 'weekly_digest': return runDigest(context, 'weekly');
  }
}
