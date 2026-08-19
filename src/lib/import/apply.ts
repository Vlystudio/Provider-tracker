import { and, eq, inArray, sql } from 'drizzle-orm';
import { createDatabase } from '../../db/client';
import {
  auditEvents,
  authorizations,
  calls,
  diagnoses,
  facilities,
  facilitySpecialties,
  importBatches,
  importRowResults,
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

export async function applyImportPlan(plan: ImportPlan): Promise<ApplyImportSummary> {
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
      const actorId = importIdentity[0]?.id ?? null;
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
                status: rejected ? ('rejected' as const) : duplicate ? ('duplicate' as const) : ('imported' as const),
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

      for (const batch of chunks(plan.postalCodes)) {
        await tx
          .insert(postalCodeCentroids)
          .values(
            batch.map((postalCode) => ({
              zipCode: postalCode.zipCode,
              latitude: postalCode.latitude,
              longitude: postalCode.longitude,
              geogPoint: { x: postalCode.longitude, y: postalCode.latitude },
              source: `${postalCode.source.workbookKind}:${postalCode.source.sourceFileName}`,
            })),
          )
          .onConflictDoUpdate({
            target: postalCodeCentroids.zipCode,
            set: {
              latitude: sql`excluded.latitude`,
              longitude: sql`excluded.longitude`,
              geogPoint: sql`excluded.geog_point`,
              source: sql`excluded.source`,
              updatedAt: sql`now()`,
            },
          });
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
                phoneRaw: facility.phoneRaw,
                phoneNormalized: facility.phoneNormalized,
                postalCode: facility.postalCode,
                latitude,
                longitude,
                geogPoint: latitude !== null && longitude !== null ? { x: longitude, y: latitude } : null,
                coordinateProvenance:
                  facility.latitude !== null && facility.longitude !== null
                    ? 'workbook_explicit'
                    : centroid
                      ? 'zip_centroid'
                      : null,
                dataQualityStatus: facility.issues.length ? ('needs_review' as const) : ('clean' as const),
                sourceMetadata: {
                  workbookKind: facility.source.workbookKind,
                  sourceFileName: facility.source.sourceFileName,
                  sourceHash: facility.source.sourceHash,
                  sheetName: facility.source.sheetName,
                  rowNumber: facility.source.rowNumber,
                },
              };
            }),
          )
          .onConflictDoUpdate({
            target: [facilities.normalizedName, facilities.normalizedCity],
            set: {
              facilityName: sql`excluded.facility_name`,
              city: sql`excluded.city`,
              displayKey: sql`excluded.display_key`,
              facilityType: sql`excluded.facility_type`,
              autoFillSpecialty: sql`excluded.auto_fill_specialty`,
              phoneRaw: sql`excluded.phone_raw`,
              phoneNormalized: sql`excluded.phone_normalized`,
              postalCode: sql`excluded.postal_code`,
              latitude: sql`excluded.latitude`,
              longitude: sql`excluded.longitude`,
              geogPoint: sql`excluded.geog_point`,
              coordinateProvenance: sql`excluded.coordinate_provenance`,
              dataQualityStatus: sql`excluded.data_quality_status`,
              sourceMetadata: sql`excluded.source_metadata`,
              optimisticLockVersion: sql`${facilities.optimisticLockVersion} + 1`,
              updatedAt: sql`now()`,
            },
          });
      }

      const initials = [
        ...new Set(plan.calls.map((call) => call.callerInitials).filter((value): value is string => Boolean(value))),
      ];
      for (const batch of chunks(initials)) {
        await tx
          .insert(users)
          .values(
            batch.map((initialsValue) => ({
              email: `workbook-${initialsValue.toLowerCase()}@local.invalid`,
              name: `Workbook user ${initialsValue}`,
              displayName: `Workbook user ${initialsValue}`,
              initials: initialsValue,
              role: 'ura_user' as const,
              isActive: false,
            })),
          )
          .onConflictDoNothing({ target: users.initials });
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

      const [facilityRows, specialtyRows, diagnosisRows, lobRows, reasonRows, userRows] = await Promise.all([
        tx.select({ id: facilities.id, normalizedName: facilities.normalizedName, normalizedCity: facilities.normalizedCity }).from(facilities),
        tx.select({ id: specialties.id, normalizedName: specialties.normalizedName }).from(specialties),
        tx.select({ id: diagnoses.id, code: diagnoses.code }).from(diagnoses),
        tx.select({ id: linesOfBusiness.id, code: linesOfBusiness.code }).from(linesOfBusiness),
        tx.select({ id: referralReasons.id, normalizedLabel: referralReasons.normalizedLabel }).from(referralReasons),
        tx.select({ id: users.id, initials: users.initials }).from(users),
      ]);
      const facilityIdByKey = new Map(
        facilityRows.map((facility) => [`${facility.normalizedName}|${facility.normalizedCity}`, facility.id]),
      );
      const specialtyIdByName = new Map(specialtyRows.map((specialty) => [specialty.normalizedName, specialty.id]));
      const diagnosisIdByCode = new Map(diagnosisRows.map((diagnosis) => [diagnosis.code, diagnosis.id]));
      const lobIdByCode = new Map(lobRows.map((lob) => [lob.code, lob.id]));
      const reasonIdByLabel = new Map(reasonRows.map((reason) => [reason.normalizedLabel, reason.id]));
      const userIdByInitials = new Map(userRows.map((user) => [user.initials, user.id]));

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
              treatmentStatus: sql`excluded.treatment_status`,
              notes: sql`excluded.notes`,
              sourceMetadata: sql`excluded.source_metadata`,
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
      for (const batch of chunks(plan.calls)) {
        const inserted = await tx
          .insert(calls)
          .values(
            batch.map((call) => ({
              authorizationId: call.authorizationNumber
                ? authorizationIdByNumber.get(call.authorizationNumber) ?? null
                : null,
              facilityId: facilityIdByKey.get(call.normalizedFacilityKey) ?? null,
              callerUserId: call.callerInitials ? userIdByInitials.get(call.callerInitials) ?? null : null,
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
                issues: call.issues,
              },
            })),
          )
          .onConflictDoNothing({ target: calls.importFingerprint })
          .returning({ id: calls.id });
        insertedCalls += inserted.length;
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
          action: 'workbook_import_applied',
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
