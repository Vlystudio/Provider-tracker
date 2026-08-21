export type Phase9GateStatus = 'pending' | 'pass' | 'fail' | 'not_applicable';

export type Phase9GateDefinition = {
  key: string;
  category: string;
  label: string;
  owner: string;
  deploymentBlocker: boolean;
};

export type Phase9GateEvidence = {
  owner?: string;
  available: boolean;
  configured: boolean;
  testable: boolean;
  status: Phase9GateStatus;
  evidence: string[];
  testedAt?: string | null;
  approvedBy?: string | null;
  notes?: string;
};

export type Phase9EvidenceManifest = {
  schemaVersion: 1;
  environment: 'staging';
  release: {
    commit: string;
    imageDigest: string;
  };
  gates: Record<string, Phase9GateEvidence>;
};

export type Phase9Evaluation = {
  status:
    | 'PRODUCTION PILOT APPROVED'
    | 'PRODUCTION PILOT APPROVED WITH NON-BLOCKING FOLLOW-UP'
    | 'PRODUCTION PILOT BLOCKED — INFRASTRUCTURE VALIDATION REQUIRED'
    | 'PRODUCTION PILOT BLOCKED — SECURITY/TECHNICAL FAILURE';
  totals: Record<Phase9GateStatus | 'missing', number>;
  gates: Array<Phase9GateDefinition & Phase9GateEvidence & { recorded: boolean }>;
};

export const phase9GateDefinitions: Phase9GateDefinition[] = [
  { key: 'network.vpn_only', category: 'Network', label: 'VPN-only access verified', owner: 'Network', deploymentBlocker: true },
  { key: 'network.public_blocked', category: 'Network', label: 'Public application access blocked', owner: 'Network', deploymentBlocker: true },
  { key: 'network.origin_blocked', category: 'Network', label: 'Direct origin blocked', owner: 'Network', deploymentBlocker: true },
  { key: 'network.private_dns', category: 'Network', label: 'Private DNS verified', owner: 'Network/DNS', deploymentBlocker: true },
  { key: 'network.proxy_trust', category: 'Network', label: 'Trusted proxy behavior verified', owner: 'Ingress', deploymentBlocker: true },
  { key: 'network.database_public_blocked', category: 'Network', label: 'PostgreSQL public access blocked', owner: 'Network/DBA', deploymentBlocker: true },
  { key: 'network.database_vpn_blocked', category: 'Network', label: 'Ordinary VPN clients cannot reach PostgreSQL', owner: 'Network/DBA', deploymentBlocker: true },
  { key: 'identity.strategy', category: 'Identity', label: 'Approved production identity strategy validated', owner: 'Identity/Security', deploymentBlocker: true },
  { key: 'identity.mfa', category: 'Identity', label: 'Corporate MFA requirement validated', owner: 'Identity/Security', deploymentBlocker: true },
  { key: 'identity.role_mapping', category: 'Identity', label: 'Role mapping remains server controlled', owner: 'Application/Security', deploymentBlocker: true },
  { key: 'identity.sessions', category: 'Identity', label: 'Session and revocation behavior passes', owner: 'Application/Security', deploymentBlocker: true },
  { key: 'identity.disabled_users', category: 'Identity', label: 'Disabled users are blocked', owner: 'Identity/Application', deploymentBlocker: true },
  { key: 'identity.production_paths', category: 'Identity', label: 'No inappropriate authentication paths remain', owner: 'Identity/Application', deploymentBlocker: true },
  { key: 'transport.https', category: 'TLS / Secrets', label: 'HTTPS validated', owner: 'Ingress', deploymentBlocker: true },
  { key: 'transport.secure_cookies', category: 'TLS / Secrets', label: 'Secure cookies validated', owner: 'Application/Security', deploymentBlocker: true },
  { key: 'secrets.managed', category: 'TLS / Secrets', label: 'Managed secrets configured', owner: 'Platform/Security', deploymentBlocker: true },
  { key: 'secrets.failure', category: 'TLS / Secrets', label: 'Secret failure remains fail-closed', owner: 'Platform/Application', deploymentBlocker: true },
  { key: 'secrets.rotation', category: 'TLS / Secrets', label: 'Rotation rehearsal completed', owner: 'Platform/Security', deploymentBlocker: true },
  { key: 'database.postgis', category: 'Database', label: 'PostGIS migration passes', owner: 'DBA', deploymentBlocker: true },
  { key: 'database.spatial_indexes', category: 'Database', label: 'Spatial indexes verified', owner: 'DBA/Application', deploymentBlocker: true },
  { key: 'database.geographic_correctness', category: 'Database', label: 'Geographic correctness passes', owner: 'Application/DBA', deploymentBlocker: true },
  { key: 'database.geographic_benchmark', category: 'Database', label: 'Geographic benchmark passes', owner: 'Application/DBA', deploymentBlocker: true },
  { key: 'database.least_privilege', category: 'Database', label: 'Least privilege passes on staging PostgreSQL', owner: 'DBA/Security', deploymentBlocker: true },
  { key: 'database.tls', category: 'Database', label: 'Database TLS validated', owner: 'DBA/Security', deploymentBlocker: true },
  { key: 'container.build', category: 'Container', label: 'Production image builds', owner: 'Platform/Release', deploymentBlocker: true },
  { key: 'container.scan', category: 'Container', label: 'Container scan completed', owner: 'Security/Release', deploymentBlocker: true },
  { key: 'container.findings', category: 'Container', label: 'No exploitable Critical or High findings', owner: 'Security', deploymentBlocker: true },
  { key: 'container.non_root', category: 'Container', label: 'Non-root runtime validated', owner: 'Platform', deploymentBlocker: true },
  { key: 'container.runtime', category: 'Container', label: 'Runtime privileges minimized', owner: 'Platform/Security', deploymentBlocker: true },
  { key: 'operations.logging', category: 'Operations', label: 'Central logging active', owner: 'Logging', deploymentBlocker: true },
  { key: 'operations.correlation', category: 'Operations', label: 'Request correlation confirmed end-to-end', owner: 'Logging/Application', deploymentBlocker: true },
  { key: 'operations.monitoring', category: 'Operations', label: 'Monitoring active', owner: 'Operations', deploymentBlocker: true },
  { key: 'operations.alerts', category: 'Operations', label: 'Alerts tested', owner: 'Operations/Security', deploymentBlocker: true },
  { key: 'operations.scheduler', category: 'Operations', label: 'Production scheduler active', owner: 'Operations', deploymentBlocker: true },
  { key: 'operations.backup', category: 'Operations', label: 'Managed backup active', owner: 'Backup/DBA', deploymentBlocker: true },
  { key: 'operations.restore', category: 'Operations', label: 'Full PostGIS restore passes', owner: 'Backup/DBA', deploymentBlocker: true },
  { key: 'migration.rehearsal', category: 'Migration / Data', label: 'Migration rehearsal passes', owner: 'Migration', deploymentBlocker: true },
  { key: 'migration.reconciliation', category: 'Migration / Data', label: 'Reconciliation passes', owner: 'Migration/Operations', deploymentBlocker: true },
  { key: 'migration.record_loss', category: 'Migration / Data', label: 'No unexplained record loss', owner: 'Migration/Operations', deploymentBlocker: true },
  { key: 'migration.history', category: 'Migration / Data', label: 'Historical semantics preserved', owner: 'Migration/Operations', deploymentBlocker: true },
  { key: 'migration.automation', category: 'Migration / Data', label: 'Initial automation baseline is safe', owner: 'Operations', deploymentBlocker: true },
  { key: 'pilot.cohort', category: 'UAT / Pilot', label: 'Pilot cohort defined', owner: 'Business', deploymentBlocker: true },
  { key: 'pilot.least_privilege', category: 'UAT / Pilot', label: 'Pilot accounts are least privileged', owner: 'Identity/Application', deploymentBlocker: true },
  { key: 'pilot.uat', category: 'UAT / Pilot', label: 'UAT process completed', owner: 'Business', deploymentBlocker: true },
  { key: 'pilot.defects', category: 'UAT / Pilot', label: 'Blocking UAT defects resolved', owner: 'Business/Application', deploymentBlocker: true },
  { key: 'pilot.rollback', category: 'UAT / Pilot', label: 'Rollback is ready', owner: 'Cutover/DBA', deploymentBlocker: true },
  { key: 'pilot.monitoring', category: 'UAT / Pilot', label: 'Pilot monitoring is ready', owner: 'Operations', deploymentBlocker: true },
  { key: 'security.hostile_suite', category: 'Security', label: 'Hostile-request tests remain green', owner: 'Application/Security', deploymentBlocker: true },
  { key: 'security.staging_tests', category: 'Security', label: 'Staging security tests pass', owner: 'Security', deploymentBlocker: true },
  { key: 'security.vpn_matrix', category: 'Security', label: 'VPN attack matrix passes', owner: 'Network/Security', deploymentBlocker: true },
  { key: 'security.identity_matrix', category: 'Security', label: 'Identity matrix passes', owner: 'Identity/Security', deploymentBlocker: true },
  { key: 'security.findings', category: 'Security', label: 'No open Critical or High findings', owner: 'Security', deploymentBlocker: true },
  { key: 'release.artifact', category: 'Engineering', label: 'Staging artifact is tied to a commit and image digest', owner: 'Release', deploymentBlocker: true },
  { key: 'release.records', category: 'Engineering', label: 'SBOM, scan, build, and artifact records are retained', owner: 'Release/Security', deploymentBlocker: true },
  { key: 'engineering.regression', category: 'Engineering', label: 'Full regression suite passes', owner: 'Application', deploymentBlocker: true },
  { key: 'engineering.dependency_audit', category: 'Engineering', label: 'Production dependency audit passes', owner: 'Application/Security', deploymentBlocker: true },
  { key: 'engineering.secret_scan', category: 'Engineering', label: 'Repository and history secret scan passes', owner: 'Application/Security', deploymentBlocker: true },
  { key: 'engineering.static_audit', category: 'Engineering', label: 'Static security audit passes', owner: 'Application/Security', deploymentBlocker: true },
  { key: 'engineering.supply_chain', category: 'Engineering', label: 'Supply-chain audit passes', owner: 'Release/Security', deploymentBlocker: true },
  { key: 'engineering.clean_tree', category: 'Engineering', label: 'Working tree is clean', owner: 'Application', deploymentBlocker: true },
  { key: 'follow_up.large_dataset', category: 'Follow-up', label: 'Preferred 50,000-facility benchmark recorded', owner: 'Application/DBA', deploymentBlocker: false },
  { key: 'follow_up.alert_tuning', category: 'Follow-up', label: 'Alert-noise review completed', owner: 'Operations', deploymentBlocker: false },
  { key: 'follow_up.feedback', category: 'Follow-up', label: 'Pilot feedback process assigned', owner: 'Business', deploymentBlocker: false },
];

const pendingEvidence: Phase9GateEvidence = {
  available: false,
  configured: false,
  testable: false,
  status: 'pending',
  evidence: [],
  testedAt: null,
  approvedBy: null,
};

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseEvidence(value: unknown, key: string): Phase9GateEvidence {
  const item = record(value);
  if (!item) throw new Error(`Gate ${key} must be an object.`);
  const status = item.status;
  if (!['pending', 'pass', 'fail', 'not_applicable'].includes(String(status))) {
    throw new Error(`Gate ${key} has an invalid status.`);
  }
  if (typeof item.available !== 'boolean' || typeof item.configured !== 'boolean' || typeof item.testable !== 'boolean') {
    throw new Error(`Gate ${key} must record available, configured, and testable as booleans.`);
  }
  if (!Array.isArray(item.evidence) || item.evidence.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(`Gate ${key} evidence must be a list of non-empty references.`);
  }

  const evidence: Phase9GateEvidence = {
    owner: typeof item.owner === 'string' && item.owner.trim() ? item.owner.trim() : undefined,
    available: item.available,
    configured: item.configured,
    testable: item.testable,
    status: status as Phase9GateStatus,
    evidence: item.evidence.map((entry) => String(entry).trim()),
    testedAt: typeof item.testedAt === 'string' ? item.testedAt : null,
    approvedBy: typeof item.approvedBy === 'string' ? item.approvedBy.trim() : null,
    notes: typeof item.notes === 'string' ? item.notes.trim() : undefined,
  };

  if (evidence.status === 'pass') {
    if (!evidence.available || !evidence.configured || !evidence.testable) {
      throw new Error(`Gate ${key} cannot pass unless it was available, configured, and testable.`);
    }
    if (!evidence.evidence.length || !evidence.approvedBy || !evidence.testedAt || Number.isNaN(Date.parse(evidence.testedAt))) {
      throw new Error(`Gate ${key} needs dated evidence and an approver before it can pass.`);
    }
  }
  if (evidence.status === 'not_applicable' && (!evidence.notes || !evidence.approvedBy)) {
    throw new Error(`Gate ${key} needs an approved explanation when marked not applicable.`);
  }
  return evidence;
}

export function parsePhase9Manifest(value: unknown): Phase9EvidenceManifest {
  const manifest = record(value);
  if (!manifest || manifest.schemaVersion !== 1 || manifest.environment !== 'staging') {
    throw new Error('Phase 9 evidence must use schemaVersion 1 and environment staging.');
  }
  const release = record(manifest.release);
  const gates = record(manifest.gates);
  if (!release || !gates) throw new Error('Phase 9 evidence must include release and gates objects.');
  const parsedGates: Record<string, Phase9GateEvidence> = {};
  for (const [key, entry] of Object.entries(gates)) parsedGates[key] = parseEvidence(entry, key);

  return {
    schemaVersion: 1,
    environment: 'staging',
    release: {
      commit: typeof release.commit === 'string' ? release.commit.trim() : '',
      imageDigest: typeof release.imageDigest === 'string' ? release.imageDigest.trim() : '',
    },
    gates: parsedGates,
  };
}

export function evaluatePhase9Readiness(manifest: Phase9EvidenceManifest): Phase9Evaluation {
  const gates = phase9GateDefinitions.map((definition) => ({
    ...definition,
    ...(manifest.gates[definition.key] ?? pendingEvidence),
    recorded: Boolean(manifest.gates[definition.key]),
  }));
  const totals: Phase9Evaluation['totals'] = { pending: 0, pass: 0, fail: 0, not_applicable: 0, missing: 0 };
  for (const gate of gates) {
    totals[gate.status] += 1;
    if (!gate.recorded) totals.missing += 1;
  }

  const blockingFailure = gates.some((gate) => gate.deploymentBlocker && gate.status === 'fail');
  const releaseRecorded = /^[0-9a-f]{40}$/i.test(manifest.release.commit)
    && /^sha256:[0-9a-f]{64}$/i.test(manifest.release.imageDigest);
  const blockingPending = !releaseRecorded || gates.some((gate) => gate.deploymentBlocker && gate.status !== 'pass');
  const nonBlockingPending = gates.some((gate) => !gate.deploymentBlocker && gate.status !== 'pass' && gate.status !== 'not_applicable');
  let status: Phase9Evaluation['status'];
  if (blockingFailure) status = 'PRODUCTION PILOT BLOCKED — SECURITY/TECHNICAL FAILURE';
  else if (blockingPending) status = 'PRODUCTION PILOT BLOCKED — INFRASTRUCTURE VALIDATION REQUIRED';
  else if (nonBlockingPending) status = 'PRODUCTION PILOT APPROVED WITH NON-BLOCKING FOLLOW-UP';
  else status = 'PRODUCTION PILOT APPROVED';
  return { status, totals, gates };
}

export function createPhase9EvidenceTemplate(): Phase9EvidenceManifest {
  return {
    schemaVersion: 1,
    environment: 'staging',
    release: { commit: '', imageDigest: '' },
    gates: Object.fromEntries(phase9GateDefinitions.map((gate) => [gate.key, {
      owner: gate.owner,
      available: false,
      configured: false,
      testable: false,
      status: 'pending',
      evidence: [],
      testedAt: null,
      approvedBy: null,
      notes: '',
    }])),
  };
}
