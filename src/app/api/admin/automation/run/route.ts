import { randomUUID } from 'node:crypto';
import { z, ZodError } from 'zod';
import { automationJobTypes } from '@/lib/automation';
import { recordAuditEventBestEffort } from '@/server/audit';
import { authorizationErrorResponse, requireRequestPermission } from '@/server/authorization';
import { runAutomationJob } from '@/server/automation-runner';
import { enforceDatabaseRateLimit, rateLimitErrorResponse } from '@/server/rate-limit';
import { enforceSameOrigin, readJsonBody, requestSecurityErrorResponse } from '@/server/request-security';

const inputSchema = z.object({
  jobType: z.enum(automationJobTypes),
  dryRun: z.boolean().default(true),
  executionKey: z.string().trim().min(4).max(160).regex(/^[a-zA-Z0-9:._+-]+$/).optional(),
});

export async function POST(request: Request) {
  let principal: Awaited<ReturnType<typeof requireRequestPermission>> | null = null;
  try {
    enforceSameOrigin(request);
    principal = await requireRequestPermission(request.headers, 'automation:manage');
    await enforceDatabaseRateLimit(principal.id, 'automation-manual-run', { max: 10, windowSeconds: 60 });
    const input = inputSchema.parse(await readJsonBody(request));
    const result = await runAutomationJob(input.jobType, {
      executionKey: input.executionKey ?? `manual:${input.jobType}:${randomUUID()}`,
      trigger: 'manual',
      dryRun: input.dryRun,
    });
    await recordAuditEventBestEffort({ actorId: principal.id, action: 'automation.manual-run', result: 'success', entityType: 'automation_job_execution', entityId: result.executionId, request, metadata: { jobType: input.jobType, dryRun: input.dryRun } });
    return Response.json(result);
  } catch (error) {
    if (principal) await recordAuditEventBestEffort({ actorId: principal.id, action: 'automation.manual-run', result: 'failure', entityType: 'automation_job_execution', request });
    return authorizationErrorResponse(error) ?? requestSecurityErrorResponse(error) ?? rateLimitErrorResponse(error) ?? (error instanceof ZodError
      ? Response.json({ error: error.issues[0]?.message ?? 'Invalid automation request.' }, { status: 400 })
      : Response.json({ error: 'The automation job failed. Review execution history for details.' }, { status: 500 }));
  }
}
