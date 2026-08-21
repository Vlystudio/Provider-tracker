import { getReleaseIdentifier } from '@/server/release';

export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json(
    { status: 'ok', release: getReleaseIdentifier() },
    { status: 200, headers: { 'Cache-Control': 'no-store' } },
  );
}
