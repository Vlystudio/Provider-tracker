import { z } from 'zod';
import { getDatabaseHealth, getDatabaseClient } from './database';
import { getDemoAdminOverview, getDemoCallLog, getDemoDashboard, getDemoFacilities, getDemoProviderResults, getDemoReports, getDemoReviewQueue } from './demo-data';
import { getDataMode, getServerConfig } from './config';
import { assertPermission, type Principal } from './authorization';

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
  getDashboard(principal: Principal): Promise<DashboardPageState>;
  getProviderSearch(principal: Principal, input: z.input<typeof searchInputSchema>): Promise<DataState<ReturnType<typeof getDemoProviderResults>>>;
  getCallLog(principal: Principal, input?: Record<string, string | number>): Promise<DataState<ReturnType<typeof getDemoCallLog>>>;
  getFacilities(principal: Principal): Promise<DataState<ReturnType<typeof getDemoFacilities>>>;
  getReviewQueue(principal: Principal): Promise<DataState<ReturnType<typeof getDemoReviewQueue>>>;
  getReports(principal: Principal): Promise<DataState<ReturnType<typeof getDemoReports>>>;
  getAdminOverview(principal: Principal): Promise<DataState<ReturnType<typeof getDemoAdminOverview>>>;
  getDatabaseHealth(principal: Principal): Promise<{ ok: boolean; message: string }>;
}

class DemoDataAdapter implements AppDataAdapter {
  async getDashboard(principal: Principal): Promise<DashboardPageState> {
    assertPermission(principal, 'app:access');
    return { ok: true, dataMode: 'demo', databaseAvailable: false, data: getDemoDashboard() };
  }

  async getProviderSearch(principal: Principal, input: z.input<typeof searchInputSchema>): Promise<DataState<ReturnType<typeof getDemoProviderResults>>> {
    assertPermission(principal, 'operations:read');
    const parsed = searchInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, dataMode: 'demo', databaseAvailable: false, message: parsed.error.issues[0]?.message ?? 'Invalid search parameters.' };
    }
    return { ok: true, dataMode: 'demo', databaseAvailable: false, data: getDemoProviderResults().slice(0, parsed.data.pageSize) };
  }

  async getCallLog(principal: Principal): Promise<DataState<ReturnType<typeof getDemoCallLog>>> {
    assertPermission(principal, 'operations:read');
    return { ok: true, dataMode: 'demo', databaseAvailable: false, data: getDemoCallLog() };
  }

  async getFacilities(principal: Principal): Promise<DataState<ReturnType<typeof getDemoFacilities>>> {
    assertPermission(principal, 'operations:read');
    return { ok: true, dataMode: 'demo', databaseAvailable: false, data: getDemoFacilities() };
  }

  async getReviewQueue(principal: Principal): Promise<DataState<ReturnType<typeof getDemoReviewQueue>>> {
    assertPermission(principal, 'operations:read');
    return { ok: true, dataMode: 'demo', databaseAvailable: false, data: getDemoReviewQueue() };
  }

  async getReports(principal: Principal): Promise<DataState<ReturnType<typeof getDemoReports>>> {
    assertPermission(principal, 'reports:read');
    return { ok: true, dataMode: 'demo', databaseAvailable: false, data: getDemoReports() };
  }

  async getAdminOverview(principal: Principal): Promise<DataState<ReturnType<typeof getDemoAdminOverview>>> {
    assertPermission(principal, 'admin:read');
    return { ok: true, dataMode: 'demo', databaseAvailable: false, data: getDemoAdminOverview() };
  }

  async getDatabaseHealth(principal: Principal): Promise<{ ok: boolean; message: string }> {
    assertPermission(principal, 'admin:read');
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

  async getDashboard(principal: Principal): Promise<DashboardPageState> {
    assertPermission(principal, 'app:access');
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
    } catch {
      return { ok: false, dataMode: 'database', databaseAvailable: false, message: 'The dashboard data could not be loaded.', data: this.emptyDashboard() };
    }
  }

  async getProviderSearch(principal: Principal, input: z.input<typeof searchInputSchema>): Promise<DataState<ReturnType<typeof getDemoProviderResults>>> {
    assertPermission(principal, 'operations:read');
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
    } catch {
      return {
        ok: false,
        dataMode: 'database',
        databaseAvailable: false,
        message: 'The provider search could not be completed.',
        data: this.emptyProviderResults(),
      };
    }
  }

  async getCallLog(principal: Principal): Promise<DataState<ReturnType<typeof getDemoCallLog>>> {
    assertPermission(principal, 'operations:read');
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
    } catch {
      return {
        ok: false,
        dataMode: 'database',
        databaseAvailable: false,
        message: 'The call log could not be loaded.',
        data: [],
      };
    }
  }

  async getFacilities(principal: Principal): Promise<DataState<ReturnType<typeof getDemoFacilities>>> {
    assertPermission(principal, 'operations:read');
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
    } catch {
      return {
        ok: false,
        dataMode: 'database',
        databaseAvailable: false,
        message: 'The facilities list could not be loaded.',
        data: [],
      };
    }
  }

  async getReviewQueue(principal: Principal): Promise<DataState<ReturnType<typeof getDemoReviewQueue>>> {
    assertPermission(principal, 'operations:read');
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
    } catch {
      return {
        ok: false,
        dataMode: 'database',
        databaseAvailable: false,
        message: 'The review queue could not be loaded.',
        data: [],
      };
    }
  }

  async getReports(principal: Principal): Promise<DataState<ReturnType<typeof getDemoReports>>> {
    assertPermission(principal, 'reports:read');
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
    } catch {
      return {
        ok: false,
        dataMode: 'database',
        databaseAvailable: false,
        message: 'The reports could not be loaded.',
        data: { metrics: [], generatedAt: new Date().toISOString() },
      };
    }
  }

  async getAdminOverview(principal: Principal): Promise<DataState<ReturnType<typeof getDemoAdminOverview>>> {
    assertPermission(principal, 'admin:read');
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
    } catch {
      return {
        ok: false,
        dataMode: 'database',
        databaseAvailable: false,
        message: 'The admin overview could not be loaded.',
        data: { tasks: [], importBatches: [] },
      };
    }
  }

  async getDatabaseHealth(principal: Principal) {
    assertPermission(principal, 'admin:read');
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
