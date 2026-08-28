import { describe, expect, it } from 'vitest';
import {
  bulkAssignmentInputSchema,
  duplicateDecisionInputSchema,
  facilityMergeInputSchema,
  facilityPatchSchema,
  verificationEventInputSchema,
} from './provider-intelligence-service';

const facilityA = '00000000-0000-4000-8000-000000000001';
const facilityB = '00000000-0000-4000-8000-000000000002';

describe('provider intelligence mutation validation', () => {
  it('accepts a partial verification without resetting omitted fields', () => {
    const parsed = verificationEventInputSchema.parse({
      expectedVersion: 2,
      verifiedAt: new Date().toISOString(),
      method: 'phone',
      acceptingStatus: 'yes',
    });
    expect(parsed.acceptingStatus).toBe('yes');
    expect(parsed.schedulingWithinFourWeeks).toBeUndefined();
  });

  it('rejects empty, future, and mass-assigned verification events', () => {
    expect(() => verificationEventInputSchema.parse({ expectedVersion: 0, verifiedAt: new Date().toISOString(), method: 'phone' })).toThrow();
    expect(() => verificationEventInputSchema.parse({ expectedVersion: 0, verifiedAt: new Date(Date.now() + 86_400_000).toISOString(), method: 'phone', acceptingStatus: 'yes' })).toThrow();
    expect(() => verificationEventInputSchema.parse({ expectedVersion: 0, verifiedAt: new Date().toISOString(), method: 'phone', acceptingStatus: 'yes', verifiedBy: facilityA })).toThrow();
  });

  it('requires optimistic versions and explicit merge confirmation', () => {
    expect(facilityMergeInputSchema.parse({
      survivorFacilityId: facilityA,
      mergedFacilityId: facilityB,
      reason: 'Confirmed duplicate records.',
      survivorExpectedVersion: 3,
      mergedExpectedVersion: 1,
      confirmation: 'MERGE',
    }).confirmation).toBe('MERGE');
    expect(() => facilityMergeInputSchema.parse({ survivorFacilityId: facilityA, mergedFacilityId: facilityB, reason: 'Duplicate', survivorExpectedVersion: 0, mergedExpectedVersion: 0, confirmation: 'yes' })).toThrow();
  });

  it('bounds bulk work and rejects unsupported edits', () => {
    expect(bulkAssignmentInputSchema.parse({ facilityIds: [facilityA], assignedTo: facilityB, reasonCodes: ['stale'] }).facilityIds).toHaveLength(1);
    expect(() => bulkAssignmentInputSchema.parse({ facilityIds: Array.from({ length: 101 }, () => facilityA), assignedTo: facilityB, reasonCodes: ['stale'] })).toThrow();
    expect(() => facilityPatchSchema.parse({ expectedVersion: 0, role: 'admin' })).toThrow();
    expect(duplicateDecisionInputSchema.parse({ decision: 'not_duplicate', note: 'Different addresses.' }).decision).toBe('not_duplicate');
  });
});
