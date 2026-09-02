import { timingSafeEqual } from 'node:crypto';
import { runAutomationJob } from '@/server/automation-runner';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 32) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const received = Buffer.from(request.headers.get('authorization') ?? '');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function GET(request: Request) {
  if (!process.env.CRON_SECRET || process.env.CRON_SECRET.trim().length < 32) {
    return Response.json({ error: 'Scheduled automation is not configured.' }, {
      status: 503,
      headers: { 'cache-control': 'private, no-store, max-age=0' },
    });
  }
  if (!authorized(request)) {
    return Response.json({ error: 'Unauthorized.' }, {
      status: 401,
      headers: { 'cache-control': 'private, no-store, max-age=0' },
    });
  }

  const scheduledFor = new Date();
  const dateKey = scheduledFor.toISOString().slice(0, 10);
  try {
    const result = await runAutomationJob('reverification_scan', {
      trigger: 'scheduled',
      scheduledFor,
      executionKey: `vercel:reverification:${dateKey}`,
    });
    return Response.json({
      result: result.result,
      counts: result.counts,
      deduplicated: result.deduplicated,
    }, { headers: { 'cache-control': 'private, no-store, max-age=0' } });
  } catch {
    return Response.json({ error: 'The scheduled reverification scan failed.' }, {
      status: 500,
      headers: { 'cache-control': 'private, no-store, max-age=0' },
    });
  }
}
