import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const port = Number.parseInt(process.env.FAILURE_TEST_PORT ?? '3201', 10);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('FAILURE_TEST_PORT is invalid.');
const baseUrl = `http://127.0.0.1:${port}`;
const marker = 'database-password-must-not-appear';
const nextBin = 'node_modules/next/dist/bin/next';
let output = '';
const child = spawn(process.execPath, [nextBin, 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
  cwd: process.cwd(),
  windowsHide: true,
  env: {
    ...process.env,
    NODE_ENV: 'production',
    APP_ENV: 'production',
    APP_DATA_MODE: 'database',
    APP_MAINTENANCE_MODE: 'off',
    LOG_LEVEL: 'info',
    DATABASE_URL: `postgresql://failure_user:${marker}@127.0.0.1:1/provider_tracker`,
    DATABASE_CONNECT_TIMEOUT_MS: '500',
    DATABASE_STATEMENT_TIMEOUT_MS: '500',
    BETTER_AUTH_URL: 'https://failure-test.example.invalid',
    AUTH_TRUSTED_ORIGINS: 'https://failure-test.example.invalid',
    BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
    AUDIT_LOG_IP_SALT: randomBytes(48).toString('base64url'),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});
child.stdout.on('data', (chunk) => { output += String(chunk); });
child.stderr.on('data', (chunk) => { output += String(chunk); });

async function waitForHealth() {
  const deadline = Date.now()+30_000;
  while (Date.now()<deadline) {
    if (child.exitCode !== null) throw new Error(`Failure-test server exited early.\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.status===200) return;
    } catch {
      // Startup is still in progress.
    }
    await new Promise((resolve) => setTimeout(resolve,250));
  }
  throw new Error(`Failure-test server did not start.\n${output}`);
}

try {
  await waitForHealth();
  const health = await fetch(`${baseUrl}/api/health`);
  const ready = await fetch(`${baseUrl}/api/ready`);
  const body = await ready.text();
  const requestId = ready.headers.get('x-request-id');
  await new Promise((resolve) => setTimeout(resolve,100));
  if (health.status !== 200) throw new Error(`Health returned ${health.status}.`);
  if (ready.status !== 503) throw new Error(`Readiness returned ${ready.status}; expected 503.`);
  if (!requestId || !output.includes(requestId)) throw new Error('Readiness log and response did not share a request ID.');
  if (body.includes(marker) || output.includes(marker)) throw new Error('Database credentials appeared in failure output.');
  process.stdout.write(`${JSON.stringify({ status: 'PASS', health: health.status, readiness: ready.status, requestIdCorrelated: true, credentialsRedacted: true })}\n`);
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise<void>((resolve) => child.once('exit', () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve,5_000)),
  ]);
}
