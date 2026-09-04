import type { PageId } from './navigation';

export const USER_ROLES = [
  'ADMIN',
  'SUPERVISOR',
  'HR',
  'ACCOUNTING',
  'VIEW'
] as const;

export type UserRole = typeof USER_ROLES[number];

export const ROLE_LABELS: Record<UserRole, string> = {
  ADMIN: 'ADMIN',
  SUPERVISOR: 'SUPERVISOR',
  HR: 'HR',
  ACCOUNTING: 'ACCOUNTING',
  VIEW: 'VIEW'
};

export const ROLE_PAGES: Record<UserRole, PageId[] | null> = {
  ADMIN: null,
  SUPERVISOR: [
    'dashboard', 'assets', 'facility-assets',
    'asset-assignment', 'asset-borrow-return',
    'asset-maintenance', 'annual-inventory', 'asset-depreciation', 'asset-disposal',
    'approval-workflow', 'audit-log', 'master-data'
  ],
  HR: [
    'dashboard', 'assets',
    'asset-assignment', 'annual-inventory',
    'employees'
  ],
  ACCOUNTING: [
    'dashboard', 'assets', 'asset-depreciation', 'asset-disposal'
  ],
  VIEW: ['dashboard', 'assets']
};

export function isUserRole(value: string): value is UserRole {
  return (USER_ROLES as readonly string[]).includes(value);
}

export function roleLabel(value: string): string {
  return isUserRole(value) ? ROLE_LABELS[value] : value;
}
