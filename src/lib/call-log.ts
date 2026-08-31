export type CallLogGroup<T> = {
  trackingId: string;
  calls: T[];
};

export function groupCallsByTrackingId<T extends { trackingId: string }>(calls: readonly T[]): CallLogGroup<T>[] {
  const groups = new Map<string, CallLogGroup<T>>();

  for (const call of calls) {
    const trackingId = call.trackingId.trim() || 'Not recorded';
    const existing = groups.get(trackingId);

    if (existing) {
      existing.calls.push(call);
      continue;
    }

    groups.set(trackingId, {
      trackingId,
      calls: [call],
    });
  }

  return [...groups.values()];
}
