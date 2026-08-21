export type DeploymentCheck = {
  key: string;
  status: 'PASS' | 'FAIL';
  critical: boolean;
  detail: string;
};

export type ConfigurationDifference = {
  key: string;
  status: 'MATCH' | 'EXPECTED_DIFFERENCE' | 'DANGEROUS_DIFFERENCE' | 'PRESENCE_ONLY';
  detail: string;
};

const secretKeys = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'AUDIT_LOG_IP_SALT',
  'OPERATIONS_TOKEN',
] as const;

const mustMatchKeys = [
  'APP_ENV',
  'APP_DATA_MODE',
  'NETWORK_ACCESS_MODE',
  'PROXY_TRUST_MODE',
  'REQUEST_ID_SOURCE',
  'APP_MAINTENANCE_MODE',
  'AUTH_CLIENT_IP_HEADER',
  'AUTH_SESSION_ABSOLUTE_SECONDS',
  'AUTH_SESSION_IDLE_SECONDS',
  'AUTH_SESSION_TOUCH_SECONDS',
  'PRIVILEGED_AUTH_MAX_AGE_SECONDS',
  'APP_RELEASE',
  'BUILD_COMMIT',
] as const;

const environmentSpecificKeys = [
  'BETTER_AUTH_URL',
  'AUTH_TRUSTED_ORIGINS',
  'AUTH_TRUSTED_PROXY_CIDRS',
] as const;

const placeholderPattern = /(change[-_ ]?this|replace[-_ ]?me|placeholder|test[-_ ]?secret|set[-_ ]?in[-_ ]?secret)/i;

function trimmed(values: Record<string, string | undefined>, key: string): string {
  return values[key]?.trim() ?? '';
}

function check(key: string, passed: boolean, detail: string, critical = true): DeploymentCheck {
  return { key, status: passed ? 'PASS' : 'FAIL', critical, detail };
}

function isPrivateDeploymentOrigin(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return url.protocol === 'https:' && !['localhost', '127.0.0.1', '::1'].includes(hostname) && url.origin === value;
  } catch {
    return false;
  }
}

function trustedOriginsAreSafe(value: string, requiredOrigin: string): boolean {
  const origins = [...new Set(value.split(',').map((item) => item.trim()).filter(Boolean))];
  return origins.length > 0 && origins.includes(requiredOrigin) && origins.every(isPrivateDeploymentOrigin);
}

function databaseUsesVerifiedTls(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      (url.protocol === 'postgresql:' || url.protocol === 'postgres:') &&
      url.searchParams.get('sslmode')?.toLowerCase() === 'verify-full'
    );
  } catch {
    return false;
  }
}

function hasRestrictedProxyRanges(value: string): boolean {
  const ranges = value.split(',').map((item) => item.trim()).filter(Boolean);
  return ranges.length > 0 && !ranges.some((range) => ['0.0.0.0/0', '::/0', '*'].includes(range));
}

function secretIsPresent(values: Record<string, string | undefined>, key: string, minimumLength: number): boolean {
  const value = trimmed(values, key);
  return value.length >= minimumLength && !placeholderPattern.test(value);
}

export function auditDeploymentConfiguration(values: Record<string, string | undefined>): DeploymentCheck[] {
  const authOrigin = trimmed(values, 'BETTER_AUTH_URL');
  const databaseUrl = trimmed(values, 'DATABASE_URL');

  return [
    check('APP_ENV', trimmed(values, 'APP_ENV') === 'production', 'Production runtime mode is required.'),
    check('APP_DATA_MODE', trimmed(values, 'APP_DATA_MODE') === 'database', 'Database data mode is required.'),
    check('NETWORK_ACCESS_MODE', trimmed(values, 'NETWORK_ACCESS_MODE') === 'private-vpn', 'Private VPN mode is required.'),
    check('PROXY_TRUST_MODE', trimmed(values, 'PROXY_TRUST_MODE') === 'sanitized-ingress', 'Sanitized ingress mode is required.'),
    check('REQUEST_ID_SOURCE', trimmed(values, 'REQUEST_ID_SOURCE') === 'trusted-proxy', 'The approved ingress must replace request IDs.'),
    check('APP_MAINTENANCE_MODE', trimmed(values, 'APP_MAINTENANCE_MODE') === 'off', 'Traffic must not be enabled while maintenance mode is on.'),
    check('LOG_LEVEL', ['info', 'warn', 'error'].includes(trimmed(values, 'LOG_LEVEL')), 'Debug logging is not allowed.'),
    check('BETTER_AUTH_URL', isPrivateDeploymentOrigin(authOrigin), 'A non-loopback HTTPS application origin is required.'),
    check('AUTH_TRUSTED_ORIGINS', trustedOriginsAreSafe(trimmed(values, 'AUTH_TRUSTED_ORIGINS'), authOrigin), 'Trusted origins must be exact HTTPS origins and include the application origin.'),
    check('AUTH_CLIENT_IP_HEADER', ['x-real-ip', 'cf-connecting-ip', 'fly-client-ip'].includes(trimmed(values, 'AUTH_CLIENT_IP_HEADER')), 'Use only the ingress-replaced client IP header.'),
    check('AUTH_TRUSTED_PROXY_CIDRS', hasRestrictedProxyRanges(trimmed(values, 'AUTH_TRUSTED_PROXY_CIDRS')), 'At least one restricted proxy range is required; global ranges are rejected.'),
    check('DATABASE_URL', databaseUsesVerifiedTls(databaseUrl), 'PostgreSQL must use certificate and hostname verification with sslmode=verify-full.'),
    check('BETTER_AUTH_SECRET', secretIsPresent(values, 'BETTER_AUTH_SECRET', 32), 'The authentication secret must be supplied by the secret store and contain at least 32 characters.'),
    check('AUDIT_LOG_IP_SALT', secretIsPresent(values, 'AUDIT_LOG_IP_SALT', 32), 'The audit salt must be supplied by the secret store and contain at least 32 characters.'),
    check('OPERATIONS_TOKEN', secretIsPresent(values, 'OPERATIONS_TOKEN', 32), 'The monitoring token must be supplied by the secret store and contain at least 32 characters.'),
    check('AUTH_SESSION_ABSOLUTE_SECONDS', trimmed(values, 'AUTH_SESSION_ABSOLUTE_SECONDS') === '28800', 'The fixed eight-hour session limit must match the approved profile.'),
    check('AUTH_SESSION_IDLE_SECONDS', trimmed(values, 'AUTH_SESSION_IDLE_SECONDS') === '1800', 'The 30-minute idle limit must match the approved profile.'),
    check('AUTH_SESSION_TOUCH_SECONDS', trimmed(values, 'AUTH_SESSION_TOUCH_SECONDS') === '60', 'The session activity interval must match the approved profile.'),
    check('PRIVILEGED_AUTH_MAX_AGE_SECONDS', trimmed(values, 'PRIVILEGED_AUTH_MAX_AGE_SECONDS') === '900', 'The 15-minute privileged-login window must match the approved profile.'),
    check('APP_RELEASE', trimmed(values, 'APP_RELEASE').length > 0, 'An immutable release identifier is required.'),
    check('BUILD_COMMIT', /^[0-9a-f]{40}$/i.test(trimmed(values, 'BUILD_COMMIT')), 'The full source commit is required.'),
  ];
}

export function compareDeploymentConfigurations(
  staging: Record<string, string | undefined>,
  production: Record<string, string | undefined>,
): ConfigurationDifference[] {
  const differences: ConfigurationDifference[] = [];

  for (const key of secretKeys) {
    const bothPresent = Boolean(trimmed(staging, key) && trimmed(production, key));
    differences.push({
      key,
      status: 'PRESENCE_ONLY',
      detail: bothPresent
        ? 'Present in both environments; secret values were not compared or printed.'
        : 'Missing from one or both environments; secret values were not printed.',
    });
  }

  for (const key of mustMatchKeys) {
    const matches = trimmed(staging, key) === trimmed(production, key);
    differences.push({
      key,
      status: matches ? 'MATCH' : 'DANGEROUS_DIFFERENCE',
      detail: matches ? 'Matches the staging profile.' : 'Differs from staging in a security-critical field.',
    });
  }

  for (const key of environmentSpecificKeys) {
    const matches = trimmed(staging, key) === trimmed(production, key);
    differences.push({
      key,
      status: matches ? 'MATCH' : 'EXPECTED_DIFFERENCE',
      detail: matches ? 'Matches staging.' : 'Differs as expected for an environment-specific field; review and approve it.',
    });
  }

  return differences;
}

export function deploymentConfigurationPassed(checks: DeploymentCheck[]): boolean {
  return checks.every((item) => item.status === 'PASS' || !item.critical);
}
