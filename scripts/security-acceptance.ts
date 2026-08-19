import { randomBytes } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { hashPassword } from 'better-auth/crypto';
import { Pool } from 'pg';

const databaseUrl = process.env.SECURITY_TEST_DATABASE_URL?.trim();
const baseUrl = process.env.SECURITY_TEST_BASE_URL?.trim() || 'http://127.0.0.1:3100';
const publicOrigin = process.env.SECURITY_TEST_PUBLIC_ORIGIN?.trim() || 'https://provider-tracker.test';
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
};
Object.assign(process.env, runtimeEnvironment);

const pool = new Pool({ connectionString: databaseUrl });
const results: Array<{ scenario: string; expected: string; actual: string; pass: boolean }> = [];
const runtime = { server: null as ChildProcess | null };

function record(scenario: string, expected: string, actual: string, pass: boolean) {
  results.push({ scenario, expected, actual, pass });
}

function password() {
  return `Aa1!${randomBytes(18).toString('base64url')}`;
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
  if (options.cookie) headers.set('cookie', options.cookie);
  if (options.clientIp) headers.set('x-real-ip', options.clientIp);
  return fetch(`${baseUrl}${path}`, { ...options, headers, redirect: 'manual' });
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

async function signIn(email: string, accountPassword: string, clientIp: string) {
  const response = await request('/api/auth/sign-in/email', {
    method: 'POST',
    clientIp,
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
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/sign-in`);
      if (response.status === 200) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('The production server did not become ready within 60 seconds.');
}

async function createTestSchema() {
  await pool.query(`
    DROP TABLE IF EXISTS audit_events, authorizations, auth_rate_limits, verification_tokens, sessions, accounts, users CASCADE;
    DROP TYPE IF EXISTS authorization_status CASCADE;
    DROP TYPE IF EXISTS user_role CASCADE;
    CREATE TYPE user_role AS ENUM ('admin', 'ura_user', 'report_viewer', 'auditor');
    CREATE TYPE authorization_status AS ENUM ('open', 'complete', 'cancelled');
    CREATE TABLE users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, email text NOT NULL UNIQUE,
      email_verified boolean NOT NULL DEFAULT false, display_name text, image text,
      initials text NOT NULL DEFAULT '--', role user_role NOT NULL DEFAULT 'ura_user',
      is_active boolean NOT NULL DEFAULT true, is_service_account boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX users_role_active_idx ON users(role, is_active);
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
    CREATE TABLE audit_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
      action text NOT NULL, result text NOT NULL DEFAULT 'success', entity_type text NOT NULL, entity_id text,
      before_json jsonb, after_json jsonb, request_id text, source_ip_hash text,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX audit_events_entity_idx ON audit_events(entity_type, entity_id, created_at);
    CREATE INDEX audit_events_actor_created_idx ON audit_events(actor_id, created_at);
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

  const nextExecutable = fileURLToPath(new URL('../node_modules/next/dist/bin/next', import.meta.url));
  runtime.server = spawn(process.execPath, [nextExecutable, 'start', '-H', '127.0.0.1', '-p', new URL(baseUrl).port], {
    cwd: process.cwd(),
    env: runtimeEnvironment,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let serverError = '';
  runtime.server.stderr?.on('data', (chunk) => { serverError += String(chunk); });
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
  record(
    'Cross-origin browser access policy',
    'BLOCKED',
    response.headers.has('access-control-allow-origin') ? 'CORS header present' : 'No CORS allow-origin header',
    !response.headers.has('access-control-allow-origin'),
  );
  response = await request('/');
  record('Anonymous → authenticated page', 'BLOCKED', `HTTP ${response.status} → ${response.headers.get('location')}`, response.status >= 300 && response.status < 400 && response.headers.get('location')?.endsWith('/sign-in') === true);
  response = await request('/api/session');
  record('Anonymous → protected API', 'BLOCKED', `HTTP ${response.status}`, response.status === 401);
  response = await request('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { origin: publicOrigin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'public-signup@example.invalid', password: password(), name: 'Public Signup' }),
  });
  record('Public registration endpoint', 'BLOCKED', `HTTP ${response.status}`, response.status === 404);

  const invalid = await signIn(fixtures.userA.email, 'Not-the-password1!', '192.0.2.99');
  record('Invalid credentials', 'BLOCKED', `HTTP ${invalid.response.status}`, invalid.response.status === 401);

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

  const adminLogin = await signIn(fixtures.admin.email, fixtures.admin.password, '192.0.2.10');
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

  const provisionedLogin = await signIn(`provisioned-${runId}@example.invalid`, provisionedPassword, '192.0.2.14');
  record('Provisioned account sign-in', 'PASS', `HTTP ${provisionedLogin.response.status}`, provisionedLogin.response.status === 200 && Boolean(provisionedLogin.cookie));
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

  const viewerLogin = await signIn(fixtures.userB.email, fixtures.userB.password, '192.0.2.13');
  const viewerReport = await request('/reports', { cookie: viewerLogin.cookie, clientIp: '192.0.2.13' });
  const viewerOperations = await request('/provider-search', { cookie: viewerLogin.cookie, clientIp: '192.0.2.13' });
  record(
    'Report viewer permission boundary',
    'PASS',
    `report HTTP ${viewerReport.status}; operations HTTP ${viewerOperations.status}`,
    viewerReport.status === 200 && viewerOperations.status >= 300 && viewerOperations.status < 400 && viewerOperations.headers.get('location')?.endsWith('/forbidden') === true,
  );
  response = await request(`/api/admin/users/${userB.id}`, {
    method: 'PATCH', cookie: adminLogin.cookie, clientIp: '192.0.2.10',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ role: 'ura_user' }),
  });
  record('Missing CSRF origin → admin mutation', 'BLOCKED', `HTTP ${response.status}`, response.status === 403);

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

  const deletedUserLogin = await signIn(fixtures.userB.email, fixtures.userB.password, '192.0.2.16');
  await pool.query('DELETE FROM users WHERE id = $1', [userB.id]);
  response = await request('/api/session', { cookie: deletedUserLogin.cookie, clientIp: '192.0.2.16' });
  record('Deleted user session', 'BLOCKED', `HTTP ${response.status}`, response.status === 401);

  const auditRows = await pool.query<{ action: string; metadata: unknown }>(
    `SELECT action, metadata FROM audit_events
     WHERE action = ANY($1::text[])`,
    [['auth.sign-in', 'auth.sign-out', 'user.create', 'user.role-change', 'user.password-reset', 'user.deactivate']],
  );
  const auditedActionsFound = new Set(auditRows.rows.map((row) => row.action));
  const requiredAuditActions = ['auth.sign-in', 'auth.sign-out', 'user.create', 'user.role-change', 'user.password-reset', 'user.deactivate'];
  const serializedAuditRows = JSON.stringify(auditRows.rows);
  const sensitiveFixtureValues = [
    ...Object.values(fixtures).flatMap((fixture) => [fixture.email, fixture.password]),
    provisionedPassword,
    replacementPassword,
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
    throw new Error(`${failed.length} security acceptance scenario(s) failed.${serverError ? ` Server error: ${serverError.slice(0, 500)}` : ''}`);
  }
}

try {
  await main();
} finally {
  if (runtime.server && !runtime.server.killed) runtime.server.kill();
  await pool.end();
}
