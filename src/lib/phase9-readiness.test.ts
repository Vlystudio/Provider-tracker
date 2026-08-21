import { describe, expect, it } from 'vitest';
import {
  createPhase9EvidenceTemplate,
  evaluatePhase9Readiness,
  parsePhase9Manifest,
  phase9GateDefinitions,
} from './phase9-readiness';

function passAll() {
  const template = createPhase9EvidenceTemplate();
  template.release.commit = '0123456789abcdef0123456789abcdef01234567';
  template.release.imageDigest = `sha256:${'a'.repeat(64)}`;
  for (const gate of phase9GateDefinitions) {
    template.gates[gate.key] = {
      owner: gate.owner,
      available: true,
      configured: true,
      testable: true,
      status: 'pass',
      evidence: [`ticket/${gate.key}`],
      testedAt: '2026-08-21T12:00:00Z',
      approvedBy: 'named approver',
    };
  }
  return template;
}

describe('Phase 9 readiness evidence', () => {
  it('keeps an empty evidence record blocked', () => {
    const result = evaluatePhase9Readiness(createPhase9EvidenceTemplate());
    expect(result.status).toBe('PRODUCTION PILOT BLOCKED — INFRASTRUCTURE VALIDATION REQUIRED');
    expect(result.totals.pending).toBe(phase9GateDefinitions.length);
  });

  it('reports a recorded hard failure separately from missing infrastructure evidence', () => {
    const manifest = createPhase9EvidenceTemplate();
    manifest.gates['network.origin_blocked']!.status = 'fail';
    manifest.gates['network.origin_blocked']!.available = true;
    manifest.gates['network.origin_blocked']!.configured = true;
    manifest.gates['network.origin_blocked']!.testable = true;
    const result = evaluatePhase9Readiness(manifest);
    expect(result.status).toBe('PRODUCTION PILOT BLOCKED — SECURITY/TECHNICAL FAILURE');
  });

  it('requires evidence and approval for every claimed pass', () => {
    const manifest = createPhase9EvidenceTemplate();
    manifest.gates['network.vpn_only']!.status = 'pass';
    manifest.gates['network.vpn_only']!.available = true;
    manifest.gates['network.vpn_only']!.configured = true;
    manifest.gates['network.vpn_only']!.testable = true;
    expect(() => parsePhase9Manifest(manifest)).toThrow(/dated evidence and an approver/);
  });

  it('allows approval with only non-blocking follow-up left', () => {
    const manifest = passAll();
    manifest.gates['follow_up.alert_tuning']!.status = 'pending';
    manifest.gates['follow_up.alert_tuning']!.evidence = [];
    manifest.gates['follow_up.alert_tuning']!.testedAt = null;
    manifest.gates['follow_up.alert_tuning']!.approvedBy = null;
    expect(evaluatePhase9Readiness(manifest).status).toBe('PRODUCTION PILOT APPROVED WITH NON-BLOCKING FOLLOW-UP');
  });

  it('approves only when every gate has passed', () => {
    expect(evaluatePhase9Readiness(passAll()).status).toBe('PRODUCTION PILOT APPROVED');
  });
});
