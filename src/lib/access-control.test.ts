import { describe, expect, it } from 'vitest';
import { can, isUserRole, permissionForPage } from './access-control';

describe('access control policy', () => {
  it('gives administrative permissions only to administrators', () => {
    expect(can('admin', 'admin:manage-users')).toBe(true);
    expect(can('ura_user', 'admin:manage-users')).toBe(false);
    expect(can('report_viewer', 'admin:read')).toBe(false);
    expect(can('auditor', 'admin:manage-data')).toBe(false);
  });

  it('keeps operational and reporting access separate', () => {
    expect(can('ura_user', 'operations:write')).toBe(true);
    expect(can('report_viewer', 'operations:read')).toBe(false);
    expect(can('report_viewer', 'reports:read')).toBe(true);
    expect(can('auditor', 'audit:read')).toBe(true);
  });

  it('rejects unrecognized roles', () => {
    expect(isUserRole('admin')).toBe(true);
    expect(isUserRole('super-admin')).toBe(false);
    expect(isUserRole({ role: 'admin' })).toBe(false);
  });

  it('maps protected pages to an explicit permission', () => {
    expect(permissionForPage('/')).toBe('app:access');
    expect(permissionForPage('/admin')).toBe('admin:read');
    expect(permissionForPage('/reports/weekly')).toBe('reports:read');
    expect(permissionForPage('/audit')).toBe('audit:read');
    expect(permissionForPage('/provider-search')).toBe('operations:read');
    expect(permissionForPage('/notifications')).toBe('notifications:read');
    expect(permissionForPage('/work')).toBe('work:read');
    expect(permissionForPage('/changes')).toBe('changes:read');
    expect(permissionForPage('/coverage')).toBe('coverage:read');
    expect(permissionForPage('/automation')).toBe('automation:read');
    expect(permissionForPage('/sign-in')).toBeNull();
  });

  it('keeps automation settings and coverage rules admin-only', () => {
    expect(can('admin', 'automation:manage')).toBe(true);
    expect(can('admin', 'coverage:manage')).toBe(true);
    expect(can('ura_user', 'automation:manage')).toBe(false);
    expect(can('report_viewer', 'coverage:manage')).toBe(false);
  });
});
