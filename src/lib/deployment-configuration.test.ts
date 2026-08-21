import { describe, expect, it } from 'vitest';
import {
  auditDeploymentConfiguration,
  compareDeploymentConfigurations,
  deploymentConfigurationPassed,
} from './deployment-configuration';

const valid = {
  APP_ENV: 'production',
  APP_DATA_MODE: 'database',
  NETWORK_ACCESS_MODE: 'private-vpn',
  PROXY_TRUST_MODE: 'sanitized-ingress',
  REQUEST_ID_SOURCE: 'trusted-proxy',
  APP_MAINTENANCE_MODE: 'off',
  LOG_LEVEL: 'info',
  BETTER_AUTH_URL: 'https://provider-tracker.corp.invalid',
  AUTH_TRUSTED_ORIGINS: 'https://provider-tracker.corp.invalid',
  AUTH_CLIENT_IP_HEADER: 'x-real-ip',
  AUTH_TRUSTED_PROXY_CIDRS: '10.20.0.0/16',
  DATABASE_URL: 'postgresql://runtime:private-value@db.corp.invalid:5432/provider_tracker?sslmode=verify-full',
  BETTER_AUTH_SECRET: 'b'.repeat(40),
  AUDIT_LOG_IP_SALT: 'a'.repeat(40),
  OPERATIONS_TOKEN: 'o'.repeat(40),
  AUTH_SESSION_ABSOLUTE_SECONDS: '28800',
  AUTH_SESSION_IDLE_SECONDS: '1800',
  AUTH_SESSION_TOUCH_SECONDS: '60',
  PRIVILEGED_AUTH_MAX_AGE_SECONDS: '900',
  APP_RELEASE: '0.1.0-0123456',
  BUILD_COMMIT: '0123456789abcdef0123456789abcdef01234567',
};

describe('deployment configuration audit', () => {
  it('accepts the approved security profile without exposing values', () => {
    const checks = auditDeploymentConfiguration(valid);
    expect(deploymentConfigurationPassed(checks)).toBe(true);
    expect(JSON.stringify(checks)).not.toContain(valid.BETTER_AUTH_SECRET);
    expect(JSON.stringify(checks)).not.toContain('private-value');
  });

  it('fails public or weakened production settings', () => {
    const checks = auditDeploymentConfiguration({
      ...valid,
      NETWORK_ACCESS_MODE: 'local',
      BETTER_AUTH_URL: 'http://localhost:3000',
      AUTH_TRUSTED_ORIGINS: '*',
      AUTH_TRUSTED_PROXY_CIDRS: '0.0.0.0/0',
      DATABASE_URL: 'postgresql://runtime:private-value@db.corp.invalid/provider_tracker',
      LOG_LEVEL: 'debug',
    });
    expect(deploymentConfigurationPassed(checks)).toBe(false);
    expect(checks.filter((item) => item.status === 'FAIL').map((item) => item.key)).toEqual(expect.arrayContaining([
      'NETWORK_ACCESS_MODE',
      'BETTER_AUTH_URL',
      'AUTH_TRUSTED_ORIGINS',
      'AUTH_TRUSTED_PROXY_CIDRS',
      'DATABASE_URL',
      'LOG_LEVEL',
    ]));
  });

  it('reports secret presence without comparing or printing secret values', () => {
    const production = {
      ...valid,
      BETTER_AUTH_URL: 'https://provider-tracker.production.invalid',
      AUTH_TRUSTED_ORIGINS: 'https://provider-tracker.production.invalid',
      BETTER_AUTH_SECRET: 'p'.repeat(40),
    };
    const result = compareDeploymentConfigurations(valid, production);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain(valid.BETTER_AUTH_SECRET);
    expect(serialized).not.toContain(production.BETTER_AUTH_SECRET);
    expect(result.find((item) => item.key === 'BETTER_AUTH_SECRET')?.status).toBe('PRESENCE_ONLY');
    expect(result.find((item) => item.key === 'BETTER_AUTH_URL')?.status).toBe('EXPECTED_DIFFERENCE');
  });

  it('marks a security-profile change as dangerous drift', () => {
    const result = compareDeploymentConfigurations(valid, { ...valid, PROXY_TRUST_MODE: 'off' });
    expect(result.find((item) => item.key === 'PROXY_TRUST_MODE')?.status).toBe('DANGEROUS_DIFFERENCE');
  });
});
