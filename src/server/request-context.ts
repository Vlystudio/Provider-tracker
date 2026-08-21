import { randomUUID } from 'node:crypto';

export const requestIdHeader = 'x-request-id';
const safeRequestIdPattern = /^[a-zA-Z0-9][a-zA-Z0-9._:/+-]{7,127}$/;

export function normalizeRequestId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && safeRequestIdPattern.test(trimmed) ? trimmed : null;
}

export function resolveRequestId(value: string | null | undefined, trustIncoming = false): string {
  if (trustIncoming) {
    const accepted = normalizeRequestId(value);
    if (accepted) return accepted;
  }
  return randomUUID();
}

export function requestIdFromHeaders(headers: Headers | Record<string, string | string[] | undefined>): string | undefined {
  const value = headers instanceof Headers ? headers.get(requestIdHeader) : headers[requestIdHeader];
  return normalizeRequestId(Array.isArray(value) ? value[0] : value ?? undefined) ?? undefined;
}
