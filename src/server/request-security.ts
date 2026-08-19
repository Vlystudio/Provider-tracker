import 'server-only';

import { getSecurityConfig } from './config';

const MAX_JSON_BYTES = 16 * 1024;

export class InvalidRequestError extends Error {
  readonly status = 400;
}

export class CsrfError extends Error {
  readonly status = 403;
}

export class PayloadTooLargeError extends Error {
  readonly status = 413;
}

export function enforceSameOrigin(request: Request): void {
  const origin = request.headers.get('origin');
  const fetchSite = request.headers.get('sec-fetch-site');

  if (!origin || fetchSite === 'cross-site' || !getSecurityConfig().AUTH_TRUSTED_ORIGINS.includes(origin)) {
    throw new CsrfError('Request origin was not accepted.');
  }
}

export async function readJsonBody(request: Request, maxBytes = MAX_JSON_BYTES): Promise<unknown> {
  const contentType = request.headers.get('content-type')?.split(';', 1)[0]?.trim().toLowerCase();
  if (contentType !== 'application/json') {
    throw new InvalidRequestError('Content-Type must be application/json.');
  }

  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new PayloadTooLargeError('Request body is too large.');
  }

  const raw = await request.text();
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) {
    throw new PayloadTooLargeError('Request body is too large.');
  }

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw new InvalidRequestError('Request body must contain valid JSON.');
  }
}

export function requestSecurityErrorResponse(error: unknown): Response | null {
  if (error instanceof InvalidRequestError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof CsrfError) {
    return Response.json({ error: 'Request origin was not accepted.' }, { status: error.status });
  }
  if (error instanceof PayloadTooLargeError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return null;
}
