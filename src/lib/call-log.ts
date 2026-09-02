export type CallLogGroup<T> = {
  trackingId: string;
  calls: T[];
};

export function groupCallsByTrackingId<T extends { trackingId: string; trackingGroupKey?: string }>(calls: readonly T[]): CallLogGroup<T>[] {
  const groups = new Map<string, CallLogGroup<T>>();

  for (const call of calls) {
    const trackingId = call.trackingId.trim() || 'Not recorded';
    const groupKey = call.trackingGroupKey?.trim() || trackingId;
    const existing = groups.get(groupKey);

    if (existing) {
      existing.calls.push(call);
      continue;
    }

    groups.set(groupKey, {
      trackingId,
      calls: [call],
    });
  }

  return [...groups.values()];
}
