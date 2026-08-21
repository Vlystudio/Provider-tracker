import 'dotenv/config';

const baseValue = process.env.SMOKE_BASE_URL?.trim();
if (!baseValue) throw new Error('SMOKE_BASE_URL is required.');
const baseUrl = new URL(baseValue);
const checks: Array<{ name: string; status: number; pass: boolean; detail?: string }> = [];

async function request(pathname: string, options: RequestInit = {}) {
  return fetch(new URL(pathname, baseUrl), { redirect: 'manual', signal: AbortSignal.timeout(10_000), ...options });
}

function record(name: string, response: Response, expected: (status: number) => boolean, detail?: string) {
  const pass = expected(response.status);
  checks.push({ name, status: response.status, pass, detail });
  if (!pass) throw new Error(`${name} failed with HTTP ${response.status}.`);
}

const publicResponse = await request('/');
record('public entry', publicResponse, (status) => status === 200 || (status >= 300 && status < 400));
const signIn = await request('/sign-in');
record('sign-in page', signIn, (status) => status === 200);
const health = await request('/api/health');
record('liveness', health, (status) => status === 200);
const healthBody = await health.json() as { status?: string };
if (healthBody.status !== 'ok' || Object.keys(healthBody).length !== 1) {
  throw new Error('Health response is not the expected minimal body.');
}
const readiness = await request('/api/ready');
record('readiness', readiness, (status) => status === 200);
const anonymous = await request('/api/facilities/00000000-0000-4000-8000-000000000000');
record('anonymous API rejection', anonymous, (status) => status === 401 || status === 403);

for (const [header, expected] of [
  ['content-security-policy', /default-src/],
  ['x-content-type-options', /nosniff/i],
  ['x-frame-options', /deny/i],
  ['referrer-policy', /strict-origin/i],
] as const) {
  const value = signIn.headers.get(header) ?? '';
  if (!expected.test(value)) throw new Error(`Security header ${header} is missing or invalid.`);
}
const requestId = health.headers.get('x-request-id');
const release = health.headers.get('x-app-release');
if (!requestId || requestId.length > 128) throw new Error('Health response is missing a bounded request ID.');
if (!release) throw new Error('Health response is missing the release header.');

process.stdout.write(`${JSON.stringify({ status: 'PASS', baseUrl: baseUrl.origin, release, checks }, null, 2)}\n`);
