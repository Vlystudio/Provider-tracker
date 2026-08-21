import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import pg from 'pg';

const connectionString = process.env.DATABASE_SECURITY_TEST_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_SECURITY_TEST_URL or DATABASE_URL is required.');
const source = new URL(connectionString);
const database = source.pathname.slice(1);
if (!database.endsWith('_test')) {
  throw new Error('Database security acceptance only runs against a database whose name ends in _test.');
}

const suffix = randomBytes(6).toString('hex');
const role = `pt_runtime_test_${suffix}`;
const password = randomBytes(32).toString('base64url');
const identifier = `"${role}"`;
const admin = new pg.Pool({ connectionString, max: 1, statement_timeout: 20_000 });
const results: Array<{ check: string; status: 'PASS' | 'FAIL'; detail: string }> = [];

function record(check: string, passed: boolean, detail: string) {
  results.push({ check, status: passed ? 'PASS' : 'FAIL', detail });
}

async function expectPrivilegeBlocked(client: pg.Pool, check: string, sql: string) {
  try {
    await client.query(sql);
    record(check, false, 'statement unexpectedly succeeded');
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown';
    record(check, code === '42501', `SQLSTATE ${code}`);
  }
}

let runtime: pg.Pool | null = null;
try {
  await admin.query(`CREATE ROLE ${identifier} LOGIN PASSWORD '${password}' NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`);
  await admin.query(`GRANT CONNECT ON DATABASE "${database.replaceAll('"', '""')}" TO ${identifier}`);
  await admin.query(`GRANT USAGE ON SCHEMA public TO ${identifier}`);
  await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${identifier}`);
  await admin.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${identifier}`);
  await admin.query(`REVOKE UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON TABLE public.audit_events FROM ${identifier}`);

  const runtimeUrl = new URL(connectionString);
  runtimeUrl.username = role;
  runtimeUrl.password = password;
  runtime = new pg.Pool({ connectionString: runtimeUrl.toString(), max: 1, statement_timeout: 15_000 });

  const attributes = await runtime.query<{
    rolsuper: boolean; rolcreatedb: boolean; rolcreaterole: boolean; rolreplication: boolean; rolbypassrls: boolean;
  }>('SELECT rolsuper, rolcreatedb, rolcreaterole, rolreplication, rolbypassrls FROM pg_roles WHERE rolname=current_user');
  const flags = attributes.rows[0];
  record('Runtime role has no administrative attributes', Boolean(flags) && Object.values(flags).every((value) => value === false), JSON.stringify(flags));

  const memberships = await runtime.query<{ role_name: string }>(`
    SELECT parent.rolname AS role_name
    FROM pg_auth_members membership
    JOIN pg_roles parent ON parent.oid=membership.roleid
    JOIN pg_roles member ON member.oid=membership.member
    WHERE member.rolname=current_user`);
  const dangerous = memberships.rows.filter(({ role_name }) => [
    'pg_read_server_files', 'pg_write_server_files', 'pg_execute_server_program', 'pg_signal_backend',
  ].includes(role_name));
  record('Runtime role has no dangerous built-in memberships', dangerous.length === 0, dangerous.map((row) => row.role_name).join(', ') || 'none');

  const read = await runtime.query<{ count: string }>('SELECT count(*)::text AS count FROM users');
  record('Runtime role can read application data', read.rows.length === 1, `rows=${read.rows[0]?.count ?? 'unknown'}`);

  const client = await runtime.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO auth_rate_limits (key, count, last_request) VALUES ($1, 1, 0)', [`security-acceptance:${suffix}`]);
    await client.query("INSERT INTO audit_events (action, result, entity_type, request_id) VALUES ('security.acceptance', 'success', 'test', $1)", [suffix]);
    await client.query('ROLLBACK');
    record('Runtime role can perform required application writes', true, 'transaction rolled back');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    record('Runtime role can perform required application writes', false, error instanceof Error ? error.message : String(error));
  } finally {
    client.release();
  }

  await expectPrivilegeBlocked(runtime, 'Runtime role cannot create roles', `CREATE ROLE pt_forbidden_${suffix}`);
  await expectPrivilegeBlocked(runtime, 'Runtime role cannot create extensions', 'CREATE EXTENSION dblink');
  await expectPrivilegeBlocked(runtime, 'Runtime role cannot create tables', `CREATE TABLE public.pt_forbidden_${suffix} (id int)`);
  await expectPrivilegeBlocked(runtime, 'Runtime role cannot alter application tables', 'ALTER TABLE public.users ADD COLUMN pt_forbidden text');
  await expectPrivilegeBlocked(runtime, 'Runtime role cannot read server files', "SELECT pg_read_file('postgresql.conf', 0, 1)");
  await expectPrivilegeBlocked(runtime, 'Runtime role cannot execute server programs', "COPY (SELECT 1) TO PROGRAM 'false'");
  await expectPrivilegeBlocked(runtime, 'Runtime role cannot update audit history', 'UPDATE audit_events SET action=action WHERE false');
  await expectPrivilegeBlocked(runtime, 'Runtime role cannot delete audit history', 'DELETE FROM audit_events WHERE false');
} finally {
  await runtime?.end().catch(() => undefined);
  await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE usename=$1', [role]).catch(() => undefined);
  await admin.query(`DROP OWNED BY ${identifier}`).catch(() => undefined);
  await admin.query(`DROP ROLE IF EXISTS ${identifier}`).catch(() => undefined);
  await admin.end();
}

process.stdout.write(`${JSON.stringify({ status: results.every((result) => result.status === 'PASS') ? 'PASS' : 'FAIL', results }, null, 2)}\n`);
if (results.some((result) => result.status === 'FAIL')) process.exitCode = 1;
