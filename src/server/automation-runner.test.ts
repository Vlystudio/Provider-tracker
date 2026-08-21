import { describe, expect, it, vi } from 'vitest';
import { isRetryableAutomationError, runWithBoundedRetry } from './automation-runner';

describe('automation retry policy', () => {
  it('retries transient failures and stops after success', async () => {
    const work = vi.fn().mockRejectedValueOnce(Object.assign(new Error('deadlock'), { code: '40P01' })).mockResolvedValue('ok');
    await expect(runWithBoundedRetry(work, { wait: async () => undefined })).resolves.toEqual({ value: 'ok', retryCount: 1 });
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('does not retry permanent failures', async () => {
    const work = vi.fn().mockRejectedValue(Object.assign(new Error('invalid'), { code: '23514' }));
    await expect(runWithBoundedRetry(work, { wait: async () => undefined })).rejects.toThrow('invalid');
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('recognizes only bounded transient database and network errors', () => {
    expect(isRetryableAutomationError({ code: '40001' })).toBe(true);
    expect(isRetryableAutomationError({ code: '23505' })).toBe(false);
  });
});
