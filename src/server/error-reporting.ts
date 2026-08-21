import { classifyError, logEvent, safeErrorFields } from './logger';

export type ErrorReport = {
  requestId?: string;
  route: string;
  method: string;
  environment: string;
  release: string;
  category: ReturnType<typeof classifyError>;
  error: unknown;
};

export interface ErrorReporter {
  report(input: ErrorReport): void | Promise<void>;
}

class StructuredLogErrorReporter implements ErrorReporter {
  report(input: ErrorReport): void {
    logEvent('error', 'request.failed', {
      requestId: input.requestId,
      route: input.route,
      method: input.method,
      environment: input.environment,
      release: input.release,
      errorCategory: input.category,
      ...safeErrorFields(input.error),
    });
  }
}

let reporter: ErrorReporter = new StructuredLogErrorReporter();

export function setErrorReporter(nextReporter: ErrorReporter): void {
  reporter = nextReporter;
}

export async function reportError(input: ErrorReport): Promise<void> {
  await reporter.report(input);
}
