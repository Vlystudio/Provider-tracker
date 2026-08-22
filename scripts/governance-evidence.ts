import 'dotenv/config';

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import pg from 'pg';

const requiredDocuments = [
  'docs/DATA_CLASSIFICATION.md',
  'docs/DATA_FLOW_SECURITY.md',
  'docs/DATA_GOVERNANCE.md',
  'docs/ACCESS_GOVERNANCE.md',
  'docs/RETENTION.md',
  'docs/EXPORT_SECURITY.md',
  'docs/BREACH_RESPONSE.md',
  'docs/COMPLIANCE_EVIDENCE.md',
  'docs/HIPAA_TECHNICAL_READINESS.md',
  'docs/PHASE10_ACCEPTANCE.md',
];
const missing = requiredDocuments.filter((file) => !existsSync(file));
if (missing.length) throw new Error(`Missing governance documents: ${missing.join(', ')}`);
const artifacts = requiredDocuments.map((file) => ({
  file,
  sha256: createHash('sha256').update(readFileSync(file)).digest('hex'),
}));
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const branch = execFileSync('git', ['branch', '--show-current'], { encoding: 'utf8' }).trim();
const connectionString = process.env.DATABASE_URL?.trim();
let databaseEvidence: Record<string, unknown> = { available: false };

if (connectionString) {
  const pool = new pg.Pool({ connectionString, max: 1, statement_timeout: 15_000 });
  try {
    const tables = await pool.query<{
      access_review_table: boolean;
      retention_policy_table: boolean;
      retention_hold_table: boolean;
    }>(`
      SELECT
        to_regclass('public.access_review_decisions') IS NOT NULL AS access_review_table,
        to_regclass('public.data_retention_policies') IS NOT NULL AS retention_policy_table,
        to_regclass('public.data_retention_holds') IS NOT NULL AS retention_hold_table`);
    const tableState = tables.rows[0];
    let configuredPolicies = 0;
    let enabledPolicies = 0;
    let activeHolds = 0;
    if (tableState?.retention_policy_table) {
      const policies = await pool.query<{ configured: number; enabled: number }>(`
        SELECT
          count(*) FILTER (WHERE retention_days IS NOT NULL)::int AS configured,
          count(*) FILTER (WHERE deletion_enabled)::int AS enabled
        FROM data_retention_policies`);
      configuredPolicies = policies.rows[0]?.configured ?? 0;
      enabledPolicies = policies.rows[0]?.enabled ?? 0;
    }
    if (tableState?.retention_hold_table) {
      const holds = await pool.query<{ active: number }>(
        `SELECT count(*) FILTER (WHERE released_at IS NULL)::int AS active FROM data_retention_holds`,
      );
      activeHolds = holds.rows[0]?.active ?? 0;
    }
    databaseEvidence = {
      available: true,
      ...tableState,
      configuredPolicies,
      enabledPolicies,
      activeHolds,
    };
  } finally {
    await pool.end();
  }
}

process.stdout.write(`${JSON.stringify({
  evidenceVersion: 'phase10-v1',
  generatedAt: new Date().toISOString(),
  environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development',
  release: process.env.APP_RELEASE ?? process.env.BUILD_COMMIT ?? 'local',
  source: { commit, branch },
  policySnapshot: {
    vpnRequired: process.env.NETWORK_ACCESS_MODE === 'private-vpn',
    mfaRequired: process.env.CORPORATE_MFA_REQUIRED === 'true',
    exportAuditEnabled: true,
    exportMaxRows: Number(process.env.EXPORT_MAX_ROWS ?? 1_000),
    dormantAccountReviewDays: Number(process.env.GOVERNANCE_DORMANT_ACCOUNT_DAYS ?? 90),
    securityLoggingEnabled: true,
    maintenanceMode: process.env.APP_MAINTENANCE_MODE ?? 'off',
  },
  databaseEvidence,
  artifacts,
  verificationCommands: [
    'npm run verify:ci',
    'npm run test:security',
    'npm run test:database-security',
    'npm run test:automation',
    'npm run test:migration',
    'npm run test:restore',
    'npm run db:audit-integrity',
    'npm run test:governance-performance',
  ],
  limitation: 'This manifest identifies application evidence. It does not certify regulatory compliance or external infrastructure controls.',
}, null, 2)}\n`);
