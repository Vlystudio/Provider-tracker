import { lookup } from 'node:dns/promises';
import { connect } from 'node:net';

const baseUrlValue = process.env.PUBLIC_PROBE_BASE_URL?.trim();
if (!baseUrlValue || process.env.PUBLIC_PROBE_CONFIRM_OUTSIDE_VPN !== 'YES') {
  throw new Error('Run from an authorized public test position with PUBLIC_PROBE_BASE_URL and PUBLIC_PROBE_CONFIRM_OUTSIDE_VPN=YES.');
}
const baseUrl = new URL(baseUrlValue);
if (baseUrl.protocol !== 'https:') throw new Error('PUBLIC_PROBE_BASE_URL must use HTTPS.');

const paths = ['/', '/sign-in', '/api/health', '/api/ready', '/api/session'];
const results: Array<{ target: string; status: 'BLOCKED' | 'EXPOSED' | 'OBSERVED'; detail: string }> = [];

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
    results.push({ target: path, status: 'EXPOSED', detail: `Received HTTP ${response.status}.` });
  } catch (error) {
    results.push({ target: path, status: 'BLOCKED', detail: error instanceof Error ? error.message : String(error) });
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

process.stdout.write(`${JSON.stringify({ status: results.some((result) => result.status === 'EXPOSED') ? 'FAIL' : 'PASS', results }, null, 2)}\n`);
if (results.some((result) => result.status === 'EXPOSED')) process.exitCode = 1;
