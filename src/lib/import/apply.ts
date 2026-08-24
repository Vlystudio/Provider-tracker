import { and, eq, inArray, sql } from 'drizzle-orm';
import { createDatabase } from '../../db/client';
import {
  auditEvents,
  authorizations,
  calls,
  diagnoses,
  facilities,
  facilityContactAttempts,
  facilityDiagnosisCapabilities,
  facilitySpecialties,
  facilityVerificationEvents,
  importBatches,
  importRowResults,
  legacyActors,
  linesOfBusiness,
  postalCodeCentroids,
  referralReasons,
  specialties,
  users,
} from '../../db/schema';
import { normalizeKeyPart } from './normalization';
import { safeImportSummary } from './reconcile';
import type { ImportPlan } from './types';

const CHUNK_SIZE = 250;

function verificationAnswer(value: string): 'yes' | 'no' | 'unknown' | 'not_applicable' | 'unable_to_verify' {
  if (value === 'yes' || value === 'no' || value === 'not_applicable') return value;
  if (value === 'unable_to_tell_without_triage') return 'unable_to_verify';
  return 'unknown';
}

function schedulingAnswer(value: string) {
  return value === 'urgent_referral_required' ? ('yes' as const) : verificationAnswer(value);
}

function isConfirmed(value: string) {
  return value === 'yes' || value === 'no' || value === 'not_applicable';
}

function chunks<T>(values: T[], size = CHUNK_SIZE) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

export type ApplyImportSummary = {
  skippedAsAlreadyApplied: boolean;
  appliedSourceHashes: string[];
  existingSourceHashes: string[];
  insertedCalls: number;
  stagedRows: number;
  uniqueFacilities: number;
  uniqueFacilitySpecialties: number;
  uniquePostalCodes: number;
};

export type ApplyImportOptions = {
  actorId?: string | null;
  migrationRunId?: string | null;
  notificationBaselineAt?: Date | null;
  simulateFailureAfterStaging?: boolean;
  legacyActorUserIds?: Record<string, string>;
};

export async function applyImportPlan(
  plan: ImportPlan,
  options: ApplyImportOptions = {},
): Promise<ApplyImportSummary> {
  const database = createDatabase();
  try {
    return await database.db.transaction(async (tx) => {
      const hashes = plan.sources.map((source) => source.sourceHash);
      const existingBatches = hashes.length
        ? await tx
            .select()
            .from(importBatches)
            .where(
              and(
                inArray(importBatches.sourceHash, hashes),
                eq(importBatches.importerVersion, plan.importerVersion),
              ),
            )
        : [];
      const existingByHash = new Map(existingBatches.map((batch) => [batch.sourceHash, batch]));
      const existingSourceHashes = existingBatches
        .filter((batch) => batch.status === 'applied')
        .map((batch) => batch.sourceHash);
      const newSources = plan.sources.filter(
        (source) => existingByHash.get(source.sourceHash)?.status !== 'applied',
      );
      if (!newSources.length) {
        return {
          skippedAsAlreadyApplied: true,
          appliedSourceHashes: [],
          existingSourceHashes,
          insertedCalls: 0,
          stagedRows: 0,
          uniqueFacilities: plan.facilities.length,
          uniqueFacilitySpecialties: plan.facilitySpecialties.length,
          uniquePostalCodes: plan.postalCodes.length,
        };
      }

      const importIdentity = await tx
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, 'system-import@local.invalid'))
        .limit(1);
      const actorId = options.actorId ?? importIdentity[0]?.id ?? null;
      const batchIdByHash = new Map<string, string>();

      for (const source of plan.sources) {
        const existing = existingByHash.get(source.sourceHash);
        if (existing) {
          batchIdByHash.set(source.sourceHash, existing.id);
          if (existing.status !== 'applied') {
            await tx
              .update(importBatches)
              .set({
                status: 'pending',
                sourceFileName: source.sourceFileName,
                sourceSizeBytes: source.sizeBytes,
                counts: {},
                summary: {},
                migrationRunId: options.migrationRunId ?? null,
                actorId,
                completedAt: null,
                updatedAt: sql`now()`,
              })
              .where(eq(importBatches.id, existing.id));
          }
          continue;
        }

        const inserted = await tx
          .insert(importBatches)
          .values({
            sourceFileName: source.sourceFileName,
            sourceHash: source.sourceHash,
            sourceSizeBytes: source.sizeBytes,
            workbookKind: source.workbookKind,
            importerVersion: plan.importerVersion,
            migrationRunId: options.migrationRunId ?? null,
            status: 'pending',
            actorId,
          })
          .returning({ id: importBatches.id });
        batchIdByHash.set(source.sourceHash, inserted[0].id);
      }

      const newHashes = new Set(newSources.map((source) => source.sourceHash));
      const stagedRows = plan.stagedRows.filter((row) => newHashes.has(row.source.sourceHash));
      const seenFingerprints = new Set<string>();
      for (const batch of chunks(stagedRows)) {
        await tx
          .insert(importRowResults)
          .values(
            batch.map((row) => {
              const dedupeKey = `${row.entityType}:${row.fingerprint}`;
              const duplicate = seenFingerprints.has(dedupeKey);
              seenFingerprints.add(dedupeKey);
              const rejected =
                row.status === 'rejected' || row.issues.includes('mapping_facility_not_in_master');
              return {
                batchId: batchIdByHash.get(row.source.sourceHash)!,
                entityType: row.entityType,
                sheetName: row.source.sheetName,
                sourceRow: row.source.rowNumber,
                fingerprint: row.fingerprint,
                status: rejected
                  ? ('rejected' as const)
                  : row.status === 'skipped'
                    ? ('skipped' as const)
                    : duplicate
                      ? ('duplicate' as const)
                      : ('imported' as const),
                rawData: row.rawData,
                normalizedData: row.normalizedData,
                issues: row.issues,
              };
            }),
          )
          .onConflictDoUpdate({
            target: [
              importRowResults.batchId,
              importRowResults.entityType,
              importRowResults.sheetName,
              importRowResults.sourceRow,
            ],
            set: {
              fingerprint: sql`excluded.fingerprint`,
              status: sql`excluded.status`,
              rawData: sql`excluded.raw_data`,
              normalizedData: sql`excluded.normalized_data`,
              issues: sql`excluded.issues`,
              updatedAt: sql`now()`,
            },
          });
      }
      if (options.simulateFailureAfterStaging) {
        throw new Error('Simulated migration failure after staging.');
      }

      for (const batch of chunks(plan.postalCodes)) {
        await tx
          .insert(postalCodeCentroids)
          .values(
            batch.map((postalCode) => ({
              zipCode: postalCode.zipCode,
              latitude: postalCode.latitude,
              longitude: postalCode.longitude,
              geogPoint: sql`ST_SetSRID(ST_MakePoint(${postalCode.longitude}, ${postalCode.latitude}), 4326)`,
              source: `${postalCode.source.workbookKind}:${postalCode.source.sourceFileName}`,
            })),
          )
          .onConflictDoNothing({ target: postalCodeCentroids.zipCode });
      }

      const postalCodeMap = new Map(
        plan.postalCodes.map((postalCode) => [postalCode.zipCode.slice(0, 5), postalCode]),
      );
      for (const batch of chunks(plan.facilities)) {
        await tx
          .insert(facilities)
          .values(
            batch.map((facility) => {
              const centroid = facility.postalCode
                ? postalCodeMap.get(facility.postalCode.slice(0, 5))
                : undefined;
              const latitude = facility.latitude ?? centroid?.latitude ?? null;
              const longitude = facility.longitude ?? centroid?.longitude ?? null;
              return {
                facilityName: facility.facilityName,
                city: facility.city,
                normalizedName: facility.normalizedName,
                normalizedCity: facility.normalizedCity,
                displayKey: facility.displayKey,
                facilityType: facility.facilityType,
                autoFillSpecialty: facility.autoFillSpecialty,
                active: facility.active,
                phoneRaw: facility.phoneRaw,
                phoneNormalized: facility.phoneNormalized,
                postalCode: facility.postalCode,
                latitude,
                longitude,
                geogPoint:
                  latitude !== null && longitude !== null
                    ? sql`ST_SetSRID(ST_MakePoint(${longitude}, ${latitude}), 4326)`
                    : null,
                coordinateProvenance:
                  facility.latitude !== null && facility.longitude !== null
                    ? 'workbook_explicit'
                    : centroid
                      ? 'zip_centroid'
                      : null,
                coordinateQuality:
                  facility.latitude !== null && facility.longitude !== null
                    ? ('manual' as const)
                    : centroid
                      ? ('zip_centroid' as const)
                      : ('unknown' as const),
                dataQualityStatus: facility.issues.length ? ('needs_review' as const) : ('clean' as const),
                sourceMetadata: {
                  workbookKind: facility.source.workbookKind,
                  sourceFileName: facility.source.sourceFileName,
                  sourceHash: facility.source.sourceHash,
                  sheetName: facility.source.sheetName,
                  rowNumber: facility.source.rowNumber,
                  legacyStatus: facility.legacyStatus,
                },
                migrationBaselineAt: options.notificationBaselineAt ?? null,
              };
            }),
          )
          .onConflictDoUpdate({
            target: [facilities.normalizedName, facilities.normalizedCity],
            set: {
              phoneRaw: sql`case when ${facilities.phoneVerifiedAt} is null then excluded.phone_raw else ${facilities.phoneRaw} end`,
              phoneNormalized: sql`case when ${facilities.phoneVerifiedAt} is null then excluded.phone_normalized else ${facilities.phoneNormalized} end`,
              postalCode: sql`case when ${facilities.addressVerifiedAt} is null then excluded.postal_code else ${facilities.postalCode} end`,
              latitude: sql`case when ${facilities.addressVerifiedAt} is null then excluded.latitude else ${facilities.latitude} end`,
              longitude: sql`case when ${facilities.addressVerifiedAt} is null then excluded.longitude else ${facilities.longitude} end`,
              geogPoint: sql`case when ${facilities.addressVerifiedAt} is null then excluded.geog_point else ${facilities.geogPoint} end`,
              coordinateProvenance: sql`case when ${facilities.addressVerifiedAt} is null then excluded.coordinate_provenance else ${facilities.coordinateProvenance} end`,
              coordinateQuality: sql`case when ${facilities.addressVerifiedAt} is null then excluded.coordinate_quality else ${facilities.coordinateQuality} end`,
              dataQualityStatus: sql`case when ${facilities.dataQualityStatus} = 'rejected' then ${facilities.dataQualityStatus} else excluded.data_quality_status end`,
              sourceMetadata: sql`${facilities.sourceMetadata} || excluded.source_metadata`,
              optimisticLockVersion: sql`${facilities.optimisticLockVersion} + 1`,
              updatedAt: sql`now()`,
            },
          });
      }

      const initials = [
        ...new Set(plan.calls.map((call) => call.callerInitials).filter((value): value is string => Boolean(value))),
      ];
      const currentUsers = initials.length
        ? await tx
            .select({ id: users.id, initials: users.initials, isActive: users.isActive })
            .from(users)
            .where(inArray(users.initials, initials))
        : [];
      const usersByInitials = new Map<string, string[]>();
      for (const user of currentUsers) {
        if (!user.isActive) continue;
        const normalized = normalizeKeyPart(user.initials);
        usersByInitials.set(normalized, [...(usersByInitials.get(normalized) ?? []), user.id]);
      }
      for (const batch of chunks(initials)) {
        await tx
          .insert(legacyActors)
          .values(batch.map((initialsValue) => {
            const normalizedKey = normalizeKeyPart(initialsValue);
            const reviewedUserId = options.legacyActorUserIds?.[normalizedKey];
            const matches = reviewedUserId ? [reviewedUserId] : usersByInitials.get(normalizedKey) ?? [];
            return {
              normalizedKey,
              initials: initialsValue,
              displayName: `Legacy ${initialsValue}`,
              status: matches.length === 1 ? ('mapped' as const) : matches.length > 1 ? ('ambiguous' as const) : ('legacy_only' as const),
              mappedUserId: matches.length === 1 ? matches[0] : null,
              sourceMetadata: { source: 'legacy_workbook' },
              mappedBy: matches.length === 1 ? actorId : null,
              mappedAt: matches.length === 1 ? sql`now()` : null,
            };
          }))
          .onConflictDoUpdate({
            target: legacyActors.normalizedKey,
            set: {
              initials: sql`excluded.initials`,
              mappedUserId: sql`coalesce(excluded.mapped_user_id, ${legacyActors.mappedUserId})`,
              status: sql`case when excluded.mapped_user_id is not null then 'mapped'::legacy_actor_status else ${legacyActors.status} end`,
              mappedBy: sql`coalesce(excluded.mapped_by, ${legacyActors.mappedBy})`,
              mappedAt: sql`coalesce(excluded.mapped_at, ${legacyActors.mappedAt})`,
              updatedAt: sql`now()`,
            },
          });
      }

      const lobs = [...new Set(plan.calls.map((call) => call.lob).filter((value): value is string => Boolean(value)))];
      for (const batch of chunks(lobs)) {
        await tx
          .insert(linesOfBusiness)
          .values(batch.map((code) => ({ code, label: code })))
          .onConflictDoNothing({ target: linesOfBusiness.code });
      }

      const specialtyCandidates = new Map<string, string>();
      for (const mapping of plan.facilitySpecialties) {
        if (mapping.normalizedSpecialty) specialtyCandidates.set(mapping.normalizedSpecialty, mapping.specialty);
      }
      for (const call of plan.calls) {
        if (call.normalizedSpecialty && call.specialty) specialtyCandidates.set(call.normalizedSpecialty, call.specialty);
      }
      for (const batch of chunks([...specialtyCandidates.entries()])) {
        await tx
          .insert(specialties)
          .values(batch.map(([normalizedName, canonicalName]) => ({ canonicalName, normalizedName })))
          .onConflictDoNothing({ target: specialties.normalizedName });
      }

      const diagnosisCandidates = new Map<string, string>();
      for (const call of plan.calls) {
        if (call.diagnosisCode) {
          diagnosisCandidates.set(call.diagnosisCode, call.diagnosisDescription ?? 'Description unavailable');
        }
      }
      for (const batch of chunks([...diagnosisCandidates.entries()])) {
        await tx
          .insert(diagnoses)
          .values(batch.map(([code, description]) => ({ code, description })))
          .onConflictDoUpdate({
            target: diagnoses.code,
            set: {
              description: sql`case when excluded.description = 'Description unavailable' then ${diagnoses.description} else excluded.description end`,
              updatedAt: sql`now()`,
            },
          });
      }

      const reasonCandidates = new Map<string, string>();
      for (const call of plan.calls) {
        if (call.referralReason) reasonCandidates.set(normalizeKeyPart(call.referralReason), call.referralReason);
      }
      for (const batch of chunks([...reasonCandidates.entries()])) {
        await tx
          .insert(referralReasons)
          .values(batch.map(([normalizedLabel, label]) => ({ normalizedLabel, label })))
          .onConflictDoNothing({ target: referralReasons.normalizedLabel });
      }

      const [facilityRows, specialtyRows, diagnosisRows, lobRows, reasonRows, legacyActorRows] = await Promise.all([
        tx.select({ id: facilities.id, normalizedName: facilities.normalizedName, normalizedCity: facilities.normalizedCity }).from(facilities),
        tx.select({ id: specialties.id, normalizedName: specialties.normalizedName }).from(specialties),
        tx.select({ id: diagnoses.id, code: diagnoses.code }).from(diagnoses),
        tx.select({ id: linesOfBusiness.id, code: linesOfBusiness.code }).from(linesOfBusiness),
        tx.select({ id: referralReasons.id, normalizedLabel: referralReasons.normalizedLabel }).from(referralReasons),
        tx.select({ id: legacyActors.id, normalizedKey: legacyActors.normalizedKey, mappedUserId: legacyActors.mappedUserId }).from(legacyActors),
      ]);
      const facilityIdByKey = new Map(
        facilityRows.map((facility) => [`${facility.normalizedName}|${facility.normalizedCity}`, facility.id]),
      );
      const specialtyIdByName = new Map(specialtyRows.map((specialty) => [specialty.normalizedName, specialty.id]));
      const diagnosisIdByCode = new Map(diagnosisRows.map((diagnosis) => [diagnosis.code, diagnosis.id]));
      const lobIdByCode = new Map(lobRows.map((lob) => [lob.code, lob.id]));
      const reasonIdByLabel = new Map(reasonRows.map((reason) => [reason.normalizedLabel, reason.id]));
      const legacyActorByInitials = new Map(legacyActorRows.map((legacyActor) => [legacyActor.normalizedKey, legacyActor]));

      for (const batch of chunks(plan.facilitySpecialties)) {
        const values = batch.flatMap((mapping) => {
          const facilityId = facilityIdByKey.get(mapping.normalizedFacilityKey);
          const specialtyId = specialtyIdByName.get(mapping.normalizedSpecialty);
          if (!facilityId || !specialtyId) return [];
          return [
            {
              facilityId,
              specialtyId,
              treatmentStatus: mapping.treatmentStatus,
              notes: mapping.notes,
              sourceMetadata: {
                sourceHash: mapping.source.sourceHash,
                sourceFileName: mapping.source.sourceFileName,
                sheetName: mapping.source.sheetName,
                rowNumber: mapping.source.rowNumber,
              },
            },
          ];
        });
        if (!values.length) continue;
        await tx
          .insert(facilitySpecialties)
          .values(values)
          .onConflictDoUpdate({
            target: [facilitySpecialties.facilityId, facilitySpecialties.specialtyId],
            set: {
              treatmentStatus: sql`case when ${facilitySpecialties.lastConfirmedAt} is null then excluded.treatment_status else ${facilitySpecialties.treatmentStatus} end`,
              notes: sql`case when ${facilitySpecialties.lastConfirmedAt} is null then excluded.notes else ${facilitySpecialties.notes} end`,
              sourceMetadata: sql`${facilitySpecialties.sourceMetadata} || excluded.source_metadata`,
              updatedAt: sql`now()`,
            },
          });
      }

      const authorizationCandidates = new Map<string, (typeof plan.calls)[number]>();
      for (const call of plan.calls) {
        if (call.authorizationNumber && !authorizationCandidates.has(call.authorizationNumber)) {
          authorizationCandidates.set(call.authorizationNumber, call);
        }
      }
      for (const batch of chunks([...authorizationCandidates.entries()])) {
        await tx
          .insert(authorizations)
          .values(
            batch.map(([authorizationNumber, call]) => ({
              authorizationNumber,
              lobId: call.lob ? lobIdByCode.get(call.lob) ?? null : null,
              defaultDiagnosisId: call.diagnosisCode ? diagnosisIdByCode.get(call.diagnosisCode) ?? null : null,
              defaultSpecialtyId: call.normalizedSpecialty
                ? specialtyIdByName.get(call.normalizedSpecialty) ?? null
                : null,
              referralReasonId: call.referralReason
                ? reasonIdByLabel.get(normalizeKeyPart(call.referralReason)) ?? null
                : null,
              referralReasonDetail: call.referralReason,
            })),
          )
          .onConflictDoNothing({ target: authorizations.authorizationNumber });
      }

      const authorizationRows = await tx
        .select({ id: authorizations.id, authorizationNumber: authorizations.authorizationNumber })
        .from(authorizations);
      const authorizationIdByNumber = new Map(
        authorizationRows.map((authorization) => [authorization.authorizationNumber, authorization.id]),
      );

      let insertedCalls = 0;
      const callByFingerprint = new Map(plan.calls.map((call) => [call.fingerprint, call]));
      for (const batch of chunks(plan.calls)) {
        const inserted = await tx
          .insert(calls)
          .values(
            batch.map((call) => ({
              authorizationId: call.authorizationNumber
                ? authorizationIdByNumber.get(call.authorizationNumber) ?? null
                : null,
              facilityId: facilityIdByKey.get(call.normalizedFacilityKey) ?? null,
              callerUserId: call.callerInitials ? legacyActorByInitials.get(normalizeKeyPart(call.callerInitials))?.mappedUserId ?? null : null,
              legacyActorId: call.callerInitials ? legacyActorByInitials.get(normalizeKeyPart(call.callerInitials))?.id ?? null : null,
              importBatchId: batchIdByHash.get(call.source.sourceHash) ?? null,
              callAt: new Date(call.callAt),
              callerInitialsSnapshot: call.callerInitials,
              lobSnapshot: call.lob,
              authorizationNumberSnapshot: call.authorizationNumber,
              facilitySnapshot: call.facilityDisplayKey,
              diagnosisCodeSnapshot: call.diagnosisCode,
              diagnosisDescriptionSnapshot: call.diagnosisDescription,
              specialtySnapshot: call.specialty,
              phoneSnapshot: call.phone,
              didNotLeaveVm: call.didNotLeaveVm,
              acceptingNewPatients: call.acceptingNewPatients,
              canTreatDiagnosis: call.canTreatDiagnosis,
              canScheduleWithinFourWeeks: call.canScheduleWithinFourWeeks,
              bookingOutRaw: call.bookingOut,
              notes: call.notes,
              referralTypeSnapshot: call.referralType,
              referralReasonSnapshot: call.referralReason,
              specialtyConfirmed: call.specialtyConfirmed,
              useInFdm: call.useInFdm,
              manualCallTimeOverride: call.manualCallTimeOverride
                ? new Date(call.manualCallTimeOverride)
                : null,
              weekStart: call.weekStart,
              duplicateGroupKey: call.duplicateGroupKey,
              resultCode: call.resultCode,
              resultPhrase: call.resultPhrase,
              importFingerprint: call.fingerprint,
              sourceWorkbook: call.source.sourceFileName,
              sourceSheet: call.source.sheetName,
              sourceRow: call.source.rowNumber,
              sourceMetadata: {
                sourceHash: call.source.sourceHash,
                workbookKind: call.source.workbookKind,
                logicalFingerprint: call.logicalFingerprint,
                importedResultPhrase: call.importedResultPhrase,
                legacyAnswers: call.legacyAnswers,
                issues: call.issues,
              },
            })),
          )
          .onConflictDoNothing({ target: calls.importFingerprint })
          .returning({ id: calls.id, fingerprint: calls.importFingerprint });
        insertedCalls += inserted.length;
        for (const record of inserted) {
          const call = record.fingerprint ? callByFingerprint.get(record.fingerprint) : undefined;
          if (!call) continue;
          const facilityId = facilityIdByKey.get(call.normalizedFacilityKey);
          if (!facilityId) continue;
          const callAt = new Date(call.callAt);
          const legacyActor = call.callerInitials
            ? legacyActorByInitials.get(normalizeKeyPart(call.callerInitials))
            : undefined;
          const callerUserId = legacyActor?.mappedUserId ?? null;
          if (call.resultCode === 'unable_to_contact') {
            await tx.insert(facilityContactAttempts).values({
              facilityId,
              attemptedAt: callAt,
              attemptedBy: callerUserId,
              legacyActorId: legacyActor?.id ?? null,
              method: 'phone',
              outcome: call.didNotLeaveVm ? 'voicemail_not_left' : 'no_answer',
              relatedCallId: record.id,
            });
            continue;
          }
          const specialtyId = call.normalizedSpecialty ? specialtyIdByName.get(call.normalizedSpecialty) ?? null : null;
          const diagnosisId = call.diagnosisCode ? diagnosisIdByCode.get(call.diagnosisCode) ?? null : null;
          const acceptingStatus = verificationAnswer(call.acceptingNewPatients);
          const specialtyStatus = verificationAnswer(call.specialtyConfirmed);
          const diagnosisStatus = verificationAnswer(call.canTreatDiagnosis);
          const schedulingStatus = schedulingAnswer(call.canScheduleWithinFourWeeks);
          await tx.insert(facilityVerificationEvents).values({
            facilityId,
            verifiedAt: callAt,
            verifiedBy: callerUserId,
            legacyActorId: legacyActor?.id ?? null,
            method: 'internal_source',
            confidence: 'secondary',
            acceptingStatus,
            specialtyId,
            specialtyStatus,
            diagnosisId,
            diagnosisStatus,
            schedulingWithinFourWeeks: schedulingStatus,
            urgentReferralStatus: call.canScheduleWithinFourWeeks === 'urgent_referral_required' ? 'yes' : null,
            relatedCallId: record.id,
            importBatchId: batchIdByHash.get(call.source.sourceHash) ?? null,
            sourceMetadata: {
              sourceHash: call.source.sourceHash,
              sourceFileName: call.source.sourceFileName,
              sheetName: call.source.sheetName,
              rowNumber: call.source.rowNumber,
            },
          });
          await tx.update(facilities).set({
            ...(isConfirmed(acceptingStatus) ? {
              currentAcceptingStatus: sql`case when ${facilities.acceptingVerifiedAt} is null or ${facilities.acceptingVerifiedAt} < ${callAt} then ${acceptingStatus}::verification_answer else ${facilities.currentAcceptingStatus} end`,
              acceptingVerifiedAt: sql`greatest(${facilities.acceptingVerifiedAt}, ${callAt})`,
            } : {}),
            ...(isConfirmed(schedulingStatus) ? {
              currentSchedulingStatus: sql`case when ${facilities.schedulingVerifiedAt} is null or ${facilities.schedulingVerifiedAt} < ${callAt} then ${schedulingStatus}::verification_answer else ${facilities.currentSchedulingStatus} end`,
              ...(call.canScheduleWithinFourWeeks === 'urgent_referral_required' ? {
                currentUrgentReferralStatus: sql`case when ${facilities.schedulingVerifiedAt} is null or ${facilities.schedulingVerifiedAt} < ${callAt} then 'yes'::verification_answer else ${facilities.currentUrgentReferralStatus} end`,
              } : {}),
              schedulingVerifiedAt: sql`greatest(${facilities.schedulingVerifiedAt}, ${callAt})`,
            } : {}),
            lastVerifiedAt: sql`greatest(${facilities.lastVerifiedAt}, ${callAt})`,
            optimisticLockVersion: sql`${facilities.optimisticLockVersion} + 1`,
            updatedAt: sql`now()`,
          }).where(eq(facilities.id, facilityId));
          if (specialtyId) {
            await tx.update(facilitySpecialties).set({
              verificationStatus: specialtyStatus,
              ...(isConfirmed(specialtyStatus) ? { lastConfirmedAt: sql`greatest(${facilitySpecialties.lastConfirmedAt}, ${callAt})` } : {}),
              confirmingCallId: record.id,
              optimisticLockVersion: sql`${facilitySpecialties.optimisticLockVersion} + 1`,
              updatedAt: sql`now()`,
            }).where(and(eq(facilitySpecialties.facilityId, facilityId), eq(facilitySpecialties.specialtyId, specialtyId), sql`${facilitySpecialties.lastConfirmedAt} is null or ${facilitySpecialties.lastConfirmedAt} <= ${callAt}`));
          }
          if (diagnosisId) {
            await tx.insert(facilityDiagnosisCapabilities).values({
              facilityId,
              diagnosisId,
              status: diagnosisStatus,
              lastVerifiedAt: isConfirmed(diagnosisStatus) ? callAt : null,
              sourceMetadata: { sourceHash: call.source.sourceHash, sourceRow: call.source.rowNumber },
            }).onConflictDoUpdate({
              target: [facilityDiagnosisCapabilities.facilityId, facilityDiagnosisCapabilities.diagnosisId],
              set: {
                status: sql`case when ${facilityDiagnosisCapabilities.lastVerifiedAt} is null or ${facilityDiagnosisCapabilities.lastVerifiedAt} <= ${callAt} then excluded.status else ${facilityDiagnosisCapabilities.status} end`,
                lastVerifiedAt: sql`greatest(${facilityDiagnosisCapabilities.lastVerifiedAt}, excluded.last_verified_at)`,
                sourceMetadata: sql`${facilityDiagnosisCapabilities.sourceMetadata} || excluded.source_metadata`,
                optimisticLockVersion: sql`${facilityDiagnosisCapabilities.optimisticLockVersion} + 1`,
                updatedAt: sql`now()`,
              },
            });
          }
        }
      }

      const safeSummary = safeImportSummary(plan, 10);
      for (const source of newSources) {
        const batchId = batchIdByHash.get(source.sourceHash)!;
        const sourceRows = stagedRows.filter((row) => row.source.sourceHash === source.sourceHash);
        const sourceCounts = {
          stagedRows: sourceRows.length,
          rejectedRows: sourceRows.filter(
            (row) => row.status === 'rejected' || row.issues.includes('mapping_facility_not_in_master'),
          ).length,
          calls: plan.calls.filter((call) => call.source.sourceHash === source.sourceHash).length,
          facilities: plan.facilities.filter((facility) => facility.source.sourceHash === source.sourceHash).length,
          facilitySpecialties: plan.facilitySpecialties.filter(
            (mapping) => mapping.source.sourceHash === source.sourceHash,
          ).length,
          postalCodes: plan.postalCodes.filter((postalCode) => postalCode.source.sourceHash === source.sourceHash)
            .length,
        };
        await tx
          .update(importBatches)
          .set({
            status: 'applied',
            counts: sourceCounts,
            summary: safeSummary,
            completedAt: sql`now()`,
            updatedAt: sql`now()`,
          })
          .where(eq(importBatches.id, batchId));
        await tx.insert(auditEvents).values({
          actorId,
           action: 'workbook.import.applied',
           result: 'success',
          entityType: 'import_batch',
          entityId: batchId,
          afterJson: { sourceHash: source.sourceHash, importerVersion: plan.importerVersion, counts: sourceCounts },
        });
      }

      return {
        skippedAsAlreadyApplied: false,
        appliedSourceHashes: newSources.map((source) => source.sourceHash),
        existingSourceHashes,
        insertedCalls,
        stagedRows: stagedRows.length,
        uniqueFacilities: plan.facilities.length,
        uniqueFacilitySpecialties: plan.facilitySpecialties.length,
        uniquePostalCodes: plan.postalCodes.length,
      };
    });
  } finally {
    await database.close();
  }
}
