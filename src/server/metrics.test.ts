import { beforeEach, describe, expect, it } from 'vitest';
import { incrementMetric, observeDuration, renderMetrics, resetMetricsForTest } from './metrics';

describe('application metrics', () => {
  beforeEach(() => resetMetricsForTest());

  it('renders counters and latency distributions without user labels', () => {
    incrementMetric('provider_tracker_http_requests_total', { route: 'api', method: 'GET', status: '200', user_id: 'ignored' });
    observeDuration('provider_tracker_operation_duration_ms', 42, { operation: 'provider_search' });
    const output = renderMetrics();

    expect(output).toContain('provider_tracker_http_requests_total');
    expect(output).toContain('provider_tracker_operation_duration_ms_bucket');
    expect(output).not.toContain('user_id');
  });
});
