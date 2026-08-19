import 'server-only';

import { createHmac, randomUUID } from 'node:crypto';
import { auditEvents } from '@/db/schema';
import { getSecurityConfig } from './config';
import { requireDatabaseClient } from './database';

type AuditResult = 'success' | 'failure' | 'blocked';

type AuditEventInput = {
  actorId?: string | null;
  action: string;
  result: AuditResult;
  entityType: string;
  entityId?: string | null;
  request?: Request;
  requestId?: string;
  metadata?: Record<string, string | number | boolean | null>;
};

function getTrustedClientAddress(request?: Request): string | null {
  if (!request) return null;
  const header = getSecurityConfig().AUTH_CLIENT_IP_HEADER;
  return header ? request.headers.get(header)?.trim() || null : null;
}

export function hashAuditValue(value: string): string {
  return createHmac('sha256', getSecurityConfig().AUDIT_LOG_IP_SALT).update(value).digest('hex');
}

export function buildAuditEvent(input: AuditEventInput) {
  const address = getTrustedClientAddress(input.request);
  return {
    actorId: input.actorId ?? null,
    action: input.action,
    result: input.result,
    entityType: input.entityType,
    entityId: input.entityId ?? null,
    requestId: input.requestId ?? randomUUID(),
    sourceIpHash: address ? hashAuditValue(address) : null,
    metadata: input.metadata ?? {},
  };
}

export async function recordAuditEvent(input: AuditEventInput): Promise<void> {
  await requireDatabaseClient().insert(auditEvents).values(buildAuditEvent(input));
}

export async function recordAuditEventBestEffort(input: AuditEventInput): Promise<void> {
  try {
    await recordAuditEvent(input);
  } catch {
    console.error('A security audit event could not be stored.', {
      action: input.action,
      requestId: input.requestId,
    });
  }
}
