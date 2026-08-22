import { readFileSync, readdirSync } from 'node:fs';

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

const files = [...sourceFiles('src'), 'next.config.ts'];
const findings = [];
const clientStorage = /\b(localStorage|sessionStorage|indexedDB|serviceWorker|caches\.)\b/;
const riskyConsole = /console\.(?:log|info|debug)\s*\([^\n]*(?:request|headers|cookies|body|email|member|diagnos|comment|notes?)/i;

for (const file of files) {
  const source = readFileSync(file, 'utf8');
  if (clientStorage.test(source)) findings.push({ file, rule: 'persistent-browser-storage' });
  if (riskyConsole.test(source)) findings.push({ file, rule: 'sensitive-console-payload' });
  if (source.startsWith("'use client'") && /from ['"]@\/(?:db|server)\//.test(source)) {
    findings.push({ file, rule: 'server-data-imported-into-client' });
  }
}

const proxy = readFileSync('src/proxy.ts', 'utf8');
const nextConfig = readFileSync('next.config.ts', 'utf8');
const logger = readFileSync('src/server/logger.ts', 'utf8');
const metrics = readFileSync('src/server/metrics.ts', 'utf8');
const exportRoutes = [
  'src/app/api/exports/providers.csv/route.ts',
  'src/app/api/admin/migrations/[id]/diagnostics.csv/route.ts',
];

if (!proxy.includes("'private, no-store'")) findings.push({ file: 'src/proxy.ts', rule: 'authenticated-cache-default' });
if (!nextConfig.includes('productionBrowserSourceMaps: false')) findings.push({ file: 'next.config.ts', rule: 'browser-source-maps' });
if (!logger.includes('emailPattern') || !logger.includes('sensitiveKeyPattern')) findings.push({ file: 'src/server/logger.ts', rule: 'log-redaction' });
if (!metrics.includes("allowedLabels = new Set(['route', 'method', 'status', 'operation', 'result'])")) findings.push({ file: 'src/server/metrics.ts', rule: 'metric-label-allowlist' });
for (const file of exportRoutes) {
  const source = readFileSync(file, 'utf8');
  if (!source.includes("'cache-control': 'private, no-store, max-age=0'")) findings.push({ file, rule: 'download-cache-control' });
  if (!source.includes("'x-content-type-options': 'nosniff'")) findings.push({ file, rule: 'download-nosniff' });
  if (!source.includes("'content-disposition'")) findings.push({ file, rule: 'download-disposition' });
}

process.stdout.write(`${JSON.stringify({
  status: findings.length ? 'FAIL' : 'PASS',
  filesReviewed: files.length,
  checks: {
    persistentBrowserStorage: true,
    clientServerBoundary: true,
    structuredLogRedaction: true,
    metricLabelAllowlist: true,
    authenticatedNoStoreDefault: true,
    browserSourceMapsDisabled: true,
    downloadHeaders: exportRoutes.length,
  },
  findings,
}, null, 2)}\n`);
if (findings.length) process.exitCode = 1;
