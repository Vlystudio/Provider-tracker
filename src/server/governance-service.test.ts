import { describe, expect, it } from 'vitest';
import {
  accessReviewInputSchema,
  incidentScopeInputSchema,
  retentionHoldInputSchema,
  retentionHoldReleaseInputSchema,
  retentionPolicyInputSchema,
} from './governance-service';

const userId = '11111111-1111-4111-8111-111111111111';

describe('governance request validation', () => {
  it('accepts the four access-review decisions only for a calendar quarter', () => {
    expect(accessReviewInputSchema.parse({ reviewedUserId: userId, reviewPeriod: '2026-Q3', decision: 'retain' }).decision).toBe('retain');
    expect(() => accessReviewInputSchema.parse({ reviewedUserId: userId, reviewPeriod: 'third-quarter', decision: 'retain' })).toThrow();
    expect(() => accessReviewInputSchema.parse({ reviewedUserId: userId, reviewPeriod: '2026-Q3', decision: 'certified' })).toThrow();
  });

  it('does not enable deletion without policy evidence and an explicit confirmation', () => {
    expect(retentionPolicyInputSchema.parse({
      category: 'expired_sessions', retentionDays: 30, deletionEnabled: false, policyReference: null,
    }).deletionEnabled).toBe(false);
    expect(() => retentionPolicyInputSchema.parse({
      category: 'expired_sessions', retentionDays: 30, deletionEnabled: true,
      policyReference: 'POLICY-12', confirmation: 'yes',
    })).toThrow('ENABLE RETENTION');
  });

  it('requires a complete entity pair for a narrow hold', () => {
    expect(retentionHoldInputSchema.parse({
      category: 'expired_sessions', entityType: null, entityId: null, reasonCode: 'incident_preservation',
    }).entityId).toBeNull();
    expect(() => retentionHoldInputSchema.parse({
      category: 'expired_sessions', entityType: 'sessions', entityId: null, reasonCode: 'incident_preservation',
    })).toThrow();
    expect(retentionHoldReleaseInputSchema.parse({ reasonCode: 'matter_closed' }).reasonCode).toBe('matter_closed');
    expect(() => retentionHoldReleaseInputSchema.parse({ reasonCode: 'Matter closed after review' })).toThrow();
  });

  it('bounds account-investigation windows', () => {
    expect(incidentScopeInputSchema.parse({
      userId,
      start: '2026-08-01T00:00:00.000Z',
      end: '2026-08-22T00:00:00.000Z',
    }).userId).toBe(userId);
    expect(() => incidentScopeInputSchema.parse({
      userId,
      start: '2024-01-01T00:00:00.000Z',
      end: '2026-08-22T00:00:00.000Z',
    })).toThrow('366 days');
  });
});
