import 'server-only';

import { z } from 'zod';
import { parseReportPeriod, percentage } from '@/lib/provider-intelligence';
import { assertPermission, type Principal } from './authorization';
import { getFreshnessPolicy } from './config';
import { getDatabasePool } from './database';
import { measureOperation } from './metrics';

export const reportingInputSchema = z.object({
  from: z.string().date(),
  to: z.string().date(),
  drilldown: z.enum(['fresh', 'accepting', 'newly_accepting', 'became_unavailable', 'stale']).optional(),
}).strict().refine((value) => value.from <= value.to, { path: ['from'], message: 'The start date must be on or before the end date.' });

export type OperationalReport = {
  metrics: Array<{ label: string; value: string; detail: string; href?: string }>;
  generatedAt: string;
  period: { from: string; to: string };
  total: number;
  trend: Array<{ date: string; verifications: number; successfulContacts: number; failedContacts: number }>;
  coverage: Array<{ specialty: string; facilities: number; fresh: number; accepting: number }>;
  drilldown: Array<{ facilityId: string; facilityName: string; city: string; acceptingStatus: string; lastVerifiedAt: string | null }>;
};

type SummaryRow = {
  active_facilities: number;
  fresh_facilities: number;
  recent_verified: number;
  accepting_facilities: number;
  verification_events: number;
  phone_verifications: number;
  failed_contacts: number;
  newly_accepting: number;
  became_unavailable: number;
  assignments_created: number;
  assignments_completed: number;
  average_wait_days: string | null;
  wait_denominator: number;
};

async function runOperationalReport(
  principal: Principal,
  input: z.input<typeof reportingInputSchema>,
): Promise<OperationalReport> {
  assertPermission(principal, 'reports:read');
  const value = reportingInputSchema.parse(input);
  const period = parseReportPeriod(value.from, value.to);
  const policy = getFreshnessPolicy();
  const pool = getDatabasePool();
  if (!pool) throw new Error('Database configuration is required for reporting.');
  const parameters = [period.from, period.toExclusive, policy.accepting.freshDays, policy.accepting.staleDays];
  const [summaryResult, trendResult, coverageResult] = await Promise.all([
    pool.query<SummaryRow>(`
      SELECT
        (SELECT count(*)::int FROM facilities WHERE active AND merged_into_facility_id IS NULL) AS active_facilities,
        (SELECT count(*)::int FROM facilities WHERE active AND merged_into_facility_id IS NULL AND accepting_verified_at >= now() - ($3::text || ' days')::interval) AS fresh_facilities,
        (SELECT count(*)::int FROM facilities WHERE active AND merged_into_facility_id IS NULL AND accepting_verified_at >= now() - ($4::text || ' days')::interval) AS recent_verified,
        (SELECT count(*)::int FROM facilities WHERE active AND merged_into_facility_id IS NULL AND accepting_verified_at >= now() - ($4::text || ' days')::interval AND current_accepting_status='yes') AS accepting_facilities,
        (SELECT count(*)::int FROM facility_verification_events WHERE verified_at >= $1 AND verified_at < $2) AS verification_events,
        (SELECT count(*)::int FROM facility_verification_events WHERE verified_at >= $1 AND verified_at < $2 AND method='phone') AS phone_verifications,
        (SELECT count(*)::int FROM facility_contact_attempts WHERE attempted_at >= $1 AND attempted_at < $2 AND outcome <> 'verified') AS failed_contacts,
        (SELECT count(*)::int FROM facility_verification_events WHERE verified_at >= $1 AND verified_at < $2 AND accepting_status='yes' AND previous_state->>'acceptingStatus' IN ('no','unknown','unable_to_verify')) AS newly_accepting,
        (SELECT count(*)::int FROM facility_verification_events WHERE verified_at >= $1 AND verified_at < $2 AND accepting_status='no' AND previous_state->>'acceptingStatus'='yes') AS became_unavailable,
        (SELECT count(*)::int FROM reverification_assignments WHERE created_at >= $1 AND created_at < $2) AS assignments_created,
        (SELECT count(*)::int FROM reverification_assignments WHERE created_at >= $1 AND created_at < $2 AND status='completed') AS assignments_completed,
        (SELECT round(avg(estimated_wait_days)::numeric, 1)::text FROM facility_verification_events WHERE verified_at >= $1 AND verified_at < $2 AND estimated_wait_days IS NOT NULL) AS average_wait_days,
        (SELECT count(*)::int FROM facility_verification_events WHERE verified_at >= $1 AND verified_at < $2 AND estimated_wait_days IS NOT NULL) AS wait_denominator`, parameters),
    pool.query<{ date: Date; verifications: number; successful_contacts: number; failed_contacts: number }>(`
      WITH days AS (SELECT generate_series($1::date, ($2::date - interval '1 day')::date, interval '1 day')::date AS date),
      verification AS (SELECT verified_at::date AS date, count(*)::int AS count, count(*) FILTER (WHERE method='phone')::int AS phone_count FROM facility_verification_events WHERE verified_at >= $1 AND verified_at < $2 GROUP BY verified_at::date),
      contact AS (SELECT attempted_at::date AS date, count(*) FILTER (WHERE outcome <> 'verified')::int AS failed_count FROM facility_contact_attempts WHERE attempted_at >= $1 AND attempted_at < $2 GROUP BY attempted_at::date)
      SELECT days.date, coalesce(verification.count,0)::int AS verifications, coalesce(verification.phone_count,0)::int AS successful_contacts, coalesce(contact.failed_count,0)::int AS failed_contacts
      FROM days LEFT JOIN verification USING (date) LEFT JOIN contact USING (date) ORDER BY days.date`, parameters.slice(0, 2)),
    pool.query<{ specialty: string; facilities: number; fresh: number; accepting: number }>(`
      SELECT s.canonical_name AS specialty,
        count(DISTINCT f.id)::int AS facilities,
        count(DISTINCT f.id) FILTER (WHERE fs.last_confirmed_at >= now() - interval '180 days')::int AS fresh,
        count(DISTINCT f.id) FILTER (WHERE f.current_accepting_status='yes' AND f.accepting_verified_at >= now() - ($1::text || ' days')::interval)::int AS accepting
      FROM specialties s JOIN facility_specialties fs ON fs.specialty_id=s.id AND fs.active
      JOIN facilities f ON f.id=fs.facility_id AND f.active AND f.merged_into_facility_id IS NULL
      GROUP BY s.id, s.canonical_name ORDER BY facilities ASC, s.canonical_name LIMIT 25`, [policy.accepting.staleDays]),
  ]);
  const summary = summaryResult.rows[0];
  const fresh = percentage(summary?.fresh_facilities ?? 0, summary?.active_facilities ?? 0);
  const accepting = percentage(summary?.accepting_facilities ?? 0, summary?.recent_verified ?? 0);
  const contact = percentage(summary?.phone_verifications ?? 0, (summary?.phone_verifications ?? 0) + (summary?.failed_contacts ?? 0));
  const completion = percentage(summary?.assignments_completed ?? 0, summary?.assignments_created ?? 0);
  const query = new URLSearchParams({ from: value.from, to: value.to });
  const metricHref = (drilldown: NonNullable<z.infer<typeof reportingInputSchema>['drilldown']>) => `/reports?${query.toString()}&drilldown=${drilldown}`;
  const metrics = [
    { label: 'Fresh accepting status', value: fresh.percent === null ? '—' : `${fresh.percent}%`, detail: `${fresh.numerator} of ${fresh.denominator} active facilities were verified in the last ${policy.accepting.freshDays} days`, href: metricHref('fresh') },
    { label: 'Currently accepting', value: accepting.percent === null ? '—' : `${accepting.percent}%`, detail: `${accepting.numerator} of ${accepting.denominator} facilities verified in the last ${policy.accepting.staleDays} days are accepting`, href: metricHref('accepting') },
    { label: 'Phone contact success', value: contact.percent === null ? '—' : `${contact.percent}%`, detail: `${contact.numerator} successful phone verifications out of ${contact.denominator} recorded phone contacts` },
    { label: 'Reverification completed', value: completion.percent === null ? '—' : `${completion.percent}%`, detail: `${completion.numerator} of ${completion.denominator} assignments created in the period were completed` },
    { label: 'Verifications recorded', value: String(summary?.verification_events ?? 0), detail: 'Verification events in the selected period' },
    { label: 'Newly accepting', value: String(summary?.newly_accepting ?? 0), detail: 'Recorded changes from unavailable or unknown to accepting', href: metricHref('newly_accepting') },
    { label: 'Became unavailable', value: String(summary?.became_unavailable ?? 0), detail: 'Recorded changes from accepting to not accepting', href: metricHref('became_unavailable') },
    { label: 'Average wait', value: summary?.average_wait_days ? `${summary.average_wait_days} days` : '—', detail: `${summary?.wait_denominator ?? 0} verification events included a wait estimate` },
  ];
  const drilldown = value.drilldown ? await getReportDrilldown(pool, value.drilldown, parameters) : [];
  return {
    metrics,
    generatedAt: new Date().toISOString(),
    period: { from: value.from, to: value.to },
    total: summary?.verification_events ?? 0,
    trend: trendResult.rows.map((row) => ({ date: new Date(row.date).toISOString().slice(0, 10), verifications: row.verifications, successfulContacts: row.successful_contacts, failedContacts: row.failed_contacts })),
    coverage: coverageResult.rows,
    drilldown,
  };
}

export async function getOperationalReport(
  principal: Principal,
  input: z.input<typeof reportingInputSchema>,
): Promise<OperationalReport> {
  return measureOperation('report_generation', () => runOperationalReport(principal, input));
}

async function getReportDrilldown(
  pool: NonNullable<ReturnType<typeof getDatabasePool>>,
  kind: NonNullable<z.infer<typeof reportingInputSchema>['drilldown']>,
  parameters: Array<Date | number>,
) {
  const conditions: Record<typeof kind, string> = {
    fresh: `f.accepting_verified_at >= now() - ($3::text || ' days')::interval`,
    accepting: `f.current_accepting_status='yes' AND f.accepting_verified_at >= now() - ($4::text || ' days')::interval`,
    stale: `f.accepting_verified_at < now() - ($4::text || ' days')::interval`,
    newly_accepting: `EXISTS (SELECT 1 FROM facility_verification_events ve WHERE ve.facility_id=f.id AND ve.verified_at >= $1 AND ve.verified_at < $2 AND ve.accepting_status='yes' AND ve.previous_state->>'acceptingStatus' IN ('no','unknown','unable_to_verify'))`,
    became_unavailable: `EXISTS (SELECT 1 FROM facility_verification_events ve WHERE ve.facility_id=f.id AND ve.verified_at >= $1 AND ve.verified_at < $2 AND ve.accepting_status='no' AND ve.previous_state->>'acceptingStatus'='yes')`,
  };
  const result = await pool.query<{ facility_id: string; facility_name: string; city: string; accepting_status: string; last_verified_at: Date | null }>(`
    SELECT f.id AS facility_id, f.facility_name, f.city, f.current_accepting_status::text AS accepting_status, f.last_verified_at
    FROM facilities f WHERE f.active AND f.merged_into_facility_id IS NULL AND ${conditions[kind]}
    ORDER BY f.facility_name LIMIT 500`, parameters);
  return result.rows.map((row) => ({ facilityId: row.facility_id, facilityName: row.facility_name, city: row.city, acceptingStatus: row.accepting_status, lastVerifiedAt: row.last_verified_at?.toISOString() ?? null }));
}
