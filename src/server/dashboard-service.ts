import 'server-only';

import type { DashboardSummary } from '@/lib/dashboard';
import { assertPermission, type Principal } from './authorization';
import { getDatabasePool } from './database';
import { measureOperation } from './metrics';

type DashboardRow = {
  active_facilities: string | number;
  calls_this_week: string | number;
  active_work: string | number;
  availability_due: string | number;
  fresh_accepting: string | number;
  confirmed_unavailable: string | number;
  unconfirmed_availability: string | number;
  important_changes: string | number;
};

function count(value: string | number | undefined): number {
  return Number(value ?? 0);
}

async function runDashboardSummary(principal: Principal): Promise<DashboardSummary> {
  assertPermission(principal, 'app:access');
  const pool = getDatabasePool();
  if (!pool) throw new Error('Database configuration is required for the dashboard.');
  const result = await pool.query<DashboardRow>(`
    WITH active_facilities AS (
      SELECT f.*,
        CASE
          WHEN f.current_accepting_status = 'no' OR f.current_scheduling_status = 'no' THEN
            COALESCE(
              f.next_available_date::timestamptz,
              CASE WHEN GREATEST(f.accepting_verified_at, f.scheduling_verified_at) IS NOT NULL
                THEN GREATEST(f.accepting_verified_at, f.scheduling_verified_at)
                  + (COALESCE(f.estimated_wait_days, 30) * interval '1 day')
              END
            )
          WHEN GREATEST(f.accepting_verified_at, f.scheduling_verified_at) IS NOT NULL THEN
            GREATEST(f.accepting_verified_at, f.scheduling_verified_at) + interval '30 days'
          ELSE NULL
        END AS availability_review_due_at
      FROM facilities f
      WHERE f.active AND f.merged_into_facility_id IS NULL
    )
    SELECT
      (SELECT count(*) FROM active_facilities)::text AS active_facilities,
      (SELECT count(*) FROM calls c
        WHERE c.call_at >= date_trunc('week', now())
          AND ($1::boolean OR c.caller_user_id = $2::uuid))::text AS calls_this_week,
      (SELECT count(*) FROM operational_work_items w
        WHERE w.status IN ('open','assigned','in_progress','blocked')
          AND ($1::boolean OR w.assigned_to = $2::uuid))::text AS active_work,
      (SELECT count(*) FROM active_facilities f
        WHERE f.current_accepting_status <> 'not_applicable'
          AND CASE
            WHEN f.current_accepting_status = 'no' OR f.current_scheduling_status = 'no' THEN
              f.availability_review_due_at IS NULL OR f.availability_review_due_at <= now()
            ELSE
              f.accepting_verified_at IS NULL
              OR f.current_accepting_status IN ('unknown','not_asked','unable_to_verify')
              OR f.availability_review_due_at IS NULL
              OR f.availability_review_due_at <= now()
          END)::text AS availability_due,
      (SELECT count(*) FROM active_facilities f
        WHERE f.current_accepting_status = 'yes'
          AND f.accepting_verified_at >= now() - interval '30 days')::text AS fresh_accepting,
      (SELECT count(*) FROM active_facilities f
        WHERE (f.current_accepting_status = 'no' OR f.current_scheduling_status = 'no')
          AND f.availability_review_due_at > now())::text AS confirmed_unavailable,
      (SELECT count(*) FROM active_facilities f
        WHERE f.current_accepting_status IN ('unknown','not_asked','unable_to_verify')
          OR ((f.current_accepting_status = 'no' OR f.current_scheduling_status = 'no')
            AND f.next_available_date IS NULL AND f.estimated_wait_days IS NULL))::text AS unconfirmed_availability,
      (SELECT count(*) FROM operational_change_events e
        WHERE e.severity = 'important' AND e.occurred_at >= now() - interval '30 days')::text AS important_changes
  `, [principal.role === 'admin', principal.id]);
  const row = result.rows[0];
  const reliability = {
    activeFacilities: count(row?.active_facilities),
    callsThisWeek: count(row?.calls_this_week),
    activeWork: count(row?.active_work),
    availabilityDue: count(row?.availability_due),
    freshAccepting: count(row?.fresh_accepting),
    confirmedUnavailable: count(row?.confirmed_unavailable),
    unconfirmedAvailability: count(row?.unconfirmed_availability),
    importantChanges: count(row?.important_changes),
  };
  return {
    cards: [
      { label: 'Calls this week', value: String(reliability.callsThisWeek) },
      { label: principal.role === 'admin' ? 'Active work' : 'My active work', value: String(reliability.activeWork) },
      { label: 'Availability checks due', value: String(reliability.availabilityDue) },
      { label: 'Fresh accepting facilities', value: String(reliability.freshAccepting) },
    ],
    reliability,
  };
}

export async function getDashboardSummary(principal: Principal): Promise<DashboardSummary> {
  return measureOperation('dashboard_summary', () => runDashboardSummary(principal));
}
