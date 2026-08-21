const noncePattern = /^[A-Za-z0-9_-]{16,128}$/;

export function createContentSecurityPolicy(nonce: string, production: boolean): string {
  if (!noncePattern.test(nonce)) {
    throw new Error('A valid CSP nonce is required.');
  }

  const developmentScriptSources = production ? [] : ["'unsafe-inline'", "'unsafe-eval'"];
  const developmentStyleSources = production ? [] : ["'unsafe-inline'"];

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${developmentScriptSources.join(' ')}`.trim(),
    `style-src 'self' 'nonce-${nonce}' ${developmentStyleSources.join(' ')}`.trim(),
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self'${production ? '' : ' ws: wss:'}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "media-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(production ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}
