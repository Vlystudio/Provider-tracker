import { getServerConfig } from './config';
import { closeDatabasePool } from './database';
import { logEvent, safeErrorFields } from './logger';
import { getBuildMetadata } from './release';

type RuntimeState = { initialized: boolean; shuttingDown: boolean; handlersInstalled: boolean };
const runtimeStateKey = Symbol.for('provider-tracker.runtime-state');
const runtimeGlobal = globalThis as typeof globalThis & { [runtimeStateKey]?: RuntimeState };

function state(): RuntimeState {
  runtimeGlobal[runtimeStateKey] ??= { initialized: true, shuttingDown: false, handlersInstalled: false };
  return runtimeGlobal[runtimeStateKey];
}

export function getRuntimeState(): { initialized: boolean; shuttingDown: boolean } {
  const current = state();
  return { initialized: current.initialized, shuttingDown: current.shuttingDown };
}

export function markRuntimeInitialized(): void {
  state().initialized = true;
}

export async function shutdownRuntime(signal: string): Promise<void> {
  if (state().shuttingDown) return;
  state().shuttingDown = true;
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
  if (state().handlersInstalled) return;
  state().handlersInstalled = true;
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
  runtimeGlobal[runtimeStateKey] = { initialized: false, shuttingDown: false, handlersInstalled: false };
}
