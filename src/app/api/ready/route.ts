import { getServerConfig } from '@/server/config';
import { getDatabaseReadiness } from '@/server/database';
import { logEvent } from '@/server/logger';
import { getReleaseIdentifier } from '@/server/release';
import { requestIdFromHeaders } from '@/server/request-context';
import { getRuntimeState } from '@/server/runtime-state';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const requestId = requestIdFromHeaders(request.headers);
  try {
    const config = getServerConfig();
    const runtime = getRuntimeState();
    const database = await getDatabaseReadiness();
    const checks = {
      initialized: runtime.initialized,
      acceptingTraffic: !runtime.shuttingDown && config.APP_MAINTENANCE_MODE === 'off',
      database: database.checks.connection,
      schema: database.checks.schema,
      postgis: database.checks.postgis,
      spatialIndex: database.checks.spatialIndex,
    };
    const ready = Object.values(checks).every(Boolean);
    if (!ready) logEvent('warn', 'runtime.not-ready', { requestId, checks });
    return Response.json(
      { status: ready ? 'ready' : 'not_ready', release: getReleaseIdentifier(), checks },
      { status: ready ? 200 : 503, headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    logEvent('error', 'runtime.readiness-error', { requestId, error });
    return Response.json(
      { status: 'not_ready', release: getReleaseIdentifier(), checks: { configuration: false } },
      { status: 503, headers: { 'Cache-Control': 'no-store' } },
    );
  }
}
