type Labels = Record<string, string>;

const counters = new Map<string, number>();
const histograms = new Map<string, number[]>();
const gauges = new Map<string, number>();
const latencyBuckets = [10, 25, 50, 100, 250, 500, 1_000, 2_500, 5_000, 10_000];
const safeMetricPattern = /^[a-z][a-z0-9_]{1,63}$/;
const safeLabelPattern = /^[a-z][a-z0-9_]{0,31}$/;
const allowedLabels = new Set(['route', 'method', 'status', 'operation', 'result']);

function key(name: string, labels: Labels = {}): string {
  if (!safeMetricPattern.test(name)) throw new Error(`Invalid metric name: ${name}`);
  const entries = Object.entries(labels)
    .filter(([label]) => allowedLabels.has(label) && safeLabelPattern.test(label))
    .sort(([a], [b]) => a.localeCompare(b));
  return `${name}|${entries.map(([label, value]) => `${label}=${value.replace(/[^a-zA-Z0-9_.:/-]/g, '_').slice(0, 64)}`).join(',')}`;
}

function decode(metricKey: string): { name: string; labels: Labels } {
  const [name, encoded = ''] = metricKey.split('|', 2);
  return {
    name,
    labels: Object.fromEntries(encoded ? encoded.split(',').map((pair) => pair.split('=', 2) as [string, string]) : []),
  };
}

function renderLabels(labels: Labels, extra: Labels = {}): string {
  const values = { ...labels, ...extra };
  const entries = Object.entries(values);
  return entries.length ? `{${entries.map(([label, value]) => `${label}="${value.replace(/["\\\n]/g, '_')}"`).join(',')}}` : '';
}

export function incrementMetric(name: string, labels: Labels = {}, amount = 1): void {
  const metricKey = key(name, labels);
  counters.set(metricKey, (counters.get(metricKey) ?? 0) + amount);
}

export function observeDuration(name: string, durationMs: number, labels: Labels = {}): void {
  const metricKey = key(name, labels);
  const samples = histograms.get(metricKey) ?? Array.from({ length: latencyBuckets.length + 2 }, () => 0);
  for (let index = 0; index < latencyBuckets.length; index += 1) {
    if (durationMs <= latencyBuckets[index]) samples[index] += 1;
  }
  samples[latencyBuckets.length] += 1;
  samples[latencyBuckets.length + 1] += durationMs;
  histograms.set(metricKey, samples);
}

export function setMetricGauge(name: string, value: number, labels: Labels = {}): void {
  gauges.set(key(name, labels), value);
}

export async function measureOperation<T>(operation: string, work: () => Promise<T>): Promise<T> {
  const started = performance.now();
  try {
    const result = await work();
    incrementMetric('provider_tracker_operations_total', { operation, result: 'success' });
    return result;
  } catch (error) {
    incrementMetric('provider_tracker_operations_total', { operation, result: 'failure' });
    throw error;
  } finally {
    observeDuration('provider_tracker_operation_duration_ms', performance.now() - started, { operation });
  }
}

export function renderMetrics(extraGauges: Record<string, number> = {}): string {
  for (const [name, value] of Object.entries(extraGauges)) setMetricGauge(name, value);
  const lines = [
    '# Provider Tracker process metrics',
    `provider_tracker_process_uptime_seconds ${Math.floor(process.uptime())}`,
  ];
  for (const [metricKey, value] of [...counters.entries()].sort()) {
    const { name, labels } = decode(metricKey);
    lines.push(`${name}${renderLabels(labels)} ${value}`);
  }
  for (const [metricKey, samples] of [...histograms.entries()].sort()) {
    const { name, labels } = decode(metricKey);
    latencyBuckets.forEach((bucket, index) => lines.push(`${name}_bucket${renderLabels(labels, { le: String(bucket) })} ${samples[index]}`));
    lines.push(`${name}_bucket${renderLabels(labels, { le: '+Inf' })} ${samples[latencyBuckets.length]}`);
    lines.push(`${name}_count${renderLabels(labels)} ${samples[latencyBuckets.length]}`);
    lines.push(`${name}_sum${renderLabels(labels)} ${samples[latencyBuckets.length + 1].toFixed(3)}`);
  }
  for (const [metricKey, value] of [...gauges.entries()].sort()) {
    const { name, labels } = decode(metricKey);
    lines.push(`${name}${renderLabels(labels)} ${value}`);
  }
  return `${lines.join('\n')}\n`;
}

export function resetMetricsForTest(): void {
  counters.clear();
  histograms.clear();
  gauges.clear();
}
