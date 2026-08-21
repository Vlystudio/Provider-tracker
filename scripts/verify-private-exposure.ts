import { lookup } from 'node:dns/promises';
import { connect } from 'node:net';
import { connect as connectTls } from 'node:tls';

const baseUrlValue = process.env.PUBLIC_PROBE_BASE_URL?.trim();
if (!baseUrlValue || process.env.PUBLIC_PROBE_CONFIRM_OUTSIDE_VPN !== 'YES') {
  throw new Error('Run from an authorized public test position with PUBLIC_PROBE_BASE_URL and PUBLIC_PROBE_CONFIRM_OUTSIDE_VPN=YES.');
}
const additionalBaseUrls = (process.env.PUBLIC_PROBE_ADDITIONAL_BASE_URLS ?? '')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);
const baseUrls = [baseUrlValue, ...additionalBaseUrls].map((value) => new URL(value));
if (baseUrls.some((url) => url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash)) {
  throw new Error('Public probe base URLs must be HTTPS origins without credentials, paths, queries, or fragments.');
}

const paths = [
  '/',
  '/sign-in',
  '/api/health',
  '/api/ready',
  '/api/session',
  '/api/auth/get-session',
  '/api/metrics',
  '/api/notifications',
  '/api/admin/users',
];
const results: Array<{ target: string; status: 'BLOCKED' | 'EXPOSED' | 'OBSERVED'; detail: string }> = [];

for (const baseUrl of baseUrls) {
  try {
    const addresses = await lookup(baseUrl.hostname, { all: true });
    results.push({
      target: `DNS ${baseUrl.hostname}`,
      status: 'OBSERVED',
      detail: addresses.length ? `Resolved ${addresses.length} address(es); HTTP reachability still tested.` : 'No addresses returned.',
    });
  } catch (error) {
    results.push({ target: `DNS ${baseUrl.hostname}`, status: 'OBSERVED', detail: error instanceof Error ? error.message : String(error) });
  }

  for (const path of paths) {
    try {
      const response = await fetch(new URL(path, baseUrl), { signal: AbortSignal.timeout(8_000), redirect: 'manual' });
      results.push({ target: `${baseUrl.origin}${path}`, status: 'EXPOSED', detail: `Received HTTP ${response.status}.` });
      await response.body?.cancel();
    } catch (error) {
      results.push({ target: `${baseUrl.origin}${path}`, status: 'BLOCKED', detail: error instanceof Error ? error.message : String(error) });
    }
  }
}

function parseHostPort(target: string): { host: string; port: number } {
  const url = new URL(`tls://${target}`);
  const port = Number.parseInt(url.port || '443', 10);
  if (url.username || url.password || url.pathname || url.search || url.hash || !url.hostname || port < 1 || port > 65_535) {
    throw new Error(`Invalid direct-origin target: ${target}`);
  }
  return { host: url.hostname, port };
}

async function probeTlsOrigin(target: string, applicationHostname: string): Promise<boolean> {
  const { host, port } = parseHostPort(target);
  return new Promise<boolean>((resolve) => {
    const socket = connectTls({ host, port, servername: applicationHostname, rejectUnauthorized: false });
    let settled = false;
    const finish = (value: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(8_000, () => finish(false));
    socket.once('secureConnect', () => {
      socket.write(`GET /api/health HTTP/1.1\r\nHost: ${applicationHostname}\r\nConnection: close\r\n\r\n`);
    });
    socket.once('data', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('close', () => finish(false));
  });
}

const originTargets = (process.env.PUBLIC_PROBE_ORIGIN_TARGETS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
if (originTargets.length) {
  const applicationHostname = process.env.PUBLIC_PROBE_APPLICATION_HOSTNAME?.trim() || baseUrls[0]!.hostname;
  for (const target of originTargets) {
    const reachable = await probeTlsOrigin(target, applicationHostname);
    results.push({
      target: `direct origin ${target}`,
      status: reachable ? 'EXPOSED' : 'BLOCKED',
      detail: reachable ? 'TLS origin returned application-protocol data with the expected hostname.' : 'No application-protocol response was received.',
    });
  }
}

const databaseHost = process.env.PUBLIC_PROBE_DATABASE_HOST?.trim();
if (databaseHost) {
  const databasePort = Number.parseInt(process.env.PUBLIC_PROBE_DATABASE_PORT ?? '5432', 10);
  if (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65_535) {
    throw new Error('PUBLIC_PROBE_DATABASE_PORT must be a valid TCP port.');
  }
  const reachable = await new Promise<boolean>((resolve) => {
    const socket = connect({ host: databaseHost, port: databasePort });
    const finish = (value: boolean) => {
      socket.destroy();
      resolve(value);
    };
    socket.setTimeout(5_000, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
  results.push({
    target: `${databaseHost}:${databasePort}`,
    status: reachable ? 'EXPOSED' : 'BLOCKED',
    detail: reachable ? 'TCP connection succeeded.' : 'TCP connection did not succeed.',
  });
}

process.stdout.write(`${JSON.stringify({
  status: results.some((result) => result.status === 'EXPOSED') ? 'FAIL' : 'PASS',
  testPosition: 'outside-vpn',
  testedAt: new Date().toISOString(),
  results,
}, null, 2)}\n`);
if (results.some((result) => result.status === 'EXPOSED')) process.exitCode = 1;
