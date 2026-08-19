import { z } from 'zod';
import { getDatabaseHealth, getDatabaseClient } from './database';
import { getDemoAdminOverview, getDemoCallLog, getDemoDashboard, getDemoFacilities, getDemoProviderResults, getDemoReports, getDemoReviewQueue } from './demo-data';
import { getDataMode, getServerConfig } from './config';

const searchInputSchema = z.object({
  memberZip: z.string().trim().regex(/^\d{5}$/).default('04530'),
  radius: z.coerce.number().positive().max(500).default(50),
  diagnosis: z.string().optional(),
  specialty: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(10),
  sort: z.enum(['distance', 'facility_name', 'last_call_date']).default('distance'),
});

type DataMode = 'database' | 'demo';
type DataState<T> = {
  ok: boolean;
  dataMode: DataMode;
  databaseAvailable: boolean;
  message?: string;
  data?: T;
};

export type DashboardPageState = DataState<ReturnType<typeof getDemoDashboard>>;

export interface AppDataAdapter {
  getDashboard(): Promise<DashboardPageState>;
  getProviderSearch(input: z.input<typeof searchInputSchema>): Promise<DataState<ReturnType<typeof getDemoProviderResults>>>;
  getCallLog(input?: Record<string, string | number>): Promise<DataState<ReturnType<typeof getDemoCallLog>>>;
  getFacilities(): Promise<DataState<ReturnType<typeof getDemoFacilities>>>;
  getReviewQueue(): Promise<DataState<ReturnType<typeof getDemoReviewQueue>>>;
  getReports(): Promise<DataState<ReturnType<typeof getDemoReports>>>;
  getAdminOverview(): Promise<DataState<ReturnType<typeof getDemoAdminOverview>>>;
  getDatabaseHealth(): Promise<{ ok: boolean; message: string; details?: string }>;
}

class DemoDataAdapter implements AppDataAdapter {
  async getDashboard(): Promise<DashboardPageState> {
    return { ok: true, dataMode: 'demo', databaseAvailable: false, data: getDemoDashboard() };
  }

  async getProviderSearch(input: z.input<typeof searchInputSchema>): Promise<DataState<ReturnType<typeof getDemoProviderResults>>> {
    const parsed = searchInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, dataMode: 'demo', databaseAvailable: false, message: parsed.error.issues[0]?.message ?? 'Invalid search parameters.' };
    }
    return { ok: true, dataMode: 'demo', databaseAvailable: false, data: getDemoProviderResults().slice(0, parsed.data.pageSize) };
  }

  async getCallLog(): Promise<DataState<ReturnType<typeof getDemoCallLog>>> {
    return { ok: true, dataMode: 'demo', databaseAvailable: false, data: getDemoCallLog() };
  }

  async getFacilities(): Promise<DataState<ReturnType<typeof getDemoFacilities>>> {
    return { ok: true, dataMode: 'demo', databaseAvailable: false, data: getDemoFacilities() };
  }

  async getReviewQueue(): Promise<DataState<ReturnType<typeof getDemoReviewQueue>>> {
    return { ok: true, dataMode: 'demo', databaseAvailable: false, data: getDemoReviewQueue() };
  }

  async getReports(): Promise<DataState<ReturnType<typeof getDemoReports>>> {
    return { ok: true, dataMode: 'demo', databaseAvailable: false, data: getDemoReports() };
  }

  async getAdminOverview(): Promise<DataState<ReturnType<typeof getDemoAdminOverview>>> {
    return { ok: true, dataMode: 'demo', databaseAvailable: false, data: getDemoAdminOverview() };
  }

  async getDatabaseHealth(): Promise<{ ok: boolean; message: string; details?: string }> {
    return { ok: false, message: 'Demo mode is active; database access is intentionally disabled for local demo work.' };
  }
}

class DatabaseDataAdapter implements AppDataAdapter {
  private emptyDashboard() {
    return {
      cards: [],
      recentAuthorizations: [],
      providerPreview: [],
      reviewPreview: [],
    };
  }

  private emptyProviderResults() {
    return [];
  }

  async getDashboard(): Promise<DashboardPageState> {
    const health = await getDatabaseHealth();
    if (!health.ok) {
      return { ok: false, dataMode: 'database', databaseAvailable: false, message: health.message, data: this.emptyDashboard() };
    }

    const db = getDatabaseClient();
    if (!db) {
      return { ok: false, dataMode: 'database', databaseAvailable: false, message: 'Database configuration is missing.', data: this.emptyDashboard() };
    }

    try {
      await db.execute(`SELECT 1 as ok`);
      return { ok: true, dataMode: 'database', databaseAvailable: true, data: this.emptyDashboard() };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The database could not be queried.';
      return { ok: false, dataMode: 'database', databaseAvailable: false, message, data: this.emptyDashboard() };
    }
  }

  async getProviderSearch(input: z.input<typeof searchInputSchema>): Promise<DataState<ReturnType<typeof getDemoProviderResults>>> {
    const parsed = searchInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, dataMode: 'database', databaseAvailable: false, message: parsed.error.issues[0]?.message ?? 'Request validation failed.', data: this.emptyProviderResults() };
    }

    const health = await getDatabaseHealth();
    if (!health.ok) {
      return { ok: false, dataMode: 'database', databaseAvailable: false, message: health.message, data: this.emptyProviderResults() };
    }

    const db = getDatabaseClient();
    if (!db) {
      return { ok: false, dataMode: 'database', databaseAvailable: false, message: 'Database configuration is missing.', data: this.emptyProviderResults() };
    }

    try {
      await db.execute(`SELECT 1 as ok`);
      return { ok: true, dataMode: 'database', databaseAvailable: true, data: this.emptyProviderResults().slice(0, parsed.data.pageSize) };
    } catch (error) {
      return {
        ok: false,
        dataMode: 'database',
        databaseAvailable: false,
        message: error instanceof Error ? error.message : 'The provider search query failed.',
        data: this.emptyProviderResults(),
      };
    }
  }

  async getCallLog(): Promise<DataState<ReturnType<typeof getDemoCallLog>>> {
    const health = await getDatabaseHealth();
    if (!health.ok) {
      return { ok: false, dataMode: 'database', databaseAvailable: false, message: health.message, data: [] };
    }

    const db = getDatabaseClient();
    if (!db) {
      return { ok: false, dataMode: 'database', databaseAvailable: false, message: 'Database configuration is missing.', data: [] };
    }

    try {
      await db.execute(`SELECT 1 as ok`);
      return { ok: true, dataMode: 'database', databaseAvailable: true, data: [] };
    } catch (error) {
      return {
        ok: false,
        dataMode: 'database',
        databaseAvailable: false,
        message: error instanceof Error ? error.message : 'The call log query failed.',
        data: [],
      };
    }
  }

  async getFacilities(): Promise<DataState<ReturnType<typeof getDemoFacilities>>> {
    const health = await getDatabaseHealth();
    if (!health.ok) {
      return { ok: false, dataMode: 'database', databaseAvailable: false, message: health.message, data: [] };
    }

    const db = getDatabaseClient();
    if (!db) {
      return { ok: false, dataMode: 'database', databaseAvailable: false, message: 'Database configuration is missing.', data: [] };
    }

    try {
      await db.execute(`SELECT 1 as ok`);
      return { ok: true, dataMode: 'database', databaseAvailable: true, data: [] };
    } catch (error) {
      return {
        ok: false,
        dataMode: 'database',
        databaseAvailable: false,
        message: error instanceof Error ? error.message : 'The facilities query failed.',
        data: [],
      };
    }
  }

  async getReviewQueue(): Promise<DataState<ReturnType<typeof getDemoReviewQueue>>> {
    const health = await getDatabaseHealth();
    if (!health.ok) {
      return { ok: false, dataMode: 'database', databaseAvailable: false, message: health.message, data: [] };
    }

    const db = getDatabaseClient();
    if (!db) {
      return { ok: false, dataMode: 'database', databaseAvailable: false, message: 'Database configuration is missing.', data: [] };
    }

    try {
      await db.execute(`SELECT 1 as ok`);
      return { ok: true, dataMode: 'database', databaseAvailable: true, data: [] };
    } catch (error) {
      return {
        ok: false,
        dataMode: 'database',
        databaseAvailable: false,
        message: error instanceof Error ? error.message : 'The review queue query failed.',
        data: [],
      };
    }
  }

  async getReports(): Promise<DataState<ReturnType<typeof getDemoReports>>> {
    const health = await getDatabaseHealth();
    if (!health.ok) {
      return { ok: false, dataMode: 'database', databaseAvailable: false, message: health.message, data: { metrics: [], generatedAt: new Date().toISOString() } };
    }

    const db = getDatabaseClient();
    if (!db) {
      return { ok: false, dataMode: 'database', databaseAvailable: false, message: 'Database configuration is missing.', data: { metrics: [], generatedAt: new Date().toISOString() } };
    }

    try {
      await db.execute(`SELECT 1 as ok`);
      return { ok: true, dataMode: 'database', databaseAvailable: true, data: { metrics: [], generatedAt: new Date().toISOString() } };
    } catch (error) {
      return {
        ok: false,
        dataMode: 'database',
        databaseAvailable: false,
        message: error instanceof Error ? error.message : 'The reports query failed.',
        data: { metrics: [], generatedAt: new Date().toISOString() },
      };
    }
  }

  async getAdminOverview(): Promise<DataState<ReturnType<typeof getDemoAdminOverview>>> {
    const health = await getDatabaseHealth();
    if (!health.ok) {
      return { ok: false, dataMode: 'database', databaseAvailable: false, message: health.message, data: { tasks: [], importBatches: [] } };
    }

    const db = getDatabaseClient();
    if (!db) {
      return { ok: false, dataMode: 'database', databaseAvailable: false, message: 'Database configuration is missing.', data: { tasks: [], importBatches: [] } };
    }

    try {
      await db.execute(`SELECT 1 as ok`);
      return { ok: true, dataMode: 'database', databaseAvailable: true, data: { tasks: [], importBatches: [] } };
    } catch (error) {
      return {
        ok: false,
        dataMode: 'database',
        databaseAvailable: false,
        message: error instanceof Error ? error.message : 'The admin overview query failed.',
        data: { tasks: [], importBatches: [] },
      };
    }
  }

  async getDatabaseHealth() {
    return getDatabaseHealth();
  }
}

export function getAppDataAdapter(): AppDataAdapter {
  const config = getServerConfig();
  if (config.APP_DATA_MODE === 'demo') {
    if (config.APP_ENV === 'production') {
      throw new Error('Demo data mode is disabled in production.');
    }
    return new DemoDataAdapter();
  }

  return new DatabaseDataAdapter();
}

export function getResolvedDataMode(): DataMode {
  return getDataMode();
}
