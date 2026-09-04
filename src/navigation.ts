import type { ComponentType } from 'react';
import type { LucideProps } from 'lucide-react';
import {
  Archive,
  Box,
  CheckSquare,
  ClipboardCheck,
  Database,
  History,
  Laptop,
  LayoutDashboard,
  PackageSearch,
  TrendingDown,
  UserCog,
  Users,
  Wrench
} from 'lucide-react';

export type PageId =
  | 'dashboard'
  | 'assets'
  | 'facility-assets'
  | 'asset-assignment'
  | 'asset-borrow-return'
  | 'asset-maintenance'
  | 'annual-inventory'
  | 'asset-depreciation'
  | 'asset-disposal'
  | 'approval-workflow'
  | 'audit-log'
  | 'employees'
  | 'users'
  | 'master-data';

type NavIcon = ComponentType<LucideProps>;
export type NavItem = readonly [PageId, string, NavIcon];
export type NavGroup = { label: string; items: readonly NavItem[] };

export const navGroups: readonly NavGroup[] = [
  { label: 'ภาพรวม', items: [['dashboard', 'แดชบอร์ดผู้บริหาร', LayoutDashboard]] },
  {
    label: 'ทรัพย์สิน (Asset)',
    items: [
      ['assets', 'ทะเบียนทรัพย์สิน', Laptop],
      ['facility-assets', 'ทรัพย์สินส่วนกลาง', Box],
      ['asset-assignment', 'ผู้ครอบครองปัจจุบัน', UserCog],
      ['asset-borrow-return', 'ยืม-คืนอุปกรณ์ IT', PackageSearch],
      ['asset-maintenance', 'แจ้งซ่อม IT / GA', Wrench],
      ['annual-inventory', 'ตรวจนับประจำปี', ClipboardCheck],
      ['asset-depreciation', 'ค่าเสื่อมราคา', TrendingDown],
      ['asset-disposal', 'ตัดจำหน่ายทรัพย์สิน', Archive]
    ]
  },
  {
    label: 'งานระบบ',
    items: [
      ['approval-workflow', 'Approval Workflow', CheckSquare],
      ['audit-log', 'Audit Log', History]
    ]
  },
  {
    label: 'บุคคล',
    items: [
      ['employees', 'ข้อมูลพนักงาน', Users],
      ['users', 'ผู้ใช้งานระบบ', UserCog]
    ]
  },
  { label: 'ข้อมูลหลัก (Master Data)', items: [['master-data', 'จัดการ Master Data ทั้งหมด', Database]] }
];
