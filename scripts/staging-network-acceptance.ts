import { connect } from 'node:net';
import { connect as connectTls } from 'node:tls';

const baseValue = process.env.STAGING_NETWORK_BASE_URL?.trim();
if (
  !baseValue
  || process.env.STAGING_NETWORK_CONFIRM_ON_VPN !== 'YES'
  || process.env.STAGING_NETWORK_AUTHORIZED !== 'YES'
) {
  throw new Error('Run from an authorized VPN client with STAGING_NETWORK_BASE_URL, STAGING_NETWORK_CONFIRM_ON_VPN=YES, and STAGING_NETWORK_AUTHORIZED=YES.');
}

const baseUrl = new URL(baseValue);
if (baseUrl.protocol !== 'https:' || baseUrl.username || baseUrl.password || baseUrl.pathname !== '/' || baseUrl.search || baseUrl.hash) {
  throw new Error('STAGING_NETWORK_BASE_URL must be an HTTPS origin without credentials, path, query, or fragment.');
}
if (['localhost', '127.0.0.1', '::1'].includes(baseUrl.hostname.toLowerCase())) {
  throw new Error('The staging network test does not accept a loopback target.');
}

type Check = { name: string; status: 'PASS' | 'FAIL'; detail: string };
const checks: Check[] = [];
function add(name: string, passed: boolean, detail: string) {
  checks.push({ name, status: passed ? 'PASS' : 'FAIL', detail });
}

async function request(path: string, headers: HeadersInit = {}) {
  return fetch(new URL(path, baseUrl), {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(10_000),
  });
}

const tlsResult = await new Promise<{ authorized: boolean; protocol: string; validFrom: string; validTo: string; fingerprint256: string }>((resolve, reject) => {
  const socket = connectTls({ host: baseUrl.hostname, port: Number(baseUrl.port || 443), servername: baseUrl.hostname, rejectUnauthorized: true });
  socket.setTimeout(10_000, () => socket.destroy(new Error('TLS connection timed out.')));
  socket.once('secureConnect', () => {
    const certificate = socket.getPeerCertificate();
    const result = {
      authorized: socket.authorized,
      protocol: socket.getProtocol() ?? 'unknown',
      validFrom: certificate.valid_from ?? '',
      validTo: certificate.valid_to ?? '',
      fingerprint256: certificate.fingerprint256 ?? '',
    };
    socket.end();
    resolve(result);
  });
  socket.once('error', reject);
});
add('TLS certificate and hostname', tlsResult.authorized, 'The certificate chain and hostname were validated by the runtime trust store.');
add('TLS protocol', ['TLSv1.2', 'TLSv1.3'].includes(tlsResult.protocol), `Negotiated ${tlsResult.protocol}.`);

const signIn = await request('/sign-in');
add('sign-in reachable', signIn.status === 200, `Received HTTP ${signIn.status}.`);
const hsts = signIn.headers.get('strict-transport-security') ?? '';
add('HSTS', /max-age=\d+/i.test(hsts), hsts ? 'HSTS is present.' : 'HSTS is missing.');
await signIn.body?.cancel();

const protectedPage = await request('/provider-search');
const protectedLocation = protectedPage.headers.get('location') ?? '';
add('anonymous page access', protectedPage.status >= 300 && protectedPage.status < 400 && protectedLocation.includes('/sign-in'), `Received HTTP ${protectedPage.status}.`);
await protectedPage.body?.cancel();

const session = await request('/api/session');
add('anonymous API access', session.status === 401, `Received HTTP ${session.status}.`);
await session.body?.cancel();

const health = await request('/api/health');
add('liveness', health.status === 200, `Received HTTP ${health.status}.`);
await health.body?.cancel();
const readiness = await request('/api/ready');
add('readiness', readiness.status === 200, `Received HTTP ${readiness.status}.`);
await readiness.body?.cancel();
const metrics = await request('/api/metrics');
add('anonymous metrics', metrics.status === 404, `Received HTTP ${metrics.status}.`);
await metrics.body?.cancel();

const spoof = await request('/provider-search', {
  forwarded: 'for=198.51.100.10;host=attacker.invalid;proto=http',
  'x-forwarded-for': '198.51.100.10',
  'x-forwarded-host': 'attacker.invalid',
  'x-forwarded-proto': 'http',
  'x-real-ip': '198.51.100.10',
});
const spoofLocation = spoof.headers.get('location') ?? '';
add(
  'forwarded-header spoofing',
  spoof.status >= 300 && spoof.status < 400 && !spoofLocation.includes('attacker.invalid'),
  `Received HTTP ${spoof.status}; redirect stayed on the configured application origin.`,
);
await spoof.body?.cancel();

async function tcpReachable(host: string, port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const socket = connect({ host, port });
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(5_000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

const databaseHost = process.env.STAGING_NETWORK_DATABASE_HOST?.trim();
if (databaseHost) {
  const databasePort = Number.parseInt(process.env.STAGING_NETWORK_DATABASE_PORT ?? '5432', 10);
  if (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65_535) {
    throw new Error('STAGING_NETWORK_DATABASE_PORT must be a valid TCP port.');
  }
  add('ordinary VPN client to PostgreSQL', !(await tcpReachable(databaseHost, databasePort)), 'The database TCP port must not accept an ordinary VPN client.');
}

for (const target of (process.env.STAGING_NETWORK_ORIGIN_TARGETS ?? '').split(',').map((item) => item.trim()).filter(Boolean)) {
  const targetUrl = new URL(`tcp://${target}`);
  const port = Number.parseInt(targetUrl.port || '443', 10);
  if (!targetUrl.hostname || targetUrl.pathname || targetUrl.search || targetUrl.hash || port < 1 || port > 65_535) {
    throw new Error(`Invalid direct-origin target: ${target}`);
  }
  add(`ordinary VPN client to origin ${target}`, !(await tcpReachable(targetUrl.hostname, port)), 'The application origin must accept traffic only from the approved ingress tier.');
}

const passed = checks.every((check) => check.status === 'PASS');
process.stdout.write(`${JSON.stringify({
  status: passed ? 'PASS' : 'FAIL',
  testPosition: 'inside-vpn',
  testedAt: new Date().toISOString(),
  tls: tlsResult,
  checks,
}, null, 2)}\n`);
if (!passed) process.exitCode = 1;
