export type CallLogGroup<T> = {
  authorizationNumber: string;
  calls: T[];
};

export function groupCallsByAuthorization<T extends { number: string }>(calls: readonly T[]): CallLogGroup<T>[] {
  const groups = new Map<string, CallLogGroup<T>>();

  for (const call of calls) {
    const authorizationNumber = call.number.trim() || 'Not recorded';
    const existing = groups.get(authorizationNumber);

    if (existing) {
      existing.calls.push(call);
      continue;
    }

    groups.set(authorizationNumber, {
      authorizationNumber,
      calls: [call],
    });
  }

  return [...groups.values()];
}
