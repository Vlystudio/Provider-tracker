import { z } from 'zod';
import { getDatabaseHealth, getDatabaseClient } from './database';
import { getDemoCallLog, getDemoDashboard, getDemoFacilities, getDemoProviderResults, getDemoReports, getDemoReviewQueue } from './demo-data';
import { getDataMode, getServerConfig } from './config';
import { assertPermission, type Principal } from './authorization';
import { listCallLog, type CallLogRow } from './call-service';
import { providerSearchInputSchema, searchProviders, type ProviderSearchPage } from './provider-search-service';
import { facilityDirectoryInputSchema, listFacilities, type FacilityDirectoryPage } from './facility-directory-service';
import { getOperationalReport, reportingInputSchema, type OperationalReport } from './provider-reporting-service';

export type ReportRange = z.input<typeof reportingInputSchema>;

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
  getProviderSearch(principal: Principal, input: z.input<typeof providerSearchInputSchema>): Promise<DataState<ProviderSearchPage>>;
  getCallLog(principal: Principal, input?: Record<string, string | number>): Promise<DataState<CallLogRow[]>>;
  getFacilities(principal: Principal, input?: z.input<typeof facilityDirectoryInputSchema>): Promise<DataState<FacilityDirectoryPage>>;
  getReviewQueue(principal: Principal): Promise<DataState<ReturnType<typeof getDemoReviewQueue>>>;
  getReports(principal: Principal, input: ReportRange): Promise<DataState<OperationalReport>>;
  getDatabaseHealth(principal: Principal): Promise<{ ok: boolean; message: string }>;
}

class DemoDataAdapter implements AppDataAdapter {
  async getDashboard(principal: Principal): Promise<DashboardPageState> {
    assertPermission(principal, 'app:access');
    return { ok: true, dataMode: 'demo', databaseAvailable: false, data: getDemoDashboard() };
  }

  async getProviderSearch(principal: Principal, input: z.input<typeof providerSearchInputSchema>): Promise<DataState<ProviderSearchPage>> {
    assertPermission(principal, 'operations:read');
    const parsed = providerSearchInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, dataMode: 'demo', databaseAvailable: false, message: parsed.error.issues[0]?.message ?? 'Invalid search parameters.' };
    }
    const querySpecialty = parsed.data.specialty?.trim().toLowerCase();
    const queryDiagnosis = parsed.data.diagnosis?.trim().toUpperCase();
    let results = getDemoProviderResults().filter((result) =>
      result.distanceMiles <= parsed.data.radius
      && parsed.data.memberZip === '04530'
      && (!querySpecialty || result.specialties.toLowerCase().includes(querySpecialty))
      && (!queryDiagnosis || (queryDiagnosis === 'J45' && result.diagnosisMatch))
      && (!parsed.data.accepting || result.acceptingStatus === parsed.data.accepting)
      && (!parsed.data.scheduling || result.schedulingStatus === parsed.data.scheduling)
      && (!parsed.data.urgentReferral || result.urgentReferralStatus === parsed.data.urgentReferral)
      && (!parsed.data.freshness || result.freshness === parsed.data.freshness)
      && (!parsed.data.facilityName || result.facilityName.toLowerCase().includes(parsed.data.facilityName.toLowerCase())),
    );
    results = [...results].sort((left, right) => {
      if (parsed.data.sort === 'name') return left.facilityName.localeCompare(right.facilityName);
      if (parsed.data.sort === 'recently_verified') return String(right.lastVerifiedAt).localeCompare(String(left.lastVerifiedAt));
      if (parsed.data.sort === 'soonest_availability') return (left.estimatedWaitDays ?? 9999) - (right.estimatedWaitDays ?? 9999);
      if (parsed.data.sort === 'recommended') return right.rankScore - left.rankScore || left.distanceMiles - right.distanceMiles;
      return left.distanceMiles - right.distanceMiles;
    });
    const offset = (parsed.data.page - 1) * parsed.data.pageSize;
    return {
      ok: true,
      dataMode: 'demo',
      databaseAvailable: false,
      data: {
        rows: results.slice(offset, offset + parsed.data.pageSize),
        total: results.length,
        page: parsed.data.page,
        pageSize: parsed.data.pageSize,
        originFound: parsed.data.memberZip === '04530',
        excludedForMissingCoordinates: 0,
      },
    };
  }

  async getCallLog(principal: Principal): Promise<DataState<CallLogRow[]>> {
    assertPermission(principal, 'operations:read');
    return {
      ok: true,
      dataMode: 'demo',
      databaseAvailable: false,
      data: getDemoCallLog().map((row, index) => ({
        ...row,
        id: `demo-call-${index + 1}`,
        calledAt: `${row.date}T14:00:00.000Z`,
        caller: 'Demo user',
        status: row.status === 'Retry due' ? ('Follow-up' as const) : ('Complete' as const),
      })),
    };
  }

  async getFacilities(principal: Principal, input: z.input<typeof facilityDirectoryInputSchema> = {}): Promise<DataState<FacilityDirectoryPage>> {
    assertPermission(principal, 'operations:read');
    const parsed = facilityDirectoryInputSchema.safeParse(input);
    if (!parsed.success) return { ok: false, dataMode: 'demo', databaseAvailable: false, message: parsed.error.issues[0]?.message };
    let rows = getDemoFacilities().filter((row) =>
      (!parsed.data.query || `${row.facilityName} ${row.city} ${row.facilityType} ${row.specialties}`.toLowerCase().includes(parsed.data.query.toLowerCase()))
      && (!parsed.data.status || row.recordStatus.toLowerCase().replace(' ', '_') === parsed.data.status)
      && (!parsed.data.freshness || row.freshness === parsed.data.freshness),
    );
    rows = [...rows].sort((left, right) => parsed.data.sort === 'city'
      ? left.city.localeCompare(right.city)
      : parsed.data.sort === 'last_verified'
        ? String(right.lastVerifiedAt).localeCompare(String(left.lastVerifiedAt))
        : left.facilityName.localeCompare(right.facilityName));
    const offset = (parsed.data.page - 1) * parsed.data.pageSize;
    return { ok: true, dataMode: 'demo', databaseAvailable: false, data: { rows: rows.slice(offset, offset + parsed.data.pageSize), total: rows.length, page: parsed.data.page, pageSize: parsed.data.pageSize } };
  }

  async getReviewQueue(principal: Principal): Promise<DataState<ReturnType<typeof getDemoReviewQueue>>> {
    assertPermission(principal, 'operations:read');
    return { ok: true, dataMode: 'demo', databaseAvailable: false, data: getDemoReviewQueue() };
  }

  async getReports(principal: Principal, input: ReportRange): Promise<DataState<OperationalReport>> {
    assertPermission(principal, 'reports:read');
    const parsed = reportingInputSchema.safeParse(input);
    if (!parsed.success) {
      return { ok: false, dataMode: 'demo', databaseAvailable: false, message: parsed.error.issues[0]?.message ?? 'Invalid report range.', data: { ...getDemoReports(), trend: [], coverage: [], drilldown: [] } };
    }
    const demo = getDemoReports(parsed.data.from, parsed.data.to, parsed.data.drilldown);
    return { ok: true, dataMode: 'demo', databaseAvailable: false, data: demo };
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
    };
  }

  private emptyProviderResults(input: { page?: number; pageSize?: number } = {}): ProviderSearchPage {
    return { rows: [], total: 0, page: input.page ?? 1, pageSize: input.pageSize ?? 25, originFound: true, excludedForMissingCoordinates: 0 };
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

  async getProviderSearch(principal: Principal, input: z.input<typeof providerSearchInputSchema>): Promise<DataState<ProviderSearchPage>> {
    assertPermission(principal, 'operations:read');
    const parsed = providerSearchInputSchema.safeParse(input);
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
      const page = await searchProviders(principal, parsed.data);
      return { ok: true, dataMode: 'database', databaseAvailable: true, data: page };
    } catch {
      return {
        ok: false,
        dataMode: 'database',
        databaseAvailable: false,
        message: 'The provider search could not be completed.',
        data: this.emptyProviderResults(parsed.data),
      };
    }
  }

  async getCallLog(principal: Principal): Promise<DataState<CallLogRow[]>> {
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
      return { ok: true, dataMode: 'database', databaseAvailable: true, data: await listCallLog(principal) };
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

  async getFacilities(principal: Principal, input: z.input<typeof facilityDirectoryInputSchema> = {}): Promise<DataState<FacilityDirectoryPage>> {
    assertPermission(principal, 'operations:read');
    const health = await getDatabaseHealth();
    if (!health.ok) {
      return { ok: false, dataMode: 'database', databaseAvailable: false, message: health.message, data: { rows: [], total: 0, page: 1, pageSize: 25 } };
    }

    const db = getDatabaseClient();
    if (!db) {
      return { ok: false, dataMode: 'database', databaseAvailable: false, message: 'Database configuration is missing.', data: { rows: [], total: 0, page: 1, pageSize: 25 } };
    }

    try {
      return { ok: true, dataMode: 'database', databaseAvailable: true, data: await listFacilities(principal, input) };
    } catch {
      return {
        ok: false,
        dataMode: 'database',
        databaseAvailable: false,
        message: 'The facilities list could not be loaded.',
        data: { rows: [], total: 0, page: 1, pageSize: 25 },
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

  async getReports(principal: Principal, input: ReportRange): Promise<DataState<OperationalReport>> {
    assertPermission(principal, 'reports:read');
    const parsed = reportingInputSchema.safeParse(input);
    if (!parsed.success) {
      return {
        ok: false,
        dataMode: 'database',
        databaseAvailable: false,
        message: parsed.error.issues[0]?.message ?? 'Invalid report range.',
        data: { metrics: [], generatedAt: new Date().toISOString(), period: { from: input.from, to: input.to }, total: 0, trend: [], coverage: [], drilldown: [] },
      };
    }
    const health = await getDatabaseHealth();
    if (!health.ok) {
      return { ok: false, dataMode: 'database', databaseAvailable: false, message: health.message, data: { metrics: [], generatedAt: new Date().toISOString(), period: parsed.data, total: 0, trend: [], coverage: [], drilldown: [] } };
    }

    const db = getDatabaseClient();
    if (!db) {
      return { ok: false, dataMode: 'database', databaseAvailable: false, message: 'Database configuration is missing.', data: { metrics: [], generatedAt: new Date().toISOString(), period: parsed.data, total: 0, trend: [], coverage: [], drilldown: [] } };
    }

    try {
      return { ok: true, dataMode: 'database', databaseAvailable: true, data: await getOperationalReport(principal, parsed.data) };
    } catch {
      return {
        ok: false,
        dataMode: 'database',
        databaseAvailable: false,
        message: 'The reports could not be loaded.',
        data: { metrics: [], generatedAt: new Date().toISOString(), period: parsed.data, total: 0, trend: [], coverage: [], drilldown: [] },
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
