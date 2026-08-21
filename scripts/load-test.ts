import 'dotenv/config';

const baseValue = process.env.LOAD_BASE_URL?.trim();
if (!baseValue) throw new Error('LOAD_BASE_URL is required.');
const baseUrl = new URL(baseValue);
const local = ['localhost', '127.0.0.1', '::1'].includes(baseUrl.hostname);
if (!local && !(process.env.TARGET_ENVIRONMENT === 'staging' && process.env.ALLOW_STAGING_LOAD_TEST === 'true')) {
  throw new Error('Load tests are limited to local targets unless staging is explicitly authorized.');
}
const requests = Number.parseInt(process.env.LOAD_REQUESTS ?? '100', 10);
const concurrency = Number.parseInt(process.env.LOAD_CONCURRENCY ?? '10', 10);
if (!Number.isInteger(requests) || requests < 10 || requests > 500) throw new Error('LOAD_REQUESTS must be between 10 and 500.');
if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 25) throw new Error('LOAD_CONCURRENCY must be between 1 and 25.');

const paths = ['/api/health', '/api/ready', '/sign-in', '/api/session', '/provider-search'];
const queue = Array.from({ length: requests }, (_, index) => paths[index % paths.length]!);
const samples: Array<{ path: string; status: number; durationMs: number }> = [];
let cursor = 0;
async function worker() {
  while (cursor < queue.length) {
    const index = cursor++;
    const pathname = queue[index]!;
    const started = performance.now();
    try {
      const response = await fetch(new URL(pathname, baseUrl), { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
      samples.push({ path: pathname, status: response.status, durationMs: performance.now()-started });
      await response.body?.cancel();
    } catch {
      samples.push({ path: pathname, status: 0, durationMs: performance.now()-started });
    }
  }
}
await Promise.all(Array.from({ length: concurrency }, () => worker()));

function percentile(values: number[], value: number) {
  const sorted = [...values].sort((a,b) => a-b);
  return sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*value)-1)] ?? 0;
}
const failures = samples.filter((sample) => sample.status === 0 || sample.status >= 500);
const summary = paths.map((pathname) => {
  const rows = samples.filter((sample) => sample.path === pathname);
  return { path: pathname, requests: rows.length, errors: rows.filter((row) => row.status === 0 || row.status >= 500).length, p50Ms: Number(percentile(rows.map((row) => row.durationMs),0.5).toFixed(1)), p95Ms: Number(percentile(rows.map((row) => row.durationMs),0.95).toFixed(1)) };
});
console.table(summary);
process.stdout.write(`${JSON.stringify({ status: failures.length === 0 ? 'PASS' : 'FAIL', target: baseUrl.origin, requests, concurrency, errorRate: failures.length/requests, summary }, null, 2)}\n`);
if (failures.length) process.exitCode = 1;
