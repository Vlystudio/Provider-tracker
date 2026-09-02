import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const automationMocks = vi.hoisted(() => ({ runAutomationJob: vi.fn() }));

vi.mock('@/server/automation-runner', () => ({ runAutomationJob: automationMocks.runAutomationJob }));

import { GET } from './route';

describe('scheduled reverification route', () => {
  beforeEach(() => {
    vi.stubEnv('CRON_SECRET', 'a-secure-test-secret-with-more-than-32-characters');
    automationMocks.runAutomationJob.mockReset();
  });

  afterEach(() => vi.unstubAllEnvs());

  it('rejects requests without the scheduler bearer token', async () => {
    const response = await GET(new Request('https://example.invalid/api/cron/reverification'));
    expect(response.status).toBe(401);
    expect(automationMocks.runAutomationJob).not.toHaveBeenCalled();
  });

  it('runs once per UTC date using a stable execution key', async () => {
    automationMocks.runAutomationJob.mockResolvedValue({
      result: 'succeeded',
      counts: { processed: 3, created: 1, skipped: 0, errors: 0 },
      deduplicated: false,
    });
    const secret = process.env.CRON_SECRET!;
    const response = await GET(new Request('https://example.invalid/api/cron/reverification', {
      headers: { authorization: `Bearer ${secret}` },
    }));
    expect(response.status).toBe(200);
    expect(automationMocks.runAutomationJob).toHaveBeenCalledWith('reverification_scan', expect.objectContaining({
      trigger: 'scheduled',
      executionKey: expect.stringMatching(/^vercel:reverification:\d{4}-\d{2}-\d{2}$/),
    }));
  });
});
