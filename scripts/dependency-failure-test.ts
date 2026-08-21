import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const firstPort = Number.parseInt(process.env.FAILURE_TEST_PORT ?? '3201', 10);
if (!Number.isInteger(firstPort) || firstPort < 1024 || firstPort > 65534) {
  throw new Error('FAILURE_TEST_PORT is invalid.');
}

const credentialMarker = 'database-password-must-not-appear';
const nextBin = 'node_modules/next/dist/bin/next';

async function waitForHealth(baseUrl: string, child: ReturnType<typeof spawn>, output: () => string) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Failure-test server exited early.\n${output()}`);
    try {
      const response = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(1_000) });
      if (response.status === 200) return;
    } catch {
      // The server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Failure-test server did not start.\n${output()}`);
}

async function verifyScenario(port: number, maintenanceMode: 'off' | 'on') {
  const baseUrl = `http://127.0.0.1:${port}`;
  let serverOutput = '';
  const operationsToken = randomBytes(32).toString('base64url');
  const child = spawn(process.execPath, [nextBin, 'start', '--hostname', '127.0.0.1', '--port', String(port)], {
    cwd: process.cwd(),
    windowsHide: true,
    env: {
      ...process.env,
      NODE_ENV: 'production',
      APP_ENV: 'production',
      APP_DATA_MODE: 'database',
      APP_MAINTENANCE_MODE: maintenanceMode,
      LOG_LEVEL: 'info',
      DATABASE_URL: `postgresql://failure_user:${credentialMarker}@127.0.0.1:1/provider_tracker`,
      DATABASE_CONNECT_TIMEOUT_MS: '500',
      DATABASE_STATEMENT_TIMEOUT_MS: '500',
      BETTER_AUTH_URL: 'https://failure-test.example.invalid',
      AUTH_TRUSTED_ORIGINS: 'https://failure-test.example.invalid',
      BETTER_AUTH_SECRET: randomBytes(48).toString('base64url'),
      AUDIT_LOG_IP_SALT: randomBytes(48).toString('base64url'),
      OPERATIONS_TOKEN: operationsToken,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', (chunk) => { serverOutput += String(chunk); });
  child.stderr.on('data', (chunk) => { serverOutput += String(chunk); });

  try {
    await waitForHealth(baseUrl, child, () => serverOutput);
    const health = await fetch(`${baseUrl}/api/health`);
    const readiness = await fetch(`${baseUrl}/api/ready`);
    const readinessBody = await readiness.text();
    const requestId = readiness.headers.get('x-request-id');
    await new Promise((resolve) => setTimeout(resolve, 100));

    if (health.status !== 200 || readiness.status !== 503) {
      throw new Error(`Unexpected probe status: health=${health.status} ready=${readiness.status}.`);
    }
    if (!requestId || !serverOutput.includes(requestId)) {
      throw new Error('Readiness log and response did not share a request ID.');
    }
    if (readinessBody.includes(credentialMarker) || serverOutput.includes(credentialMarker)) {
      throw new Error('Database credentials appeared in failure output.');
    }
    const hiddenMetrics = await fetch(`${baseUrl}/api/metrics`);
    const visibleMetrics = await fetch(`${baseUrl}/api/metrics`, {
      headers: { authorization: `Bearer ${operationsToken}` },
    });
    const metricsBody = await visibleMetrics.text();
    if (hiddenMetrics.status !== 404 || visibleMetrics.status !== 200 || !metricsBody.includes('provider_tracker_database_pool_max')) {
      throw new Error('Protected metrics behavior failed.');
    }

    if (maintenanceMode === 'on') {
      const page = await fetch(`${baseUrl}/`, { redirect: 'manual' });
      const api = await fetch(`${baseUrl}/api/session`, { redirect: 'manual' });
      if (
        page.status !== 307 ||
        !page.headers.get('location')?.includes('/maintenance') ||
        api.status !== 503
      ) {
        throw new Error('Maintenance routing behavior failed.');
      }
    }

    return {
      health: health.status,
      readiness: readiness.status,
      requestIdCorrelated: true,
      credentialsRedacted: true,
      metricsProtected: true,
      ...(maintenanceMode === 'on' ? { maintenanceRouting: true } : {}),
    };
  } finally {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
}

const databaseFailure = await verifyScenario(firstPort, 'off');
const maintenance = await verifyScenario(firstPort + 1, 'on');
process.stdout.write(`${JSON.stringify({ status: 'PASS', databaseFailure, maintenance })}\n`);
