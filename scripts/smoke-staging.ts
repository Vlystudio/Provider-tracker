import 'dotenv/config';
import pg from 'pg';

const baseValue = process.env.SMOKE_BASE_URL?.trim();
const databaseUrl = process.env.STAGING_DATABASE_URL?.trim();
const facilityId = process.env.STAGING_MUTATION_FACILITY_ID?.trim();
if (!baseValue || !databaseUrl || !facilityId) {
  throw new Error('SMOKE_BASE_URL, STAGING_DATABASE_URL, and STAGING_MUTATION_FACILITY_ID are required.');
}
const baseUrl = new URL(baseValue);
const credentials = {
  ura: { email: process.env.STAGING_URA_EMAIL, password: process.env.STAGING_URA_PASSWORD },
  auditor: { email: process.env.STAGING_AUDITOR_EMAIL, password: process.env.STAGING_AUDITOR_PASSWORD },
  admin: { email: process.env.STAGING_ADMIN_EMAIL, password: process.env.STAGING_ADMIN_PASSWORD },
};
for (const [role, value] of Object.entries(credentials)) {
  if (!value.email || !value.password) throw new Error(`Dedicated ${role} staging credentials are required.`);
}

type Session = { cookie: string };
async function signIn(email: string, password: string): Promise<Session> {
  const response = await fetch(new URL('/api/auth/sign-in/email', baseUrl), {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(10_000),
    headers: { 'content-type': 'application/json', origin: baseUrl.origin },
    body: JSON.stringify({ email, password, rememberMe: false }),
  });
  if (!response.ok) throw new Error(`Staging sign-in failed with HTTP ${response.status}.`);
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie') ?? ''];
  const cookie = cookies.map((value) => value.split(';',1)[0]).filter(Boolean).join('; ');
  if (!cookie) throw new Error('Staging sign-in did not return a session cookie.');
  return { cookie };
}

async function authenticated(pathname: string, session: Session, options: RequestInit = {}) {
  return fetch(new URL(pathname, baseUrl), {
    redirect: 'manual', signal: AbortSignal.timeout(15_000), ...options,
    headers: { cookie: session.cookie, ...(options.headers ?? {}) },
  });
}

const ura = await signIn(credentials.ura.email!, credentials.ura.password!);
const auditor = await signIn(credentials.auditor.email!, credentials.auditor.password!);
const admin = await signIn(credentials.admin.email!, credentials.admin.password!);
const checks: Record<string, string> = {};
for (const [name, response] of [
  ['URA home', await authenticated('/', ura)],
  ['provider search', await authenticated('/provider-search?memberZip=04103&radius=25&sort=recommended', ura)],
  ['reports', await authenticated('/reports', ura)],
  ['auditor audit access', await authenticated('/audit', auditor)],
  ['admin access', await authenticated('/admin', admin)],
] as const) {
  if (response.status !== 200) throw new Error(`${name} failed with HTTP ${response.status}.`);
  checks[name] = 'PASS';
}
for (const [name, response] of [
  ['URA admin boundary', await authenticated('/admin', ura)],
  ['auditor admin boundary', await authenticated('/admin', auditor)],
] as const) {
  if (response.status < 300 || response.status >= 400 || !response.headers.get('location')?.includes('/forbidden')) {
    throw new Error(`${name} did not enforce the expected authorization boundary.`);
  }
  checks[name] = 'PASS';
}

const mutation = await authenticated('/api/calls', ura, {
  method: 'POST',
  headers: { 'content-type': 'application/json', origin: baseUrl.origin },
  body: JSON.stringify({
    callAt: new Date().toISOString(),
    facilityId,
    contactOutcome: 'no_answer',
    notes: 'Staging smoke test.',
  }),
});
if (mutation.status !== 201) throw new Error(`Staging fixture mutation failed with HTTP ${mutation.status}.`);
const requestId = mutation.headers.get('x-request-id');
if (!requestId) throw new Error('Mutation response did not include a request ID.');
const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
try {
  const audit = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM audit_events WHERE request_id=$1 AND action='call.create'`, [requestId]);
  if ((audit.rows[0]?.count ?? 0) !== 1) throw new Error('Mutation audit event was not found by request ID.');
  const spatial = await pool.query<{ ordered: boolean }>(`
    WITH origin AS (SELECT ST_SetSRID(ST_MakePoint(-70.29,43.68),4326)::geography point),
    p AS (SELECT ST_Project(point,1609.344,0) near,ST_Project(point,5*1609.344,0) far,point FROM origin)
    SELECT ST_Distance(point,near)<ST_Distance(point,far) AS ordered FROM p`);
  if (!spatial.rows[0]?.ordered) throw new Error('Staging geographic ordering check failed.');
} finally {
  await pool.end();
}
checks['fixture mutation and audit'] = 'PASS';
checks['PostGIS ordering'] = 'PASS';

const logout = await authenticated('/api/auth/sign-out', ura, { method: 'POST', headers: { origin: baseUrl.origin } });
if (!logout.ok) throw new Error(`Logout failed with HTTP ${logout.status}.`);
const revoked = await authenticated('/', ura);
if (revoked.status < 300 || revoked.status >= 400 || !revoked.headers.get('location')?.includes('/sign-in')) {
  throw new Error('Logged-out session still reached a protected page.');
}
checks['logout and session revocation'] = 'PASS';
process.stdout.write(`${JSON.stringify({ status: 'PASS', checks }, null, 2)}\n`);
