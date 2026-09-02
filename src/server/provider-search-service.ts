import 'server-only';

import { z } from 'zod';
import {
  availabilityReviewDueAt,
  classifyFreshness,
  freshnessLabel,
  rankSearchResult,
  verificationAnswers,
  type FreshnessState,
  type VerificationAnswer,
} from '@/lib/provider-intelligence';
import { assertPermission, type Principal } from './authorization';
import { recordAuditEventBestEffort } from './audit';
import { getFreshnessPolicy } from './config';
import { getDatabasePool } from './database';
import { incrementMetric, measureOperation } from './metrics';
import { safeFilterKeys } from '@/lib/governance';

const optionalText = z.string().trim().max(200).optional().transform((value) => value || undefined);

export const providerSearchInputSchema = z.object({
  memberZip: z.string().trim().regex(/^\d{5}$/).default('04530'),
  radius: z.coerce.number().positive().max(500).default(50),
  diagnosis: optionalText,
  specialty: optionalText,
  accepting: z.enum(verificationAnswers).optional(),
  scheduling: z.enum(verificationAnswers).optional(),
  urgentReferral: z.enum(verificationAnswers).optional(),
  freshness: z.enum(['fresh', 'aging', 'stale', 'never_verified']).optional(),
  availability: z.enum(['available_or_review', 'confirmed_unavailable', 'all']).default('available_or_review'),
  facilityName: optionalText,
  verifiedFrom: z.string().date().optional(),
  verifiedTo: z.string().date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['recommended', 'distance', 'recently_verified', 'soonest_availability', 'name']).default('recommended'),
}).strict().refine((value) => !value.verifiedFrom || !value.verifiedTo || value.verifiedFrom <= value.verifiedTo, {
  path: ['verifiedFrom'], message: 'The start date must be on or before the end date.',
});

export type ProviderSearchInput = z.infer<typeof providerSearchInputSchema>;

export type ProviderSearchResult = {
  facilityId: string;
  facilityName: string;
  city: string;
  stateCode: string | null;
  postalCode: string | null;
  distanceMiles: number;
  phone: string;
  specialties: string;
  specialtyMatch: boolean;
  diagnosisMatch: boolean;
  acceptingStatus: VerificationAnswer;
  schedulingStatus: VerificationAnswer;
  urgentReferralStatus: VerificationAnswer;
  nextAvailableDate: string | null;
  estimatedWaitDays: number | null;
  acceptingVerifiedAt: string | null;
  availabilityReviewDueAt: string | null;
  lastVerifiedAt: string | null;
  freshness: FreshnessState;
  freshnessLabel: string;
  coordinateQuality: string;
  coordinateProvenance: string | null;
  dataQualityStatus: string;
  rankScore: number;
  matchReasons: string[];
  optimisticLockVersion: number;
};

export type ProviderSearchPage = {
  rows: ProviderSearchResult[];
  total: number;
  page: number;
  pageSize: number;
  originFound: boolean;
  excludedForMissingCoordinates: number;
};

type QueryRow = {
  facility_id: string;
  facility_name: string;
  city: string;
  state_code: string | null;
  postal_code: string | null;
  distance_miles: string | number;
  phone_raw: string | null;
  specialties: string;
  specialty_match: boolean;
  diagnosis_match: boolean;
  current_accepting_status: VerificationAnswer;
  current_scheduling_status: VerificationAnswer;
  current_urgent_referral_status: VerificationAnswer;
  next_available_date: string | Date | null;
  estimated_wait_days: number | null;
  accepting_verified_at: Date | null;
  scheduling_verified_at: Date | null;
  last_verified_at: Date | null;
  coordinate_quality: string;
  coordinate_provenance: string | null;
  data_quality_status: string;
  completeness: string | number;
  ranking_score: string | number;
  optimistic_lock_version: number;
  total_count: string | number;
};

const orderBy: Record<ProviderSearchInput['sort'], string> = {
  recommended: 'ranking_score DESC, distance_miles ASC, facility_name ASC',
  distance: 'distance_miles ASC, facility_name ASC',
  recently_verified: 'last_verified_at DESC NULLS LAST, distance_miles ASC, facility_name ASC',
  soonest_availability: 'next_available_date ASC NULLS LAST, estimated_wait_days ASC NULLS LAST, distance_miles ASC',
  name: 'facility_name ASC, city ASC',
};

function isoDate(value: Date | string | null): string | null {
  if (!value) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

function calendarDate(value: Date | string | null): string | null {
  return isoDate(value)?.slice(0, 10) ?? null;
}

async function runProviderSearch(principal: Principal, input: z.input<typeof providerSearchInputSchema>): Promise<ProviderSearchPage> {
  assertPermission(principal, 'operations:read');
  const value = providerSearchInputSchema.parse(input);
  const pool = getDatabasePool();
  if (!pool) throw new Error('Database configuration is required for provider search.');
  const policy = getFreshnessPolicy();
  const origin = await pool.query<{ found: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM postal_code_centroids
       WHERE zip_code = $1 AND geog_point IS NOT NULL
     ) AS found`,
    [value.memberZip],
  );
  if (!origin.rows[0]?.found) {
    return { rows: [], total: 0, page: value.page, pageSize: value.pageSize, originFound: false, excludedForMissingCoordinates: 0 };
  }

  const verifiedToExclusive = value.verifiedTo
    ? new Date(new Date(`${value.verifiedTo}T00:00:00.000Z`).valueOf() + 86_400_000)
    : null;
  const parameters = [
    value.memberZip,
    value.radius * 1609.344,
    value.specialty ? `%${value.specialty}%` : null,
    value.diagnosis ? `%${value.diagnosis}%` : null,
    value.accepting ?? null,
    value.scheduling ?? null,
    value.urgentReferral ?? null,
    value.freshness ?? null,
    value.facilityName ? `%${value.facilityName}%` : null,
    value.verifiedFrom ? new Date(`${value.verifiedFrom}T00:00:00.000Z`) : null,
    verifiedToExclusive,
    policy.accepting.freshDays,
    policy.accepting.staleDays,
    value.availability,
    value.pageSize,
    (value.page - 1) * value.pageSize,
  ];

  const query = `
    WITH origin AS (
      SELECT geog_point FROM postal_code_centroids WHERE zip_code = $1 LIMIT 1
    ), candidate AS (
      SELECT
        f.id AS facility_id,
        f.facility_name,
        f.city,
        f.state_code,
        f.postal_code,
        ST_Distance(f.geog_point::geography, o.geog_point::geography) / 1609.344 AS distance_miles,
        f.phone_raw,
        COALESCE((
          SELECT string_agg(DISTINCT s.canonical_name, ', ' ORDER BY s.canonical_name)
          FROM facility_specialties fs
          JOIN specialties s ON s.id = fs.specialty_id
          WHERE fs.facility_id = f.id AND fs.active AND s.active
        ), 'Not recorded') AS specialties,
        CASE WHEN $3::text IS NULL THEN false ELSE EXISTS (
          SELECT 1 FROM facility_specialties fs
          JOIN specialties s ON s.id = fs.specialty_id
          WHERE fs.facility_id = f.id AND fs.active AND s.active
            AND (s.canonical_name ILIKE $3 OR s.aliases::text ILIKE $3)
        ) END AS specialty_match,
        CASE WHEN $4::text IS NULL THEN false ELSE EXISTS (
          SELECT 1 FROM facility_diagnosis_capabilities fdc
          JOIN diagnoses d ON d.id = fdc.diagnosis_id
          WHERE fdc.facility_id = f.id AND fdc.active AND d.active AND fdc.status = 'yes'
            AND (d.code ILIKE $4 OR d.description ILIKE $4 OR d.aliases::text ILIKE $4)
        ) END AS diagnosis_match,
        f.current_accepting_status,
        f.current_scheduling_status,
        f.current_urgent_referral_status,
        f.next_available_date,
        f.estimated_wait_days,
        f.accepting_verified_at,
        f.scheduling_verified_at,
        f.last_verified_at,
        f.coordinate_quality,
        f.coordinate_provenance,
        f.data_quality_status,
        f.optimistic_lock_version,
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
        END AS availability_review_due_at,
        (
          (CASE WHEN f.phone_normalized IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN f.postal_code IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN f.address_line_1 IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN f.last_verified_at IS NOT NULL THEN 1 ELSE 0 END) +
          (CASE WHEN EXISTS (SELECT 1 FROM facility_specialties fs WHERE fs.facility_id = f.id AND fs.active) THEN 1 ELSE 0 END)
        ) / 5.0 AS completeness
      FROM facilities f
      CROSS JOIN origin o
      WHERE f.active
        AND f.merged_into_facility_id IS NULL
        AND f.geog_point IS NOT NULL
        AND ST_DWithin(f.geog_point::geography, o.geog_point::geography, $2)
        AND ($3::text IS NULL OR EXISTS (
          SELECT 1 FROM facility_specialties fs JOIN specialties s ON s.id = fs.specialty_id
          WHERE fs.facility_id = f.id AND fs.active AND s.active
            AND (s.canonical_name ILIKE $3 OR s.aliases::text ILIKE $3)
        ))
        AND ($4::text IS NULL OR EXISTS (
          SELECT 1 FROM facility_diagnosis_capabilities fdc JOIN diagnoses d ON d.id = fdc.diagnosis_id
          WHERE fdc.facility_id = f.id AND fdc.active AND d.active AND fdc.status = 'yes'
            AND (d.code ILIKE $4 OR d.description ILIKE $4 OR d.aliases::text ILIKE $4)
        ))
        AND ($5::text IS NULL OR f.current_accepting_status::text = $5)
        AND ($6::text IS NULL OR f.current_scheduling_status::text = $6)
        AND ($7::text IS NULL OR f.current_urgent_referral_status::text = $7)
        AND ($8::text IS NULL OR CASE
          WHEN f.accepting_verified_at IS NULL THEN 'never_verified'
          WHEN f.accepting_verified_at >= now() - ($12::text || ' days')::interval THEN 'fresh'
          WHEN f.accepting_verified_at >= now() - ($13::text || ' days')::interval THEN 'aging'
          ELSE 'stale'
        END = $8)
        AND ($9::text IS NULL OR f.facility_name ILIKE $9)
        AND ($10::timestamptz IS NULL OR f.last_verified_at >= $10)
        AND ($11::timestamptz IS NULL OR f.last_verified_at < $11)
    ), filtered AS (
      SELECT candidate.* FROM candidate
      WHERE $14::text = 'all'
        OR ($14::text = 'confirmed_unavailable'
          AND (current_accepting_status = 'no' OR current_scheduling_status = 'no')
          AND availability_review_due_at > now())
        OR ($14::text = 'available_or_review'
          AND (
            (current_accepting_status <> 'no' AND current_scheduling_status <> 'no')
            OR availability_review_due_at IS NULL
            OR availability_review_due_at <= now()
          ))
    ), ranked AS (
      SELECT filtered.*,
        (
          CASE WHEN $3::text IS NOT NULL AND specialty_match THEN 30 ELSE 0 END +
          CASE WHEN $4::text IS NOT NULL AND diagnosis_match THEN 35 ELSE 0 END +
          CASE WHEN current_accepting_status = 'yes' THEN 20 ELSE 0 END +
          CASE WHEN current_scheduling_status = 'yes' THEN 12 ELSE 0 END +
          CASE
            WHEN accepting_verified_at IS NULL THEN -12
            WHEN accepting_verified_at >= now() - ($12::text || ' days')::interval THEN 12
            WHEN accepting_verified_at >= now() - ($13::text || ' days')::interval THEN 5
            ELSE -8
          END +
          GREATEST(0, 12 - distance_miles / 10.0) +
          CASE WHEN estimated_wait_days <= 28 THEN 6 ELSE 0 END +
          completeness * 5
        ) AS ranking_score
      FROM filtered
    )
    SELECT ranked.*, count(*) OVER() AS total_count
    FROM ranked
    ORDER BY ${orderBy[value.sort]}
    LIMIT $15 OFFSET $16`;

  const [result, missing] = await Promise.all([
    pool.query<QueryRow>(query, parameters),
    pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM facilities WHERE active AND merged_into_facility_id IS NULL AND geog_point IS NULL`),
  ]);
  const now = new Date();
  const rows = result.rows.map((row): ProviderSearchResult => {
    const distanceMiles = Number(row.distance_miles);
    const completeness = Number(row.completeness);
    const ranking = rankSearchResult({
      facilityId: row.facility_id,
      specialtyMatch: row.specialty_match,
      diagnosisMatch: row.diagnosis_match,
      acceptingStatus: row.current_accepting_status,
      schedulingStatus: row.current_scheduling_status,
      urgentReferralStatus: row.current_urgent_referral_status,
      acceptingVerifiedAt: row.accepting_verified_at,
      distanceMiles,
      estimatedWaitDays: row.estimated_wait_days,
      completeness,
    }, now, policy);
    const freshness = classifyFreshness('accepting', row.accepting_verified_at, now, policy);
    const reviewDueAt = availabilityReviewDueAt({
      acceptingStatus: row.current_accepting_status,
      schedulingStatus: row.current_scheduling_status,
      acceptingVerifiedAt: row.accepting_verified_at,
      schedulingVerifiedAt: row.scheduling_verified_at,
      nextAvailableDate: row.next_available_date,
      estimatedWaitDays: row.estimated_wait_days,
    });
    return {
      facilityId: row.facility_id,
      facilityName: row.facility_name,
      city: row.city,
      stateCode: row.state_code,
      postalCode: row.postal_code,
      distanceMiles,
      phone: row.phone_raw ?? '',
      specialties: row.specialties,
      specialtyMatch: row.specialty_match,
      diagnosisMatch: row.diagnosis_match,
      acceptingStatus: row.current_accepting_status,
      schedulingStatus: row.current_scheduling_status,
      urgentReferralStatus: row.current_urgent_referral_status,
      nextAvailableDate: calendarDate(row.next_available_date),
      estimatedWaitDays: row.estimated_wait_days,
      acceptingVerifiedAt: isoDate(row.accepting_verified_at),
      availabilityReviewDueAt: isoDate(reviewDueAt),
      lastVerifiedAt: isoDate(row.last_verified_at),
      freshness: freshness.state,
      freshnessLabel: freshnessLabel(freshness),
      coordinateQuality: row.coordinate_quality,
      coordinateProvenance: row.coordinate_provenance,
      dataQualityStatus: row.data_quality_status,
      rankScore: ranking.score,
      matchReasons: ranking.reasons,
      optimisticLockVersion: row.optimistic_lock_version,
    };
  });
  return {
    rows,
    total: Number(result.rows[0]?.total_count ?? 0),
    page: value.page,
    pageSize: value.pageSize,
    originFound: true,
    excludedForMissingCoordinates: Number(missing.rows[0]?.count ?? 0),
  };
}

export async function searchProviders(
  principal: Principal,
  input: z.input<typeof providerSearchInputSchema>,
  options: { audit?: boolean } = {},
): Promise<ProviderSearchPage> {
  if (input.radius !== undefined || input.memberZip) {
    incrementMetric('provider_tracker_geographic_searches_total', { result: 'attempted' });
  }
  const result = await measureOperation('provider_search', () => runProviderSearch(principal, input));
  if (options.audit !== false) {
    await recordAuditEventBestEffort({
      actorId: principal.id,
      action: 'provider.search',
      result: 'success',
      entityType: 'provider_search',
      metadata: {
        resultCount: result.rows.length,
        totalMatches: result.total,
        page: result.page,
        filterKeys: safeFilterKeys(input as Record<string, unknown>).join(','),
      },
    });
  }
  return result;
}
