import 'server-only';

import { z } from 'zod';
import { assertPermission, type Principal } from './authorization';
import { getFreshnessPolicy } from './config';
import { getDatabasePool } from './database';

export const qualityIssueCodes = ['all', 'stale', 'never_verified', 'duplicates', 'missing_coordinates', 'missing_phone', 'conflicting'] as const;
export type QualityIssueCode = (typeof qualityIssueCodes)[number];

export const qualityDashboardInputSchema = z.object({
  issue: z.enum(qualityIssueCodes).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export type DataQualityDashboard = {
  metrics: Array<{ code: QualityIssueCode; label: string; count: number; href: string }>;
  rows: Array<{ facilityId: string; facilityName: string; city: string; phone: string | null; postalCode: string | null; lastVerifiedAt: string | null; issueLabel: string }>;
  total: number;
  page: number;
  pageSize: number;
};

type MetricRow = {
  active_records: string;
  stale_records: string;
  never_verified: string;
  duplicate_candidates: string;
  missing_coordinates: string;
  missing_phone: string;
  conflicting_states: string;
};

const issueWhere: Record<QualityIssueCode, string> = {
  all: `(
    f.accepting_verified_at IS NULL OR
    f.accepting_verified_at < now() - ($1::text || ' days')::interval OR
    f.geog_point IS NULL OR f.phone_normalized IS NULL OR
    EXISTS (SELECT 1 FROM facility_duplicate_candidates dc WHERE dc.decision IN ('pending','deferred') AND (dc.left_facility_id = f.id OR dc.right_facility_id = f.id)) OR
    EXISTS (SELECT 1 FROM facility_verification_events ve WHERE ve.facility_id = f.id AND ve.verified_at >= now() - interval '14 days' AND ve.accepting_status IN ('yes','no') GROUP BY ve.facility_id HAVING count(DISTINCT ve.accepting_status) > 1)
  )`,
  stale: `f.accepting_verified_at < now() - ($1::text || ' days')::interval`,
  never_verified: 'f.accepting_verified_at IS NULL',
  duplicates: `EXISTS (SELECT 1 FROM facility_duplicate_candidates dc WHERE dc.decision IN ('pending','deferred') AND (dc.left_facility_id = f.id OR dc.right_facility_id = f.id))`,
  missing_coordinates: 'f.geog_point IS NULL',
  missing_phone: 'f.phone_normalized IS NULL',
  conflicting: `EXISTS (SELECT 1 FROM facility_verification_events ve WHERE ve.facility_id = f.id AND ve.verified_at >= now() - interval '14 days' AND ve.accepting_status IN ('yes','no') GROUP BY ve.facility_id HAVING count(DISTINCT ve.accepting_status) > 1)`,
};

const issueLabels: Record<QualityIssueCode, string> = {
  all: 'Needs review',
  stale: 'Verification stale',
  never_verified: 'Never verified',
  duplicates: 'Duplicate candidate',
  missing_coordinates: 'Coordinates missing',
  missing_phone: 'Phone missing',
  conflicting: 'Recent statuses conflict',
};

export async function getDataQualityDashboard(
  principal: Principal,
  input: z.input<typeof qualityDashboardInputSchema> = {},
): Promise<DataQualityDashboard> {
  assertPermission(principal, 'admin:read');
  const value = qualityDashboardInputSchema.parse(input);
  const pool = getDatabasePool();
  if (!pool) throw new Error('Database configuration is required for data-quality reporting.');
  const staleDays = getFreshnessPolicy().accepting.staleDays;
  const [metricResult, rowResult] = await Promise.all([
    pool.query<MetricRow>(`
      SELECT
        count(*) FILTER (WHERE f.active)::text AS active_records,
        count(*) FILTER (WHERE f.active AND f.accepting_verified_at < now() - ($1::text || ' days')::interval)::text AS stale_records,
        count(*) FILTER (WHERE f.active AND f.accepting_verified_at IS NULL)::text AS never_verified,
        (SELECT count(*) FROM facility_duplicate_candidates WHERE decision IN ('pending','deferred'))::text AS duplicate_candidates,
        count(*) FILTER (WHERE f.active AND f.geog_point IS NULL)::text AS missing_coordinates,
        count(*) FILTER (WHERE f.active AND f.phone_normalized IS NULL)::text AS missing_phone,
        (SELECT count(*) FROM (
          SELECT facility_id FROM facility_verification_events
          WHERE verified_at >= now() - interval '14 days' AND accepting_status IN ('yes','no')
          GROUP BY facility_id HAVING count(DISTINCT accepting_status) > 1
        ) conflicts)::text AS conflicting_states
      FROM facilities f`, [staleDays]),
    pool.query<{
      facility_id: string; facility_name: string; city: string; phone_raw: string | null; postal_code: string | null;
      last_verified_at: Date | null; total_count: string;
    }>(`
      SELECT f.id AS facility_id, f.facility_name, f.city, f.phone_raw, f.postal_code, f.last_verified_at,
        count(*) OVER()::text AS total_count
      FROM facilities f
      WHERE f.active AND f.merged_into_facility_id IS NULL AND ${issueWhere[value.issue]}
      ORDER BY f.last_verified_at ASC NULLS FIRST, f.facility_name
      LIMIT $2 OFFSET $3`, [staleDays, value.pageSize, (value.page - 1) * value.pageSize]),
  ]);
  const metric = metricResult.rows[0];
  const metrics = [
    { code: 'all' as const, label: 'Active records', count: Number(metric?.active_records ?? 0), href: '/facilities?status=active' },
    { code: 'stale' as const, label: 'Stale', count: Number(metric?.stale_records ?? 0), href: '/data-quality?issue=stale' },
    { code: 'never_verified' as const, label: 'Never verified', count: Number(metric?.never_verified ?? 0), href: '/data-quality?issue=never_verified' },
    { code: 'duplicates' as const, label: 'Duplicate candidates', count: Number(metric?.duplicate_candidates ?? 0), href: '/duplicates' },
    { code: 'missing_coordinates' as const, label: 'Missing coordinates', count: Number(metric?.missing_coordinates ?? 0), href: '/data-quality?issue=missing_coordinates' },
    { code: 'missing_phone' as const, label: 'Missing phone', count: Number(metric?.missing_phone ?? 0), href: '/data-quality?issue=missing_phone' },
    { code: 'conflicting' as const, label: 'Conflicting status', count: Number(metric?.conflicting_states ?? 0), href: '/data-quality?issue=conflicting' },
  ];
  return {
    metrics,
    rows: rowResult.rows.map((row) => ({
      facilityId: row.facility_id,
      facilityName: row.facility_name,
      city: row.city,
      phone: row.phone_raw,
      postalCode: row.postal_code,
      lastVerifiedAt: row.last_verified_at?.toISOString() ?? null,
      issueLabel: issueLabels[value.issue],
    })),
    total: Number(rowResult.rows[0]?.total_count ?? 0),
    page: value.page,
    pageSize: value.pageSize,
  };
}

export type DuplicateReviewRow = {
  id: string;
  confidence: 'exact' | 'probable' | 'possible';
  score: number;
  reasons: string[];
  decision: 'pending' | 'deferred';
  left: { id: string; name: string; city: string; phone: string | null; postalCode: string | null; latitude: number | null; longitude: number | null; specialties: string; verificationCount: number; callCount: number; version: number };
  right: { id: string; name: string; city: string; phone: string | null; postalCode: string | null; latitude: number | null; longitude: number | null; specialties: string; verificationCount: number; callCount: number; version: number };
};

export async function listDuplicateCandidates(principal: Principal, page = 1, pageSize = 20) {
  assertPermission(principal, 'admin:read');
  const safePage = Math.max(1, Math.floor(page));
  const safeSize = Math.max(1, Math.min(50, Math.floor(pageSize)));
  const pool = getDatabasePool();
  if (!pool) throw new Error('Database configuration is required for duplicate review.');
  const result = await pool.query<{
    id: string; confidence: 'exact' | 'probable' | 'possible'; score: number; reason_codes: string[]; decision: 'pending' | 'deferred'; total_count: string;
    left_id: string; left_name: string; left_city: string; left_phone: string | null; left_zip: string | null; left_latitude: number | null; left_longitude: number | null; left_specialties: string; left_verifications: number; left_calls: number; left_version: number;
    right_id: string; right_name: string; right_city: string; right_phone: string | null; right_zip: string | null; right_latitude: number | null; right_longitude: number | null; right_specialties: string; right_verifications: number; right_calls: number; right_version: number;
  }>(`
    SELECT dc.id, dc.confidence, dc.score, dc.reason_codes, dc.decision, count(*) OVER()::text AS total_count,
      l.id AS left_id, l.facility_name AS left_name, l.city AS left_city, l.phone_raw AS left_phone, l.postal_code AS left_zip,
      l.latitude AS left_latitude, l.longitude AS left_longitude, l.optimistic_lock_version AS left_version,
      COALESCE((SELECT string_agg(DISTINCT s.canonical_name, ', ') FROM facility_specialties fs JOIN specialties s ON s.id=fs.specialty_id WHERE fs.facility_id=l.id AND fs.active), 'None') AS left_specialties,
      (SELECT count(*)::int FROM facility_verification_events ve WHERE ve.facility_id=l.id) AS left_verifications,
      (SELECT count(*)::int FROM calls c WHERE c.facility_id=l.id) AS left_calls,
      r.id AS right_id, r.facility_name AS right_name, r.city AS right_city, r.phone_raw AS right_phone, r.postal_code AS right_zip,
      r.latitude AS right_latitude, r.longitude AS right_longitude, r.optimistic_lock_version AS right_version,
      COALESCE((SELECT string_agg(DISTINCT s.canonical_name, ', ') FROM facility_specialties fs JOIN specialties s ON s.id=fs.specialty_id WHERE fs.facility_id=r.id AND fs.active), 'None') AS right_specialties,
      (SELECT count(*)::int FROM facility_verification_events ve WHERE ve.facility_id=r.id) AS right_verifications,
      (SELECT count(*)::int FROM calls c WHERE c.facility_id=r.id) AS right_calls
    FROM facility_duplicate_candidates dc
    JOIN facilities l ON l.id=dc.left_facility_id
    JOIN facilities r ON r.id=dc.right_facility_id
    WHERE dc.decision IN ('pending','deferred')
    ORDER BY CASE dc.confidence WHEN 'exact' THEN 1 WHEN 'probable' THEN 2 ELSE 3 END, dc.score DESC, dc.created_at
    LIMIT $1 OFFSET $2`, [safeSize, (safePage - 1) * safeSize]);
  const rows: DuplicateReviewRow[] = result.rows.map((row) => ({
    id: row.id, confidence: row.confidence, score: row.score, reasons: row.reason_codes, decision: row.decision,
    left: { id: row.left_id, name: row.left_name, city: row.left_city, phone: row.left_phone, postalCode: row.left_zip, latitude: row.left_latitude, longitude: row.left_longitude, specialties: row.left_specialties, verificationCount: row.left_verifications, callCount: row.left_calls, version: row.left_version },
    right: { id: row.right_id, name: row.right_name, city: row.right_city, phone: row.right_phone, postalCode: row.right_zip, latitude: row.right_latitude, longitude: row.right_longitude, specialties: row.right_specialties, verificationCount: row.right_verifications, callCount: row.right_calls, version: row.right_version },
  }));
  return { rows, total: Number(result.rows[0]?.total_count ?? 0), page: safePage, pageSize: safeSize };
}
