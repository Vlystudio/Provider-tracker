import { timingSafeEqual } from 'node:crypto';
import { getServerConfig } from '@/server/config';
import { getDatabasePoolStats } from '@/server/database';
import { renderMetrics } from '@/server/metrics';

export const dynamic = 'force-dynamic';

function equalSecret(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}

export function GET(request: Request) {
  const token = getServerConfig().OPERATIONS_TOKEN;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!token || !equalSecret(supplied, token)) {
    return new Response('Not found.\n', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  }
  const pool = getDatabasePoolStats();
  return new Response(renderMetrics({
    provider_tracker_database_pool_total: pool.total,
    provider_tracker_database_pool_idle: pool.idle,
    provider_tracker_database_pool_waiting: pool.waiting,
    provider_tracker_database_pool_max: pool.max,
  }), {
    status: 200,
    headers: { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
