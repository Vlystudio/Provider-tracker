import { getServerConfig } from './config';
import { closeDatabasePool } from './database';
import { logEvent, safeErrorFields } from './logger';
import { getBuildMetadata } from './release';

let initialized = false;
let shuttingDown = false;
let handlersInstalled = false;

export function getRuntimeState(): { initialized: boolean; shuttingDown: boolean } {
  return { initialized, shuttingDown };
}

export function markRuntimeInitialized(): void {
  initialized = true;
}

export async function shutdownRuntime(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  const timeoutMs = getServerConfig().GRACEFUL_SHUTDOWN_TIMEOUT_MS;
  logEvent('info', 'runtime.shutdown-started', { signal, timeoutMs });
  let timeout: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      closeDatabasePool(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('Graceful shutdown timed out.')), timeoutMs);
        timeout.unref();
      }),
    ]);
    logEvent('info', 'runtime.shutdown-complete', { signal });
  } catch (error) {
    logEvent('error', 'runtime.shutdown-failed', { signal, ...safeErrorFields(error) });
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function registerRuntimeLifecycle(): void {
  if (handlersInstalled) return;
  handlersInstalled = true;
  markRuntimeInitialized();
  logEvent('info', 'runtime.started', { environment: getServerConfig().APP_ENV, build: getBuildMetadata() });

  if (process.env.NODE_ENV !== 'production') return;
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      void shutdownRuntime(signal)
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  }
}

export function resetRuntimeStateForTest(): void {
  initialized = false;
  shuttingDown = false;
  handlersInstalled = false;
}
