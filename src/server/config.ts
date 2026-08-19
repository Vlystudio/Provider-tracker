import { z } from 'zod';

export const appDataModeSchema = z.enum(['database', 'demo']);
export const appEnvironmentSchema = z.enum(['development', 'test', 'production']);

export type AppDataMode = z.infer<typeof appDataModeSchema>;
export type AppEnvironment = z.infer<typeof appEnvironmentSchema>;

export type ServerConfig = {
  APP_ENV: AppEnvironment;
  APP_DATA_MODE: AppDataMode;
  DATABASE_URL?: string;
};

export function resolveServerConfig(overrides: Partial<ServerConfig> = {}): ServerConfig {
  const source = {
    APP_ENV: overrides.APP_ENV ?? process.env.APP_ENV ?? process.env.NODE_ENV ?? 'development',
    APP_DATA_MODE: overrides.APP_DATA_MODE ?? process.env.APP_DATA_MODE ?? 'database',
    DATABASE_URL: (overrides.DATABASE_URL ?? process.env.DATABASE_URL?.trim()) || undefined,
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
    })
    .safeParse(source);

  if (!parsed.success) {
    throw new Error(`Invalid server configuration: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`);
  }

  const config = parsed.data;

  if (config.APP_DATA_MODE === 'demo' && config.APP_ENV === 'production') {
    throw new Error('Demo data mode is disabled in production.');
  }

  return config;
}

export function getServerConfig(): ServerConfig {
  return resolveServerConfig();
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
