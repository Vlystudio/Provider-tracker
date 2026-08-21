import 'server-only';

import { eq } from 'drizzle-orm';
import {
  automationSettingsSchema,
  defaultAutomationSettings,
  type AutomationSettings,
} from '@/lib/automation-config';
import { automationSettings } from '@/db/schema';
import { recordAuditEvent } from './audit';
import { assertPermission, type Principal } from './authorization';
import { requireDatabaseClient } from './database';

export { automationSettingsSchema, defaultAutomationSettings };
export type { AutomationSettings };

export async function getAutomationSettings(): Promise<AutomationSettings> {
  const [row] = await requireDatabaseClient().select().from(automationSettings).where(eq(automationSettings.scope, 'global')).limit(1);
  if (!row) return defaultAutomationSettings;
  return automationSettingsSchema.parse(row);
}

export async function saveAutomationSettings(principal: Principal, value: unknown, request?: Request): Promise<AutomationSettings> {
  assertPermission(principal, 'automation:manage');
  const parsed = automationSettingsSchema.parse(value);
  const db = requireDatabaseClient();
  const [before] = await db.select().from(automationSettings).where(eq(automationSettings.scope, 'global')).limit(1);
  const [saved] = await db.insert(automationSettings).values({ scope: 'global', ...parsed, updatedBy: principal.id, updatedAt: new Date() })
    .onConflictDoUpdate({ target: automationSettings.scope, set: { ...parsed, updatedBy: principal.id, updatedAt: new Date() } })
    .returning();
  await recordAuditEvent({
    actorId: principal.id,
    action: 'automation.settings.update',
    result: 'success',
    entityType: 'automation_settings',
    entityId: 'global',
    request,
    metadata: { changed: JSON.stringify(before ?? {}) !== JSON.stringify(saved) },
  });
  return automationSettingsSchema.parse(saved);
}
