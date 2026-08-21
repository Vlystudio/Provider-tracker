import 'server-only';

import { z } from 'zod';
import { classifyFreshness, freshnessLabel, type FreshnessState, type VerificationAnswer } from '@/lib/provider-intelligence';
import { assertPermission, type Principal } from './authorization';
import { getFreshnessPolicy } from './config';
import { getDatabasePool } from './database';

export const facilityDirectoryInputSchema = z.object({
  query: z.string().trim().max(200).optional().transform((value) => value || undefined),
  status: z.enum(['active', 'needs_review', 'archived']).optional(),
  freshness: z.enum(['fresh', 'aging', 'stale', 'never_verified']).optional(),
  sort: z.enum(['name', 'city', 'freshness', 'last_verified']).default('name'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
}).strict();

export type FacilityDirectoryRow = {
  facilityId: string;
  facilityName: string;
  city: string;
  facilityType: string;
  specialties: string;
  acceptingStatus: VerificationAnswer;
  freshness: FreshnessState;
  freshnessLabel: string;
  lastVerifiedAt: string | null;
  recordStatus: 'Active' | 'Needs review' | 'Archived';
  dataQualityStatus: string;
};

export type FacilityDirectoryPage = { rows: FacilityDirectoryRow[]; total: number; page: number; pageSize: number };

type Row = {
  facility_id: string;
  facility_name: string;
  city: string;
  facility_type: string;
  specialties: string;
  current_accepting_status: VerificationAnswer;
  accepting_verified_at: Date | null;
  last_verified_at: Date | null;
  active: boolean;
  data_quality_status: string;
  total_count: string;
};

export async function listFacilities(principal: Principal, input: z.input<typeof facilityDirectoryInputSchema> = {}): Promise<FacilityDirectoryPage> {
  assertPermission(principal, 'operations:read');
  const value = facilityDirectoryInputSchema.parse(input);
  const pool = getDatabasePool();
  if (!pool) throw new Error('Database configuration is required for the facility directory.');
  const policy = getFreshnessPolicy();
  const sortSql = value.sort === 'city'
    ? 'city, facility_name'
    : value.sort === 'last_verified'
      ? 'last_verified_at DESC NULLS LAST, facility_name'
      : value.sort === 'freshness'
        ? 'accepting_verified_at ASC NULLS FIRST, facility_name'
        : 'facility_name, city';
  const result = await pool.query<Row>(`
    SELECT
      f.id AS facility_id,
      f.facility_name,
      f.city,
      f.facility_type,
      COALESCE((SELECT string_agg(DISTINCT s.canonical_name, ', ' ORDER BY s.canonical_name)
        FROM facility_specialties fs JOIN specialties s ON s.id = fs.specialty_id
        WHERE fs.facility_id = f.id AND fs.active), 'Not recorded') AS specialties,
      f.current_accepting_status,
      f.accepting_verified_at,
      f.last_verified_at,
      f.active,
      f.data_quality_status,
      count(*) OVER()::text AS total_count
    FROM facilities f
    WHERE f.merged_into_facility_id IS NULL
      AND ($1::text IS NULL OR concat_ws(' ', f.facility_name, f.city, f.facility_type, f.phone_raw) ILIKE $1
        OR EXISTS (SELECT 1 FROM facility_specialties fs JOIN specialties s ON s.id = fs.specialty_id
          WHERE fs.facility_id = f.id AND fs.active AND s.canonical_name ILIKE $1))
      AND ($2::text IS NULL OR CASE
        WHEN $2 = 'active' THEN f.active AND f.data_quality_status = 'clean'
        WHEN $2 = 'needs_review' THEN f.active AND f.data_quality_status = 'needs_review'
        WHEN $2 = 'archived' THEN NOT f.active
        ELSE true END)
      AND ($3::text IS NULL OR CASE
        WHEN f.accepting_verified_at IS NULL THEN 'never_verified'
        WHEN f.accepting_verified_at >= now() - ($4::text || ' days')::interval THEN 'fresh'
        WHEN f.accepting_verified_at >= now() - ($5::text || ' days')::interval THEN 'aging'
        ELSE 'stale' END = $3)
    ORDER BY ${sortSql}
    LIMIT $6 OFFSET $7`, [
      value.query ? `%${value.query}%` : null,
      value.status ?? null,
      value.freshness ?? null,
      policy.accepting.freshDays,
      policy.accepting.staleDays,
      value.pageSize,
      (value.page - 1) * value.pageSize,
    ]);
  const now = new Date();
  return {
    rows: result.rows.map((row) => {
      const freshness = classifyFreshness('accepting', row.accepting_verified_at, now, policy);
      return {
        facilityId: row.facility_id,
        facilityName: row.facility_name,
        city: row.city,
        facilityType: row.facility_type,
        specialties: row.specialties,
        acceptingStatus: row.current_accepting_status,
        freshness: freshness.state,
        freshnessLabel: freshnessLabel(freshness),
        lastVerifiedAt: row.last_verified_at?.toISOString() ?? null,
        recordStatus: !row.active ? 'Archived' : row.data_quality_status === 'needs_review' ? 'Needs review' : 'Active',
        dataQualityStatus: row.data_quality_status,
      };
    }),
    total: Number(result.rows[0]?.total_count ?? 0),
    page: value.page,
    pageSize: value.pageSize,
  };
}
