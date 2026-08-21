export const userRoles = ['admin', 'ura_user', 'report_viewer', 'auditor'] as const;
export type UserRole = (typeof userRoles)[number];

export const permissions = [
  'app:access',
  'operations:read',
  'operations:write',
  'reports:read',
  'notifications:read',
  'work:read',
  'work:write',
  'changes:read',
  'coverage:read',
  'coverage:manage',
  'automation:read',
  'automation:manage',
  'migration:read',
  'migration:preview',
  'migration:apply',
  'migration:review',
  'migration:export',
  'migration:reverse',
  'admin:read',
  'admin:manage-users',
  'admin:manage-data',
  'audit:read',
] as const;
export type Permission = (typeof permissions)[number];

const rolePermissions: Record<UserRole, ReadonlySet<Permission>> = {
  admin: new Set(permissions),
  ura_user: new Set(['app:access', 'operations:read', 'operations:write', 'reports:read', 'notifications:read', 'work:read', 'work:write', 'changes:read', 'coverage:read']),
  report_viewer: new Set(['app:access', 'reports:read', 'notifications:read', 'changes:read', 'coverage:read']),
  auditor: new Set(['app:access', 'reports:read', 'audit:read', 'notifications:read']),
};

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && userRoles.includes(value as UserRole);
}

export function can(role: UserRole, permission: Permission): boolean {
  return rolePermissions[role].has(permission);
}

export function permissionForPage(pathname: string): Permission | null {
  if (pathname === '/') return 'app:access';
  if (pathname.startsWith('/admin')) return 'admin:read';
  if (pathname.startsWith('/automation')) return 'automation:read';
  if (pathname.startsWith('/migration')) return 'migration:read';
  if (pathname.startsWith('/notifications')) return 'notifications:read';
  if (pathname.startsWith('/work')) return 'work:read';
  if (pathname.startsWith('/changes')) return 'changes:read';
  if (pathname.startsWith('/coverage')) return 'coverage:read';
  if (pathname.startsWith('/data-quality') || pathname.startsWith('/duplicates')) return 'admin:read';
  if (pathname.startsWith('/audit')) return 'audit:read';
  if (pathname.startsWith('/reports')) return 'reports:read';
  if (pathname.startsWith('/new-call')) return 'operations:write';
  if (
    pathname.startsWith('/call-log') ||
    pathname.startsWith('/provider-search') ||
    pathname.startsWith('/authorization-summary') ||
    pathname.startsWith('/review-queue') ||
    pathname.startsWith('/facilities')
  ) {
    return 'operations:read';
  }
  return null;
}
