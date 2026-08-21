import { isIP } from 'node:net';
import { z } from 'zod';
import { parseFreshnessPolicy, type FreshnessPolicy } from '../lib/provider-intelligence';

export const appDataModeSchema = z.enum(['database', 'demo']);
export const appEnvironmentSchema = z.enum(['development', 'test', 'production']);
export const logLevelSchema = z.enum(['debug', 'info', 'warn', 'error']);
export const maintenanceModeSchema = z.enum(['off', 'on']);
export const requestIdSourceSchema = z.enum(['generate', 'trusted-proxy']);
export const networkAccessModeSchema = z.enum(['local', 'private-vpn']);
export const proxyTrustModeSchema = z.enum(['off', 'sanitized-ingress']);

export type AppDataMode = z.infer<typeof appDataModeSchema>;
export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;

export type ServerConfig = {
  APP_ENV: AppEnvironment;
  APP_DATA_MODE: AppDataMode;
  DATABASE_URL?: string;
  DATABASE_POOL_SIZE: number;
  DATABASE_IDLE_TIMEOUT_MS: number;
  DATABASE_CONNECT_TIMEOUT_MS: number;
  DATABASE_STATEMENT_TIMEOUT_MS: number;
  GRACEFUL_SHUTDOWN_TIMEOUT_MS: number;
  LOG_LEVEL: z.infer<typeof logLevelSchema>;
  APP_MAINTENANCE_MODE: z.infer<typeof maintenanceModeSchema>;
  REQUEST_ID_SOURCE: z.infer<typeof requestIdSourceSchema>;
  OPERATIONS_TOKEN?: string;
};

export type SecurityConfig = {
  APP_ENV: AppEnvironment;
  DATABASE_URL: string;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL: string;
  AUTH_TRUSTED_ORIGINS: string[];
  AUDIT_LOG_IP_SALT: string;
  AUTH_CLIENT_IP_HEADER?: 'x-real-ip' | 'cf-connecting-ip' | 'fly-client-ip';
  AUTH_TRUSTED_PROXY_CIDRS: string[];
  NETWORK_ACCESS_MODE: z.infer<typeof networkAccessModeSchema>;
  PROXY_TRUST_MODE: z.infer<typeof proxyTrustModeSchema>;
  AUTH_SESSION_ABSOLUTE_SECONDS: number;
  AUTH_SESSION_IDLE_SECONDS: number;
  AUTH_SESSION_TOUCH_SECONDS: number;
  PRIVILEGED_AUTH_MAX_AGE_SECONDS: number;
};

type SecurityConfigOverrides = Partial<Omit<SecurityConfig, 'AUTH_TRUSTED_ORIGINS' | 'AUTH_TRUSTED_PROXY_CIDRS'>> & {
  AUTH_TRUSTED_ORIGINS?: string[] | string;
  AUTH_TRUSTED_PROXY_CIDRS?: string[] | string;
};

const placeholderPattern = /(change[-_ ]?this|replace[-_ ]?me|example|placeholder|test[-_ ]?secret)/i;

function parseOrigins(value: string[] | string | undefined): string[] {
  const origins = Array.isArray(value) ? value : value?.split(',') ?? [];
  return [...new Set(origins.map((origin) => origin.trim()).filter(Boolean))];
}

function parseList(value: string[] | string | undefined): string[] {
  const values = Array.isArray(value) ? value : value?.split(',') ?? [];
  return [...new Set(values.map((item) => item.trim()).filter(Boolean))];
}

function isIpOrCidr(value: string): boolean {
  const slash = value.lastIndexOf('/');
  if (slash === -1) return isIP(value) !== 0;
  const address = value.slice(0, slash);
  const prefix = Number(value.slice(slash + 1));
  const family = isIP(address);
  return Number.isInteger(prefix) && ((family === 4 && prefix >= 0 && prefix <= 32) || (family === 6 && prefix >= 0 && prefix <= 128));
}

export function resolveServerConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const source = {
    APP_ENV: overrides.APP_ENV ?? process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development',
    APP_DATA_MODE: overrides.APP_DATA_MODE ?? process.env.APP_DATA_MODE ?? 'database',
    DATABASE_URL: (overrides.DATABASE_URL ?? process.env.DATABASE_URL?.trim()) || undefined,
    DATABASE_POOL_SIZE: overrides.DATABASE_POOL_SIZE ?? process.env.DATABASE_POOL_SIZE ?? 10,
    DATABASE_IDLE_TIMEOUT_MS: overrides.DATABASE_IDLE_TIMEOUT_MS ?? process.env.DATABASE_IDLE_TIMEOUT_MS ?? 30_000,
    DATABASE_CONNECT_TIMEOUT_MS: overrides.DATABASE_CONNECT_TIMEOUT_MS ?? process.env.DATABASE_CONNECT_TIMEOUT_MS ?? 10_000,
    DATABASE_STATEMENT_TIMEOUT_MS: overrides.DATABASE_STATEMENT_TIMEOUT_MS ?? process.env.DATABASE_STATEMENT_TIMEOUT_MS ?? 15_000,
    GRACEFUL_SHUTDOWN_TIMEOUT_MS: overrides.GRACEFUL_SHUTDOWN_TIMEOUT_MS ?? process.env.GRACEFUL_SHUTDOWN_TIMEOUT_MS ?? 20_000,
    LOG_LEVEL: overrides.LOG_LEVEL ?? process.env.LOG_LEVEL ??
      ((overrides.APP_ENV ?? process.env.APP_ENV ?? process.env.NODE_ENV) === 'production' ? 'info' : 'debug'),
    APP_MAINTENANCE_MODE: overrides.APP_MAINTENANCE_MODE ?? process.env.APP_MAINTENANCE_MODE ?? 'off',
    REQUEST_ID_SOURCE: overrides.REQUEST_ID_SOURCE ?? process.env.REQUEST_ID_SOURCE ?? 'generate',
    OPERATIONS_TOKEN: (overrides.OPERATIONS_TOKEN ?? process.env.OPERATIONS_TOKEN?.trim()) || undefined,
  };

  const parsed = z
    .object({
      APP_ENV: appEnvironmentSchema,
      APP_DATA_MODE: appDataModeSchema,
      DATABASE_URL: z
        .string()
        .url()
        .refine((value) => value.startsWith('postgresql://') || value.startsWith('postgres://'), {
          message: 'DATABASE_URL must use a PostgreSQL connection string.',
        })
        .optional(),
      DATABASE_POOL_SIZE: z.coerce.number().int().min(1).max(50),
      DATABASE_IDLE_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(600_000),
      DATABASE_CONNECT_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000),
      DATABASE_STATEMENT_TIMEOUT_MS: z.coerce.number().int().min(500).max(300_000),
      GRACEFUL_SHUTDOWN_TIMEOUT_MS: z.coerce.number().int().min(1_000).max(120_000),
      LOG_LEVEL: logLevelSchema,
      APP_MAINTENANCE_MODE: maintenanceModeSchema,
      REQUEST_ID_SOURCE: requestIdSourceSchema,
      OPERATIONS_TOKEN: z.string().min(32, 'OPERATIONS_TOKEN must contain at least 32 characters.').optional(),
    })
    .safeParse(source);

  if (!parsed.success) {
    throw new Error(`Invalid server configuration: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
  }

  const config = parsed.data;

  if (config.APP_DATA_MODE === 'demo' && config.APP_ENV === 'production') {
    throw new Error('Demo data mode is disabled in production.');
  }

  if (config.APP_ENV === 'production' && config.LOG_LEVEL === 'debug') {
    throw new Error('Debug logging is disabled in production.');
  }

  if (config.APP_ENV === 'production' && config.OPERATIONS_TOKEN && placeholderPattern.test(config.OPERATIONS_TOKEN)) {
    throw new Error('Placeholder operations tokens are not allowed in production.');
  }

  return config;
}

export function getServerConfig(): ServerConfig {
  return resolveServerConfig();
}

export function getFreshnessPolicy(): FreshnessPolicy {
  return parseFreshnessPolicy({
    ACCEPTING_FRESH_DAYS: process.env.VERIFICATION_ACCEPTING_FRESH_DAYS,
    ACCEPTING_STALE_DAYS: process.env.VERIFICATION_ACCEPTING_STALE_DAYS,
    SCHEDULING_FRESH_DAYS: process.env.VERIFICATION_SCHEDULING_FRESH_DAYS,
    SCHEDULING_STALE_DAYS: process.env.VERIFICATION_SCHEDULING_STALE_DAYS,
    SPECIALTY_FRESH_DAYS: process.env.VERIFICATION_SPECIALTY_FRESH_DAYS,
    SPECIALTY_STALE_DAYS: process.env.VERIFICATION_SPECIALTY_STALE_DAYS,
    DIAGNOSIS_FRESH_DAYS: process.env.VERIFICATION_DIAGNOSIS_FRESH_DAYS,
    DIAGNOSIS_STALE_DAYS: process.env.VERIFICATION_DIAGNOSIS_STALE_DAYS,
    CONTACT_FRESH_DAYS: process.env.VERIFICATION_CONTACT_FRESH_DAYS,
    CONTACT_STALE_DAYS: process.env.VERIFICATION_CONTACT_STALE_DAYS,
  });
}

export function resolveSecurityConfig(overrides: SecurityConfigOverrides = {}): SecurityConfig {
  const appEnvironment = overrides.APP_ENV ?? process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development';
  const source = {
    APP_ENV: appEnvironment,
    DATABASE_URL: overrides.DATABASE_URL ?? process.env.DATABASE_URL,
    BETTER_AUTH_SECRET: overrides.BETTER_AUTH_SECRET ?? process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: overrides.BETTER_AUTH_URL ?? process.env.BETTER_AUTH_URL,
    AUTH_TRUSTED_ORIGINS: parseOrigins(overrides.AUTH_TRUSTED_ORIGINS ?? process.env.AUTH_TRUSTED_ORIGINS),
    AUDIT_LOG_IP_SALT: overrides.AUDIT_LOG_IP_SALT ?? process.env.AUDIT_LOG_IP_SALT,
    AUTH_CLIENT_IP_HEADER: overrides.AUTH_CLIENT_IP_HEADER ?? (process.env.AUTH_CLIENT_IP_HEADER || undefined),
    AUTH_TRUSTED_PROXY_CIDRS: parseList(
      overrides.AUTH_TRUSTED_PROXY_CIDRS ?? process.env.AUTH_TRUSTED_PROXY_CIDRS,
    ),
    NETWORK_ACCESS_MODE: overrides.NETWORK_ACCESS_MODE ?? process.env.NETWORK_ACCESS_MODE ?? 'local',
    PROXY_TRUST_MODE: overrides.PROXY_TRUST_MODE ?? process.env.PROXY_TRUST_MODE ?? 'off',
    AUTH_SESSION_ABSOLUTE_SECONDS:
      overrides.AUTH_SESSION_ABSOLUTE_SECONDS ?? process.env.AUTH_SESSION_ABSOLUTE_SECONDS ?? 28_800,
    AUTH_SESSION_IDLE_SECONDS:
      overrides.AUTH_SESSION_IDLE_SECONDS ?? process.env.AUTH_SESSION_IDLE_SECONDS ?? 1_800,
    AUTH_SESSION_TOUCH_SECONDS:
      overrides.AUTH_SESSION_TOUCH_SECONDS ?? process.env.AUTH_SESSION_TOUCH_SECONDS ?? 60,
    PRIVILEGED_AUTH_MAX_AGE_SECONDS:
      overrides.PRIVILEGED_AUTH_MAX_AGE_SECONDS ?? process.env.PRIVILEGED_AUTH_MAX_AGE_SECONDS ?? 900,
  };

  const parsed = z.object({
    APP_ENV: appEnvironmentSchema,
    DATABASE_URL: z.string().url().refine(
      (value) => value.startsWith('postgresql://') || value.startsWith('postgres://'),
      'DATABASE_URL must use a PostgreSQL connection string.',
    ),
    BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must contain at least 32 characters.'),
    BETTER_AUTH_URL: z.string().url('BETTER_AUTH_URL must be an absolute URL.'),
    AUTH_TRUSTED_ORIGINS: z.array(z.string().url().refine(
      (value) => new URL(value).origin === value,
      'Trusted origins must not include a path, query, or fragment.',
    )).min(1, 'AUTH_TRUSTED_ORIGINS must include the application origin.'),
    AUDIT_LOG_IP_SALT: z.string().min(32, 'AUDIT_LOG_IP_SALT must contain at least 32 characters.'),
    AUTH_CLIENT_IP_HEADER: z.enum(['x-real-ip', 'cf-connecting-ip', 'fly-client-ip']).optional(),
    AUTH_TRUSTED_PROXY_CIDRS: z.array(z.string().trim().refine(isIpOrCidr, 'Trusted proxy values must be IP addresses or CIDR ranges.')).max(32),
    NETWORK_ACCESS_MODE: networkAccessModeSchema,
    PROXY_TRUST_MODE: proxyTrustModeSchema,
    AUTH_SESSION_ABSOLUTE_SECONDS: z.coerce.number().int().min(900).max(86_400),
    AUTH_SESSION_IDLE_SECONDS: z.coerce.number().int().min(300).max(28_800),
    AUTH_SESSION_TOUCH_SECONDS: z.coerce.number().int().min(30).max(900),
    PRIVILEGED_AUTH_MAX_AGE_SECONDS: z.coerce.number().int().min(60).max(3_600),
  }).safeParse(source);

  if (!parsed.success) {
    throw new Error(
      `Invalid security configuration: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'configuration'}: ${issue.message}`)
        .join('; ')}`,
    );
  }

  const config = parsed.data;
  const baseOrigin = new URL(config.BETTER_AUTH_URL).origin;

  if (!config.AUTH_TRUSTED_ORIGINS.includes(baseOrigin)) {
    throw new Error('Invalid security configuration: AUTH_TRUSTED_ORIGINS must include BETTER_AUTH_URL.');
  }

  if (config.AUTH_SESSION_IDLE_SECONDS > config.AUTH_SESSION_ABSOLUTE_SECONDS) {
    throw new Error('Invalid security configuration: idle session lifetime cannot exceed absolute session lifetime.');
  }
  if (config.AUTH_SESSION_TOUCH_SECONDS >= config.AUTH_SESSION_IDLE_SECONDS) {
    throw new Error('Invalid security configuration: session touch interval must be shorter than idle lifetime.');
  }
  if (config.PRIVILEGED_AUTH_MAX_AGE_SECONDS > config.AUTH_SESSION_ABSOLUTE_SECONDS) {
    throw new Error('Invalid security configuration: recent-authentication window cannot exceed session lifetime.');
  }
  if (config.AUTH_CLIENT_IP_HEADER) {
    if (config.PROXY_TRUST_MODE !== 'sanitized-ingress') {
      throw new Error('Invalid security configuration: trusted client IP headers require sanitized ingress.');
    }
    if (config.AUTH_TRUSTED_PROXY_CIDRS.length === 0) {
      throw new Error('Invalid security configuration: trusted client IP headers require proxy CIDRs.');
    }
  }

  if (config.APP_ENV === 'production') {
    if (!config.BETTER_AUTH_URL.startsWith('https://')) {
      throw new Error('Invalid security configuration: BETTER_AUTH_URL must use HTTPS in production.');
    }
    if (config.AUTH_TRUSTED_ORIGINS.some((origin) => !origin.startsWith('https://'))) {
      throw new Error('Invalid security configuration: trusted origins must use HTTPS in production.');
    }
    if (placeholderPattern.test(config.BETTER_AUTH_SECRET) || placeholderPattern.test(config.AUDIT_LOG_IP_SALT)) {
      throw new Error('Invalid security configuration: placeholder secrets are not allowed in production.');
    }
    if (config.NETWORK_ACCESS_MODE !== 'private-vpn') {
      throw new Error('Invalid security configuration: production requires NETWORK_ACCESS_MODE=private-vpn.');
    }
  }

  return config;
}

export function getSecurityConfig(): SecurityConfig {
  return resolveSecurityConfig();
}

export function assertProductionConfiguration(forceProduction = false): void {
  const productionRuntime = (process.env.APP_ENV ?? process.env.NODE_ENV) === 'production';
  if (forceProduction || productionRuntime) {
    if (process.env.APP_ENV !== 'production') {
      throw new Error('Invalid production configuration: APP_ENV must be set to production.');
    }
    resolveSecurityConfig({ APP_ENV: 'production' });
    const appConfig = resolveServerConfig({ APP_ENV: 'production' });
    if (!appConfig.DATABASE_URL) {
      throw new Error('Invalid production configuration: DATABASE_URL is required.');
    }
    const securityConfig = resolveSecurityConfig({ APP_ENV: 'production' });
    if (appConfig.REQUEST_ID_SOURCE === 'trusted-proxy' && securityConfig.PROXY_TRUST_MODE !== 'sanitized-ingress') {
      throw new Error('Invalid production configuration: trusted request IDs require sanitized ingress.');
    }
  }
}

export function getDataMode(): AppDataMode {
  return getServerConfig().APP_DATA_MODE;
}

export function isProduction(): boolean {
  return getServerConfig().APP_ENV === 'production';
}

export function requireDatabaseUrl(): string {
  const databaseUrl = getServerConfig().DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL is not configured for the current environment.');
  }
  return databaseUrl;
}
