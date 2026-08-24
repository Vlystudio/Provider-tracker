import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { hashPassword } from 'better-auth/crypto';
import { strToU8, zipSync } from 'fflate';
import { Pool } from 'pg';

const databaseUrl = process.env.SECURITY_TEST_DATABASE_URL?.trim();
const baseUrl = process.env.SECURITY_TEST_BASE_URL?.trim() || 'http://127.0.0.1:3100';
const publicOrigin = process.env.SECURITY_TEST_PUBLIC_ORIGIN?.trim() || `https://${new URL(baseUrl).host}`;
if (!databaseUrl) throw new Error('SECURITY_TEST_DATABASE_URL is required.');
if (!publicOrigin.startsWith('https://')) throw new Error('SECURITY_TEST_PUBLIC_ORIGIN must use HTTPS.');

const databaseName = new URL(databaseUrl).pathname.slice(1);
if (!databaseName.endsWith('_test')) {
  throw new Error('The security acceptance command only runs against a database whose name ends in _test.');
}

const runtimeEnvironment: NodeJS.ProcessEnv = {
  ...process.env,
  NODE_ENV: 'production',
  APP_ENV: 'production',
  APP_DATA_MODE: 'database',
  DATABASE_URL: databaseUrl,
  BETTER_AUTH_URL: publicOrigin,
  BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
  AUTH_TRUSTED_ORIGINS: publicOrigin,
  AUDIT_LOG_IP_SALT: randomBytes(48).toString('base64url'),
  AUTH_CLIENT_IP_HEADER: 'x-real-ip',
  AUTH_TRUSTED_PROXY_CIDRS: '127.0.0.1/32',
  NETWORK_ACCESS_MODE: 'private-vpn',
  PROXY_TRUST_MODE: 'sanitized-ingress',
  HOSTNAME: new URL(baseUrl).hostname,
  PORT: new URL(baseUrl).port,
};
Object.assign(process.env, runtimeEnvironment);

const pool = new Pool({ connectionString: databaseUrl });
const results: Array<{ scenario: string; expected: string; actual: string; pass: boolean }> = [];
const runtime = { server: null as ChildProcess | null, stderr: '' };

function record(scenario: string, expected: string, actual: string, pass: boolean) {
  results.push({ scenario, expected, actual, pass });
}

function password() {
  return `Aa1!${randomBytes(18).toString('base64url')}`;
}

function emptyAdminWorkbook() {
  const sheets = [
    { name: 'Facilities', headers: ['Facility Name', 'City'] },
    { name: 'Facility-Specialty Map', headers: ['Facility Name', 'Specialty'] },
    { name: 'Zip Coordinates', headers: ['Zip Code', 'Latitude', 'Longitude'] },
    { name: 'tblWeeklyCallLog', headers: ['Facility Name', 'Call Date'] },
    { name: 'Monthly Archive', headers: ['Facility Name', 'Call Date'] },
  ];
  const entries: Record<string, Uint8Array> = {
    'xl/workbook.xml': strToU8(`<?xml version="1.0"?><workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((sheet, index) => `<sheet name="${sheet.name}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`).join('')}</sheets></workbook>`),
    'xl/_rels/workbook.xml.rels': strToU8(`<?xml version="1.0"?><Relationships>${sheets.map((_sheet, index) => `<Relationship Id="rId${index + 1}" Target="worksheets/sheet${index + 1}.xml"/>`).join('')}</Relationships>`),
  };
  sheets.forEach((sheet, index) => {
    const cells = sheet.headers.map((header, cellIndex) => `<c r="${String.fromCharCode(65 + cellIndex)}1" t="inlineStr"><is><t>${header}</t></is></c>`).join('');
    entries[`xl/worksheets/sheet${index + 1}.xml`] = strToU8(`<?xml version="1.0"?><worksheet><sheetData><row r="1">${cells}</row></sheetData></worksheet>`);
  });
  return zipSync(entries);
}

function cookieFrom(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((value) => value.split(';', 1)[0])
    .filter(Boolean)
    .join('; ');
}

async function request(
  path: string,
  options: RequestInit & { cookie?: string; clientIp?: string } = {},
) {
  const headers = new Headers(options.headers);
  if (!headers.has('host')) headers.set('host', new URL(publicOrigin).host);
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.clientIp) headers.set('x-real-ip', options.clientIp);
  return fetch(`${baseUrl}${path}`, { ...options, headers, redirect: 'manual' });
}

async function requestWithRawHost(path: string, host: string, headers: Record<string, string> = {}) {
  return new Promise<{ status: number; location: string | null }>((resolve, reject) => {
    const outgoing = httpRequest(new URL(path, baseUrl), {
      method: 'GET',
      headers: { ...headers, host },
    }, (incoming) => {
      incoming.resume();
      incoming.on('end', () => resolve({
        status: incoming.statusCode ?? 0,
        location: typeof incoming.headers.location === 'string' ? incoming.headers.location : null,
      }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

async function mutation(path: string, cookie: string, method: 'POST' | 'PATCH' | 'DELETE', body?: unknown) {
  return request(path, {
    method,
    cookie,
    clientIp: '192.0.2.10',
    headers: {
      origin: publicOrigin,
      'sec-fetch-site': 'same-origin',
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function signIn(email: string, accountPassword: string, clientIp: string, cookie?: string) {
  const response = await request('/api/auth/sign-in/email', {
    method: 'POST',
    clientIp,
    cookie,
    headers: {
      origin: publicOrigin,
      'sec-fetch-site': 'same-origin',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password: accountPassword, rememberMe: false }),
  });
  return { response, cookie: cookieFrom(response) };
}

async function waitForServer() {
  const deadline = Date.now() + 60_000;
  let lastStatus: number | null = null;
  while (Date.now() < deadline) {
    if (runtime.server?.exitCode !== null) {
      throw new Error(`The production server exited before readiness. ${runtime.stderr.slice(0, 1_000)}`);
    }
    try {
      const response = await request('/sign-in');
      lastStatus = response.status;
      if (response.status === 200) return;
      if (response.status >= 400) {
        throw new Error(`The production server returned HTTP ${response.status} during readiness. ${(await response.text()).slice(0, 500)} ${runtime.stderr.slice(0, 1_000)}`);
      }
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`The production server did not become ready within 60 seconds. Last HTTP status: ${lastStatus ?? 'none'}. ${runtime.stderr.slice(0, 1_000)}`);
}

async function createTestSchema() {
  await pool.query(`
    DROP TABLE IF EXISTS access_review_decisions, data_retention_holds, data_retention_policies,
      legacy_value_mappings, legacy_actors, migration_reconciliations, migration_diagnostics, migration_sources, migration_runs,
      operational_digests, coverage_alert_events, coverage_watches, operational_change_events,
      operational_work_items, notifications, notification_preferences, automation_settings, automation_job_executions,
      facility_merge_records, facility_duplicate_candidates, reverification_assignments, facility_contact_attempts, facility_verification_events,
      facility_diagnosis_capabilities, facility_specialties, facilities, postal_code_centroids, diagnoses, specialties,
      audit_events, authorizations, auth_rate_limits, verification_tokens, sessions, accounts, users CASCADE;
    DROP TYPE IF EXISTS assignment_status CASCADE;
    DROP TYPE IF EXISTS access_review_decision CASCADE;
    DROP TYPE IF EXISTS migration_diagnostic_status CASCADE;
    DROP TYPE IF EXISTS migration_readiness CASCADE;
    DROP TYPE IF EXISTS migration_run_status CASCADE;
    DROP TYPE IF EXISTS legacy_actor_status CASCADE;
    DROP TYPE IF EXISTS workbook_kind CASCADE;
    DROP TYPE IF EXISTS coverage_state CASCADE;
    DROP TYPE IF EXISTS work_item_status CASCADE;
    DROP TYPE IF EXISTS digest_frequency CASCADE;
    DROP TYPE IF EXISTS notification_severity CASCADE;
    DROP TYPE IF EXISTS automation_result CASCADE;
    DROP TYPE IF EXISTS contact_outcome CASCADE;
    DROP TYPE IF EXISTS source_confidence CASCADE;
    DROP TYPE IF EXISTS verification_method CASCADE;
    DROP TYPE IF EXISTS verification_answer CASCADE;
    DROP TYPE IF EXISTS coordinate_quality CASCADE;
    DROP TYPE IF EXISTS duplicate_decision CASCADE;
    DROP TYPE IF EXISTS duplicate_confidence CASCADE;
    DROP TYPE IF EXISTS data_quality_status CASCADE;
    DROP TYPE IF EXISTS authorization_status CASCADE;
    DROP TYPE IF EXISTS user_role CASCADE;
    CREATE TYPE user_role AS ENUM ('admin', 'ura_user', 'report_viewer', 'auditor');
    CREATE TYPE workbook_kind AS ENUM ('admin', 'user');
    CREATE TYPE migration_run_status AS ENUM ('previewed', 'approved', 'running', 'failed', 'applied', 'reconciled', 'cancelled', 'reversed');
    CREATE TYPE migration_diagnostic_status AS ENUM ('open', 'resolved', 'deferred', 'skipped');
    CREATE TYPE migration_readiness AS ENUM ('go', 'go_with_warnings', 'no_go');
    CREATE TYPE legacy_actor_status AS ENUM ('unmapped', 'mapped', 'retired');
    CREATE TYPE authorization_status AS ENUM ('open', 'complete', 'cancelled');
    CREATE TYPE data_quality_status AS ENUM ('clean', 'needs_review', 'rejected');
    CREATE TYPE coordinate_quality AS ENUM ('exact', 'address', 'zip_centroid', 'manual', 'unknown');
    CREATE TYPE duplicate_confidence AS ENUM ('exact', 'probable', 'possible');
    CREATE TYPE duplicate_decision AS ENUM ('pending', 'not_duplicate', 'deferred', 'merged');
    CREATE TYPE verification_answer AS ENUM ('yes', 'no', 'unknown', 'not_asked', 'unable_to_verify', 'not_applicable');
    CREATE TYPE verification_method AS ENUM ('phone', 'fax', 'portal', 'website', 'email', 'internal_source', 'other');
    CREATE TYPE source_confidence AS ENUM ('direct', 'authoritative', 'secondary', 'unverified');
    CREATE TYPE contact_outcome AS ENUM ('verified', 'no_answer', 'voicemail_left', 'voicemail_not_left', 'disconnected', 'wrong_number', 'fax_only', 'callback_requested', 'unable_to_verify');
    CREATE TYPE assignment_status AS ENUM ('open', 'completed', 'dismissed');
    CREATE TYPE automation_result AS ENUM ('running', 'succeeded', 'failed', 'skipped', 'dry_run');
    CREATE TYPE notification_severity AS ENUM ('informational', 'attention', 'important');
    CREATE TYPE digest_frequency AS ENUM ('none', 'daily', 'weekly');
    CREATE TYPE work_item_status AS ENUM ('open', 'assigned', 'in_progress', 'completed', 'dismissed', 'blocked');
    CREATE TYPE coverage_state AS ENUM ('unknown', 'healthy', 'alerting');
    CREATE TYPE access_review_decision AS ENUM ('retain', 'modify', 'disable', 'investigate');
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, email text NOT NULL UNIQUE,
      email_verified boolean NOT NULL DEFAULT false, display_name text, image text,
      initials text NOT NULL DEFAULT '--', role user_role NOT NULL DEFAULT 'ura_user',
      is_active boolean NOT NULL DEFAULT true, is_service_account boolean NOT NULL DEFAULT false,
      last_signed_in_at timestamptz, role_assigned_at timestamptz, disabled_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX users_role_active_idx ON users(role, is_active);
    CREATE TABLE legacy_actors (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source_value text NOT NULL, normalized_value text NOT NULL UNIQUE,
      display_name text NOT NULL, status legacy_actor_status NOT NULL DEFAULT 'unmapped',
      mapped_user_id uuid REFERENCES users(id) ON DELETE SET NULL, mapping_reason text,
      mapped_by uuid REFERENCES users(id) ON DELETE SET NULL, mapped_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE accounts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), account_id text NOT NULL, provider_id text NOT NULL, issuer text NOT NULL,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, access_token text, refresh_token text,
      id_token text, access_token_expires_at timestamptz, refresh_token_expires_at timestamptz,
      scope text, password text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(issuer, account_id)
    );
    CREATE INDEX accounts_user_id_idx ON accounts(user_id);
    CREATE TABLE sessions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token text NOT NULL UNIQUE,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at timestamptz NOT NULL,
      ip_address text, user_agent text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX sessions_user_id_idx ON sessions(user_id);
    CREATE INDEX sessions_expires_idx ON sessions(expires_at);
    CREATE TABLE verification_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), identifier text NOT NULL, value text NOT NULL UNIQUE,
      expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX verification_tokens_identifier_idx ON verification_tokens(identifier);
    CREATE TABLE auth_rate_limits (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), key text NOT NULL UNIQUE, count integer NOT NULL, last_request bigint NOT NULL
    );
    CREATE TABLE authorizations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), authorization_number text NOT NULL UNIQUE,
      lob_id uuid, default_diagnosis_id uuid, default_specialty_id uuid, referral_reason_id uuid,
      referral_reason_detail text, member_zip text, created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      status authorization_status NOT NULL DEFAULT 'open', created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX authorizations_status_updated_idx ON authorizations(status, updated_at);
    CREATE TABLE specialties (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), canonical_name text NOT NULL, normalized_name text NOT NULL UNIQUE,
      active boolean NOT NULL DEFAULT true, aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE diagnoses (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), code text NOT NULL UNIQUE, description text NOT NULL,
      active boolean NOT NULL DEFAULT true, aliases jsonb NOT NULL DEFAULT '[]'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE postal_code_centroids (
      zip_code text PRIMARY KEY, geog_point text
    );
    CREATE TABLE facilities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_name text NOT NULL, city text NOT NULL,
      normalized_name text NOT NULL, normalized_city text NOT NULL, display_key text NOT NULL,
      facility_type text NOT NULL DEFAULT 'Hospital', address_line_1 text, address_line_2 text, state_code text,
      auto_fill_specialty boolean NOT NULL DEFAULT false, phone_raw text, phone_normalized text, postal_code text,
      latitude double precision, longitude double precision, geog_point text, coordinate_provenance text,
      coordinate_quality coordinate_quality NOT NULL DEFAULT 'unknown',
      current_accepting_status verification_answer NOT NULL DEFAULT 'unknown',
      current_scheduling_status verification_answer NOT NULL DEFAULT 'unknown',
      current_urgent_referral_status verification_answer NOT NULL DEFAULT 'unknown',
      next_available_date date, estimated_wait_days integer, accepting_verified_at timestamptz,
      scheduling_verified_at timestamptz, phone_verified_at timestamptz, address_verified_at timestamptz,
      last_verified_at timestamptz, merged_into_facility_id uuid, archived_at timestamptz, archived_by uuid,
      active boolean NOT NULL DEFAULT true, data_quality_status data_quality_status NOT NULL DEFAULT 'clean',
      source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb, migration_baseline_at timestamptz,
      optimistic_lock_version integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(normalized_name, normalized_city)
    );
    CREATE TABLE facility_specialties (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_id uuid NOT NULL, specialty_id uuid NOT NULL,
      treatment_status text NOT NULL DEFAULT 'unknown', verification_status verification_answer NOT NULL DEFAULT 'unknown',
      active boolean NOT NULL DEFAULT true, notes text, last_confirmed_at timestamptz, confirming_call_id uuid,
      source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb, optimistic_lock_version integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(facility_id,specialty_id)
    );
    CREATE TABLE facility_diagnosis_capabilities (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_id uuid NOT NULL, diagnosis_id uuid NOT NULL,
      status verification_answer NOT NULL DEFAULT 'unknown', active boolean NOT NULL DEFAULT true, notes text,
      last_verified_at timestamptz, source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      optimistic_lock_version integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(facility_id,diagnosis_id)
    );
    CREATE TABLE facility_verification_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_id uuid NOT NULL, verified_at timestamptz NOT NULL,
      verified_by uuid, legacy_actor_id uuid, method verification_method NOT NULL, confidence source_confidence NOT NULL DEFAULT 'direct',
      contact_person text, contact_channel text, accepting_status verification_answer, specialty_id uuid,
      specialty_status verification_answer, diagnosis_id uuid, diagnosis_status verification_answer,
      scheduling_within_four_weeks verification_answer, urgent_referral_status verification_answer,
      next_available_date date, estimated_wait_days integer, comments text, related_call_id uuid,
      related_contact_attempt_id uuid, import_batch_id uuid, previous_state jsonb NOT NULL DEFAULT '{}'::jsonb,
      resulting_state jsonb NOT NULL DEFAULT '{}'::jsonb, source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE facility_contact_attempts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_id uuid NOT NULL, attempted_at timestamptz NOT NULL,
      attempted_by uuid, legacy_actor_id uuid, method verification_method NOT NULL, outcome contact_outcome NOT NULL,
      contact_person text, contact_channel text, comments text, related_call_id uuid,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE reverification_assignments (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_id uuid NOT NULL, assigned_to uuid, assigned_by uuid,
      status assignment_status NOT NULL DEFAULT 'open', reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
      completed_at timestamptz, completed_by uuid, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE facility_duplicate_candidates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), left_facility_id uuid NOT NULL, right_facility_id uuid NOT NULL,
      confidence duplicate_confidence NOT NULL, score integer NOT NULL, reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
      decision duplicate_decision NOT NULL DEFAULT 'pending', reviewed_by uuid, reviewed_at timestamptz,
      review_note text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(left_facility_id,right_facility_id), CHECK(left_facility_id<right_facility_id), CHECK(score between 0 and 100)
    );
    CREATE TABLE facility_merge_records (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), survivor_facility_id uuid NOT NULL, merged_facility_id uuid NOT NULL,
      candidate_id uuid, merged_by uuid, reason text NOT NULL, restore_snapshot jsonb NOT NULL,
      undone_at timestamptz, undone_by uuid, undo_reason text, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE audit_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
      action text NOT NULL, result text NOT NULL DEFAULT 'success', entity_type text NOT NULL, entity_id text,
      before_json jsonb, after_json jsonb, request_id text, source_ip_hash text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX audit_events_entity_idx ON audit_events(entity_type, entity_id, created_at);
    CREATE INDEX audit_events_actor_created_idx ON audit_events(actor_id, created_at);
    CREATE TABLE access_review_decisions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), review_period text NOT NULL,
      reviewed_user_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
      reviewer_id uuid REFERENCES users(id) ON DELETE SET NULL, reviewed_role user_role NOT NULL,
      account_active boolean NOT NULL, last_signed_in_at timestamptz,
      decision access_review_decision NOT NULL, decided_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(review_period,reviewed_user_id,reviewer_id)
    );
    CREATE INDEX access_review_user_decided_idx ON access_review_decisions(reviewed_user_id,decided_at);
    CREATE TABLE data_retention_policies (
      category text PRIMARY KEY, retention_days integer, deletion_enabled boolean NOT NULL DEFAULT false,
      policy_reference text, approved_by uuid REFERENCES users(id) ON DELETE SET NULL, approved_at timestamptz,
      updated_by uuid REFERENCES users(id) ON DELETE SET NULL, updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE data_retention_holds (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), category text NOT NULL, entity_type text, entity_id text,
      reason_code text NOT NULL, placed_by uuid REFERENCES users(id) ON DELETE SET NULL,
      placed_at timestamptz NOT NULL DEFAULT now(), released_by uuid REFERENCES users(id) ON DELETE SET NULL,
      released_at timestamptz
    );
    CREATE INDEX data_retention_hold_category_active_idx ON data_retention_holds(category,released_at);
    CREATE TABLE migration_runs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), importer_version text NOT NULL,
      status migration_run_status NOT NULL DEFAULT 'previewed', release_version text NOT NULL,
      source_manifest jsonb NOT NULL DEFAULT '{}'::jsonb, preview_counts jsonb NOT NULL DEFAULT '{}'::jsonb,
      apply_counts jsonb NOT NULL DEFAULT '{}'::jsonb, reconciliation jsonb NOT NULL DEFAULT '{}'::jsonb,
      readiness migration_readiness NOT NULL DEFAULT 'no_go', notification_baseline_at timestamptz,
      previewed_by uuid REFERENCES users(id), approved_by uuid REFERENCES users(id), executed_by uuid REFERENCES users(id),
      reversed_by uuid REFERENCES users(id), failure_category text, failure_message text, approval_reason text,
      reversal_reason text, approved_at timestamptz, started_at timestamptz, completed_at timestamptz,
      reversed_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE migration_sources (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), migration_run_id uuid NOT NULL REFERENCES migration_runs(id) ON DELETE CASCADE,
      workbook_kind workbook_kind NOT NULL, source_file_name text NOT NULL, source_hash text NOT NULL,
      source_size_bytes integer NOT NULL, schema_version text NOT NULL, sheets jsonb NOT NULL DEFAULT '[]'::jsonb,
      rows_scanned integer NOT NULL DEFAULT 0, formula_cells integer NOT NULL DEFAULT 0, hidden_rows integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(migration_run_id,source_hash)
    );
    CREATE TABLE migration_diagnostics (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), migration_run_id uuid NOT NULL REFERENCES migration_runs(id) ON DELETE CASCADE,
      source_hash text NOT NULL, workbook_kind workbook_kind NOT NULL, entity_type text NOT NULL, sheet_name text NOT NULL,
      source_row integer NOT NULL, row_key text, issue_code text NOT NULL, severity text NOT NULL, message text NOT NULL,
      suggested_action text, status migration_diagnostic_status NOT NULL DEFAULT 'open', resolution_action text,
      target_entity_id uuid, resolution_note text, resolved_by uuid REFERENCES users(id), resolved_at timestamptz,
      optimistic_lock_version integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(migration_run_id,source_hash,entity_type,sheet_name,source_row,issue_code)
    );
    CREATE TABLE migration_reconciliations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), migration_run_id uuid NOT NULL UNIQUE REFERENCES migration_runs(id) ON DELETE CASCADE,
      source_rows integer NOT NULL, reconciled_rows integer NOT NULL, imported_rows integer NOT NULL DEFAULT 0,
      updated_rows integer NOT NULL DEFAULT 0, unchanged_rows integer NOT NULL DEFAULT 0, skipped_rows integer NOT NULL DEFAULT 0,
      conflict_rows integer NOT NULL DEFAULT 0, invalid_rows integer NOT NULL DEFAULT 0, reconciliation_percent double precision NOT NULL,
      relationship_counts jsonb NOT NULL DEFAULT '{}'::jsonb, state_distribution jsonb NOT NULL DEFAULT '{}'::jsonb,
      report_comparison jsonb NOT NULL DEFAULT '{}'::jsonb, discrepancies jsonb NOT NULL DEFAULT '[]'::jsonb,
      readiness migration_readiness NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE legacy_value_mappings (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), mapping_type text NOT NULL, source_value text NOT NULL,
      normalized_value text NOT NULL, target_entity_id uuid, decision text NOT NULL DEFAULT 'mapped',
      created_by uuid REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(), UNIQUE(mapping_type,normalized_value)
    );
    CREATE TABLE automation_job_executions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), execution_key text NOT NULL UNIQUE, job_type text NOT NULL,
      trigger text NOT NULL, scheduled_for timestamptz NOT NULL, started_at timestamptz NOT NULL DEFAULT now(),
      finished_at timestamptz, result automation_result NOT NULL DEFAULT 'running', processed_count integer NOT NULL DEFAULT 0,
      created_count integer NOT NULL DEFAULT 0, skipped_count integer NOT NULL DEFAULT 0, error_count integer NOT NULL DEFAULT 0,
      retry_count integer NOT NULL DEFAULT 0, release_version text NOT NULL, error_category text, error_message text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE notification_preferences (
      user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, in_app_enabled boolean NOT NULL DEFAULT true,
      digest_frequency digest_frequency NOT NULL DEFAULT 'daily', categories jsonb NOT NULL DEFAULT '["work","changes","coverage","digest"]'::jsonb,
      minimum_severity notification_severity NOT NULL DEFAULT 'informational', updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE notifications (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), recipient_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      type text NOT NULL, category text NOT NULL, severity notification_severity NOT NULL DEFAULT 'informational',
      title text NOT NULL, message text NOT NULL, target_path text, source text NOT NULL, deduplication_key text NOT NULL,
      issue_key text, read_at timestamptz, delivered_at timestamptz NOT NULL DEFAULT now(), created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(recipient_id,deduplication_key)
    );
    CREATE TABLE operational_work_items (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), work_type text NOT NULL, priority notification_severity NOT NULL DEFAULT 'attention',
      target_type text NOT NULL, target_id uuid NOT NULL, due_at timestamptz, reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
      status work_item_status NOT NULL DEFAULT 'open', assigned_to uuid REFERENCES users(id) ON DELETE SET NULL, assigned_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL, source text NOT NULL, deduplication_key text NOT NULL UNIQUE, cycle integer NOT NULL DEFAULT 1,
      blocked_reason text, completed_at timestamptz, completed_by uuid REFERENCES users(id) ON DELETE SET NULL, dismissed_at timestamptz,
      dismissed_by uuid REFERENCES users(id) ON DELETE SET NULL, dismissal_reason text, optimistic_lock_version integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE operational_change_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), facility_id uuid REFERENCES facilities(id), event_type text NOT NULL,
      severity notification_severity NOT NULL DEFAULT 'informational', occurred_at timestamptz NOT NULL, source_type text NOT NULL,
      source_id uuid, deduplication_key text NOT NULL UNIQUE, before_value jsonb, after_value jsonb,
      specialty_id uuid REFERENCES specialties(id), diagnosis_id uuid REFERENCES diagnoses(id), metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE coverage_watches (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, specialty_id uuid REFERENCES specialties(id), diagnosis_id uuid REFERENCES diagnoses(id),
      postal_code text NOT NULL, radius_miles integer NOT NULL, minimum_count integer NOT NULL, freshness_days integer NOT NULL,
      enabled boolean NOT NULL DEFAULT true, state coverage_state NOT NULL DEFAULT 'unknown', cycle integer NOT NULL DEFAULT 0,
      last_count integer, last_evaluated_at timestamptz, created_by uuid NOT NULL REFERENCES users(id),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE coverage_alert_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), watch_id uuid NOT NULL REFERENCES coverage_watches(id) ON DELETE CASCADE,
      cycle integer NOT NULL, state text NOT NULL, observed_count integer NOT NULL, threshold_count integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(watch_id,cycle,state)
    );
    CREATE TABLE operational_digests (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), digest_type text NOT NULL, audience_key text NOT NULL,
      recipient_id uuid REFERENCES users(id) ON DELETE CASCADE, period_start timestamptz NOT NULL, period_end timestamptz NOT NULL,
      generated_at timestamptz NOT NULL DEFAULT now(), source_version text NOT NULL, sections jsonb NOT NULL DEFAULT '[]'::jsonb,
      execution_id uuid REFERENCES automation_job_executions(id), created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(digest_type,audience_key,period_start,period_end)
    );
    CREATE TABLE automation_settings (
      scope text PRIMARY KEY DEFAULT 'global', time_zone text NOT NULL DEFAULT 'America/New_York', upcoming_stale_days integer NOT NULL DEFAULT 7,
      meaningful_wait_increase_days integer NOT NULL DEFAULT 14, meaningful_wait_increase_percent integer NOT NULL DEFAULT 50,
      high_priority_escalation_days integer NOT NULL DEFAULT 3, daily_digest_hour integer NOT NULL DEFAULT 7,
      weekly_digest_day integer NOT NULL DEFAULT 1, batch_size integer NOT NULL DEFAULT 500,
      updated_by uuid REFERENCES users(id), updated_at timestamptz NOT NULL DEFAULT now()
    );
  `);
}

async function main() {
  await createTestSchema();
  const runId = randomBytes(6).toString('hex');
  const fixtures = {
    admin: { email: `admin-${runId}@example.invalid`, password: password(), name: 'Security Admin', role: 'admin' as const },
    userA: { email: `user-a-${runId}@example.invalid`, password: password(), name: 'User A', role: 'ura_user' as const },
    userB: { email: `user-b-${runId}@example.invalid`, password: password(), name: 'User B', role: 'ura_user' as const },
  };

  const fixtureRows: Array<{ id: string }> = [];
  for (const [index, fixture] of Object.values(fixtures).entries()) {
    const passwordHash = await hashPassword(fixture.password);
    const inserted = await pool.query<{ id: string }>(
      `INSERT INTO users (name, email, email_verified, initials, role)
       VALUES ($1, $2, true, $3, $4) RETURNING id`,
      [fixture.name, fixture.email, ['SA', 'UA', 'UB'][index], fixture.role],
    );
    const user = inserted.rows[0];
    if (!user) throw new Error('Failed to create an acceptance-test user.');
    await pool.query(
      `INSERT INTO accounts (account_id, provider_id, issuer, user_id, password)
       VALUES ($1, 'credential', 'local:credential', $2, $3)`,
      [user.id, user.id, passwordHash],
    );
    fixtureRows.push(user);
  }
  const [admin, userA, userB] = fixtureRows;
  if (!admin || !userA || !userB) throw new Error('Failed to create all acceptance-test users.');
  const insertedAuthorizations = await pool.query<{ id: string }>(
    `INSERT INTO authorizations (authorization_number, created_by, member_zip)
     VALUES ($1, $2, '04530'), ($3, $4, '04101') RETURNING id`,
    [`A-${runId}`, userA.id, `B-${runId}`, userB.id],
  );
  const [authorizationA, authorizationB] = insertedAuthorizations.rows;
  if (!authorizationA || !authorizationB) throw new Error('Failed to create acceptance-test authorizations.');
  const insertedFacility = await pool.query<{ id: string }>(
    `INSERT INTO facilities (facility_name, city, normalized_name, normalized_city, display_key, phone_raw, phone_normalized, postal_code)
     VALUES ('Acceptance Clinic', 'Portland', 'acceptance clinic', 'portland', 'Acceptance Clinic|Portland', '(207) 555-0100', '2075550100', '04103') RETURNING id`,
  );
  const facility = insertedFacility.rows[0];
  if (!facility) throw new Error('Failed to create the acceptance-test facility.');
  const mergedFixture = await pool.query<{ id: string }>(
    `INSERT INTO facilities (facility_name, city, normalized_name, normalized_city, display_key, phone_raw, phone_normalized, postal_code)
     VALUES ('Acceptance Clinic East', 'Portland', 'acceptance clinic east', 'portland', 'Acceptance Clinic East|Portland', '(207) 555-0101', '2075550101', '04103') RETURNING id`,
  );
  const mergedFacility = mergedFixture.rows[0];
  if (!mergedFacility) throw new Error('Failed to create the merge fixture.');
  const specialtyFixture = await pool.query<{ id: string }>(
    `INSERT INTO specialties (canonical_name, normalized_name) VALUES ('Oncology', 'oncology') RETURNING id`,
  );
  const diagnosisFixture = await pool.query<{ id: string }>(
    `INSERT INTO diagnoses (code, description) VALUES ('C50', 'Breast cancer') RETURNING id`,
  );
  await pool.query(
    `INSERT INTO facility_specialties (facility_id, specialty_id, verification_status, last_confirmed_at)
     VALUES ($1, $2, 'yes', now() - interval '1 day')`,
    [mergedFacility.id, specialtyFixture.rows[0]?.id],
  );
  await pool.query(
    `INSERT INTO facility_diagnosis_capabilities (facility_id, diagnosis_id, status, last_verified_at)
     VALUES ($1, $2, 'yes', now() - interval '1 day')`,
    [mergedFacility.id, diagnosisFixture.rows[0]?.id],
  );
  await pool.query(
    `INSERT INTO facility_verification_events (facility_id, verified_at, verified_by, method, accepting_status)
     VALUES ($1, now() - interval '1 day', $2, 'phone', 'yes')`,
    [mergedFacility.id, userA.id],
  );
  const notificationFixtures = await pool.query<{ id: string; recipient_id: string }>(`
    INSERT INTO notifications (recipient_id,type,category,severity,title,message,target_path,source,deduplication_key)
    VALUES
      ($1,'work_ready','work','attention','User A work','A private notification.','/work','security_fixture',$3),
      ($2,'automation_failure','automation','important','User B admin notice','B private notification.','/automation','security_fixture',$4)
    RETURNING id, recipient_id`, [userA.id, userB.id, `security-a-${runId}`, `security-b-${runId}`]);
  const notificationA = notificationFixtures.rows.find((row) => row.recipient_id === userA.id)!;
  const notificationB = notificationFixtures.rows.find((row) => row.recipient_id === userB.id)!;
  const workFixtures = await pool.query<{ id: string; assigned_to: string; optimistic_lock_version: number }>(`
    INSERT INTO operational_work_items (work_type,target_type,target_id,status,assigned_to,source,deduplication_key)
    VALUES
      ('reverification','facility',$1,'assigned',$2,'security_fixture',$4),
      ('reverification','facility',$1,'assigned',$3,'security_fixture',$5)
    RETURNING id,assigned_to,optimistic_lock_version`, [facility.id, userA.id, userB.id, `work-a-${runId}`, `work-b-${runId}`]);
  const workA = workFixtures.rows.find((row) => row.assigned_to === userA.id)!;
  const workB = workFixtures.rows.find((row) => row.assigned_to === userB.id)!;

  const standaloneServer = fileURLToPath(new URL('../.next/standalone/server.js', import.meta.url));
  runtime.server = spawn(process.execPath, [standaloneServer], {
    cwd: process.cwd(),
    env: runtimeEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  runtime.server.stderr?.on('data', (chunk) => { runtime.stderr += String(chunk); });
  await waitForServer();

  let response = await request('/sign-in');
  record('Anonymous → public sign-in page', 'PASS', `HTTP ${response.status}`, response.status === 200);
  const requiredHeaders = [
    'content-security-policy',
    'x-content-type-options',
    'referrer-policy',
    'x-frame-options',
    'permissions-policy',
    'strict-transport-security',
  ];
  const missingHeaders = requiredHeaders.filter((header) => !response.headers.has(header));
  record(
    'Security headers on public response',
    'PASS',
    missingHeaders.length ? `Missing: ${missingHeaders.join(', ')}` : 'All required headers present',
    missingHeaders.length === 0 && !response.headers.has('x-powered-by'),
  );
  const contentSecurityPolicy = response.headers.get('content-security-policy') ?? '';
  const publicHtml = await response.clone().text();
  const nonce = contentSecurityPolicy.match(/'nonce-([A-Za-z0-9_-]{16,128})'/)?.[1] ?? '';
  const scriptTags = [...publicHtml.matchAll(/<script\b[^>]*>/gi)].map((match) => match[0]);
  record(
    'Nonce-based production content policy',
    'PASS',
    contentSecurityPolicy,
    /script-src[^;]*'nonce-[A-Za-z0-9_-]{16,128}'/.test(contentSecurityPolicy)
      && /style-src[^;]*'nonce-[A-Za-z0-9_-]{16,128}'/.test(contentSecurityPolicy)
      && !contentSecurityPolicy.includes("'unsafe-inline'")
      && !contentSecurityPolicy.includes("'unsafe-eval'"),
  );
  record(
    'Content policy nonce reaches rendered scripts',
    'PASS',
    `${scriptTags.length} script tag(s) checked`,
    Boolean(nonce)
      && scriptTags.length > 0
      && scriptTags.every((tag) => tag.includes(`nonce="${nonce}"`) || tag.includes(`nonce='${nonce}'`)),
  );
  record(
    'Cross-origin browser access policy',
    'BLOCKED',
    response.headers.has('access-control-allow-origin') ? 'CORS header present' : 'No CORS allow-origin header',
    !response.headers.has('access-control-allow-origin'),
  );
  const unexpectedHost = await requestWithRawHost('/sign-in', 'attacker.example');
  record('Unexpected Host header', 'BLOCKED', `HTTP ${unexpectedHost.status}`, unexpectedHost.status === 421);
  const forwardedSpoof = await requestWithRawHost('/', new URL(publicOrigin).host, {
    'x-forwarded-host': 'attacker.example',
    'x-forwarded-proto': 'http',
  });
  const forwardedRedirect = forwardedSpoof.location;
  record(
    'Forwarded host and protocol spoofing',
    'BLOCKED',
    `HTTP ${forwardedSpoof.status} -> ${forwardedRedirect}`,
    forwardedSpoof.status >= 300 && forwardedSpoof.status < 400
      && Boolean(forwardedRedirect)
      && new URL(forwardedRedirect!).protocol === 'https:'
      && new URL(forwardedRedirect!).host !== 'attacker.example'
      && new URL(forwardedRedirect!).pathname === '/sign-in',
  );
  response = await request('/api/health');
  const healthBody = await response.clone().json() as Record<string, unknown>;
  record('Minimal health response', 'PASS', JSON.stringify(healthBody), response.status === 200 && Object.keys(healthBody).join(',') === 'status');
  response = await request('/api/ready');
  const readyBody = await response.clone().json() as Record<string, unknown>;
  record('Minimal readiness response', 'PASS', JSON.stringify(readyBody), [200, 503].includes(response.status) && Object.keys(readyBody).join(',') === 'status');
  response = await request('/');
  const anonymousRedirect = response.headers.get('location');
  const anonymousRedirectPath = anonymousRedirect ? new URL(anonymousRedirect, baseUrl).pathname : null;
  record('Anonymous → authenticated page', 'BLOCKED', `HTTP ${response.status} → ${anonymousRedirect}`, response.status >= 300 && response.status < 400 && anonymousRedirectPath === '/sign-in');
  response = await request('/api/session');
  record('Anonymous → protected API', 'BLOCKED', `HTTP ${response.status}`, response.status === 401);
  response = await request('/api/admin/migrations');
  record('Anonymous migration history', 'BLOCKED', `HTTP ${response.status}`, response.status === 401);
  response = await request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { origin: publicOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'public-signup@example.invalid', password: password(), name: 'Public Signup' }),
  });
  record('Public registration endpoint', 'BLOCKED', `HTTP ${response.status}`, response.status === 404);

  const invalid = await signIn(fixtures.userA.email, 'Not-the-password1!', '192.0.2.99');
  record('Invalid credentials', 'BLOCKED', `HTTP ${invalid.response.status}`, invalid.response.status === 401);

  const fixationCookie = 'provider-tracker.session_token=fixed-by-attacker';
  const fixation = await signIn(fixtures.userA.email, fixtures.userA.password, '192.0.2.17', fixationCookie);
  record(
    'Session fixation attempt',
    'BLOCKED',
    `HTTP ${fixation.response.status}; new cookie=${Boolean(fixation.cookie)}`,
    fixation.response.status === 200 && Boolean(fixation.cookie) && !fixation.cookie.includes('fixed-by-attacker'),
  );

  const userLogin = await signIn(fixtures.userA.email, fixtures.userA.password, '192.0.2.11');
  record('Valid sign-in', 'PASS', `HTTP ${userLogin.response.status}`, userLogin.response.status === 200 && Boolean(userLogin.cookie));
  const sessionCookieAttributes = userLogin.response.headers.getSetCookie().join('; ').toLowerCase();
  record(
    'Production session cookie attributes',
    'PASS',
    'HttpOnly; Secure; SameSite=Lax; Path=/',
    sessionCookieAttributes.includes('httponly') &&
      sessionCookieAttributes.includes('secure') &&
      sessionCookieAttributes.includes('samesite=lax') &&
      sessionCookieAttributes.includes('path=/'),
  );
  const sessionsBeforeResponse = await request('/api/account/sessions', { cookie: userLogin.cookie, clientIp: '192.0.2.11' });
  const sessionsBeforeBody = await sessionsBeforeResponse.json() as { sessions?: Array<{ id: string }> };
  const sessionsBefore = new Set(sessionsBeforeBody.sessions?.map((session) => session.id) ?? []);
  const secondUserLogin = await signIn(fixtures.userA.email, fixtures.userA.password, '192.0.2.18');
  const ownSessionsResponse = await request('/api/account/sessions', { cookie: userLogin.cookie, clientIp: '192.0.2.11' });
  const ownSessionsBody = await ownSessionsResponse.json() as { sessions?: Array<{ id: string; current: boolean }> };
  const otherSession = ownSessionsBody.sessions?.find((session) => !session.current && !sessionsBefore.has(session.id));
  const ownRevokeResponse = otherSession
    ? await mutation(`/api/account/sessions/${otherSession.id}`, userLogin.cookie, 'DELETE')
    : new Response(null, { status: 500 });
  const revokedUserSessionResponse = await request('/api/session', { cookie: secondUserLogin.cookie, clientIp: '192.0.2.18' });
  record(
    'User session inventory and targeted revocation',
    'PASS',
    `list HTTP ${ownSessionsResponse.status}; revoke HTTP ${ownRevokeResponse.status}; reused HTTP ${revokedUserSessionResponse.status}`,
    ownSessionsResponse.status === 200
      && Boolean(otherSession)
      && ownRevokeResponse.status === 200
      && revokedUserSessionResponse.status === 401,
  );
  const hostileSearch = `<script>alert(1)</script>' OR 1=1--`;
  response = await request(`/provider-search?facilityName=${encodeURIComponent(hostileSearch)}`, {
    cookie: userLogin.cookie,
    clientIp: '192.0.2.11',
  });
  const hostileSearchHtml = await response.clone().text();
  const userCountAfterSearch = await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM users');
  record(
    'Search injection and reflected script payload',
    'BLOCKED',
    `HTTP ${response.status}; users=${userCountAfterSearch.rows[0]?.count}`,
    response.status === 200
      && (userCountAfterSearch.rows[0]?.count ?? 0) >= 3
      && !hostileSearchHtml.includes('<script>alert(1)</script>'),
  );
  response = await mutation(`/api/facilities/${facility.id}/verifications`, userLogin.cookie, 'POST', {
    expectedVersion: 0,
    verifiedAt: new Date().toISOString(),
    method: 'phone',
    confidence: 'direct',
    acceptingStatus: 'yes',
    schedulingWithinFourWeeks: 'yes',
  });
  const verifiedState = await pool.query<{ status: string; version: number; event_count: number }>(
    `SELECT f.current_accepting_status::text AS status, f.optimistic_lock_version AS version,
      (SELECT count(*)::int FROM facility_verification_events WHERE facility_id=f.id) AS event_count
     FROM facilities f WHERE f.id=$1`, [facility.id],
  );
  record(
    'User creates facility verification',
    'PASS',
    `HTTP ${response.status}; status ${verifiedState.rows[0]?.status}; events ${verifiedState.rows[0]?.event_count}`,
    response.status === 201 && verifiedState.rows[0]?.status === 'yes' && verifiedState.rows[0]?.event_count === 1,
  );
  const freshnessBeforeContact = await pool.query<{ verified_at: Date | null }>(
    'SELECT accepting_verified_at AS verified_at FROM facilities WHERE id=$1', [facility.id],
  );
  response = await mutation(`/api/facilities/${facility.id}/contact-attempts`, userLogin.cookie, 'POST', {
    attemptedAt: new Date().toISOString(), method: 'phone', outcome: 'no_answer', comments: 'Acceptance test.',
  });
  const freshnessAfterContact = await pool.query<{ verified_at: Date | null; attempt_count: number }>(
    `SELECT accepting_verified_at AS verified_at,
      (SELECT count(*)::int FROM facility_contact_attempts WHERE facility_id=facilities.id) AS attempt_count
     FROM facilities WHERE id=$1`, [facility.id],
  );
  record(
    'Failed contact does not refresh verification',
    'PASS',
    `HTTP ${response.status}; attempts ${freshnessAfterContact.rows[0]?.attempt_count}`,
    response.status === 201 && freshnessAfterContact.rows[0]?.attempt_count === 1 &&
      freshnessAfterContact.rows[0]?.verified_at?.valueOf() === freshnessBeforeContact.rows[0]?.verified_at?.valueOf(),
  );
  response = await mutation(`/api/facilities/${facility.id}/verifications`, userLogin.cookie, 'POST', {
    expectedVersion: 1, verifiedAt: new Date().toISOString(), method: 'phone', acceptingStatus: 'no', verifiedBy: admin.id,
  });
  record('Verification mass assignment', 'BLOCKED', `HTTP ${response.status}`, response.status === 400);
  response = await mutation(`/api/facilities/${facility.id}/verifications`, userLogin.cookie, 'POST', {
    expectedVersion: 0, verifiedAt: new Date().toISOString(), method: 'phone', acceptingStatus: 'no',
  });
  record('Stale facility update', 'BLOCKED', `HTTP ${response.status}`, response.status === 409);
  response = await request(`/api/facilities/${facility.id}/verifications`, {
    method: 'POST', clientIp: '192.0.2.51',
    headers: { origin: publicOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: JSON.stringify({ expectedVersion: 1, verifiedAt: new Date().toISOString(), method: 'phone', acceptingStatus: 'no' }),
  });
  record('Anonymous facility verification', 'BLOCKED', `HTTP ${response.status}`, response.status === 401);
  response = await request(`/api/facilities/${facility.id}/contact-attempts`, {
    method: 'POST', cookie: userLogin.cookie, clientIp: '192.0.2.11', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ attemptedAt: new Date().toISOString(), method: 'phone', outcome: 'no_answer' }),
  });
  record('Missing CSRF origin on facility activity', 'BLOCKED', `HTTP ${response.status}`, response.status === 403);
  response = await mutation('/api/admin/facilities/merge', userLogin.cookie, 'POST', {
    survivorFacilityId: facility.id, mergedFacilityId: crypto.randomUUID(), reason: 'Acceptance test',
    survivorExpectedVersion: 1, mergedExpectedVersion: 0, confirmation: 'MERGE',
  });
  record('User facility merge', 'BLOCKED', `HTTP ${response.status}`, response.status === 403);
  response = await mutation('/api/admin/reverification/assign', userLogin.cookie, 'POST', {
    facilityIds: [facility.id], assignedTo: userA.id, reasonCodes: ['stale_accepting'],
  });
  record('User bulk assignment', 'BLOCKED', `HTTP ${response.status}`, response.status === 403);
  response = await request(`/api/authorizations/${authorizationA.id}`, { cookie: userLogin.cookie, clientIp: '192.0.2.11' });
  record('User → authorized resource', 'PASS', `HTTP ${response.status}`, response.status === 200);
  response = await request(`/api/authorizations/${authorizationB.id}`, { cookie: userLogin.cookie, clientIp: '192.0.2.11' });
  record("User → another user's private resource", 'BLOCKED', `HTTP ${response.status}`, response.status === 404);
  response = await mutation(`/api/authorizations/${authorizationB.id}`, userLogin.cookie, 'PATCH', { status: 'complete' });
  record("User → another user's mutation", 'BLOCKED', `HTTP ${response.status}`, response.status === 404);
  response = await mutation(`/api/authorizations/${authorizationB.id}`, userLogin.cookie, 'DELETE');
  record("User → another user's deletion", 'BLOCKED', `HTTP ${response.status}`, response.status === 403);
  response = await mutation(`/api/authorizations/${authorizationA.id}`, userLogin.cookie, 'PATCH', { createdBy: userA.id, status: 'complete' });
  record('Unexpected ownership field / mass assignment', 'BLOCKED', `HTTP ${response.status}`, response.status === 400);
  response = await mutation(`/api/authorizations/${authorizationA.id}`, userLogin.cookie, 'PATCH', {
    referralReasonDetail: 'x'.repeat(17 * 1024),
  });
  record('Oversized mutation body', 'BLOCKED', `HTTP ${response.status}`, response.status === 413);
  response = await request('/api/authorizations/not-a-uuid', { cookie: userLogin.cookie, clientIp: '192.0.2.11' });
  record('Invalid route identifier', 'BLOCKED', `HTTP ${response.status}`, response.status === 400);
  response = await request(`/api/authorizations/${authorizationA.id}`, {
    method: 'PUT', cookie: userLogin.cookie, clientIp: '192.0.2.11',
    headers: { origin: publicOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' }, body: '{}',
  });
  record('Unsupported mutation method', 'BLOCKED', `HTTP ${response.status}`, response.status === 405);
  response = await request(`/api/authorizations/${authorizationA.id}`, {
    method: 'PATCH', clientIp: '192.0.2.51',
    headers: { origin: publicOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'complete' }),
  });
  record('Direct API call bypassing UI', 'BLOCKED', `HTTP ${response.status}`, response.status === 401);
  response = await request('/admin', { cookie: userLogin.cookie, clientIp: '192.0.2.11' });
  record('User → admin page', 'BLOCKED', `HTTP ${response.status} → ${response.headers.get('location')}`, response.status >= 300 && response.status < 400 && response.headers.get('location')?.endsWith('/forbidden') === true);
  response = await mutation(`/api/admin/users/${userB.id}`, userLogin.cookie, 'PATCH', { role: 'admin' });
  record('User → admin API', 'BLOCKED', `HTTP ${response.status}`, response.status === 403);
  response = await request('/migration', { cookie: userLogin.cookie, clientIp: '192.0.2.11' });
  record('User migration console', 'BLOCKED', `HTTP ${response.status}`, response.status >= 300 && response.status < 400 && response.headers.get('location')?.endsWith('/forbidden') === true);
  response = await request('/api/admin/migrations', { cookie: userLogin.cookie, clientIp: '192.0.2.11' });
  record('User migration history API', 'BLOCKED', `HTTP ${response.status}`, response.status === 403);
  response = await mutation(`/api/admin/migrations/${crypto.randomUUID()}/diagnostics/${crypto.randomUUID()}`, userLogin.cookie, 'PATCH', { action: 'skip', note: 'Not authorized', version: 0 });
  record('User migration diagnostic mutation', 'BLOCKED', `HTTP ${response.status}`, response.status === 403);
  response = await request(`/api/admin/migrations/${crypto.randomUUID()}/diagnostics.csv`, { cookie: userLogin.cookie, clientIp: '192.0.2.11' });
  record('User migration diagnostic export', 'BLOCKED', `HTTP ${response.status}`, response.status === 403);
  response = await request(`/api/admin/users/${userB.id}`, {
    method: 'PATCH', cookie: userLogin.cookie, clientIp: '192.0.2.11',
    headers: { origin: publicOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', 'x-user-role': 'admin' },
    body: JSON.stringify({ role: 'admin' }),
  });
  record('Modified client role → admin API', 'BLOCKED', `HTTP ${response.status}`, response.status === 403);
  response = await request(`/api/authorizations/${authorizationA.id}`, {
    method: 'PATCH', cookie: userLogin.cookie, clientIp: '192.0.2.11',
    headers: { origin: 'https://attacker.example', 'sec-fetch-site': 'cross-site', 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'complete' }),
  });
  record('Cross-site mutation request', 'BLOCKED', `HTTP ${response.status}`, response.status === 403);

  let adminLogin = await signIn(fixtures.admin.email, fixtures.admin.password, '192.0.2.10');
  await pool.query('UPDATE sessions SET created_at=$1 WHERE user_id=$2', [new Date(Date.now() - 901_000), admin.id]);
  response = await mutation('/api/admin/automation/settings', adminLogin.cookie, 'PATCH', {
    timeZone: 'America/New_York', upcomingStaleDays: 7, meaningfulWaitIncreaseDays: 14,
    meaningfulWaitIncreasePercent: 50, highPriorityEscalationDays: 3, dailyDigestHour: 7, weeklyDigestDay: 1, batchSize: 500,
  });
  record('Stale login on privileged operation', 'BLOCKED', `HTTP ${response.status}`, response.status === 401);
  adminLogin = await signIn(fixtures.admin.email, fixtures.admin.password, '192.0.2.10');
  record('Fresh login restores privileged access', 'PASS', `HTTP ${adminLogin.response.status}`, adminLogin.response.status === 200 && Boolean(adminLogin.cookie));

  response = await request('/governance', { cookie: adminLogin.cookie, clientIp: '192.0.2.10' });
  record('Administrator governance access', 'PASS', `HTTP ${response.status}`, response.status === 200);
  response = await request('/governance', { cookie: userLogin.cookie, clientIp: '192.0.2.11' });
  record('URA governance page access', 'BLOCKED', `HTTP ${response.status}`, response.status >= 300 && response.status < 400 && response.headers.get('location')?.endsWith('/forbidden') === true);
  response = await mutation('/api/governance/access-reviews', userLogin.cookie, 'POST', {
    reviewedUserId: userA.id, reviewPeriod: '2026-Q3', decision: 'retain',
  });
  record('URA access certification decision', 'BLOCKED', `HTTP ${response.status}`, response.status === 403);
  response = await mutation('/api/governance/access-reviews', adminLogin.cookie, 'POST', {
    reviewedUserId: userA.id, reviewPeriod: '2026-Q3', decision: 'retain',
  });
  const accessReviewAudit = await pool.query<{ decisions: number; events: number }>(`
    SELECT
      (SELECT count(*)::int FROM access_review_decisions WHERE reviewed_user_id=$1 AND review_period='2026-Q3') AS decisions,
      (SELECT count(*)::int FROM audit_events WHERE action='access-review.decision' AND entity_id=$1::text) AS events`, [userA.id]);
  record(
    'Administrator records audited access decision',
    'PASS',
    `HTTP ${response.status}; decisions ${accessReviewAudit.rows[0]?.decisions}; audits ${accessReviewAudit.rows[0]?.events}`,
    response.status === 201 && accessReviewAudit.rows[0]?.decisions === 1 && accessReviewAudit.rows[0]?.events === 1,
  );
  response = await mutation('/api/governance/retention', adminLogin.cookie, 'PATCH', {
    category: 'expired_sessions', retentionDays: 30, deletionEnabled: false, policyReference: null,
  });
  record('Retention stays disabled without approved policy', 'PASS', `HTTP ${response.status}`, response.status === 200);
  response = await mutation('/api/governance/retention', adminLogin.cookie, 'PATCH', {
    category: 'expired_sessions', retentionDays: 30, deletionEnabled: true,
    policyReference: 'TEST-POLICY', confirmation: 'wrong',
  });
  record('Retention enable confirmation', 'BLOCKED', `HTTP ${response.status}`, response.status === 400);
  response = await mutation('/api/governance/retention/dry-run', adminLogin.cookie, 'POST', { category: 'expired_sessions' });
  const retentionBody = response.ok ? await response.clone().json() as { result?: { configured?: boolean; mode?: string } } : {};
  record('Retention dry run deletes nothing', 'PASS', `HTTP ${response.status}`, response.status === 200 && retentionBody.result?.configured === true && retentionBody.result?.mode === 'dry-run');
  response = await mutation('/api/governance/holds', adminLogin.cookie, 'POST', {
    category: 'expired_sessions', entityType: null, entityId: null, reasonCode: 'incident_preservation',
  });
  const holdBody = response.ok ? await response.clone().json() as { hold?: { id?: string } } : {};
  const holdId = holdBody.hold?.id;
  const releaseHold = holdId
    ? await mutation(`/api/governance/holds/${holdId}`, adminLogin.cookie, 'DELETE', { reasonCode: 'test_complete' })
    : new Response(null, { status: 500 });
  record('Retention hold place and release', 'PASS', `place HTTP ${response.status}; release HTTP ${releaseHold.status}`, response.status === 201 && releaseHold.status === 200);
  response = await mutation('/api/governance/incidents/scope', adminLogin.cookie, 'POST', {
    userId: userA.id,
    start: new Date(Date.now() - 86_400_000).toISOString(),
    end: new Date(Date.now() + 60_000).toISOString(),
  });
  const incidentBody = response.ok ? await response.clone().json() as { report?: { summary?: { signIns?: number }; evidenceLimitations?: string[] } } : {};
  record('Account investigation report', 'PASS', `HTTP ${response.status}`, response.status === 200 && (incidentBody.report?.summary?.signIns ?? 0) >= 1 && (incidentBody.report?.evidenceLimitations?.length ?? 0) >= 1);
  response = await request('/api/exports/providers.csv', {
    method: 'POST',
    headers: { origin: publicOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: JSON.stringify({ unexpected: true }),
  });
  record('Anonymous provider export', 'BLOCKED', `HTTP ${response.status}`, response.status === 401);
  response = await mutation('/api/exports/providers.csv', userLogin.cookie, 'POST', { memberZip: '04530', radius: 50 });
  const providerExportText = await response.clone().text();
  record(
    'URA provider export with current scope',
    'PASS',
    `HTTP ${response.status}; ${response.headers.get('x-data-classification')}`,
    response.status === 200
      && response.headers.get('content-disposition')?.includes('provider-directory-') === true
      && response.headers.get('cache-control')?.includes('no-store') === true
      && response.headers.get('x-data-classification') === 'confidential-operational'
      && providerExportText.includes('"Facility"'),
  );
  response = await mutation('/api/exports/providers.csv', adminLogin.cookie, 'POST', { unexpected: true });
  record('Administrator provider export authorization boundary', 'PASS', `HTTP ${response.status}`, response.status === 400);

  const emergencyPassword = password();
  response = await mutation('/api/admin/users', adminLogin.cookie, 'POST', {
    email: `emergency-${runId}@example.invalid`,
    name: 'Emergency Revocation User',
    password: emergencyPassword,
    role: 'auditor',
  });
  const emergencyUserBody = response.ok ? await response.clone().json() as { user?: { id?: string } } : {};
  const emergencyUserId = emergencyUserBody.user?.id;
  const emergencyLogin = await signIn(`emergency-${runId}@example.invalid`, emergencyPassword, '192.0.2.81');
  const emergencyRevoke = emergencyUserId
    ? await mutation(`/api/governance/users/${emergencyUserId}/emergency-revoke`, adminLogin.cookie, 'POST')
    : new Response(null, { status: 500 });
  const emergencySessionReuse = await request('/api/session', { cookie: emergencyLogin.cookie, clientIp: '192.0.2.81' });
  const emergencyState = emergencyUserId
    ? await pool.query<{ is_active: boolean; role: string; audit_count: number }>(`
        SELECT is_active,role::text,
          (SELECT count(*)::int FROM audit_events WHERE action='user.emergency-revoke' AND entity_id=users.id::text) AS audit_count
        FROM users WHERE id=$1`, [emergencyUserId])
    : { rows: [] };
  record(
    'Emergency account revocation',
    'BLOCKED',
    `revoke HTTP ${emergencyRevoke.status}; reused HTTP ${emergencySessionReuse.status}`,
    emergencyRevoke.status === 200 && emergencySessionReuse.status === 401
      && emergencyState.rows[0]?.is_active === false && emergencyState.rows[0]?.role === 'ura_user'
      && emergencyState.rows[0]?.audit_count === 1,
  );

  response = await request('/api/admin/migrations/not-a-uuid', { cookie: adminLogin.cookie, clientIp: '192.0.2.10' });
  record('Invalid migration route identifier', 'BLOCKED', `HTTP ${response.status}`, response.status === 400);
  const noOriginUpload = new FormData();
  noOriginUpload.set('admin', new File(['not a workbook'], 'legacy.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  response = await request('/api/admin/migrations', { method: 'POST', cookie: adminLogin.cookie, clientIp: '192.0.2.10', body: noOriginUpload });
  record('Missing CSRF origin on migration preview', 'BLOCKED', `HTTP ${response.status}`, response.status === 403);
  const macroUpload = new FormData();
  macroUpload.set('admin', new File(['not a workbook'], 'legacy.xlsm', { type: 'application/vnd.ms-excel.sheet.macroEnabled.12' }));
  response = await request('/api/admin/migrations', { method: 'POST', cookie: adminLogin.cookie, clientIp: '192.0.2.10', headers: { origin: publicOrigin, 'sec-fetch-site': 'same-origin' }, body: macroUpload });
  record('Macro-enabled migration upload', 'BLOCKED', `HTTP ${response.status}`, response.status === 400);
  const validMigrationUpload = new FormData();
  validMigrationUpload.set('admin', new File([Buffer.from(emptyAdminWorkbook())], 'legacy-admin.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  response = await request('/api/admin/migrations', { method: 'POST', cookie: adminLogin.cookie, clientIp: '192.0.2.10', headers: { origin: publicOrigin, 'sec-fetch-site': 'same-origin' }, body: validMigrationUpload });
  const migrationPreviewBody = response.ok ? await response.clone().json() as { run?: { id?: string; readiness?: string } } : {};
  const migrationRunId = migrationPreviewBody.run?.id;
  record('Admin migration preview', 'PASS', `HTTP ${response.status}`, response.status === 201 && migrationPreviewBody.run?.readiness === 'go' && Boolean(migrationRunId));
  response = migrationRunId ? await request(`/api/admin/migrations/${migrationRunId}`, { cookie: adminLogin.cookie, clientIp: '192.0.2.10' }) : new Response(null, { status: 500 });
  record('Admin migration detail access', 'PASS', `HTTP ${response.status}`, response.status === 200);
  response = migrationRunId ? await request(`/api/admin/migrations/${migrationRunId}/diagnostics.csv`, { cookie: adminLogin.cookie, clientIp: '192.0.2.10' }) : new Response(null, { status: 500 });
  record('Admin migration diagnostic export', 'PASS', `HTTP ${response.status}; ${response.headers.get('content-type')}`, response.status === 200 && response.headers.get('content-type')?.startsWith('text/csv') === true);
  response = await request('/api/notifications?limit=50', { cookie: userLogin.cookie, clientIp: '192.0.2.11' });
  const ownNotificationBody = response.ok ? await response.clone().json() as { rows?: Array<{ id: string }> } : {};
  record('Notification list ownership', 'PASS', `HTTP ${response.status}`, response.status === 200 && ownNotificationBody.rows?.some((row) => row.id === notificationA.id) === true && ownNotificationBody.rows?.every((row) => row.id !== notificationB.id) === true);
  response = await mutation(`/api/notifications/${notificationB.id}`, userLogin.cookie, 'PATCH');
  record('Notification IDOR read-state mutation', 'BLOCKED', `HTTP ${response.status}`, response.status === 404);
  response = await mutation(`/api/notifications/${notificationA.id}`, userLogin.cookie, 'PATCH');
  record('Own notification read-state mutation', 'PASS', `HTTP ${response.status}`, response.status === 200);
  response = await mutation('/api/notification-preferences', userLogin.cookie, 'PATCH', {
    inAppEnabled: true, digestFrequency: 'weekly', categories: ['work', 'changes'], minimumSeverity: 'attention',
  });
  record('Own notification preference update', 'PASS', `HTTP ${response.status}`, response.status === 200);
  response = await request('/automation', { cookie: userLogin.cookie, clientIp: '192.0.2.11' });
  record('Restricted notification target', 'BLOCKED', `HTTP ${response.status}`, response.status >= 300 && response.status < 400 && response.headers.get('location')?.endsWith('/forbidden') === true);
  response = await mutation('/api/admin/automation/run', userLogin.cookie, 'POST', { jobType: 'reverification_scan', dryRun: true });
  record('User manual automation execution', 'BLOCKED', `HTTP ${response.status}`, response.status === 403);
  response = await mutation('/api/admin/automation/settings', userLogin.cookie, 'PATCH', {
    timeZone: 'America/New_York', upcomingStaleDays: 7, meaningfulWaitIncreaseDays: 14,
    meaningfulWaitIncreasePercent: 50, highPriorityEscalationDays: 3, dailyDigestHour: 7, weeklyDigestDay: 1, batchSize: 500,
  });
  record('User automation configuration change', 'BLOCKED', `HTTP ${response.status}`, response.status === 403);
  response = await mutation(`/api/work-items/${workB.id}`, userLogin.cookie, 'PATCH', { status: 'completed', expectedVersion: workB.optimistic_lock_version });
  record('Work item assignment IDOR', 'BLOCKED', `HTTP ${response.status}`, response.status === 404);
  response = await mutation(`/api/work-items/${workA.id}`, userLogin.cookie, 'PATCH', { status: 'completed', expectedVersion: workA.optimistic_lock_version });
  record('Assigned work completion', 'PASS', `HTTP ${response.status}`, response.status === 200);
  response = await mutation('/api/admin/automation/settings', adminLogin.cookie, 'PATCH', {
    timeZone: 'America/New_York', upcomingStaleDays: 7, meaningfulWaitIncreaseDays: 14,
    meaningfulWaitIncreasePercent: 50, highPriorityEscalationDays: 3, dailyDigestHour: 7, weeklyDigestDay: 1, batchSize: 500,
  });
  record('Admin automation configuration change', 'PASS', `HTTP ${response.status}`, response.status === 200);
  response = await mutation('/api/admin/automation/run', adminLogin.cookie, 'POST', { jobType: 'reverification_scan', dryRun: true });
  record('Admin manual dry run', 'PASS', `HTTP ${response.status}`, response.status === 200);
  response = await mutation('/api/admin/coverage-watches', adminLogin.cookie, 'POST', {
    name: 'Security coverage watch', specialtyId: specialtyFixture.rows[0]?.id, diagnosisId: null,
    postalCode: '04103', radiusMiles: 50, minimumCount: 2, freshnessDays: 45, enabled: true,
  });
  record('Admin coverage watch creation', 'PASS', `HTTP ${response.status}`, response.status === 201);
  response = await request('/automation', { cookie: adminLogin.cookie, clientIp: '192.0.2.10' });
  record('Admin automation health access', 'PASS', `HTTP ${response.status}`, response.status === 200);
  response = await mutation('/api/admin/reverification/assign', adminLogin.cookie, 'POST', {
    facilityIds: [facility.id], assignedTo: userA.id, reasonCodes: ['stale_accepting'],
  });
  const assignmentCount = await pool.query<{ count: number }>('SELECT count(*)::int AS count FROM reverification_assignments WHERE facility_id=$1', [facility.id]);
  record('Admin bulk assignment', 'PASS', `HTTP ${response.status}; rows ${assignmentCount.rows[0]?.count}`, response.status === 200 && assignmentCount.rows[0]?.count === 1);
  response = await mutation('/api/admin/facilities/merge', adminLogin.cookie, 'POST', {
    survivorFacilityId: facility.id,
    mergedFacilityId: mergedFacility.id,
    reason: 'Acceptance-test duplicate confirmed by administrator.',
    survivorExpectedVersion: 1,
    mergedExpectedVersion: 0,
    confirmation: 'MERGE',
  });
  const mergeState = await pool.query<{ archived: boolean; destination: string | null; history: number; specialties: number; diagnoses: number; merge_records: number }>(
    `SELECT NOT source.active AS archived, source.merged_into_facility_id AS destination,
      (SELECT count(*)::int FROM facility_verification_events WHERE facility_id=source.id) AS history,
      (SELECT count(*)::int FROM facility_specialties WHERE facility_id=$1) AS specialties,
      (SELECT count(*)::int FROM facility_diagnosis_capabilities WHERE facility_id=$1) AS diagnoses,
      (SELECT count(*)::int FROM facility_merge_records WHERE survivor_facility_id=$1 AND merged_facility_id=source.id) AS merge_records
     FROM facilities source WHERE source.id=$2`, [facility.id, mergedFacility.id],
  );
  record(
    'Admin merge preserves history and relationships',
    'PASS',
    `HTTP ${response.status}; history ${mergeState.rows[0]?.history}; specialties ${mergeState.rows[0]?.specialties}; diagnoses ${mergeState.rows[0]?.diagnoses}`,
    response.status === 201 && mergeState.rows[0]?.archived === true && mergeState.rows[0]?.destination === facility.id &&
      mergeState.rows[0]?.history === 1 && mergeState.rows[0]?.specialties === 1 && mergeState.rows[0]?.diagnoses === 1 && mergeState.rows[0]?.merge_records === 1,
  );
  response = await mutation(`/api/admin/users/${userB.id}`, adminLogin.cookie, 'PATCH', { role: 'report_viewer' });
  record('Admin → approved admin operation', 'PASS', `HTTP ${response.status}`, response.status === 200);
  response = await mutation(`/api/admin/users/${admin.id}`, adminLogin.cookie, 'PATCH', { role: 'ura_user' });
  record('Admin self-demotion request', 'BLOCKED', `HTTP ${response.status}`, response.status === 409);

  const provisionedPassword = password();
  response = await mutation('/api/admin/users', adminLogin.cookie, 'POST', {
    email: `provisioned-${runId}@example.invalid`,
    name: 'Provisioned Auditor',
    password: provisionedPassword,
    role: 'auditor',
  });
  const provisionedBody = response.ok ? await response.clone().json() as { user?: { id?: string } } : {};
  const provisionedId = provisionedBody.user?.id;
  record('Admin → staff account creation', 'PASS', `HTTP ${response.status}`, response.status === 201 && Boolean(provisionedId));

  let provisionedLogin = await signIn(`provisioned-${runId}@example.invalid`, provisionedPassword, '192.0.2.14');
  record('Provisioned account sign-in', 'PASS', `HTTP ${provisionedLogin.response.status}`, provisionedLogin.response.status === 200 && Boolean(provisionedLogin.cookie));
  response = provisionedId
    ? await request(`/api/admin/users/${provisionedId}/sessions`, { cookie: adminLogin.cookie, clientIp: '192.0.2.10' })
    : new Response(null, { status: 500 });
  const sessionListText = await response.clone().text();
  const sessionListBody = response.ok ? JSON.parse(sessionListText) as { sessions?: Array<{ id: string }> } : {};
  const provisionedSessionId = sessionListBody.sessions?.[0]?.id;
  record(
    'Administrator session inventory omits credentials',
    'PASS',
    `HTTP ${response.status}; sessions=${sessionListBody.sessions?.length ?? 0}`,
    response.status === 200 && Boolean(provisionedSessionId)
      && !sessionListText.toLowerCase().includes('token')
      && !sessionListText.includes(provisionedLogin.cookie),
  );
  response = provisionedId && provisionedSessionId
    ? await mutation(`/api/admin/users/${provisionedId}/sessions/${provisionedSessionId}`, adminLogin.cookie, 'DELETE')
    : new Response(null, { status: 500 });
  const afterTargetedRevocation = await request('/api/session', { cookie: provisionedLogin.cookie, clientIp: '192.0.2.14' });
  record(
    'Administrator revokes one user session',
    'PASS',
    `revoke HTTP ${response.status}; session HTTP ${afterTargetedRevocation.status}`,
    response.status === 200 && afterTargetedRevocation.status === 401,
  );
  provisionedLogin = await signIn(`provisioned-${runId}@example.invalid`, provisionedPassword, '192.0.2.14');
  const replacementPassword = password();
  response = provisionedId
    ? await mutation(`/api/admin/users/${provisionedId}/password`, adminLogin.cookie, 'POST', { newPassword: replacementPassword })
    : new Response(null, { status: 500 });
  const revokedAfterReset = await request('/api/session', { cookie: provisionedLogin.cookie, clientIp: '192.0.2.14' });
  const replacementLogin = await signIn(`provisioned-${runId}@example.invalid`, replacementPassword, '192.0.2.15');
  record(
    'Admin password reset and session revocation',
    'PASS',
    `reset HTTP ${response.status}; old session HTTP ${revokedAfterReset.status}; new sign-in HTTP ${replacementLogin.response.status}`,
    response.status === 200 && revokedAfterReset.status === 401 && replacementLogin.response.status === 200,
  );
  const finalPassword = password();
  response = await mutation('/api/account/password', replacementLogin.cookie, 'POST', {
    currentPassword: replacementPassword,
    newPassword: finalPassword,
  });
  const previousPasswordLogin = await signIn(`provisioned-${runId}@example.invalid`, replacementPassword, '192.0.2.19');
  const changedPasswordLogin = await signIn(`provisioned-${runId}@example.invalid`, finalPassword, '192.0.2.20');
  record(
    'User password change verifies current password',
    'PASS',
    `change HTTP ${response.status}; old sign-in HTTP ${previousPasswordLogin.response.status}; new sign-in HTTP ${changedPasswordLogin.response.status}`,
    response.status === 200 && previousPasswordLogin.response.status === 401 && changedPasswordLogin.response.status === 200,
  );

  const viewerLogin = await signIn(fixtures.userB.email, fixtures.userB.password, '192.0.2.13');
  const viewerReport = await request('/reports', { cookie: viewerLogin.cookie, clientIp: '192.0.2.13' });
  const viewerOperations = await request('/provider-search', { cookie: viewerLogin.cookie, clientIp: '192.0.2.13' });
  record(
    'Report viewer permission boundary',
    'PASS',
    `report HTTP ${viewerReport.status}; operations HTTP ${viewerOperations.status}`,
    viewerReport.status === 200 && viewerOperations.status >= 300 && viewerOperations.status < 400 && viewerOperations.headers.get('location')?.endsWith('/forbidden') === true,
  );
  response = await mutation('/api/exports/providers.csv', viewerLogin.cookie, 'POST', { unexpected: true });
  record('Report viewer provider row export', 'BLOCKED', `HTTP ${response.status}`, response.status === 403);
  response = await request('/governance', { cookie: viewerLogin.cookie, clientIp: '192.0.2.13' });
  record('Report viewer governance access', 'BLOCKED', `HTTP ${response.status}`, response.status >= 300 && response.status < 400 && response.headers.get('location')?.endsWith('/forbidden') === true);
  response = await request('/governance', { cookie: changedPasswordLogin.cookie, clientIp: '192.0.2.20' });
  record('Auditor governance access', 'PASS', `HTTP ${response.status}`, response.status === 200);
  response = await mutation('/api/exports/providers.csv', changedPasswordLogin.cookie, 'POST', { unexpected: true });
  record('Auditor provider row export', 'BLOCKED', `HTTP ${response.status}`, response.status === 403);
  response = await mutation('/api/governance/access-reviews', changedPasswordLogin.cookie, 'POST', {
    reviewedUserId: userA.id, reviewPeriod: '2026-Q3', decision: 'retain',
  });
  record('Auditor access certification write', 'BLOCKED', `HTTP ${response.status}`, response.status === 403);
  response = await mutation('/api/governance/incidents/scope', changedPasswordLogin.cookie, 'POST', {
    userId: userA.id,
    start: new Date(Date.now() - 86_400_000).toISOString(),
    end: new Date(Date.now() + 60_000).toISOString(),
  });
  record('Auditor incident investigation', 'PASS', `HTTP ${response.status}`, response.status === 200);
  response = await request(`/api/admin/users/${userB.id}`, {
    method: 'PATCH', cookie: adminLogin.cookie, clientIp: '192.0.2.10',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'ura_user' }),
  });
  record('Missing CSRF origin → admin mutation', 'BLOCKED', `HTTP ${response.status}`, response.status === 403);

  const idleLogin = await signIn(fixtures.userA.email, fixtures.userA.password, '192.0.2.18');
  await pool.query('UPDATE sessions SET updated_at=$1 WHERE user_id=$2', [new Date(Date.now() - 1_801_000), userA.id]);
  response = await request('/api/session', { cookie: idleLogin.cookie, clientIp: '192.0.2.18' });
  record('Idle session timeout', 'BLOCKED', `HTTP ${response.status}`, response.status === 401);

  const revokedLogin = await signIn(fixtures.userA.email, fixtures.userA.password, '192.0.2.11');
  await pool.query('DELETE FROM sessions WHERE user_id = $1', [userA.id]);
  response = await request('/api/session', { cookie: revokedLogin.cookie, clientIp: '192.0.2.11' });
  record('Revoked session → protected resource', 'BLOCKED', `HTTP ${response.status}`, response.status === 401);

  const expiredLogin = await signIn(fixtures.userA.email, fixtures.userA.password, '192.0.2.11');
  await pool.query('UPDATE sessions SET expires_at = $1 WHERE user_id = $2', [new Date(Date.now() - 60_000), userA.id]);
  response = await request('/api/session', { cookie: expiredLogin.cookie, clientIp: '192.0.2.11' });
  record('Expired session → protected resource', 'BLOCKED', `HTTP ${response.status}`, response.status === 401);

  const logoutLogin = await signIn(fixtures.userA.email, fixtures.userA.password, '192.0.2.11');
  response = await mutation('/api/auth/sign-out', logoutLogin.cookie, 'POST', {});
  const afterLogout = await request('/api/session', { cookie: logoutLogin.cookie, clientIp: '192.0.2.11' });
  record('Logout invalidates access', 'BLOCKED', `logout HTTP ${response.status}; session HTTP ${afterLogout.status}`, response.ok && afterLogout.status === 401);

  response = await request('/api/session', { cookie: 'provider-tracker.session_token=malformed', clientIp: '192.0.2.50' });
  record('Malformed session', 'BLOCKED', `HTTP ${response.status}`, response.status === 401);

  response = await mutation(`/api/admin/users/${userA.id}`, adminLogin.cookie, 'PATCH', { isActive: false });
  const disabledLogin = await signIn(fixtures.userA.email, fixtures.userA.password, '192.0.2.12');
  record('Disabled user sign-in', 'BLOCKED', `disable HTTP ${response.status}; sign-in HTTP ${disabledLogin.response.status}`, response.status === 200 && (disabledLogin.response.status !== 200 || !disabledLogin.cookie));

  let rateLimited = false;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const attemptResult = await signIn(fixtures.userB.email, 'Wrong-password1!', '192.0.2.98');
    if (attemptResult.response.status === 429) rateLimited = true;
  }
  record('Sign-in brute-force limit', 'BLOCKED', rateLimited ? 'HTTP 429 observed' : 'No HTTP 429', rateLimited);

  const deletedAccountPassword = password();
  const deletedAccountResponse = await mutation('/api/admin/users', adminLogin.cookie, 'POST', {
    email: `deleted-${runId}@example.invalid`,
    name: 'Deleted Session Fixture',
    password: deletedAccountPassword,
    role: 'ura_user',
  });
  const deletedAccountBody = deletedAccountResponse.ok
    ? await deletedAccountResponse.json() as { user?: { id?: string } }
    : {};
  const deletedAccountId = deletedAccountBody.user?.id;
  const deletedUserLogin = await signIn(`deleted-${runId}@example.invalid`, deletedAccountPassword, '192.0.2.16');
  if (deletedAccountId) await pool.query('DELETE FROM users WHERE id = $1', [deletedAccountId]);
  response = await request('/api/session', { cookie: deletedUserLogin.cookie, clientIp: '192.0.2.16' });
  record(
    'Deleted user session',
    'BLOCKED',
    `create HTTP ${deletedAccountResponse.status}; session HTTP ${response.status}`,
    Boolean(deletedAccountId) && deletedUserLogin.response.status === 200 && response.status === 401,
  );

  const auditRows = await pool.query<{ action: string; metadata: unknown }>(
    `SELECT action, metadata FROM audit_events
     WHERE action = ANY($1::text[])`,
    [['auth.sign-in', 'auth.sign-out', 'account.password-change', 'account.session-revoke', 'user.create', 'user.role-change', 'user.password-reset', 'user.deactivate', 'user.emergency-revoke', 'facility.verification.create', 'facility.contact-attempt.create', 'reverification.bulk-assign', 'facility.merge', 'migration.preview', 'export.migration-diagnostics', 'export.provider-directory', 'provider.search', 'report.view', 'access-review.decision', 'retention.policy-update', 'retention.dry-run', 'retention.hold-place', 'retention.hold-release', 'security.investigation.run']],
  );
  const auditedActionsFound = new Set(auditRows.rows.map((row) => row.action));
  const requiredAuditActions = ['auth.sign-in', 'auth.sign-out', 'account.password-change', 'account.session-revoke', 'user.create', 'user.role-change', 'user.password-reset', 'user.deactivate', 'user.emergency-revoke', 'facility.verification.create', 'facility.contact-attempt.create', 'reverification.bulk-assign', 'facility.merge', 'migration.preview', 'export.migration-diagnostics', 'export.provider-directory', 'provider.search', 'report.view', 'access-review.decision', 'retention.policy-update', 'retention.dry-run', 'retention.hold-place', 'retention.hold-release', 'security.investigation.run'];
  const serializedAuditRows = JSON.stringify(auditRows.rows);
  const sensitiveFixtureValues = [
    ...Object.values(fixtures).flatMap((fixture) => [fixture.email, fixture.password]),
    provisionedPassword,
    replacementPassword,
    finalPassword,
    emergencyPassword,
    deletedAccountPassword,
    userLogin.cookie,
    adminLogin.cookie,
  ];
  record(
    'Security audit trail',
    'PASS',
    `${auditedActionsFound.size}/${requiredAuditActions.length} required action types stored`,
    requiredAuditActions.every((action) => auditedActionsFound.has(action)) &&
      sensitiveFixtureValues.every((value) => !serializedAuditRows.includes(value)),
  );

  const failed = results.filter((result) => !result.pass);
  console.table(results);
  if (failed.length) {
    throw new Error(`${failed.length} security acceptance scenario(s) failed: ${failed.map((result) => `${result.scenario} (${result.actual})`).join('; ')}.${runtime.stderr ? ` Server error: ${runtime.stderr.slice(0, 500)}` : ''}`);
  }
}

try {
  await main();
} finally {
  if (runtime.server && !runtime.server.killed) runtime.server.kill();
  await pool.end();
}
