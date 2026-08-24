import 'dotenv/config';
import { and, inArray, sql } from 'drizzle-orm';
import { createDatabase } from '../src/db/client';
import {
  diagnoses,
  facilities,
  facilityContactAttempts,
  facilityDiagnosisCapabilities,
  facilityDuplicateCandidates,
  facilitySpecialties,
  facilityVerificationEvents,
  specialties,
  users,
} from '../src/db/schema';

const facilityIds = Array.from({ length: 12 }, (_, index) => `00000000-0000-4000-9000-${String(index + 1).padStart(12, '0')}`);
const fixtureUserIds = ['00000000-0000-4000-8100-000000000001', '00000000-0000-4000-8100-000000000002'];

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  const databaseName = new URL(databaseUrl).pathname.slice(1);
  if (process.env.APP_ENV === 'production') throw new Error('Phase 4 fixtures cannot be loaded in production.');
  if (!databaseName.endsWith('_test') && process.env.ALLOW_DEVELOPMENT_FIXTURES !== 'true') {
    throw new Error('Use a _test database or set ALLOW_DEVELOPMENT_FIXTURES=true for an approved local fixture database.');
  }
  const database = createDatabase(databaseUrl);
  try {
    await database.db.transaction(async (tx) => {
      await tx.delete(facilityDuplicateCandidates).where(and(
        inArray(facilityDuplicateCandidates.leftFacilityId, facilityIds),
        inArray(facilityDuplicateCandidates.rightFacilityId, facilityIds),
      ));
      await tx.delete(facilityVerificationEvents).where(inArray(facilityVerificationEvents.facilityId, facilityIds));
      await tx.delete(facilityContactAttempts).where(inArray(facilityContactAttempts.facilityId, facilityIds));
      await tx.delete(facilities).where(inArray(facilities.id, facilityIds));
      for (const [index, id] of fixtureUserIds.entries()) {
        await tx.insert(users).values({
          id,
          name: index === 0 ? 'Fixture User One' : 'Fixture User Two',
          displayName: index === 0 ? 'Fixture User One' : 'Fixture User Two',
          email: `phase4-fixture-${index + 1}@local.invalid`,
          initials: index === 0 ? 'F1' : 'F2',
          role: 'ura_user',
          isActive: false,
        }).onConflictDoUpdate({ target: users.email, set: { name: index === 0 ? 'Fixture User One' : 'Fixture User Two', updatedAt: new Date() } });
      }
      await tx.insert(specialties).values([
        { canonicalName: 'Oncology', normalizedName: 'oncology', aliases: ['Cancer/Oncology'] },
        { canonicalName: 'Pulmonology', normalizedName: 'pulmonology', aliases: ['Lung medicine'] },
        { canonicalName: 'Cardiology', normalizedName: 'cardiology', aliases: [] },
      ]).onConflictDoNothing({ target: specialties.normalizedName });
      await tx.insert(diagnoses).values([
        { code: 'C50', description: 'Breast cancer', aliases: [] },
        { code: 'J45', description: 'Asthma', aliases: [] },
      ]).onConflictDoNothing({ target: diagnoses.code });
      const [specialtyRows, diagnosisRows] = await Promise.all([
        tx.select({ id: specialties.id, name: specialties.normalizedName }).from(specialties).where(inArray(specialties.normalizedName, ['oncology', 'pulmonology', 'cardiology'])),
        tx.select({ id: diagnoses.id, code: diagnoses.code }).from(diagnoses).where(inArray(diagnoses.code, ['C50', 'J45'])),
      ]);
      const specialtyId = new Map(specialtyRows.map((row) => [row.name, row.id]));
      const diagnosisId = new Map(diagnosisRows.map((row) => [row.code, row.id]));
      const now = new Date();
      const daysAgo = (days: number) => new Date(now.valueOf() - days * 86_400_000);
      await tx.insert(facilities).values(facilityIds.map((id, index) => {
        const hasCoordinates = index !== 8;
        const isNever = index === 2 || index === 8;
        const verifiedAt = isNever ? null : index === 1 ? daysAgo(70) : index === 3 ? daysAgo(38) : daysAgo(4 + index);
        const latitude = hasCoordinates ? 43.6591 + index * 0.035 : null;
        const longitude = hasCoordinates ? -70.2568 + index * 0.02 : null;
        return {
          id,
          facilityName: index === 10 ? 'Fixture Harbor Clinic' : index === 11 ? 'Fixture Harbour Clinic' : `Fixture Facility ${String(index + 1).padStart(2, '0')}`,
          city: index % 2 === 0 ? 'Portland' : 'South Portland',
          normalizedName: index === 10 ? 'fixture harbor clinic' : index === 11 ? 'fixture harbour clinic' : `fixture facility ${String(index + 1).padStart(2, '0')}`,
          normalizedCity: index % 2 === 0 ? 'portland' : 'south portland',
          displayKey: `Fixture Facility ${index + 1}|Maine`,
          facilityType: index % 3 === 0 ? 'Hospital' : 'Clinic',
          addressLine1: index === 7 ? null : `${100 + index} Test Avenue`,
          stateCode: 'ME',
          phoneRaw: index === 6 ? null : `(207) 555-${String(1000 + index)}`,
          phoneNormalized: index === 6 ? null : `207555${String(1000 + index)}`,
          postalCode: index === 7 ? null : '04103',
          latitude,
          longitude,
          geogPoint:
            latitude !== null && longitude !== null
              ? sql`ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)`
              : null,
          coordinateProvenance: hasCoordinates ? 'synthetic_fixture' : null,
          coordinateQuality: hasCoordinates ? ('address' as const) : ('unknown' as const),
          currentAcceptingStatus: index === 1 || index === 5 ? ('no' as const) : isNever ? ('unknown' as const) : ('yes' as const),
          currentSchedulingStatus: index === 4 ? ('no' as const) : isNever ? ('unknown' as const) : ('yes' as const),
          currentUrgentReferralStatus: index === 3 ? ('yes' as const) : ('no' as const),
          estimatedWaitDays: index === 4 ? 75 : index === 0 ? 7 : 21,
          nextAvailableDate: index === 4 ? new Date(now.valueOf() + 75 * 86_400_000).toISOString().slice(0, 10) : null,
          acceptingVerifiedAt: verifiedAt,
          schedulingVerifiedAt: verifiedAt,
          lastVerifiedAt: verifiedAt,
          dataQualityStatus: index === 6 || index === 7 || index === 8 ? ('needs_review' as const) : ('clean' as const),
          sourceMetadata: { fixture: 'phase4', synthetic: true },
        };
      }));
      const relationshipValues = facilityIds.flatMap((facilityId, index) => {
        const names = index % 3 === 0 ? ['oncology', 'pulmonology'] : [index % 3 === 1 ? 'pulmonology' : 'cardiology'];
        return names.map((name) => ({
          facilityId,
          specialtyId: specialtyId.get(name)!,
          verificationStatus: index === 2 ? ('unknown' as const) : ('yes' as const),
          lastConfirmedAt: index === 2 ? null : daysAgo(index === 1 ? 260 : 30),
          sourceMetadata: { fixture: 'phase4' },
        }));
      });
      await tx.insert(facilitySpecialties).values(relationshipValues);
      await tx.insert(facilityDiagnosisCapabilities).values(facilityIds.flatMap((facilityId, index) => [
        { facilityId, diagnosisId: diagnosisId.get('C50')!, status: index % 3 === 0 ? ('yes' as const) : index % 3 === 1 ? ('no' as const) : ('unknown' as const), lastVerifiedAt: index === 2 ? null : daysAgo(index === 1 ? 150 : 20), sourceMetadata: { fixture: 'phase4' } },
        ...(index === 0 ? [{ facilityId, diagnosisId: diagnosisId.get('J45')!, status: 'yes' as const, lastVerifiedAt: daysAgo(3), sourceMetadata: { fixture: 'phase4' } }] : []),
      ]));
      const verifiedFacilities = facilityIds.filter((_, index) => index !== 2 && index !== 8);
      await tx.insert(facilityVerificationEvents).values(verifiedFacilities.map((facilityId, index) => ({
        facilityId,
        verifiedAt: index === 1 ? daysAgo(70) : daysAgo(4 + index),
        verifiedBy: fixtureUserIds[index % fixtureUserIds.length],
        method: 'phone' as const,
        confidence: 'direct' as const,
        acceptingStatus: index === 1 || index === 5 ? ('no' as const) : ('yes' as const),
        schedulingWithinFourWeeks: index === 4 ? ('no' as const) : ('yes' as const),
        urgentReferralStatus: index === 3 ? ('yes' as const) : ('no' as const),
        estimatedWaitDays: index === 4 ? 75 : 14,
        previousState: { acceptingStatus: 'unknown' },
        resultingState: { acceptingStatus: index === 1 || index === 5 ? 'no' : 'yes' },
        sourceMetadata: { fixture: 'phase4' },
      })));
      await tx.insert(facilityContactAttempts).values([
        { facilityId: facilityIds[1], attemptedAt: daysAgo(2), attemptedBy: fixtureUserIds[0], method: 'phone', outcome: 'no_answer', comments: 'Synthetic failed contact.' },
        { facilityId: facilityIds[1], attemptedAt: daysAgo(1), attemptedBy: fixtureUserIds[1], method: 'phone', outcome: 'voicemail_left', comments: 'Synthetic failed contact.' },
      ]);
      const [leftFacilityId, rightFacilityId] = [facilityIds[10], facilityIds[11]].sort();
      await tx.insert(facilityDuplicateCandidates).values({
        leftFacilityId,
        rightFacilityId,
        confidence: 'possible',
        score: 55,
        reasonCodes: ['Similar name', 'Same ZIP'],
      });
    });
    console.log(`Loaded ${facilityIds.length} synthetic Phase 4 facilities.`);
  } finally {
    await database.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
