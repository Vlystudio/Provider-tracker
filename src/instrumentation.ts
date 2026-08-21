import type { Instrumentation } from 'next';

export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { assertProductionConfiguration } = await import('@/server/config');
    assertProductionConfiguration();
    const { registerRuntimeLifecycle } = await import('@/server/runtime-state');
    registerRuntimeLifecycle();
  }
}

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const [{ reportError }, { classifyError }, { requestIdFromHeaders }, { getReleaseIdentifier }] = await Promise.all([
    import('@/server/error-reporting'),
    import('@/server/logger'),
    import('@/server/request-context'),
    import('@/server/release'),
  ]);
  await reportError({
    requestId: requestIdFromHeaders(request.headers),
    route: context.routePath,
    method: request.method,
    environment: process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development',
    release: getReleaseIdentifier(),
    category: classifyError(error),
    error,
  });
};
