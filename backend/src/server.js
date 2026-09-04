import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import mysql from 'mysql2/promise';

const port = Number(process.env.PORT || 4000);

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'mysql',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || 'it_asset_db',
  user: process.env.DB_USER || 'it_asset_user',
  password: process.env.DB_PASSWORD || 'it_asset_password',
  waitForConnections: true,
  connectionLimit: 10,
  namedPlaceholders: false,
  charset: 'utf8mb4'
});

const defaultCompany = text(process.env.INITIAL_COMPANY_CODE || 'COMPANY').toUpperCase();
const defaultCompanySql = defaultCompany.replace(/'/g, "''");
const defaultPassword = process.env.DEFAULT_LOGIN_PASSWORD || 'admin123';
const maxAssetImageBytes = 5 * 1024 * 1024;
const allowedAssetImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
const maxPurchaseDocumentBytes = 5 * 1024 * 1024;
const maxPurchaseDocumentCount = 10;
const allowedPurchaseDocumentTypes = new Set(['application/pdf', 'image/jpeg', 'image/png']);


const sessionTtlHours = Math.max(1, Number(process.env.SESSION_TTL_HOURS || 12));
const loginAttemptWindowMs = 15 * 60 * 1000;
const maxLoginAttempts = 5;
const loginAttempts = new Map();

function loginAttemptKey(req, login) {
  return `${text(req.ip || req.socket?.remoteAddress)}:${text(login).toLowerCase()}`;
}

function loginBlockRemaining(key) {
  const entry = loginAttempts.get(key);
  if (!entry) return 0;
  if (entry.resetAt <= Date.now()) {
    loginAttempts.delete(key);
    return 0;
  }
  return entry.count >= maxLoginAttempts ? entry.resetAt - Date.now() : 0;
}

function recordLoginFailure(key) {
  const current = loginAttempts.get(key);
  const entry = !current || current.resetAt <= Date.now()
    ? { count: 1, resetAt: Date.now() + loginAttemptWindowMs }
    : { ...current, count: current.count + 1 };
  loginAttempts.set(key, entry);
  return entry.count;
}
const validRoles = new Set([
  'ADMIN',
  'SUPERVISOR',
  'HR',
  'ACCOUNTING',
  'VIEW'
]);

const rolePermissions = {
  ADMIN: ['*'],
  SUPERVISOR: [
    'dashboard.read', 'assets.read', 'assets.financial', 'assets.write', 'assets.assign',
    'assignment.request', 'assignment.manage', 'assignment.acknowledge',
    'workflow.request', 'workflow.approve',
    'maintenance.request', 'maintenance.write',
    'reports.read', 'master.read', 'master.manage'
  ],
  HR: [
    'dashboard.read', 'assets.read', 'assets.assign',
    'assignment.request', 'assignment.manage', 'assignment.acknowledge',
    'workflow.request', 'reports.read'
  ],
  ACCOUNTING: [
    'dashboard.read', 'assets.read', 'assets.financial', 'reports.read'
  ],
  VIEW: ['dashboard.read', 'assets.read']
};

function permissionsForRole(role) {
  return rolePermissions[role] || rolePermissions.VIEW;
}

function hasPermission(user, permission) {
  const permissions = user?.permissions || permissionsForRole(user?.role);
  return permissions.includes('*') || permissions.includes(permission);
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const digest = scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${digest}`;
}

function verifyPassword(password, stored) {
  const [scheme, salt, digest] = String(stored || '').split('$');
  if (scheme !== 'scrypt' || !salt || !digest) return false;
  const expected = Buffer.from(digest, 'hex');
  const actual = scryptSync(String(password), salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function tokenHash(token) {
  return createHash('sha256').update(String(token)).digest('hex');
}

function isSuperAdmin(user) {
  return user?.role === 'ADMIN';
}

function isDataAdmin(user) {
  return ['ADMIN', 'SUPERVISOR'].includes(user?.role);
}

function assertDataAdmin(user) {
  if (!isDataAdmin(user)) throw httpError(403, 'เฉพาะ Admin หรือ Supervisor เท่านั้นที่แก้ไขหรือลบข้อมูลย้อนหลังได้');
}


function assertSuperAdmin(user, message = 'เฉพาะ Admin เท่านั้นที่ลบข้อมูลย้อนหลังได้') {
  if (!isSuperAdmin(user)) throw httpError(403, message);
}

function assertAnyRole(user, roles, message = 'ไม่มีสิทธิ์ดำเนินการนี้') {
  if (!roles.includes(user?.role)) throw httpError(403, message);
}

const operationalDepartments = new Set(['IT', 'GA', 'HR']);

function departmentCodeFromText(value) {
  const raw = text(value).trim();
  const upper = raw.toUpperCase();
  if (operationalDepartments.has(upper)) return upper;
  const normalized = raw.toLowerCase();
  if (/(^|[^a-z])it([^a-z]|$)|information\s*technology|help\s*desk|technical\s*support|tech\s*support|ไอที|สารสนเทศ/.test(normalized)) return 'IT';
  if (/(^|[^a-z])ga([^a-z]|$)|general\s*affairs?|facilit(?:y|ies)|administration|ธุรการ|อาคาร|สถานที่|บริหารทั่วไป/.test(normalized)) return 'GA';
  if (/(^|[^a-z])hr([^a-z]|$)|human\s*resources?|people\s*operations?|บุคคล|ทรัพยากรบุคคล/.test(normalized)) return 'HR';
  return '';
}

function normalizeOperationalDepartment(value, fallback = '') {
  const code = departmentCodeFromText(value) || departmentCodeFromText(fallback);
  if (!code) throw httpError(400, 'หน่วยงานผู้ดูแลต้องเป็น IT, GA หรือ HR');
  return code;
}

function normalizeFacilityAssetType(value, fallback = 'ASSET') {
  const normalized = text(value, fallback).trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (['ASSET', 'FREE_ASSET', 'NON_ASSET'].includes(normalized)) return normalized;
  throw httpError(400, 'ประเภทต้องเป็น Asset, Free Asset หรือ Non-Asset');
}

function userOperationalDepartment(user) {
  if (user?.role === 'HR') return 'HR';
  return departmentCodeFromText(`${user?.department || ''} ${user?.position || ''}`);
}

function assertWorkflowDepartment(user, department, message) {
  if (isSuperAdmin(user)) return;
  const expected = normalizeOperationalDepartment(department);
  if (userOperationalDepartment(user) === expected) return;
  throw httpError(403, message || `รายการนี้ดำเนินการโดยหน่วยงาน ${expected}`);
}

function assertCompanyAccess(user, company) {
  const normalized = normalizeCompany(company);
  if (!isSuperAdmin(user) && normalized !== normalizeCompany(user.company)) {
    throw httpError(403, 'ไม่มีสิทธิ์เข้าถึงข้อมูลของบริษัทนี้');
  }
  return normalized;
}

function scopedCompany(user, requestedCompany = '') {
  return isSuperAdmin(user)
    ? normalizeCompany(requestedCompany || user.company || defaultCompany)
    : normalizeCompany(user.company);
}

const roleNames = {
  ADMIN: 'ADMIN',
  SUPERVISOR: 'SUPERVISOR',
  HR: 'HR',
  ACCOUNTING: 'ACCOUNTING',
  VIEW: 'VIEW'
};

const companyAdminMasterWriteTypes = new Set(['site', 'building', 'floor', 'zone', 'room', 'warehouse']);

// ข้อมูลมาตรฐานที่ต้องใช้ชุดเดียวกันทุกบริษัท
const sharedMasterTypes = new Set([
  'brand',
  'asset-category',
  'asset-subcategory',
  'asset-status',
  'asset-condition',
  'criticality',
  'ownership-type',
  'manufacturer',
  'unit'
]);

// Vendor เลือกได้ว่าจะเป็นข้อมูลกลางหรือเฉพาะบริษัท
const flexibleScopeMasterTypes = new Set(['vendor']);
const globalMasterSentinels = new Set(['', '__ALL_COMPANIES__', '__GLOBAL__', 'GLOBAL', 'ALL']);

function resolveMasterCompanyCode(user, masterType, requestedCompanyCode = '', currentCompanyCode = '') {
  if (sharedMasterTypes.has(masterType)) return '';

  const requested = text(requestedCompanyCode, currentCompanyCode);
  if (
    isSuperAdmin(user)
    && flexibleScopeMasterTypes.has(masterType)
    && globalMasterSentinels.has(requested.toUpperCase())
  ) {
    return '';
  }

  return isSuperAdmin(user)
    ? normalizeCompany(requested || user.company || defaultCompany)
    : normalizeCompany(user.company);
}

function assertMasterWriteAccess(user, masterType) {
  if (isSuperAdmin(user)) return;
  if (user?.role === 'SUPERVISOR' && companyAdminMasterWriteTypes.has(masterType)) return;
  throw httpError(403, 'ไม่มีสิทธิ์แก้ไข Master Data ประเภทนี้');
}

function assertUserManagementAccess(user) {
  if (!isSuperAdmin(user)) throw httpError(403, 'เฉพาะ Admin เท่านั้นที่จัดการบัญชีผู้ใช้งานได้');
}

function assertEmployeeManagementAccess(user) {
  if (!['ADMIN', 'HR'].includes(user?.role)) {
    throw httpError(403, 'เฉพาะ Admin หรือ HR เท่านั้นที่จัดการข้อมูลพนักงานได้');
  }
}

const allowedMasterTypes = new Set([
  'brand',
  'site',
  'building',
  'floor',
  'zone',
  'room',
  'department',
  'asset-category',
  'asset-subcategory',
  'asset-status',
  'asset-condition',
  'criticality',
  'ownership-type',
  'vendor',
  'manufacturer',
  'unit',
  'warehouse'
]);

const masterParentTypes = {
  building: 'site',
  floor: 'building',
  zone: 'floor',
  room: 'zone',
  'asset-subcategory': 'asset-category',
  warehouse: 'site'
};

async function assertCompanyExists(companyCode) {
  const normalized = normalizeCompany(companyCode);
  if (!normalized) throw httpError(400, 'กรุณาเลือกบริษัท');
  const [rows] = await pool.query(
    "SELECT company_code FROM companies WHERE company_code = ? AND status = 'ACTIVE' LIMIT 1",
    [normalized]
  );
  if (!rows[0]) throw httpError(400, `ไม่พบบริษัท Active รหัส ${normalized}`);
  return normalized;
}

async function assertMasterParent(masterType, parentCode, companyCode) {
  const expectedType = masterParentTypes[masterType];
  if (!parentCode || !expectedType) return;
  const [rows] = await pool.query(
    `SELECT id FROM master_records
     WHERE master_type = ? AND code = ? AND (company_code = '' OR company_code = ?)
     LIMIT 1`,
    [expectedType, parentCode, companyCode]
  );
  if (!rows[0]) throw httpError(400, `ไม่พบ Parent ${expectedType} รหัส ${parentCode} ในบริษัทนี้`);
}

function childMasterTypes(parentType) {
  return Object.entries(masterParentTypes)
    .filter(([, expectedParent]) => expectedParent === parentType)
    .map(([childType]) => childType);
}

async function deleteMasterBranch(connection, row) {
  for (const childType of childMasterTypes(row.master_type)) {
    const params = row.company_code
      ? [childType, row.code, row.company_code]
      : [childType, row.code];
    const [children] = row.company_code
      ? await connection.query(
          `SELECT * FROM master_records
           WHERE master_type = ? AND parent_code = ? AND company_code = ?`,
          params
        )
      : await connection.query(
          `SELECT * FROM master_records
           WHERE master_type = ? AND parent_code = ?`,
          params
        );
    for (const child of children) await deleteMasterBranch(connection, child);
  }
  await connection.query('DELETE FROM master_records WHERE id = ?', [row.id]);
}

const assetListColumns = `
  id,
  accounting_asset_id,
  company,
  name,
  brand,
  model,
  category,
  subcategory,
  serial,
  assigned_to,
  custodian_type,
  responsible_department,
  department,
  location,
  status,
  purchase_date,
  warranty_until,
  \`condition\`,
  purchase_price,
  useful_life_years,
  salvage_value,
  criticality,
  ownership_type,
  ownership_type_other,
  vendor,
  manufacturer,
  purchase_document_type,
  purchase_document_type_other,
  purchase_document_no,
  purchase_document_date,
  purchase_order_no,
  tax_invoice_no,
  accounting_note,
  purchase_document_name,
  purchase_document_mime,
  qr_printed_at,
  created_at,
  updated_at,
  asset_image_mime,
  CASE
    WHEN asset_image IS NOT NULL AND OCTET_LENGTH(asset_image) > 0 THEN 1
    ELSE 0
  END AS has_image,
  CASE
    WHEN purchase_document_file IS NOT NULL
      AND OCTET_LENGTH(purchase_document_file) > 0 THEN 1
    ELSE 0
  END AS has_purchase_document
`;

function text(value, fallback = '') {
  return String(value ?? fallback).trim();
}

function numberValue(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateOnly(value, fallback = '') {
  return text(value, fallback).slice(0, 10);
}

function now() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

function generateNo(prefix) {
  const date = bangkokDateOnly().replaceAll('-', '');
  return `${prefix}-${date}-${randomBytes(3).toString('hex').toUpperCase()}`;
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireFields(body, fields) {
  return fields.filter((field) => !text(body[field]));
}

function normalizeCompany(company) {
  const value = text(company, defaultCompany).toUpperCase();
  const normalized = value
    .normalize('NFKD')
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || defaultCompany;
}

function normalizeAssetStatus(status) {
  const value = text(status);
  const statusMap = {
    'อยู่ในสต็อก': 'IN_STOCK',
    'อยู่ในคลัง': 'IN_STOCK',
    'ใช้งานอยู่': 'ACTIVE',
    'กำลังซ่อม': 'IN_REPAIR',
    'ซ่อมบำรุง': 'IN_REPAIR',
    'เสีย': 'BROKEN',
    'สูญหาย': 'LOST'
  };
  return statusMap[value] || value;
}

const manualAssetStatuses = new Set(['ACTIVE', 'INACTIVE', 'BROKEN', 'LOST', 'IN_STOCK']);
const workflowAssetStatuses = new Set(['BORROWED', 'IN_REPAIR', 'DISPOSED', 'SOLD']);

function validateAssetValues(asset, { allowWorkflowStatus = false } = {}) {
  const statusAllowed = manualAssetStatuses.has(asset.status)
    || (allowWorkflowStatus && workflowAssetStatuses.has(asset.status));
  if (!statusAllowed) throw httpError(400, `สถานะ Asset ไม่ถูกต้อง: ${asset.status || '-'}`);
  if (asset.condition < 0 || asset.condition > 100) throw httpError(400, 'สภาพทรัพย์สินต้องอยู่ระหว่าง 0 ถึง 100');
  if (asset.purchasePrice < 0) throw httpError(400, 'ราคาซื้อต้องไม่ติดลบ');
  if (asset.usefulLifeYears <= 0) throw httpError(400, 'อายุการใช้งานต้องมากกว่า 0 ปี');
  if (asset.salvageValue < 0) throw httpError(400, 'มูลค่าซากต้องไม่ติดลบ');
  if (asset.salvageValue > asset.purchasePrice) throw httpError(400, 'มูลค่าซากต้องไม่เกินราคาซื้อ');
  if (asset.purchaseDate && asset.warrantyUntil && asset.warrantyUntil < asset.purchaseDate) {
    throw httpError(400, 'วันสิ้นสุดประกันต้องไม่น้อยกว่าวันที่ซื้อ');
  }
}


async function resolveAssetCustodian(executor, body, company, current = {}) {
  const employeeId = text(body.assignedEmployeeId || body.assigned_employee_id);
  const requestedType = text(body.custodianType || body.custodian_type).toUpperCase();
  const rawAssignedTo = text(body.assignedTo ?? body.assigned_to, current.assignedTo || '');
  const rawDepartment = text(body.department, current.department || '');
  let status = normalizeAssetStatus(body.status ?? current.status ?? 'IN_STOCK');

  const unassignedSentinels = new Set(['', '__UNASSIGNED__', 'UNASSIGNED', 'NONE', '-']);
  const sharedSentinels = new Set(['__SHARED__', 'SHARED', 'COMMON', 'ทรัพย์สินส่วนกลาง']);

  if (employeeId && !unassignedSentinels.has(employeeId.toUpperCase()) && !sharedSentinels.has(employeeId.toUpperCase())) {
    const [rows] = await executor.query(
      "SELECT id, company, name, department, location, status FROM employees WHERE id = ? LIMIT 1",
      [employeeId]
    );
    const employee = rows[0];
    if (!employee || employee.status !== 'ACTIVE') throw httpError(400, 'ไม่พบพนักงานที่ Active สำหรับผู้ถือครอง');
    if (normalizeCompany(employee.company) !== normalizeCompany(company)) {
      throw httpError(400, 'ผู้ถือครองต้องอยู่บริษัทเดียวกับทรัพย์สิน');
    }
    if (['IN_STOCK', 'INACTIVE'].includes(status)) status = 'ACTIVE';
    return {
      custodianType: 'EMPLOYEE',
      assignedEmployeeId: employee.id,
      assignedTo: employee.name,
      department: employee.department || '',
      locationFallback: employee.location || '',
      status
    };
  }

  const shared = requestedType === 'SHARED'
    || sharedSentinels.has(employeeId.toUpperCase())
    || sharedSentinels.has(rawAssignedTo.toUpperCase());
  if (shared) {
    if (!rawDepartment) throw httpError(400, 'ทรัพย์สินส่วนกลางต้องระบุหน่วยงานผู้ดูแล');
    if (['IN_STOCK', 'INACTIVE'].includes(status)) status = 'ACTIVE';
    return {
      custodianType: 'SHARED',
      assignedEmployeeId: '',
      assignedTo: 'ทรัพย์สินส่วนกลาง',
      department: rawDepartment,
      locationFallback: '',
      status
    };
  }

  const employeeExplicitlyUnassigned = Boolean(employeeId) && unassignedSentinels.has(employeeId.toUpperCase());
  const explicitlyUnassigned = requestedType === 'UNASSIGNED'
    || employeeExplicitlyUnassigned
    || (!requestedType && !rawAssignedTo);
  if (explicitlyUnassigned) {
    if (status === 'ACTIVE') status = 'IN_STOCK';
    return {
      custodianType: 'UNASSIGNED',
      assignedEmployeeId: '',
      assignedTo: '',
      department: '',
      locationFallback: '',
      status
    };
  }

  // Preserve legacy records that were saved by name before Employee ID linking existed.
  if (['IN_STOCK', 'INACTIVE'].includes(status)) status = 'ACTIVE';
  return {
    custodianType: requestedType || current.custodianType || 'EMPLOYEE',
    assignedEmployeeId: '',
    assignedTo: rawAssignedTo,
    department: rawDepartment,
    locationFallback: '',
    status
  };
}


async function resolveTransferCustodian(executor, body, company, current = {}) {
  const rawAssignee = text(body.toAssignee ?? body.to_assignee, current.to_assignee || '');
  const rawDepartment = text(body.toDepartment ?? body.to_department, current.to_department || '');
  const normalized = rawAssignee.toUpperCase();
  const unassigned = new Set(['', '__UNASSIGNED__', 'UNASSIGNED', 'NONE', '-']);
  const shared = new Set(['__SHARED__', 'SHARED', 'COMMON', 'ทรัพย์สินส่วนกลาง']);

  if (unassigned.has(normalized)) {
    return { assignee: '', department: '', custodianType: 'UNASSIGNED' };
  }
  if (shared.has(normalized)) {
    if (!rawDepartment) throw httpError(400, 'ทรัพย์สินส่วนกลางต้องระบุแผนกหรือหน่วยงานผู้ดูแล');
    return { assignee: 'ทรัพย์สินส่วนกลาง', department: rawDepartment, custodianType: 'SHARED' };
  }

  const [rows] = await executor.query(
    "SELECT id, company, name, department FROM employees WHERE status = 'ACTIVE' AND (id = ? OR name = ?) LIMIT 1",
    [rawAssignee, rawAssignee]
  );
  const employee = rows[0];
  if (employee) {
    if (normalizeCompany(employee.company) !== normalizeCompany(company)) {
      throw httpError(400, 'ผู้รับผิดชอบปลายทางต้องอยู่บริษัทเดียวกับทรัพย์สิน');
    }
    return { assignee: employee.name, department: employee.department || rawDepartment, custodianType: 'EMPLOYEE' };
  }

  if (rawAssignee === text(current.to_assignee)) {
    return { assignee: rawAssignee, department: rawDepartment, custodianType: rawAssignee ? 'EMPLOYEE' : 'UNASSIGNED' };
  }
  throw httpError(400, 'ไม่พบพนักงานปลายทางที่ Active กรุณาเลือกจากข้อมูลพนักงาน');
}

function safeJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeJsonObject(value) {
  if (!value) return {};
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function jsonValue(value, fallback) {
  try {
    return JSON.stringify(value ?? fallback);
  } catch {
    return JSON.stringify(fallback);
  }
}

function normalizeAssetItems(items) {
  return (Array.isArray(items) ? items : [])
    .map((item) => ({
      name: text(item.name),
      brand: text(item.brand),
      model: text(item.model),
      serial: text(item.serial),
      quantity: Math.max(1, numberValue(item.quantity, 1)),
      required: item.required !== false,
      note: text(item.note)
    }))
    .filter((item) => item.name);
}

function parseAssetImage(dataUrl) {
  if (dataUrl === undefined || dataUrl === null || dataUrl === '') return null;

  const match = String(dataUrl).match(
    /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\r\n]+)$/i
  );

  if (!match) {
    throw httpError(400, 'รูปภาพต้องเป็นไฟล์ JPG, PNG หรือ WEBP เท่านั้น');
  }

  const mime = match[1].toLowerCase() === 'image/jpg'
    ? 'image/jpeg'
    : match[1].toLowerCase();

  if (!allowedAssetImageTypes.has(mime)) {
    throw httpError(400, 'รูปภาพต้องเป็นไฟล์ JPG, PNG หรือ WEBP เท่านั้น');
  }

  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length) throw httpError(400, 'ไม่สามารถอ่านไฟล์รูปภาพได้');
  if (buffer.length > maxAssetImageBytes) {
    throw httpError(413, 'ขนาดรูปภาพต้องไม่เกิน 5 MB');
  }

  return { buffer, mime };
}

function parseAssetImages(values, label = 'รูปภาพทรัพย์สิน') {
  const rows = Array.isArray(values) ? values : [];
  if (rows.length > 5) throw httpError(400, `${label}เพิ่มได้สูงสุด 5 รูป`);
  return rows.map((value) => parseAssetImage(value)).filter(Boolean);
}

function normalizeImageIds(values) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0))];
}

function parseFacilityImages(values) {
  return parseAssetImages(values, 'รูปภาพทรัพย์สินส่วนกลาง');
}

function normalizeFacilityImageIds(values) {
  return normalizeImageIds(values);
}

function parsePurchaseDocument(dataUrl, fileName = '') {
  if (dataUrl === undefined || dataUrl === null || dataUrl === '') return null;

  const match = String(dataUrl).match(
    /^data:(application\/pdf|image\/(?:jpeg|jpg|png));base64,([A-Za-z0-9+/=\r\n]+)$/i
  );

  if (!match) {
    throw httpError(400, 'เอกสารต้องเป็นไฟล์ PDF, JPG หรือ PNG เท่านั้น');
  }

  const mime = match[1].toLowerCase() === 'image/jpg'
    ? 'image/jpeg'
    : match[1].toLowerCase();

  if (!allowedPurchaseDocumentTypes.has(mime)) {
    throw httpError(400, 'เอกสารต้องเป็นไฟล์ PDF, JPG หรือ PNG เท่านั้น');
  }

  const buffer = Buffer.from(match[2].replace(/\s/g, ''), 'base64');
  if (!buffer.length) throw httpError(400, 'ไม่สามารถอ่านไฟล์เอกสารได้');
  if (buffer.length > maxPurchaseDocumentBytes) {
    throw httpError(413, 'ขนาดเอกสารต้องไม่เกิน 5 MB');
  }

  const fallbackExtension = mime === 'application/pdf'
    ? '.pdf'
    : mime === 'image/png'
      ? '.png'
      : '.jpg';
  const originalName = text(fileName).split(/[\\/]/).pop() || `purchase-document${fallbackExtension}`;
  const safeName = originalName.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255);

  return {
    buffer,
    mime,
    name: safeName || `purchase-document${fallbackExtension}`
  };
}

function parsePurchaseDocuments(value, legacyData = '', legacyName = '') {
  const entries = Array.isArray(value)
    ? value
    : legacyData
      ? [{ data: legacyData, name: legacyName }]
      : [];

  if (entries.length > maxPurchaseDocumentCount) {
    throw httpError(400, `แนบเอกสารได้สูงสุด ${maxPurchaseDocumentCount} ไฟล์ต่อทรัพย์สิน`);
  }

  return entries.map((entry, index) => {
    const document = parsePurchaseDocument(entry?.data, entry?.name);
    if (!document) {
      throw httpError(400, `เอกสารลำดับที่ ${index + 1} ไม่ถูกต้อง`);
    }
    return document;
  });
}

function toPurchaseDocumentMeta(row) {
  return {
    id: Number(row.id),
    name: row.file_name || 'เอกสารแนบ',
    mime: row.mime_type || 'application/octet-stream',
    url: `/api/assets/${encodeURIComponent(row.asset_id)}/purchase-documents/${Number(row.id)}`,
    createdAt: row.created_at || ''
  };
}

async function insertAssetPurchaseDocuments(connection, assetId, documents) {
  if (!documents?.length) return;
  await connection.query(
    `INSERT INTO asset_purchase_documents (
      asset_id, file_name, mime_type, file_data
    ) VALUES ${documents.map(() => '(?, ?, ?, ?)').join(', ')}`,
    documents.flatMap((document) => [
      assetId,
      document.name,
      document.mime,
      document.buffer
    ])
  );
}

function toAssetItem(row) {
  return {
    id: Number(row.id),
    name: row.name,
    brand: row.brand || '',
    model: row.model || '',
    serial: row.serial || '',
    quantity: Number(row.quantity || 1),
    required: Boolean(row.required_return),
    note: row.note || ''
  };
}

function toAsset(row, repairs = [], returns = [], items = [], purchaseDocuments = [], images = [], events = []) {
  return {
    id: row.id,
    assetCode: row.id,
    accountingAssetId: row.accounting_asset_id || '',
    company: normalizeCompany(row.company),
    name: row.name,
    brand: row.brand || '',
    model: row.model || '',
    category: row.category,
    subcategory: row.subcategory || '',
    serial: row.serial,
    assignedTo: row.assigned_to || '',
    custodianType: row.custodian_type || (row.assigned_to ? (row.assigned_to === 'ทรัพย์สินส่วนกลาง' ? 'SHARED' : 'EMPLOYEE') : 'UNASSIGNED'),
    responsibleDepartment: row.responsible_department || 'IT',
    department: row.department || '',
    location: row.location,
    status: normalizeAssetStatus(row.status),
    purchaseDate: row.purchase_date,
    warrantyUntil: row.warranty_until,
    condition: Number(row.condition),
    purchasePrice: Number(row.purchase_price || 0),
    usefulLifeYears: Number(row.useful_life_years || 5),
    salvageValue: Number(row.salvage_value || 0),
    criticality: row.criticality || 'MEDIUM',
    ownershipType: row.ownership_type || 'OWNED',
    ownershipTypeOther: row.ownership_type_other || '',
    vendor: row.vendor || '',
    manufacturer: row.manufacturer || '',
    purchaseDocumentType: row.purchase_document_type || '',
    purchaseDocumentTypeOther: row.purchase_document_type_other || '',
    purchaseDocumentNo: row.purchase_document_no || '',
    purchaseDocumentDate: row.purchase_document_date || '',
    taxInvoiceNo: row.tax_invoice_no || '',
    accountingNote: row.accounting_note || '',
    purchaseDocumentName: purchaseDocuments[0]?.name || row.purchase_document_name || '',
    purchaseDocumentMime: purchaseDocuments[0]?.mime || row.purchase_document_mime || '',
    purchaseDocuments,
    hasPurchaseDocument: purchaseDocuments.length > 0 || Boolean(row.has_purchase_document),
    purchaseDocumentUrl: purchaseDocuments[0]?.url || (row.has_purchase_document
      ? `/api/assets/${encodeURIComponent(row.id)}/purchase-document${
          row.updated_at ? `?v=${new Date(row.updated_at).getTime()}` : ''
        }`
      : ''),
    hasImage: images.length > 0 || Boolean(row.has_image),
    imageCount: images.length || (row.has_image ? 1 : 0),
    images: images.length
      ? images
      : (row.has_image ? [{
          id: 0,
          mime: row.asset_image_mime || '',
          url: `/api/assets/${encodeURIComponent(row.id)}/image${row.updated_at ? `?v=${new Date(row.updated_at).getTime()}` : ''}`
        }] : []),
    imageMime: images[0]?.mime || row.asset_image_mime || '',
    imageUrl: images[0]?.url || (row.has_image
      ? `/api/assets/${encodeURIComponent(row.id)}/image${
          row.updated_at ? `?v=${new Date(row.updated_at).getTime()}` : ''
        }`
      : ''),
    items,
    repairs,
    returns,
    events,
    qrPrintedAt: row.qr_printed_at || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at
  };
}

function assetForUser(asset, user) {
  if (!user || hasPermission(user, 'assets.financial')) return asset;
  return {
    ...asset,
    purchasePrice: 0,
    salvageValue: 0,
    usefulLifeYears: 0,
    purchaseDocumentType: '',
    purchaseDocumentTypeOther: '',
    purchaseDocumentNo: '',
    purchaseDocumentDate: '',
    taxInvoiceNo: '',
    accountingNote: '',
    purchaseDocumentName: '',
    purchaseDocumentMime: '',
    hasPurchaseDocument: false,
    purchaseDocumentUrl: '',
    purchaseDocuments: [],
    repairs: (asset.repairs || []).map((repair) => ({ ...repair, cost: 0 }))
  };
}

function toEmployee(row) {
  const id = row.id || row.employee_code || '';
  const company = normalizeCompany(row.company || row.company_code);
  const name = row.name || row.full_name || '';
  return {
    id,
    employeeCode: id,
    company,
    companyCode: company,
    name,
    fullName: name,
    department: row.department || '',
    position: row.position || '',
    email: row.email || '',
    phone: row.phone || '',
    role: row.role || 'VIEW',
    roleName: roleNames[row.role] || row.role || 'VIEW',
    status: row.status || 'ACTIVE',
    location: row.location || '',
    permissions: permissionsForRole(row.role || 'VIEW'),
    mustChangePassword: Boolean(row.must_change_password),
    canLogin: Boolean(row.can_login)
  };
}


function toMasterRecord(row) {
  return {
    id: Number(row.id),
    masterType: row.master_type,
    code: row.code,
    name: row.name,
    parentCode: row.parent_code || '',
    companyCode: row.company_code || '',
    status: row.status || 'ACTIVE',
    data: safeJsonObject(row.data_json)
  };
}

async function getMasterData(user) {
  if (!hasPermission(user, 'master.read') && !hasPermission(user, 'assets.read')) {
    return {};
  }
  const [rows] = isSuperAdmin(user)
    ? await pool.query('SELECT * FROM master_records ORDER BY master_type, name, code')
    : await pool.query(
        "SELECT * FROM master_records WHERE company_code = '' OR company_code = ? ORDER BY master_type, name, code",
        [normalizeCompany(user.company)]
      );
  return rows.reduce((grouped, row) => {
    const item = toMasterRecord(row);
    (grouped[item.masterType] ||= []).push(item);
    return grouped;
  }, {});
}

function toStock(row) {
  return {
    id: `${row.sku}@@${row.warehouse || 'MAIN'}`,
    balanceId: row.balance_id || row.id || null,
    name: row.name,
    sku: row.sku,
    company: normalizeCompany(row.company),
    category: row.category || '',
    unit: row.unit || 'pcs',
    warehouse: row.warehouse || row.location || '-',
    available: Number(row.available || 0),
    min: Number(row.min_level || 0),
    max: Number(row.max_level || 0),
    location: row.location || '',
    status: row.status || 'ACTIVE',
    unitCost: Number(row.unit_cost || 0),
    lowStock: Number(row.available || 0) <= Number(row.min_level || 0),
    updatedAt: row.updated_at || row.created_at
  };
}

async function generateNextId(tableName, columnName, prefix, startNumber, padLength) {
  const [rows] = await pool.query(
    `SELECT ${columnName} AS id FROM ${tableName} WHERE ${columnName} LIKE ?`,
    [`${prefix}%`]
  );

  let maxNumber = startNumber - 1;
  for (const row of rows) {
    const rawId = String(row.id || '');
    const numberPart = rawId.slice(prefix.length);
    if (/^\d+$/.test(numberPart)) {
      maxNumber = Math.max(maxNumber, Number(numberPart));
    }
  }

  return `${prefix}${String(maxNumber + 1).padStart(padLength, '0')}`;
}

function bangkokAssetDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${String(value.year || '').slice(-2)}${value.month}${value.day}`;
}


function bangkokDateOnly(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function normalizeAssetReturnReason(value) {
  const normalized = text(value, 'RETURN_TO_POOL').toUpperCase();
  return ['RETURN_TO_POOL', 'REPLACEMENT', 'EMPLOYEE_CHANGE', 'DAMAGED', 'END_OF_USE', 'RESIGNED', 'OTHER'].includes(normalized)
    ? normalized
    : 'RETURN_TO_POOL';
}

async function maxExistingAssetRunningNumber(executor, companyCode) {
  const [rows] = await executor.query(
    `SELECT MAX(
       CASE
         WHEN id REGEXP '-[0-9]+$' THEN CAST(SUBSTRING_INDEX(id, '-', -1) AS UNSIGNED)
         ELSE 0
       END
     ) AS max_number
     FROM assets
     WHERE company = ?`,
    [companyCode]
  );
  return Math.max(0, Number(rows[0]?.max_number || 0));
}

async function previewNextAssetId(companyValue) {
  const companyCode = normalizeCompany(companyValue);
  const dateKey = bangkokAssetDateKey();
  const prefix = `${companyCode}-${dateKey}-`;
  const currentMax = await maxExistingAssetRunningNumber(pool, companyCode);
  const [counterRows] = await pool.query(
    `SELECT last_number FROM asset_id_counters WHERE company_code = ? LIMIT 1`,
    [companyCode]
  );
  const counterMax = Math.max(0, Number(counterRows[0]?.last_number || 0));
  const nextNumber = Math.max(currentMax, counterMax) + 1;
  return `${prefix}${String(nextNumber).padStart(3, '0')}`;
}

async function allocateAssetId(connection, companyValue) {
  const companyCode = normalizeCompany(companyValue);
  const dateKey = bangkokAssetDateKey();
  const prefix = `${companyCode}-${dateKey}-`;
  const currentMax = await maxExistingAssetRunningNumber(connection, companyCode);

  await connection.query(
    `INSERT INTO asset_id_counters (company_code, last_number, updated_at)
     VALUES (?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE
       last_number = GREATEST(last_number, VALUES(last_number)),
       updated_at = CURRENT_TIMESTAMP`,
    [companyCode, currentMax]
  );
  const [counterRows] = await connection.query(
    `SELECT last_number FROM asset_id_counters WHERE company_code = ? FOR UPDATE`,
    [companyCode]
  );
  const nextNumber = Math.max(currentMax, Number(counterRows[0]?.last_number || 0)) + 1;
  await connection.query(
    `UPDATE asset_id_counters SET last_number = ?, updated_at = CURRENT_TIMESTAMP WHERE company_code = ?`,
    [nextNumber, companyCode]
  );

  // Keep the legacy daily table in sync for backward compatibility, but do not use it
  // as the source of truth. The running number is continuous across calendar days.
  await connection.query(
    `INSERT INTO asset_id_sequences (company_code, asset_date, last_number, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON DUPLICATE KEY UPDATE last_number = GREATEST(last_number, VALUES(last_number)), updated_at = CURRENT_TIMESTAMP`,
    [companyCode, dateKey, nextNumber]
  );
  return `${prefix}${String(nextNumber).padStart(3, '0')}`;
}

async function connectWithRetry(retries = 45) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      const connection = await pool.getConnection();
      connection.release();
      return;
    } catch (error) {
      if (attempt === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

async function addColumnIfMissing(tableName, columnName, definition) {
  try {
    await pool.query(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`);
  } catch (error) {
    if (error.code !== 'ER_DUP_FIELDNAME') throw error;
  }
}


async function addIndexIfMissing(tableName, indexName, definition) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS total
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND INDEX_NAME = ?`,
    [tableName, indexName]
  );
  if (Number(rows[0]?.total || 0) > 0) return;
  await pool.query(`ALTER TABLE ${tableName} ADD ${definition}`);
}

async function ensureAssetIdSequenceCompanyKey() {
  await addColumnIfMissing('asset_id_sequences', 'company_code', "VARCHAR(120) NOT NULL DEFAULT ''");
  const [primaryRows] = await pool.query(`
    SELECT COLUMN_NAME
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'asset_id_sequences'
      AND CONSTRAINT_NAME = 'PRIMARY'
    ORDER BY ORDINAL_POSITION
  `);
  const primaryColumns = primaryRows.map((row) => String(row.COLUMN_NAME || row.column_name || ''));
  if (primaryColumns.join(',') === 'company_code,asset_date') return;

  if (primaryColumns.length) {
    await pool.query('ALTER TABLE asset_id_sequences DROP PRIMARY KEY');
  }
  await pool.query('ALTER TABLE asset_id_sequences ADD PRIMARY KEY (company_code, asset_date)');
}

async function consolidateSharedMasterRecords() {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const masterType of sharedMasterTypes) {
      const [rows] = await connection.query(
        `SELECT * FROM master_records
         WHERE master_type = ?
         ORDER BY
           CASE WHEN company_code = '' THEN 0 ELSE 1 END,
           CASE WHEN status = 'ACTIVE' THEN 0 ELSE 1 END,
           COALESCE(updated_at, created_at) DESC,
           id DESC
         FOR UPDATE`,
        [masterType]
      );

      const keepByCode = new Map();
      for (const row of rows) {
        const key = text(row.code).toUpperCase();
        if (!key) continue;
        if (!keepByCode.has(key)) {
          keepByCode.set(key, row);
          continue;
        }
        await connection.query('DELETE FROM master_records WHERE id = ?', [row.id]);
      }

      for (const row of keepByCode.values()) {
        if (row.company_code !== '') {
          await connection.query(
            "UPDATE master_records SET company_code = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [row.id]
          );
        }
      }
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function ensureMasterRecordCompanyIndex() {
  const [indexes] = await pool.query(
    `SELECT DISTINCT INDEX_NAME
     FROM information_schema.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'master_records'`
  );
  const names = new Set(indexes.map((row) => row.INDEX_NAME));
  if (names.has('master_records_type_code_unique')) {
    await pool.query('ALTER TABLE master_records DROP INDEX master_records_type_code_unique');
  }
  if (!names.has('master_records_type_company_code_unique')) {
    await pool.query(
      'ALTER TABLE master_records ADD UNIQUE KEY master_records_type_company_code_unique (master_type, company_code, code)'
    );
  }
}

async function insertAssetItems(connection, assetId, items) {
  const normalizedItems = normalizeAssetItems(items);
  if (!normalizedItems.length) return;

  await connection.query(
    `INSERT INTO asset_items (
      asset_id,
      name,
      brand,
      model,
      serial,
      quantity,
      required_return,
      note
    ) VALUES ${normalizedItems.map(() => '(?, ?, ?, ?, ?, ?, ?, ?)').join(', ')}`,
    normalizedItems.flatMap((item) => [
      assetId,
      item.name,
      item.brand,
      item.model,
      item.serial,
      item.quantity,
      item.required ? 1 : 0,
      item.note
    ])
  );
}

function bearerToken(req) {
  const authorization = text(req.headers.authorization);
  const match = authorization.match(/^Bearer\s+(.+)$/i);
  return match ? match[1].trim() : '';
}

async function findUserByLogin(login) {
  const value = text(login);
  if (!value) return null;
  const [rows] = await pool.query(
    'SELECT * FROM employees WHERE can_login = 1 AND (id = ? OR LOWER(email) = LOWER(?)) LIMIT 1',
    [value, value]
  );
  return rows[0] || null;
}

async function getRequestUser(req) {
  if (req.user) return req.user;
  throw httpError(401, 'กรุณาเข้าสู่ระบบ');
}

async function authenticateRequest(req, res, next) {
  try {
    const token = bearerToken(req);
    if (!token) return res.status(401).json({ error: 'กรุณาเข้าสู่ระบบ' });

    const [rows] = await pool.query(
      `SELECT e.*, s.id AS session_id
       FROM auth_sessions s
       INNER JOIN employees e ON e.id = s.employee_id
       WHERE s.token_hash = ?
         AND s.revoked_at IS NULL
         AND s.expires_at > CURRENT_TIMESTAMP
         AND e.status = 'ACTIVE'
         AND e.can_login = 1
       LIMIT 1`,
      [tokenHash(token)]
    );

    if (!rows[0]) return res.status(401).json({ error: 'Session หมดอายุหรือไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่' });
    req.user = toEmployee(rows[0]);
    req.sessionId = rows[0].session_id;
    await pool.query('UPDATE auth_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?', [req.sessionId]);
    next();
  } catch (error) {
    next(error);
  }
}

function requiredPermission(req) {
  const method = req.method.toUpperCase();
  const path = req.path;
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(method);

  if (path.startsWith('/auth/') || path === '/health' || path.startsWith('/public/')) return '';
  if (path.startsWith('/audit-logs')) return 'audit.read';
  if (path.startsWith('/dashboard')) return 'dashboard.read';
  if (path.startsWith('/reports/') || path.startsWith('/depreciation')) return 'reports.read';
  if (path.startsWith('/companies')) return write ? 'companies.manage' : 'master.read';
  if (path.startsWith('/employees')) return write ? 'employees.manage' : 'assets.read';
  if (path.startsWith('/master/')) return write ? 'master.manage' : 'master.read';
  if (path.startsWith('/assignment-requests')) return 'assignment.request';
  if (path.startsWith('/facility-assets') || path.startsWith('/facility-issues') || path.startsWith('/facility-movements')) return write ? 'assets.write' : 'assets.read';
  if (path.startsWith('/annual-inventory')) return write ? 'assets.assign' : 'assets.read';
  if (path.startsWith('/stock-movements')) return write ? 'stock.write' : 'stock.read';
  if (path.startsWith('/stock')) return write ? 'stock.write' : 'stock.read';
  if (path.startsWith('/approvals')) return write ? 'workflow.approve' : 'workflow.approve';
  if (/^\/borrow-records\/[^/]+\/return$/.test(path)) return 'assets.assign';
  if (path.startsWith('/transfers') || path.startsWith('/borrow-records') || path.startsWith('/disposals')) return write ? 'workflow.request' : 'assets.read';
  if (path.startsWith('/maintenance')) return write ? 'maintenance.write' : 'assets.read';
  if (path.startsWith('/asset-events')) return 'assets.read';
  if (path.startsWith('/assets')) {
    if (!write && (/\/purchase-document$/.test(path) || /\/purchase-documents\/[^/]+$/.test(path))) return 'assets.financial';
    if (!write) return 'assets.read';
    if (/\/assignment$/.test(path)) return 'assets.assign';
    if (/\/repairs$/.test(path)) return 'maintenance.write';
    if (/\/returns$/.test(path)) return 'assets.assign';
    if (/\/qr-printed$/.test(path)) return 'assets.read';
    return 'assets.write';
  }
  if (path === '/bootstrap' || path === '/me') return '';
  return write ? 'assets.write' : 'assets.read';
}

function authorizeRequest(req, res, next) {
  const write = !['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase());
  const permission = requiredPermission(req);
  if (req.path.startsWith('/employees') && write) {
    if (['ADMIN', 'HR'].includes(req.user?.role)) return next();
    return res.status(403).json({ error: 'เฉพาะ Admin หรือ HR เท่านั้นที่จัดการข้อมูลพนักงานได้' });
  }
  if (req.path.startsWith('/assignment-requests')) {
    const path = req.path;
    const method = req.method.toUpperCase();
    const canRequest = hasPermission(req.user, 'assignment.request');
    const canManage = hasPermission(req.user, 'assignment.manage');
    const canAcknowledge = hasPermission(req.user, 'assignment.acknowledge');

    if (method === 'GET' && (canRequest || canManage || canAcknowledge)) return next();
    if (method === 'DELETE' && isSuperAdmin(req.user)) return next();
    if (method === 'PUT' && (canRequest || canManage)) return next();
    if (/\/acknowledge$/.test(path) && method === 'POST' && (canAcknowledge || canManage)) return next();
    if (/\/(review|return-for-edit|reject|allocations|approve|handover)$/.test(path) && method === 'POST' && canManage) return next();
    if (/\/allocations\/[^/]+$/.test(path) && method === 'DELETE' && canManage) return next();
    if ((method === 'POST' || method === 'PUT') && canRequest) return next();
    return res.status(403).json({ error: 'ไม่มีสิทธิ์ใช้งานคำขอจัดสรรทรัพย์สิน' });
  }
  if (!permission || hasPermission(req.user, permission)) return next();
  if (permission === 'maintenance.write' && req.method === 'POST' && req.path === '/maintenance' && hasPermission(req.user, 'maintenance.request')) return next();
  return res.status(403).json({ error: 'ไม่มีสิทธิ์ใช้งานส่วนนี้' });
}

async function writeAudit(req, module, action, entityId, beforeValue = null, afterValue = null, userValue = null) {
  try {
    const user = userValue || await getRequestUser(req);
    await pool.query(
      `INSERT INTO audit_logs (
        company_code,
        employee_code,
        module,
        action,
        entity_id,
        before_json,
        after_json,
        ip_address,
        created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        user.company || defaultCompany,
        user.id || '',
        module,
        action,
        text(entityId),
        beforeValue == null ? '' : jsonValue(beforeValue, {}),
        afterValue == null ? '' : jsonValue(afterValue, {}),
        text(req.ip || req.socket?.remoteAddress)
      ]
    );
  } catch (error) {
    console.warn('Audit log failed:', error.message);
  }
}

async function createApproval(connection, user, type, requestId, requestNo, company) {
  await connection.query(
    `INSERT INTO approvals (
      company_code,
      request_type,
      request_id,
      request_no,
      requester,
      requester_employee_code,
      status,
      requested_at,
      note
    ) VALUES (?, ?, ?, ?, ?, ?, 'PENDING', CURRENT_TIMESTAMP, '')`,
    [company, type, requestId, requestNo, user.name, user.id]
  );
}

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id VARCHAR(64) PRIMARY KEY,
      company VARCHAR(120) NOT NULL DEFAULT '${defaultCompanySql}',
      name VARCHAR(255) NOT NULL,
      department VARCHAR(255) NOT NULL,
      position VARCHAR(255) NOT NULL DEFAULT '-',
      location VARCHAR(255) NOT NULL DEFAULT '-',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS assets (
      id VARCHAR(64) PRIMARY KEY,
      accounting_asset_id VARCHAR(160) NOT NULL DEFAULT '',
      company VARCHAR(120) NOT NULL DEFAULT '${defaultCompanySql}',
      name VARCHAR(255) NOT NULL,
      brand VARCHAR(255) NOT NULL DEFAULT '',
      model VARCHAR(255) NOT NULL DEFAULT '',
      category VARCHAR(120) NOT NULL,
      serial VARCHAR(160) NOT NULL,
      assigned_to VARCHAR(255) NOT NULL,
      responsible_department VARCHAR(20) NOT NULL DEFAULT 'IT',
      department VARCHAR(255) NOT NULL,
      location VARCHAR(255) NOT NULL,
      status VARCHAR(80) NOT NULL,
      purchase_date VARCHAR(40) NOT NULL DEFAULT '',
      warranty_until VARCHAR(40) NOT NULL DEFAULT '',
      \`condition\` INT NOT NULL DEFAULT 100,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS asset_id_sequences (
      company_code VARCHAR(120) NOT NULL DEFAULT '',
      asset_date CHAR(8) NOT NULL,
      last_number INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (company_code, asset_date)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS asset_id_counters (
      company_code VARCHAR(120) PRIMARY KEY,
      last_number INT NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS asset_items (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      asset_id VARCHAR(64) NOT NULL,
      name VARCHAR(255) NOT NULL,
      brand VARCHAR(255) NOT NULL DEFAULT '',
      model VARCHAR(255) NOT NULL DEFAULT '',
      serial VARCHAR(160) NOT NULL DEFAULT '',
      quantity INT NOT NULL DEFAULT 1,
      required_return TINYINT(1) NOT NULL DEFAULT 1,
      note TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT asset_items_asset_fk FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS asset_images (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      asset_id VARCHAR(64) NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      image_data MEDIUMBLOB NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX asset_images_asset_idx (asset_id, sort_order, id),
      CONSTRAINT asset_images_asset_fk FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS asset_purchase_documents (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      asset_id VARCHAR(64) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      file_data MEDIUMBLOB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX asset_purchase_documents_asset_idx (asset_id),
      CONSTRAINT asset_purchase_documents_asset_fk FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS repair_records (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      asset_id VARCHAR(64) NOT NULL,
      repair_date VARCHAR(40) NOT NULL,
      detail TEXT NOT NULL,
      cost DECIMAL(12, 2) NOT NULL DEFAULT 0,
      technician VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT repair_records_asset_fk FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS return_records (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      asset_id VARCHAR(64) NOT NULL,
      return_date VARCHAR(40) NOT NULL,
      returned_by VARCHAR(255) NOT NULL,
      received_by VARCHAR(255) NOT NULL,
      return_location VARCHAR(255) NOT NULL,
      \`condition\` INT NOT NULL DEFAULT 100,
      note TEXT NOT NULL,
      returned_items TEXT NULL,
      missing_items TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT return_records_asset_fk FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_items (
      sku VARCHAR(80) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      available DECIMAL(14, 2) NOT NULL DEFAULT 0,
      min_level DECIMAL(14, 2) NOT NULL DEFAULT 0,
      location VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS companies (
      company_code VARCHAR(120) PRIMARY KEY,
      company_name_th VARCHAR(255) NOT NULL DEFAULT '',
      company_name_en VARCHAR(255) NOT NULL,
      tax_id VARCHAR(80) NOT NULL DEFAULT '',
      address TEXT NOT NULL,
      phone VARCHAR(80) NOT NULL DEFAULT '',
      email VARCHAR(255) NOT NULL DEFAULT '',
      logo_url TEXT NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS master_records (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      master_type VARCHAR(80) NOT NULL,
      code VARCHAR(120) NOT NULL,
      name VARCHAR(255) NOT NULL,
      parent_code VARCHAR(120) NOT NULL DEFAULT '',
      company_code VARCHAR(120) NOT NULL DEFAULT '',
      status VARCHAR(40) NOT NULL DEFAULT 'ACTIVE',
      data_json LONGTEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY master_records_type_company_code_unique (master_type, company_code, code)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS asset_events (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      company_code VARCHAR(120) NOT NULL,
      asset_id VARCHAR(64) NOT NULL,
      event_type VARCHAR(80) NOT NULL,
      old_value TEXT NOT NULL,
      new_value TEXT NOT NULL,
      actor VARCHAR(255) NOT NULL,
      note TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX asset_events_asset_idx (asset_id),
      CONSTRAINT asset_events_asset_fk FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS transfers (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      request_no VARCHAR(120) UNIQUE NOT NULL,
      company_code VARCHAR(120) NOT NULL,
      asset_id VARCHAR(64) NOT NULL,
      from_location VARCHAR(255) NOT NULL DEFAULT '',
      to_location VARCHAR(255) NOT NULL,
      from_department VARCHAR(255) NOT NULL DEFAULT '',
      to_department VARCHAR(255) NOT NULL DEFAULT '',
      from_assignee VARCHAR(255) NOT NULL DEFAULT '',
      to_assignee VARCHAR(255) NOT NULL DEFAULT '',
      requested_by VARCHAR(255) NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'PENDING',
      approved_by VARCHAR(255) NOT NULL DEFAULT '',
      transfer_date VARCHAR(40) NOT NULL,
      note TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL,
      CONSTRAINT transfers_asset_fk FOREIGN KEY (asset_id) REFERENCES assets(id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS borrow_records (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      request_no VARCHAR(120) UNIQUE NOT NULL,
      company_code VARCHAR(120) NOT NULL,
      asset_id VARCHAR(64) NOT NULL,
      borrower VARCHAR(255) NOT NULL,
      borrow_date VARCHAR(40) NOT NULL,
      due_date VARCHAR(40) NOT NULL,
      return_date VARCHAR(40) NOT NULL DEFAULT '',
      condition_out DECIMAL(8, 2) NOT NULL DEFAULT 100,
      condition_in DECIMAL(8, 2) NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'PENDING',
      note TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL,
      CONSTRAINT borrow_records_asset_fk FOREIGN KEY (asset_id) REFERENCES assets(id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS borrow_return_photos (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      borrow_record_id BIGINT NOT NULL,
      asset_id VARCHAR(64) NOT NULL,
      file_name VARCHAR(255) NOT NULL DEFAULT '',
      mime_type VARCHAR(100) NOT NULL,
      file_data MEDIUMBLOB NOT NULL,
      created_by VARCHAR(255) NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY borrow_return_photos_record_unique (borrow_record_id),
      INDEX borrow_return_photos_asset_idx (asset_id),
      CONSTRAINT borrow_return_photos_record_fk FOREIGN KEY (borrow_record_id) REFERENCES borrow_records(id) ON DELETE CASCADE,
      CONSTRAINT borrow_return_photos_asset_fk FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS maintenance (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      ticket_no VARCHAR(120) UNIQUE NOT NULL,
      company_code VARCHAR(120) NOT NULL,
      asset_id VARCHAR(64) NOT NULL,
      service_department VARCHAR(20) NOT NULL DEFAULT 'IT',
      issue TEXT NOT NULL,
      priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL',
      technician VARCHAR(255) NOT NULL DEFAULT '',
      estimated_cost DECIMAL(14, 2) NULL,
      diagnosis TEXT NOT NULL,
      repair_method VARCHAR(40) NOT NULL DEFAULT '',
      repair_method_other VARCHAR(255) NOT NULL DEFAULT '',
      vendor VARCHAR(255) NOT NULL DEFAULT '',
      parts_json LONGTEXT NOT NULL,
      cost DECIMAL(14, 2) NOT NULL DEFAULT 0,
      status VARCHAR(40) NOT NULL DEFAULT 'OPEN',
      opened_date VARCHAR(40) NOT NULL,
      closed_date VARCHAR(40) NOT NULL DEFAULT '',
      note TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL,
      CONSTRAINT maintenance_asset_fk FOREIGN KEY (asset_id) REFERENCES assets(id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS disposals (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      request_no VARCHAR(120) UNIQUE NOT NULL,
      company_code VARCHAR(120) NOT NULL,
      asset_id VARCHAR(64) NOT NULL,
      reason TEXT NOT NULL,
      disposal_method VARCHAR(80) NOT NULL DEFAULT 'SCRAP',
      disposal_method_other VARCHAR(255) NOT NULL DEFAULT '',
      estimated_value DECIMAL(14, 2) NOT NULL DEFAULT 0,
      status VARCHAR(40) NOT NULL DEFAULT 'PENDING',
      requested_by VARCHAR(255) NOT NULL,
      approved_by VARCHAR(255) NOT NULL DEFAULT '',
      disposal_date VARCHAR(40) NOT NULL,
      note TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL,
      CONSTRAINT disposals_asset_fk FOREIGN KEY (asset_id) REFERENCES assets(id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS approvals (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      company_code VARCHAR(120) NOT NULL,
      request_type VARCHAR(80) NOT NULL,
      request_id BIGINT NOT NULL,
      request_no VARCHAR(120) NOT NULL,
      requester VARCHAR(255) NOT NULL,
      approver VARCHAR(255) NOT NULL DEFAULT '',
      status VARCHAR(40) NOT NULL DEFAULT 'PENDING',
      requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      decided_at TIMESTAMP NULL,
      note TEXT NOT NULL
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      doc_no VARCHAR(120) UNIQUE NOT NULL,
      company_code VARCHAR(120) NOT NULL,
      movement_type VARCHAR(40) NOT NULL,
      sku VARCHAR(80) NOT NULL,
      quantity DECIMAL(14, 2) NOT NULL,
      from_warehouse VARCHAR(255) NOT NULL DEFAULT '',
      to_warehouse VARCHAR(255) NOT NULL DEFAULT '',
      requester VARCHAR(255) NOT NULL DEFAULT '',
      reference VARCHAR(255) NOT NULL DEFAULT '',
      note TEXT NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'POSTED',
      movement_date VARCHAR(40) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT stock_movements_stock_fk FOREIGN KEY (sku) REFERENCES stock_items(sku)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      token_hash CHAR(64) UNIQUE NOT NULL,
      employee_id VARCHAR(64) NOT NULL,
      expires_at TIMESTAMP NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      last_seen_at TIMESTAMP NULL,
      revoked_at TIMESTAMP NULL,
      INDEX auth_sessions_employee_idx (employee_id),
      INDEX auth_sessions_expiry_idx (expires_at),
      CONSTRAINT auth_sessions_employee_fk FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_balances (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      sku VARCHAR(80) NOT NULL,
      company_code VARCHAR(120) NOT NULL,
      warehouse VARCHAR(120) NOT NULL,
      location VARCHAR(255) NOT NULL DEFAULT '',
      available DECIMAL(14,2) NOT NULL DEFAULT 0,
      min_level DECIMAL(14,2) NOT NULL DEFAULT 0,
      max_level DECIMAL(14,2) NOT NULL DEFAULT 0,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY stock_balances_sku_warehouse_unique (sku, warehouse),
      INDEX stock_balances_company_idx (company_code),
      CONSTRAINT stock_balances_stock_fk FOREIGN KEY (sku) REFERENCES stock_items(sku) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);


  await pool.query(`
    CREATE TABLE IF NOT EXISTS maintenance_parts (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      maintenance_id BIGINT NOT NULL,
      sku VARCHAR(80) NOT NULL,
      warehouse VARCHAR(120) NOT NULL,
      quantity DECIMAL(14,2) NOT NULL,
      unit_cost DECIMAL(12,2) NOT NULL DEFAULT 0,
      movement_doc_no VARCHAR(120) NOT NULL,
      issued_by VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT maintenance_parts_ticket_fk FOREIGN KEY (maintenance_id) REFERENCES maintenance(id) ON DELETE CASCADE,
      CONSTRAINT maintenance_parts_stock_fk FOREIGN KEY (sku) REFERENCES stock_items(sku)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS facility_assets (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      item_code VARCHAR(80) UNIQUE NOT NULL,
      company_code VARCHAR(120) NOT NULL,
      name VARCHAR(255) NOT NULL,
      asset_type VARCHAR(20) NOT NULL DEFAULT 'ASSET',
      responsible_department VARCHAR(20) NOT NULL DEFAULT 'GA',
      category VARCHAR(120) NOT NULL DEFAULT '',
      unit VARCHAR(80) NOT NULL DEFAULT 'ชิ้น',
      total_quantity DECIMAL(14,2) NOT NULL DEFAULT 0,
      available_quantity DECIMAL(14,2) NOT NULL DEFAULT 0,
      damaged_quantity DECIMAL(14,2) NOT NULL DEFAULT 0,
      custodian_employee_code VARCHAR(64) NOT NULL DEFAULT '',
      custodian_name VARCHAR(255) NOT NULL DEFAULT '',
      storage_location VARCHAR(255) NOT NULL DEFAULT '',
      warehouse VARCHAR(120) NOT NULL DEFAULT '',
      asset_image MEDIUMBLOB NULL,
      asset_image_mime VARCHAR(100) NOT NULL DEFAULT '',
      note TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL,
      INDEX facility_assets_company_idx (company_code),
      INDEX facility_assets_custodian_idx (custodian_employee_code)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS facility_asset_images (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      facility_asset_id BIGINT NOT NULL,
      mime_type VARCHAR(100) NOT NULL DEFAULT '',
      image_data MEDIUMBLOB NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX facility_asset_images_asset_idx (facility_asset_id, sort_order, id),
      CONSTRAINT facility_asset_images_asset_fk FOREIGN KEY (facility_asset_id) REFERENCES facility_assets(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS facility_issues (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      issue_no VARCHAR(120) UNIQUE NOT NULL,
      facility_asset_id BIGINT NOT NULL,
      company_code VARCHAR(120) NOT NULL,
      quantity DECIMAL(14,2) NOT NULL,
      returned_quantity DECIMAL(14,2) NOT NULL DEFAULT 0,
      damaged_quantity DECIMAL(14,2) NOT NULL DEFAULT 0,
      receiver_employee_code VARCHAR(64) NOT NULL DEFAULT '',
      receiver_name VARCHAR(255) NOT NULL DEFAULT '',
      department VARCHAR(255) NOT NULL DEFAULT '',
      destination_location VARCHAR(255) NOT NULL DEFAULT '',
      purpose TEXT NOT NULL,
      issue_date DATE NOT NULL,
      due_date DATE NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'ISSUED',
      issued_by VARCHAR(64) NOT NULL DEFAULT '',
      issued_by_name VARCHAR(255) NOT NULL DEFAULT '',
      note TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL,
      INDEX facility_issues_asset_idx (facility_asset_id),
      INDEX facility_issues_company_status_idx (company_code, status),
      CONSTRAINT facility_issues_asset_fk FOREIGN KEY (facility_asset_id) REFERENCES facility_assets(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS facility_returns (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      issue_id BIGINT NOT NULL,
      company_code VARCHAR(120) NOT NULL,
      good_quantity DECIMAL(14,2) NOT NULL DEFAULT 0,
      damaged_quantity DECIMAL(14,2) NOT NULL DEFAULT 0,
      return_date DATE NOT NULL,
      return_location VARCHAR(255) NOT NULL DEFAULT '',
      received_by VARCHAR(64) NOT NULL DEFAULT '',
      received_by_name VARCHAR(255) NOT NULL DEFAULT '',
      note TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX facility_returns_issue_idx (issue_id),
      CONSTRAINT facility_returns_issue_fk FOREIGN KEY (issue_id) REFERENCES facility_issues(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS facility_asset_movements (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      facility_asset_id BIGINT NOT NULL,
      company_code VARCHAR(120) NOT NULL,
      movement_type VARCHAR(40) NOT NULL,
      quantity DECIMAL(14,2) NOT NULL DEFAULT 0,
      reference_no VARCHAR(120) NOT NULL DEFAULT '',
      from_location VARCHAR(255) NOT NULL DEFAULT '',
      to_location VARCHAR(255) NOT NULL DEFAULT '',
      employee_code VARCHAR(64) NOT NULL DEFAULT '',
      employee_name VARCHAR(255) NOT NULL DEFAULT '',
      note TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX facility_movements_asset_idx (facility_asset_id),
      INDEX facility_movements_company_idx (company_code),
      CONSTRAINT facility_movements_asset_fk FOREIGN KEY (facility_asset_id) REFERENCES facility_assets(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS annual_inventory_counts (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      count_no VARCHAR(120) UNIQUE NOT NULL,
      company_code VARCHAR(120) NOT NULL,
      inventory_key VARCHAR(200) NOT NULL,
      inventory_type VARCHAR(20) NOT NULL,
      asset_id VARCHAR(64) NOT NULL DEFAULT '',
      facility_asset_id BIGINT NULL,
      count_year INT NOT NULL,
      item_code VARCHAR(120) NOT NULL DEFAULT '',
      item_name VARCHAR(255) NOT NULL DEFAULT '',
      asset_type VARCHAR(20) NOT NULL DEFAULT 'ASSET',
      responsible_department VARCHAR(20) NOT NULL DEFAULT 'GA',
      expected_quantity DECIMAL(14,2) NOT NULL DEFAULT 0,
      counted_quantity DECIMAL(14,2) NOT NULL DEFAULT 0,
      expected_location VARCHAR(255) NOT NULL DEFAULT '',
      actual_location VARCHAR(255) NOT NULL DEFAULT '',
      condition_status VARCHAR(40) NOT NULL DEFAULT 'GOOD',
      result_status VARCHAR(40) NOT NULL DEFAULT 'MATCH',
      count_date DATE NOT NULL,
      counted_by VARCHAR(64) NOT NULL DEFAULT '',
      counted_by_name VARCHAR(255) NOT NULL DEFAULT '',
      note TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY annual_inventory_item_year_unique (company_code, inventory_key, count_year),
      INDEX annual_inventory_company_year_idx (company_code, count_year),
      INDEX annual_inventory_responsible_idx (responsible_department, count_year)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS audit_logs (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      company_code VARCHAR(120) NOT NULL DEFAULT '',
      employee_code VARCHAR(64) NOT NULL DEFAULT '',
      module VARCHAR(80) NOT NULL,
      action VARCHAR(80) NOT NULL,
      entity_id VARCHAR(255) NOT NULL DEFAULT '',
      before_json LONGTEXT NOT NULL,
      after_json LONGTEXT NOT NULL,
      ip_address VARCHAR(120) NOT NULL DEFAULT '',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX audit_logs_created_idx (created_at)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS asset_assignment_requests (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      request_no VARCHAR(120) UNIQUE NOT NULL,
      company_code VARCHAR(120) NOT NULL,
      employee_code VARCHAR(64) NOT NULL,
      employee_name VARCHAR(255) NOT NULL,
      department VARCHAR(255) NOT NULL DEFAULT '',
      position_name VARCHAR(255) NOT NULL DEFAULT '',
      work_location VARCHAR(255) NOT NULL DEFAULT '',
      required_date DATE NULL,
      request_reason TEXT NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'DRAFT',
      requested_by VARCHAR(64) NOT NULL,
      requested_by_name VARCHAR(255) NOT NULL DEFAULT '',
      submitted_at TIMESTAMP NULL,
      reviewed_by VARCHAR(64) NOT NULL DEFAULT '',
      reviewed_by_name VARCHAR(255) NOT NULL DEFAULT '',
      reviewed_at TIMESTAMP NULL,
      decision_note TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL,
      INDEX assignment_requests_company_status_idx (company_code, status),
      INDEX assignment_requests_employee_idx (employee_code),
      CONSTRAINT assignment_requests_employee_fk FOREIGN KEY (employee_code) REFERENCES employees(id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS asset_assignment_request_items (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      request_id BIGINT NOT NULL,
      asset_category VARCHAR(120) NOT NULL,
      asset_subcategory VARCHAR(120) NOT NULL DEFAULT '',
      requested_quantity INT NOT NULL DEFAULT 1,
      specification TEXT NOT NULL,
      remarks TEXT NOT NULL,
      item_status VARCHAR(40) NOT NULL DEFAULT 'REQUESTED',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL,
      INDEX assignment_items_request_idx (request_id),
      CONSTRAINT assignment_items_request_fk FOREIGN KEY (request_id) REFERENCES asset_assignment_requests(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS asset_assignment_allocations (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      request_id BIGINT NOT NULL,
      request_item_id BIGINT NOT NULL,
      asset_id VARCHAR(64) NOT NULL,
      status VARCHAR(40) NOT NULL DEFAULT 'RESERVED',
      reserved_by VARCHAR(64) NOT NULL,
      reserved_by_name VARCHAR(255) NOT NULL DEFAULT '',
      reserved_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP NULL,
      note TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL,
      UNIQUE KEY assignment_allocations_request_asset_unique (request_id, asset_id),
      INDEX assignment_allocations_item_idx (request_item_id),
      INDEX assignment_allocations_asset_status_idx (asset_id, status),
      CONSTRAINT assignment_allocations_request_fk FOREIGN KEY (request_id) REFERENCES asset_assignment_requests(id) ON DELETE CASCADE,
      CONSTRAINT assignment_allocations_item_fk FOREIGN KEY (request_item_id) REFERENCES asset_assignment_request_items(id) ON DELETE CASCADE,
      CONSTRAINT assignment_allocations_asset_fk FOREIGN KEY (asset_id) REFERENCES assets(id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS asset_handovers (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      allocation_id BIGINT UNIQUE NOT NULL,
      request_id BIGINT NOT NULL,
      asset_id VARCHAR(64) NOT NULL,
      employee_code VARCHAR(64) NOT NULL,
      handed_over_by VARCHAR(64) NOT NULL,
      handed_over_by_name VARCHAR(255) NOT NULL DEFAULT '',
      handed_over_at TIMESTAMP NOT NULL,
      received_by VARCHAR(64) NOT NULL DEFAULT '',
      received_by_name VARCHAR(255) NOT NULL DEFAULT '',
      received_at TIMESTAMP NULL,
      asset_condition DECIMAL(8,2) NOT NULL DEFAULT 100,
      accessories_json LONGTEXT NOT NULL,
      handover_note TEXT NOT NULL,
      acknowledgement_status VARCHAR(40) NOT NULL DEFAULT 'PENDING',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NULL,
      INDEX asset_handovers_request_idx (request_id),
      CONSTRAINT asset_handovers_allocation_fk FOREIGN KEY (allocation_id) REFERENCES asset_assignment_allocations(id) ON DELETE CASCADE,
      CONSTRAINT asset_handovers_request_fk FOREIGN KEY (request_id) REFERENCES asset_assignment_requests(id) ON DELETE CASCADE,
      CONSTRAINT asset_handovers_asset_fk FOREIGN KEY (asset_id) REFERENCES assets(id),
      CONSTRAINT asset_handovers_employee_fk FOREIGN KEY (employee_code) REFERENCES employees(id)
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);


  await ensureAssetIdSequenceCompanyKey();


  // Continuous Asset ID counter: running numbers must not reset when the date changes.
  // Backfill from both existing Asset IDs and the legacy per-day sequence table so upgrades
  // preserve the highest number ever used for each company.
  await pool.query(`
    INSERT INTO asset_id_counters (company_code, last_number, updated_at)
    SELECT company,
           MAX(CASE WHEN id REGEXP '-[0-9]+$' THEN CAST(SUBSTRING_INDEX(id, '-', -1) AS UNSIGNED) ELSE 0 END),
           CURRENT_TIMESTAMP
    FROM assets
    GROUP BY company
    ON DUPLICATE KEY UPDATE
      last_number = GREATEST(asset_id_counters.last_number, VALUES(last_number)),
      updated_at = CURRENT_TIMESTAMP
  `);
  await pool.query(`
    INSERT INTO asset_id_counters (company_code, last_number, updated_at)
    SELECT company_code, MAX(last_number), CURRENT_TIMESTAMP
    FROM asset_id_sequences
    GROUP BY company_code
    ON DUPLICATE KEY UPDATE
      last_number = GREATEST(asset_id_counters.last_number, VALUES(last_number)),
      updated_at = CURRENT_TIMESTAMP
  `);

  await addColumnIfMissing('employees', 'company', `VARCHAR(120) NOT NULL DEFAULT '${defaultCompanySql}'`);
  await addColumnIfMissing('employees', 'email', "VARCHAR(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing('employees', 'phone', "VARCHAR(80) NOT NULL DEFAULT ''");
  await addColumnIfMissing('employees', 'role', "VARCHAR(80) NOT NULL DEFAULT 'VIEW'");
  await addColumnIfMissing('employees', 'status', "VARCHAR(40) NOT NULL DEFAULT 'ACTIVE'");
  await addColumnIfMissing('employees', 'updated_at', 'TIMESTAMP NULL');
  await addColumnIfMissing('employees', 'password_hash', "VARCHAR(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing('employees', 'must_change_password', 'TINYINT(1) NOT NULL DEFAULT 0');
  await addColumnIfMissing('employees', 'can_login', 'TINYINT(1) NOT NULL DEFAULT 0');

  // Migrate legacy access roles to the simplified five-role model.
  // SUPER_ADMIN must remain an administrator; older builds used this role name.
  await pool.query(`UPDATE employees SET role = CASE
    WHEN role IN ('ADMIN','SUPER_ADMIN') THEN 'ADMIN'
    WHEN role IN ('COMPANY_ADMIN','ASSET_MANAGER','WAREHOUSE','MAINTENANCE','DEPARTMENT_HEAD') THEN
      CASE
        WHEN UPPER(TRIM(department)) = 'HR' THEN 'HR'
        WHEN UPPER(TRIM(department)) IN ('ACCOUNTING','ACC') OR TRIM(department) = 'บัญชี' THEN 'ACCOUNTING'
        ELSE 'SUPERVISOR'
      END
    WHEN role = 'EMPLOYEE' THEN 'VIEW'
    WHEN role IN ('ADMIN','SUPERVISOR','HR','ACCOUNTING','VIEW') THEN role
    ELSE 'VIEW'
  END`);
  await pool.query('UPDATE employees SET must_change_password = 0 WHERE must_change_password <> 0');
  await pool.query("UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE employee_id IN (SELECT id FROM employees WHERE role = 'VIEW' AND can_login = 0)");

  await addColumnIfMissing('assets', 'accounting_asset_id', "VARCHAR(160) NOT NULL DEFAULT ''");
  await addColumnIfMissing('assets', 'company', `VARCHAR(120) NOT NULL DEFAULT '${defaultCompanySql}'`);
  await addColumnIfMissing('assets', 'brand', "VARCHAR(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing('assets', 'custodian_type', "VARCHAR(40) NOT NULL DEFAULT 'UNASSIGNED'");
  await addColumnIfMissing('assets', 'responsible_department', "VARCHAR(20) NOT NULL DEFAULT 'IT'");
  await addColumnIfMissing('assets', 'model', "VARCHAR(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing('assets', 'subcategory', "VARCHAR(120) NOT NULL DEFAULT ''");
  await addColumnIfMissing('assets', 'purchase_price', 'DECIMAL(12,2) NOT NULL DEFAULT 0');
  await addColumnIfMissing('assets', 'useful_life_years', 'DECIMAL(5,2) NOT NULL DEFAULT 5');
  await addColumnIfMissing('assets', 'salvage_value', 'DECIMAL(12,2) NOT NULL DEFAULT 0');
  await addColumnIfMissing('assets', 'criticality', "VARCHAR(40) NOT NULL DEFAULT 'MEDIUM'");
  await addColumnIfMissing('assets', 'ownership_type', "VARCHAR(60) NOT NULL DEFAULT 'OWNED'");
  await addColumnIfMissing('assets', 'ownership_type_other', "VARCHAR(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing('assets', 'vendor', "VARCHAR(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing('assets', 'manufacturer', "VARCHAR(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing('assets', 'asset_image', 'MEDIUMBLOB NULL');
  await addColumnIfMissing('assets', 'asset_image_mime', "VARCHAR(100) NOT NULL DEFAULT ''");
  await addColumnIfMissing('assets', 'purchase_document_type', "VARCHAR(50) NOT NULL DEFAULT ''");
  await addColumnIfMissing('assets', 'purchase_document_type_other', "VARCHAR(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing('assets', 'purchase_document_no', "VARCHAR(150) NOT NULL DEFAULT ''");
  await addColumnIfMissing('assets', 'purchase_document_date', 'DATE NULL');
  await addColumnIfMissing('assets', 'purchase_order_no', "VARCHAR(150) NOT NULL DEFAULT ''");
  await addColumnIfMissing('assets', 'tax_invoice_no', "VARCHAR(150) NOT NULL DEFAULT ''");
  await addColumnIfMissing('assets', 'accounting_note', 'TEXT NULL');
  await addColumnIfMissing('assets', 'purchase_document_file', 'MEDIUMBLOB NULL');
  await addColumnIfMissing('assets', 'purchase_document_mime', "VARCHAR(100) NOT NULL DEFAULT ''");
  await addColumnIfMissing('assets', 'purchase_document_name', "VARCHAR(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing('assets', 'qr_printed_at', 'TIMESTAMP NULL');
  await addColumnIfMissing('assets', 'updated_at', 'TIMESTAMP NULL');
  await addIndexIfMissing('assets', 'assets_accounting_asset_id_idx', 'INDEX assets_accounting_asset_id_idx (accounting_asset_id)');
  await addColumnIfMissing('facility_assets', 'asset_image', 'MEDIUMBLOB NULL');
  await addColumnIfMissing('facility_assets', 'asset_image_mime', "VARCHAR(100) NOT NULL DEFAULT ''");
  await addColumnIfMissing('facility_assets', 'asset_type', "VARCHAR(20) NOT NULL DEFAULT 'ASSET'");
  await addColumnIfMissing('facility_assets', 'responsible_department', "VARCHAR(20) NOT NULL DEFAULT 'GA'");


  // ย้ายรูปภาพทรัพย์สินส่วนกลางแบบเดิม (1 รูป/รายการ) ไปยังตารางรูปภาพหลายรูปเพียงครั้งเดียว
  await pool.query(`
    INSERT INTO facility_asset_images (facility_asset_id, mime_type, image_data, sort_order)
    SELECT f.id,
           CASE WHEN TRIM(COALESCE(f.asset_image_mime, '')) <> '' THEN f.asset_image_mime ELSE 'image/jpeg' END,
           f.asset_image,
           1
    FROM facility_assets f
    WHERE f.asset_image IS NOT NULL
      AND OCTET_LENGTH(f.asset_image) > 0
      AND NOT EXISTS (
        SELECT 1 FROM facility_asset_images fi WHERE fi.facility_asset_id = f.id
      )
  `);
  await pool.query(`
    UPDATE facility_assets f
    SET asset_image = NULL, asset_image_mime = ''
    WHERE f.asset_image IS NOT NULL
      AND EXISTS (SELECT 1 FROM facility_asset_images fi WHERE fi.facility_asset_id = f.id)
  `);

  // ย้ายเอกสารแนบแบบเดิม (1 ไฟล์/Asset) เข้าตารางเอกสารหลายไฟล์เพียงครั้งเดียว
  await pool.query(`
    INSERT INTO asset_purchase_documents (asset_id, file_name, mime_type, file_data)
    SELECT
      a.id,
      CASE
        WHEN TRIM(COALESCE(a.purchase_document_name, '')) <> '' THEN a.purchase_document_name
        ELSE CONCAT('purchase-document-', a.id)
      END,
      CASE
        WHEN TRIM(COALESCE(a.purchase_document_mime, '')) <> '' THEN a.purchase_document_mime
        ELSE 'application/octet-stream'
      END,
      a.purchase_document_file
    FROM assets a
    WHERE a.purchase_document_file IS NOT NULL
      AND OCTET_LENGTH(a.purchase_document_file) > 0
      AND NOT EXISTS (
        SELECT 1
        FROM asset_purchase_documents d
        WHERE d.asset_id = a.id
      )
  `);
  await pool.query(`
    UPDATE assets
    SET purchase_document_file = NULL,
        purchase_document_mime = '',
        purchase_document_name = ''
    WHERE purchase_document_file IS NOT NULL
      AND OCTET_LENGTH(purchase_document_file) > 0
      AND EXISTS (
        SELECT 1
        FROM asset_purchase_documents d
        WHERE d.asset_id = assets.id
      )
  `);

  // Normalize legacy placeholder holders so every workflow uses explicit custodian_type.
  await pool.query(`UPDATE assets SET assigned_to = '', department = '', custodian_type = 'UNASSIGNED',
                    status = CASE WHEN status = 'ACTIVE' THEN 'IN_STOCK' ELSE status END
                    WHERE TRIM(COALESCE(assigned_to, '')) IN ('', '-', 'UNASSIGNED', 'คลังกลาง')`);
  await pool.query(`UPDATE assets SET assigned_to = 'ทรัพย์สินส่วนกลาง', custodian_type = 'SHARED',
                    status = CASE WHEN status IN ('IN_STOCK','INACTIVE') THEN 'ACTIVE' ELSE status END
                    WHERE TRIM(COALESCE(assigned_to, '')) IN ('ส่วนกลาง', 'ทรัพย์สินส่วนกลาง')`);
  await pool.query(`UPDATE assets SET custodian_type = 'EMPLOYEE'
                    WHERE TRIM(COALESCE(assigned_to, '')) <> ''
                      AND assigned_to <> 'ทรัพย์สินส่วนกลาง'
                      AND custodian_type NOT IN ('EMPLOYEE','SHARED')`);

  await addColumnIfMissing('stock_items', 'company', `VARCHAR(120) NOT NULL DEFAULT '${defaultCompanySql}'`);
  await addColumnIfMissing('stock_items', 'category', "VARCHAR(120) NOT NULL DEFAULT ''");
  await addColumnIfMissing('stock_items', 'unit', "VARCHAR(40) NOT NULL DEFAULT 'pcs'");
  await addColumnIfMissing('stock_items', 'warehouse', "VARCHAR(120) NOT NULL DEFAULT ''");
  await addColumnIfMissing('stock_items', 'max_level', 'DECIMAL(14,2) NOT NULL DEFAULT 0');
  await addColumnIfMissing('stock_items', 'status', "VARCHAR(40) NOT NULL DEFAULT 'ACTIVE'");
  await addColumnIfMissing('stock_items', 'unit_cost', 'DECIMAL(12,2) NOT NULL DEFAULT 0');
  await addColumnIfMissing('stock_items', 'updated_at', 'TIMESTAMP NULL');

  // Keep schema defaults aligned with the configured initial company. This is configuration, not seeded business data.
  await pool.query(`ALTER TABLE employees MODIFY company VARCHAR(120) NOT NULL DEFAULT '${defaultCompanySql}'`);
  await pool.query(`ALTER TABLE assets MODIFY company VARCHAR(120) NOT NULL DEFAULT '${defaultCompanySql}'`);
  await pool.query(`ALTER TABLE stock_items MODIFY company VARCHAR(120) NOT NULL DEFAULT '${defaultCompanySql}'`);

  await addColumnIfMissing('return_records', 'returned_items', 'TEXT NULL');
  await addColumnIfMissing('return_records', 'missing_items', 'TEXT NULL');
  await addColumnIfMissing('return_records', 'return_reason', "VARCHAR(40) NOT NULL DEFAULT 'RETURN_TO_POOL'");
  await addColumnIfMissing('return_records', 'previous_assignee', "VARCHAR(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing('return_records', 'previous_department', "VARCHAR(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing('return_records', 'previous_location', "VARCHAR(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing('approvals', 'requester_employee_code', "VARCHAR(64) NOT NULL DEFAULT ''");
  await addColumnIfMissing('maintenance', 'requested_by', "VARCHAR(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing('maintenance', 'service_department', "VARCHAR(20) NOT NULL DEFAULT 'IT'");
  await addColumnIfMissing('maintenance', 'requester_employee_code', "VARCHAR(64) NOT NULL DEFAULT ''");
  await addColumnIfMissing('maintenance', 'previous_asset_status', "VARCHAR(40) NOT NULL DEFAULT 'ACTIVE'");
  await addColumnIfMissing('maintenance', 'priority', "VARCHAR(20) NOT NULL DEFAULT 'NORMAL'");
  await addColumnIfMissing('maintenance', 'estimated_cost', 'DECIMAL(14, 2) NULL');
  await addColumnIfMissing('maintenance', 'diagnosis', 'TEXT NULL');
  await addColumnIfMissing('maintenance', 'repair_method', "VARCHAR(40) NOT NULL DEFAULT ''");
  await addColumnIfMissing('maintenance', 'repair_method_other', "VARCHAR(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing('maintenance', 'vendor', "VARCHAR(255) NOT NULL DEFAULT ''");

  await addColumnIfMissing('repair_records', 'maintenance_id', 'BIGINT NULL');
  await addColumnIfMissing('repair_records', 'ticket_no', "VARCHAR(120) NOT NULL DEFAULT ''");
  await addColumnIfMissing('repair_records', 'issue', 'TEXT NULL');
  await addColumnIfMissing('repair_records', 'diagnosis', 'TEXT NULL');
  await addColumnIfMissing('repair_records', 'repair_method', "VARCHAR(40) NOT NULL DEFAULT ''");
  await addColumnIfMissing('repair_records', 'vendor', "VARCHAR(255) NOT NULL DEFAULT ''");
  await addIndexIfMissing('repair_records', 'repair_records_maintenance_unique', 'UNIQUE KEY repair_records_maintenance_unique (maintenance_id)');

  await pool.query("UPDATE assets SET responsible_department = 'IT' WHERE responsible_department NOT IN ('IT','GA','HR') OR responsible_department IS NULL OR TRIM(responsible_department) = ''");
  await pool.query("UPDATE facility_assets SET asset_type = 'ASSET' WHERE asset_type NOT IN ('ASSET','FREE_ASSET','NON_ASSET') OR asset_type IS NULL OR TRIM(asset_type) = ''");
  await pool.query("UPDATE facility_assets SET responsible_department = 'GA' WHERE responsible_department NOT IN ('IT','GA','HR') OR responsible_department IS NULL OR TRIM(responsible_department) = ''");
  await pool.query("UPDATE maintenance SET service_department = 'IT' WHERE service_department NOT IN ('IT','GA') OR service_department IS NULL OR TRIM(service_department) = ''");
  await addColumnIfMissing('disposals', 'disposal_method_other', "VARCHAR(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing('borrow_records', 'original_assignee', "VARCHAR(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing('borrow_records', 'original_custodian_type', "VARCHAR(40) NOT NULL DEFAULT 'UNASSIGNED'");
  await addColumnIfMissing('borrow_records', 'original_asset_status', "VARCHAR(40) NOT NULL DEFAULT 'ACTIVE'");
  await addColumnIfMissing('borrow_records', 'original_department', "VARCHAR(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing('borrow_records', 'original_location', "VARCHAR(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing('borrow_records', 'received_by', "VARCHAR(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing('borrow_records', 'return_location', "VARCHAR(255) NOT NULL DEFAULT ''");
  await addColumnIfMissing('stock_movements', 'before_json', 'LONGTEXT NULL');
  await addColumnIfMissing('stock_movements', 'after_json', 'LONGTEXT NULL');
  await addColumnIfMissing('stock_movements', 'updated_at', 'TIMESTAMP NULL');
  // Backfill the Asset repair timeline from already-closed Maintenance Tickets.
  // Older builds closed the ticket but never copied it to repair_records, so Asset Detail
  // incorrectly showed "ยังไม่มีประวัติซ่อม".
  await pool.query(`
    INSERT INTO repair_records (
      maintenance_id, asset_id, repair_date, detail, cost, technician,
      ticket_no, issue, diagnosis, repair_method, vendor
    )
    SELECT m.id, m.asset_id,
           COALESCE(NULLIF(m.closed_date, ''), NULLIF(m.opened_date, ''), DATE(m.created_at)),
           TRIM(CONCAT_WS(' · ', NULLIF(m.issue, ''), NULLIF(m.diagnosis, ''), NULLIF(m.note, ''))),
           m.cost, m.technician, m.ticket_no, m.issue, m.diagnosis, m.repair_method, m.vendor
    FROM maintenance m
    WHERE m.status = 'CLOSED'
    ON DUPLICATE KEY UPDATE
      asset_id = VALUES(asset_id),
      repair_date = VALUES(repair_date),
      detail = VALUES(detail),
      cost = VALUES(cost),
      technician = VALUES(technician),
      ticket_no = VALUES(ticket_no),
      issue = VALUES(issue),
      diagnosis = VALUES(diagnosis),
      repair_method = VALUES(repair_method),
      vendor = VALUES(vendor)
  `);

  await ensureMasterRecordCompanyIndex();
  await consolidateSharedMasterRecords();

  // ย้ายรูปภาพทะเบียนทรัพย์สินแบบเดิม (1 รูป/Asset) เข้าตารางหลายรูปเพียงครั้งเดียว
  await pool.query(`
    INSERT INTO asset_images (asset_id, mime_type, image_data, sort_order)
    SELECT a.id, COALESCE(NULLIF(a.asset_image_mime, ''), 'image/jpeg'), a.asset_image, 1
    FROM assets a
    WHERE a.asset_image IS NOT NULL
      AND OCTET_LENGTH(a.asset_image) > 0
      AND NOT EXISTS (SELECT 1 FROM asset_images ai WHERE ai.asset_id = a.id)
  `);

  // Do not rewrite company codes or insert fixed demo companies. Existing database values remain unchanged.
  const [companyCountRows] = await pool.query('SELECT COUNT(*) AS total FROM companies');
  if (Number(companyCountRows[0]?.total || 0) === 0) {
    const initialCompanyName = text(process.env.INITIAL_COMPANY_NAME || defaultCompany);
    await pool.query(
      `INSERT INTO companies (
        company_code, company_name_th, company_name_en, address, logo_url, status, updated_at
      ) VALUES (?, ?, ?, '', '', 'ACTIVE', CURRENT_TIMESTAMP)`,
      [defaultCompany, initialCompanyName, initialCompanyName]
    );
  }

  const defaultPasswordHash = hashPassword(defaultPassword);
  await pool.query(
    "UPDATE employees SET password_hash = ?, must_change_password = 0 WHERE can_login = 1 AND (password_hash IS NULL OR password_hash = '')",
    [defaultPasswordHash]
  );

  // Recover the built-in administrator after upgrading from legacy role models.
  // Previous builds could accidentally map SUPER_ADMIN to VIEW. When the well-known
  // administrator identity is found in a non-ADMIN role, promote it and reset its
  // password once to DEFAULT_LOGIN_PASSWORD so the installation cannot lock itself out.
  const [recoveryAdminRows] = await pool.query(
    `SELECT id, role, status, can_login, email
     FROM employees
     WHERE LOWER(email) = LOWER('admin@company.local') OR id IN ('ADMIN-001', 'ADMIN')
     ORDER BY CASE
       WHEN LOWER(email) = LOWER('admin@company.local') THEN 0
       WHEN id = 'ADMIN-001' THEN 1
       ELSE 2
     END
     LIMIT 1`
  );
  const recoveryAdmin = recoveryAdminRows[0];
  if (recoveryAdmin) {
    const needsRecovery = recoveryAdmin.role !== 'ADMIN'
      || recoveryAdmin.status !== 'ACTIVE'
      || Number(recoveryAdmin.can_login || 0) !== 1;
    if (needsRecovery) {
      await pool.query(
        `UPDATE employees
         SET role = 'ADMIN', status = 'ACTIVE', can_login = 1,
             email = 'admin@company.local', password_hash = ?, must_change_password = 0,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [defaultPasswordHash, recoveryAdmin.id]
      );
      console.warn(`Recovered administrator ${recoveryAdmin.id}; password reset to DEFAULT_LOGIN_PASSWORD.`);
    }
  } else {
    await pool.query(
      `INSERT INTO employees (
        id, company, name, department, position, location, email, phone,
        role, status, password_hash, must_change_password, can_login, updated_at
      ) VALUES (?, ?, ?, ?, ?, '-', ?, '', 'ADMIN', 'ACTIVE', ?, 0, 1, CURRENT_TIMESTAMP)`,
      ['ADMIN-001', defaultCompany, 'ผู้ดูแลระบบ', 'IT', 'System Admin', 'admin@company.local', defaultPasswordHash]
    );
    console.log('Created recovery administrator ADMIN-001.');
  }

  await pool.query(`
    INSERT IGNORE INTO stock_balances (
      sku, company_code, warehouse, location, available, min_level, max_level, updated_at
    )
    SELECT sku, company, COALESCE(NULLIF(warehouse, ''), 'MAIN'), location,
           available, min_level, max_level, CURRENT_TIMESTAMP
    FROM stock_items
  `);

  await pool.query('DELETE FROM auth_sessions WHERE expires_at <= CURRENT_TIMESTAMP OR revoked_at IS NOT NULL');
}


function assetVisibility(user, alias = '') {
  const column = (name) => alias ? `${alias}.${name}` : name;
  if (!user || isSuperAdmin(user)) return { sql: '1=1', params: [] };
  return { sql: `${column('company')} = ?`, params: [normalizeCompany(user.company)] };
}

function canCreateAssignmentForEmployee(user, employee) {
  if (!['ADMIN', 'SUPERVISOR', 'HR'].includes(user?.role)) return false;
  if (isSuperAdmin(user)) return true;
  return normalizeCompany(employee.company) === normalizeCompany(user.company);
}

async function assertApprovalScope(_connection, user, approval) {
  if (isSuperAdmin(user)) return;
  assertCompanyAccess(user, approval.company_code);
  if (user.role !== 'SUPERVISOR') {
    throw httpError(403, 'เฉพาะ Admin หรือ Supervisor เท่านั้นที่อนุมัติ Workflow ได้');
  }
}

async function getAssets(user = null) {
  const scope = assetVisibility(user);
  const [assets] = await pool.query(
    `SELECT ${assetListColumns} FROM assets WHERE ${scope.sql} ORDER BY created_at DESC`,
    scope.params
  );
  const assetIds = assets.map((asset) => asset.id);
  if (!assetIds.length) return [];
  const marks = assetIds.map(() => '?').join(',');
  const [repairs] = await pool.query(`SELECT * FROM repair_records WHERE asset_id IN (${marks}) ORDER BY created_at DESC, id DESC`, assetIds);
  const [returns] = await pool.query(`SELECT * FROM return_records WHERE asset_id IN (${marks}) ORDER BY created_at DESC, id DESC`, assetIds);
  const [items] = await pool.query(`SELECT * FROM asset_items WHERE asset_id IN (${marks}) ORDER BY id ASC`, assetIds);
  const [purchaseDocuments] = await pool.query(
    `SELECT id, asset_id, file_name, mime_type, created_at
     FROM asset_purchase_documents
     WHERE asset_id IN (${marks})
     ORDER BY created_at ASC, id ASC`,
    assetIds
  );
  const [assetImages] = await pool.query(
    `SELECT id, asset_id, mime_type, sort_order
     FROM asset_images
     WHERE asset_id IN (${marks})
     ORDER BY asset_id ASC, sort_order ASC, id ASC`,
    assetIds
  );

  const repairsByAsset = new Map();
  const returnsByAsset = new Map();
  const itemsByAsset = new Map();
  const purchaseDocumentsByAsset = new Map();
  const imagesByAsset = new Map();

  for (const repair of repairs) {
    const current = repairsByAsset.get(repair.asset_id) ?? [];
    current.push({
      date: repair.repair_date,
      detail: repair.detail,
      cost: Number(repair.cost),
      technician: repair.technician,
      maintenanceId: repair.maintenance_id == null ? null : Number(repair.maintenance_id),
      ticketNo: repair.ticket_no || '',
      issue: repair.issue || '',
      diagnosis: repair.diagnosis || '',
      repairMethod: repair.repair_method || '',
      vendor: repair.vendor || ''
    });
    repairsByAsset.set(repair.asset_id, current);
  }
  for (const record of returns) {
    const current = returnsByAsset.get(record.asset_id) ?? [];
    current.push({
      date: record.return_date,
      returnedBy: record.returned_by,
      receivedBy: record.received_by,
      location: record.return_location,
      condition: Number(record.condition),
      note: record.note,
      returnedItems: safeJsonArray(record.returned_items),
      missingItems: safeJsonArray(record.missing_items),
      reason: record.return_reason || 'RETURN_TO_POOL',
      previousAssignee: record.previous_assignee || '',
      previousDepartment: record.previous_department || '',
      previousLocation: record.previous_location || ''
    });
    returnsByAsset.set(record.asset_id, current);
  }
  for (const item of items) {
    const current = itemsByAsset.get(item.asset_id) ?? [];
    current.push(toAssetItem(item));
    itemsByAsset.set(item.asset_id, current);
  }
  for (const document of purchaseDocuments) {
    const current = purchaseDocumentsByAsset.get(document.asset_id) ?? [];
    current.push(toPurchaseDocumentMeta(document));
    purchaseDocumentsByAsset.set(document.asset_id, current);
  }
  for (const image of assetImages) {
    const current = imagesByAsset.get(image.asset_id) ?? [];
    current.push({
      id: Number(image.id),
      mime: image.mime_type || '',
      url: `/api/assets/${encodeURIComponent(image.asset_id)}/images/${Number(image.id)}`
    });
    imagesByAsset.set(image.asset_id, current);
  }

  return assets.map((asset) => assetForUser(toAsset(
    asset,
    repairsByAsset.get(asset.id) ?? [],
    returnsByAsset.get(asset.id) ?? [],
    itemsByAsset.get(asset.id) ?? [],
    purchaseDocumentsByAsset.get(asset.id) ?? [],
    imagesByAsset.get(asset.id) ?? []
  ), user));
}

async function getAssetById(id, user = null) {
  const scope = assetVisibility(user);
  const [rows] = await pool.query(
    `SELECT ${assetListColumns} FROM assets WHERE id = ? AND ${scope.sql} LIMIT 1`,
    [id, ...scope.params]
  );
  if (!rows[0]) return null;

  const [repairs] = await pool.query('SELECT * FROM repair_records WHERE asset_id = ? ORDER BY created_at DESC, id DESC', [id]);
  const [returns] = await pool.query('SELECT * FROM return_records WHERE asset_id = ? ORDER BY created_at DESC, id DESC', [id]);
  const [events] = await pool.query('SELECT * FROM asset_events WHERE asset_id = ? ORDER BY created_at DESC, id DESC LIMIT 200', [id]);
  const [items] = await pool.query('SELECT * FROM asset_items WHERE asset_id = ? ORDER BY id ASC', [id]);
  const [purchaseDocuments] = await pool.query(
    `SELECT id, asset_id, file_name, mime_type, created_at
     FROM asset_purchase_documents
     WHERE asset_id = ?
     ORDER BY created_at ASC, id ASC`,
    [id]
  );
  const [assetImages] = await pool.query(
    `SELECT id, asset_id, mime_type, sort_order
     FROM asset_images
     WHERE asset_id = ?
     ORDER BY sort_order ASC, id ASC`,
    [id]
  );
  const imageMeta = assetImages.map((image) => ({
    id: Number(image.id),
    mime: image.mime_type || '',
    url: `/api/assets/${encodeURIComponent(image.asset_id)}/images/${Number(image.id)}`
  }));
  return assetForUser(toAsset(
    rows[0],
    repairs.map((repair) => ({
      date: repair.repair_date,
      detail: repair.detail,
      cost: Number(repair.cost),
      technician: repair.technician,
      maintenanceId: repair.maintenance_id == null ? null : Number(repair.maintenance_id),
      ticketNo: repair.ticket_no || '',
      issue: repair.issue || '',
      diagnosis: repair.diagnosis || '',
      repairMethod: repair.repair_method || '',
      vendor: repair.vendor || ''
    })),
    returns.map((record) => ({
      date: record.return_date,
      returnedBy: record.returned_by,
      receivedBy: record.received_by,
      location: record.return_location,
      condition: Number(record.condition),
      note: record.note,
      returnedItems: safeJsonArray(record.returned_items),
      missingItems: safeJsonArray(record.missing_items),
      reason: record.return_reason || 'RETURN_TO_POOL',
      previousAssignee: record.previous_assignee || '',
      previousDepartment: record.previous_department || '',
      previousLocation: record.previous_location || ''
    })),
    items.map(toAssetItem),
    purchaseDocuments.map(toPurchaseDocumentMeta),
    imageMeta,
    events.map((event) => ({
      id: Number(event.id),
      type: event.event_type || '',
      oldValue: event.old_value || '',
      newValue: event.new_value || '',
      actor: event.actor || '',
      note: event.note || '',
      createdAt: event.created_at
    }))
  ), user);
}

async function getEmployees(user = null) {
  if (!user || isSuperAdmin(user)) {
    const [rows] = await pool.query('SELECT * FROM employees ORDER BY created_at DESC');
    return rows.map(toEmployee);
  }
  if (['SUPERVISOR', 'HR'].includes(user.role)) {
    const [rows] = await pool.query('SELECT * FROM employees WHERE company = ? ORDER BY created_at DESC', [normalizeCompany(user.company)]);
    return rows.map(toEmployee);
  }
  const [rows] = await pool.query('SELECT * FROM employees WHERE id = ? LIMIT 1', [user.id]);
  return rows.map(toEmployee);
}

const assignmentEditableStatuses = new Set(['DRAFT', 'RETURNED_FOR_EDIT']);
const assignmentManageStatuses = new Set(['SUBMITTED', 'IT_REVIEW']);
const assignmentOpenAllocationStatuses = ['RESERVED', 'HANDED_OVER'];

function normalizeAssignmentItems(value) {
  const rows = Array.isArray(value) ? value : [];
  if (!rows.length) throw httpError(400, 'กรุณาระบุรายการทรัพย์สินอย่างน้อย 1 รายการ');
  return rows.map((item, index) => {
    const assetCategory = text(item.assetCategory || item.asset_category);
    const requestedQuantity = Math.floor(numberValue(item.requestedQuantity ?? item.requested_quantity, 1));
    if (!assetCategory) throw httpError(400, `รายการที่ ${index + 1}: กรุณาระบุหมวดทรัพย์สิน`);
    if (requestedQuantity < 1 || requestedQuantity > 50) {
      throw httpError(400, `รายการที่ ${index + 1}: จำนวนต้องอยู่ระหว่าง 1 ถึง 50`);
    }
    return {
      assetCategory,
      assetSubcategory: text(item.assetSubcategory || item.asset_subcategory),
      requestedQuantity,
      specification: text(item.specification),
      remarks: text(item.remarks)
    };
  });
}

function canManageAssignments(user) {
  return hasPermission(user, 'assignment.manage');
}

function canRequestAssignments(user) {
  return hasPermission(user, 'assignment.request');
}

function assignmentRequestVisibleToUser(row, user) {
  if (isSuperAdmin(user)) return true;
  if (normalizeCompany(row.company_code) !== normalizeCompany(user.company)) return false;
  if (canManageAssignments(user)) return true;
  return row.employee_code === user.id || row.requested_by === user.id;
}

function toAssignmentHandover(row) {
  if (!row || !row.handover_id) return null;
  return {
    id: Number(row.handover_id),
    allocationId: Number(row.id),
    assetId: row.asset_id,
    handedOverBy: row.handed_over_by_name || row.handed_over_by || '',
    handedOverAt: row.handed_over_at || '',
    receivedBy: row.received_by_name || row.received_by || '',
    receivedAt: row.received_at || '',
    assetCondition: Number(row.asset_condition ?? 100),
    accessories: safeJsonArray(row.accessories_json),
    handoverNote: row.handover_note || '',
    acknowledgementStatus: row.acknowledgement_status || 'PENDING'
  };
}

async function loadAssignmentRequests(user, requestId = null) {
  const params = [];
  const where = [];
  if (requestId != null) {
    where.push('r.id = ?');
    params.push(Number(requestId));
  }
  if (!isSuperAdmin(user)) {
    where.push('r.company_code = ?');
    params.push(normalizeCompany(user.company));
  }
  if (!canManageAssignments(user)) {
    where.push('(r.employee_code = ? OR r.requested_by = ?)');
    params.push(user.id, user.id);
  }

  const [requests] = await pool.query(
    `SELECT r.*
     FROM asset_assignment_requests r
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY r.created_at DESC, r.id DESC`,
    params
  );
  if (!requests.length) return [];

  const requestIds = requests.map((row) => row.id);
  const marks = requestIds.map(() => '?').join(',');
  const [items] = await pool.query(
    `SELECT * FROM asset_assignment_request_items
     WHERE request_id IN (${marks})
     ORDER BY id ASC`,
    requestIds
  );
  const [allocations] = await pool.query(
    `SELECT
       a.*,
       s.name AS asset_name,
       s.category AS asset_category,
       s.subcategory AS asset_subcategory,
       s.serial AS asset_serial,
       s.status AS asset_status,
       s.location AS asset_location,
       h.id AS handover_id,
       h.handed_over_by,
       h.handed_over_by_name,
       h.handed_over_at,
       h.received_by,
       h.received_by_name,
       h.received_at,
       h.asset_condition,
       h.accessories_json,
       h.handover_note,
       h.acknowledgement_status
     FROM asset_assignment_allocations a
     INNER JOIN assets s ON s.id = a.asset_id
     LEFT JOIN asset_handovers h ON h.allocation_id = a.id
     WHERE a.request_id IN (${marks})
     ORDER BY a.id ASC`,
    requestIds
  );

  const allocationsByItem = new Map();
  for (const row of allocations) {
    const current = allocationsByItem.get(Number(row.request_item_id)) || [];
    current.push({
      id: Number(row.id),
      requestItemId: Number(row.request_item_id),
      assetId: row.asset_id,
      assetName: row.asset_name || '',
      assetCategory: row.asset_category || '',
      assetSubcategory: row.asset_subcategory || '',
      assetSerial: row.asset_serial || '',
      assetStatus: normalizeAssetStatus(row.asset_status),
      assetLocation: row.asset_location || '',
      status: row.status || 'RESERVED',
      reservedBy: row.reserved_by_name || row.reserved_by || '',
      reservedAt: row.reserved_at || '',
      handover: toAssignmentHandover(row)
    });
    allocationsByItem.set(Number(row.request_item_id), current);
  }

  const itemsByRequest = new Map();
  for (const row of items) {
    const current = itemsByRequest.get(Number(row.request_id)) || [];
    current.push({
      id: Number(row.id),
      assetCategory: row.asset_category,
      assetSubcategory: row.asset_subcategory || '',
      requestedQuantity: Number(row.requested_quantity || 1),
      specification: row.specification || '',
      remarks: row.remarks || '',
      itemStatus: row.item_status || 'REQUESTED',
      allocations: allocationsByItem.get(Number(row.id)) || []
    });
    itemsByRequest.set(Number(row.request_id), current);
  }

  return requests.filter((row) => assignmentRequestVisibleToUser(row, user)).map((row) => {
    const requestItems = itemsByRequest.get(Number(row.id)) || [];
    const requestedCount = requestItems.reduce((sum, item) => sum + Number(item.requestedQuantity || 0), 0);
    const allocatedCount = requestItems.reduce((sum, item) => sum + item.allocations.filter((allocation) => allocation.status !== 'CANCELLED').length, 0);
    const completedCount = requestItems.reduce((sum, item) => sum + item.allocations.filter((allocation) => allocation.status === 'COMPLETED').length, 0);
    return {
      id: Number(row.id),
      requestNo: row.request_no,
      companyCode: normalizeCompany(row.company_code),
      employeeCode: row.employee_code,
      employeeName: row.employee_name,
      department: row.department || '',
      positionName: row.position_name || '',
      workLocation: row.work_location || '',
      requiredDate: row.required_date || '',
      requestReason: row.request_reason || '',
      status: row.status || 'DRAFT',
      requestedBy: row.requested_by || '',
      requestedByName: row.requested_by_name || '',
      submittedAt: row.submitted_at || '',
      reviewedBy: row.reviewed_by || '',
      reviewedByName: row.reviewed_by_name || '',
      reviewedAt: row.reviewed_at || '',
      decisionNote: row.decision_note || '',
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || row.created_at || '',
      requestedCount,
      allocatedCount,
      completedCount,
      items: requestItems
    };
  });
}

async function loadAssignmentRequestById(id, user) {
  const rows = await loadAssignmentRequests(user, id);
  return rows[0] || null;
}

async function assertAssignmentEmployee(user, employeeCode) {
  const [rows] = await pool.query(
    "SELECT * FROM employees WHERE id = ? AND status = 'ACTIVE' LIMIT 1",
    [employeeCode]
  );
  if (!rows[0]) throw httpError(400, 'ไม่พบพนักงานที่ Active');
  assertCompanyAccess(user, rows[0].company);
  if (!canCreateAssignmentForEmployee(user, rows[0])) {
    throw httpError(403, 'ไม่มีสิทธิ์สร้างคำขอให้พนักงานรายนี้');
  }
  return rows[0];
}

async function insertAssignmentItems(connection, requestId, items) {
  for (const item of items) {
    await connection.query(
      `INSERT INTO asset_assignment_request_items (
        request_id, asset_category, asset_subcategory, requested_quantity,
        specification, remarks, item_status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'REQUESTED', CURRENT_TIMESTAMP)`,
      [requestId, item.assetCategory, item.assetSubcategory, item.requestedQuantity, item.specification, item.remarks]
    );
  }
}

async function refreshAssignmentItemStatuses(connection, requestId) {
  const [items] = await connection.query(
    'SELECT id, requested_quantity FROM asset_assignment_request_items WHERE request_id = ?',
    [requestId]
  );
  for (const item of items) {
    const [countRows] = await connection.query(
      "SELECT COUNT(*) AS total FROM asset_assignment_allocations WHERE request_item_id = ? AND status <> 'CANCELLED'",
      [item.id]
    );
    const total = Number(countRows[0]?.total || 0);
    const status = total === 0 ? 'REQUESTED' : total >= Number(item.requested_quantity) ? 'ALLOCATED' : 'PARTIAL';
    await connection.query(
      'UPDATE asset_assignment_request_items SET item_status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [status, item.id]
    );
  }
}


async function getStock(user = null) {
  if (user && !hasPermission(user, 'stock.read')) return [];
  const params = [];
  let where = '';
  if (user && !isSuperAdmin(user)) {
    where = 'WHERE b.company_code = ?';
    params.push(normalizeCompany(user.company));
  }
  const [rows] = await pool.query(
    `SELECT
       b.id AS balance_id,
       i.sku,
       i.company,
       i.name,
       i.category,
       i.unit,
       i.status,
       i.unit_cost,
       b.warehouse,
       b.available,
       b.min_level,
       b.max_level,
       b.location,
       COALESCE(b.updated_at, i.updated_at, i.created_at) AS updated_at
     FROM stock_items i
     INNER JOIN stock_balances b ON b.sku = i.sku
     ${where}
     ORDER BY i.name ASC, b.warehouse ASC`,
    params
  );
  return rows.map(toStock);
}

async function syncLegacyStockItem(connection, sku) {
  const [rows] = await connection.query(
    `SELECT COALESCE(SUM(available), 0) AS total,
            MIN(warehouse) AS warehouse,
            MIN(location) AS location,
            MIN(min_level) AS min_level,
            MAX(max_level) AS max_level
     FROM stock_balances WHERE sku = ?`,
    [sku]
  );
  const row = rows[0] || {};
  await connection.query(
    `UPDATE stock_items SET available = ?, warehouse = ?, location = ?, min_level = ?, max_level = ?, updated_at = CURRENT_TIMESTAMP WHERE sku = ?`,
    [Number(row.total || 0), row.warehouse || 'MAIN', row.location || '', Number(row.min_level || 0), Number(row.max_level || 0), sku]
  );
}


async function applyStockMovement(connection, user, payload) {
  const sku = text(payload.sku);
  const movementType = text(payload.movementType || payload.movement_type).toUpperCase();
  const quantity = numberValue(payload.quantity);
  if (!sku || !['RECEIVE', 'ISSUE', 'TRANSFER', 'ADJUST'].includes(movementType)) {
    throw httpError(400, 'ข้อมูลการเคลื่อนไหว Stock ไม่ถูกต้อง');
  }
  if (movementType !== 'ADJUST' && quantity <= 0) throw httpError(400, 'จำนวนต้องมากกว่า 0');

  const [itemRows] = await connection.query('SELECT * FROM stock_items WHERE sku = ? FOR UPDATE', [sku]);
  if (!itemRows[0]) throw httpError(404, 'ไม่พบ SKU');
  const item = itemRows[0];
  assertCompanyAccess(user, item.company);

  const fromWarehouse = text(payload.fromWarehouse || payload.from_warehouse);
  const toWarehouse = text(payload.toWarehouse || payload.to_warehouse);
  let movementQuantity = quantity;
  const balancesBefore = {};
  const balancesAfter = {};

  async function lockBalance(warehouse, createIfMissing = false) {
    if (!warehouse) throw httpError(400, 'กรุณาระบุคลังสินค้า');
    let [rows] = await connection.query(
      'SELECT * FROM stock_balances WHERE sku = ? AND warehouse = ? FOR UPDATE',
      [sku, warehouse]
    );
    if (!rows[0] && createIfMissing) {
      await connection.query(
        `INSERT INTO stock_balances (sku, company_code, warehouse, location, available, min_level, max_level, updated_at)
         VALUES (?, ?, ?, '', 0, ?, ?, CURRENT_TIMESTAMP)`,
        [sku, normalizeCompany(item.company), warehouse, Number(item.min_level || 0), Number(item.max_level || 0)]
      );
      [rows] = await connection.query(
        'SELECT * FROM stock_balances WHERE sku = ? AND warehouse = ? FOR UPDATE',
        [sku, warehouse]
      );
    }
    if (!rows[0]) throw httpError(404, `ไม่พบยอดคงเหลือในคลัง ${warehouse}`);
    return rows[0];
  }

  if (movementType === 'RECEIVE') {
    const target = await lockBalance(toWarehouse || fromWarehouse, true);
    const before = Number(target.available || 0);
    const after = before + quantity;
    await connection.query(
      'UPDATE stock_balances SET available = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [after, target.id]
    );
    balancesBefore[target.warehouse] = before;
    balancesAfter[target.warehouse] = after;
  } else if (movementType === 'ISSUE') {
    const source = await lockBalance(fromWarehouse || toWarehouse, false);
    const before = Number(source.available || 0);
    if (before < quantity) throw httpError(400, `Stock ในคลัง ${source.warehouse} ไม่เพียงพอ`);
    const after = before - quantity;
    await connection.query(
      'UPDATE stock_balances SET available = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [after, source.id]
    );
    balancesBefore[source.warehouse] = before;
    balancesAfter[source.warehouse] = after;
  } else if (movementType === 'TRANSFER') {
    if (!fromWarehouse || !toWarehouse) throw httpError(400, 'กรุณาระบุคลังต้นทางและคลังปลายทาง');
    if (fromWarehouse === toWarehouse) throw httpError(400, 'คลังต้นทางและปลายทางต้องไม่เหมือนกัน');
    const source = await lockBalance(fromWarehouse, false);
    const target = await lockBalance(toWarehouse, true);
    const sourceBefore = Number(source.available || 0);
    const targetBefore = Number(target.available || 0);
    if (sourceBefore < quantity) throw httpError(400, `Stock ในคลัง ${fromWarehouse} ไม่เพียงพอ`);
    await connection.query('UPDATE stock_balances SET available = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [sourceBefore - quantity, source.id]);
    await connection.query('UPDATE stock_balances SET available = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [targetBefore + quantity, target.id]);
    balancesBefore[fromWarehouse] = sourceBefore;
    balancesBefore[toWarehouse] = targetBefore;
    balancesAfter[fromWarehouse] = sourceBefore - quantity;
    balancesAfter[toWarehouse] = targetBefore + quantity;
  } else {
    const warehouse = toWarehouse || fromWarehouse;
    const target = await lockBalance(warehouse, true);
    const before = Number(target.available || 0);
    const adjusted = numberValue(payload.adjustedBalance ?? payload.adjusted_balance, NaN);
    if (!Number.isFinite(adjusted) || adjusted < 0) throw httpError(400, 'กรุณาระบุยอดใหม่ที่ถูกต้อง');
    movementQuantity = Math.abs(adjusted - before);
    await connection.query('UPDATE stock_balances SET available = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [adjusted, target.id]);
    balancesBefore[target.warehouse] = before;
    balancesAfter[target.warehouse] = adjusted;
  }

  const docNo = text(payload.docNo || payload.doc_no, generateNo('STK'));
  await connection.query(
    `INSERT INTO stock_movements (
      doc_no, company_code, movement_type, sku, quantity, from_warehouse,
      to_warehouse, requester, reference, note, status, movement_date
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?)`,
    [
      docNo,
      normalizeCompany(item.company),
      movementType,
      sku,
      movementQuantity,
      fromWarehouse,
      toWarehouse,
      user.name,
      text(payload.reference),
      text(payload.note),
      dateOnly(payload.movementDate || payload.movement_date, bangkokDateOnly())
    ]
  );
  await connection.query('UPDATE stock_movements SET before_json = ?, after_json = ?, updated_at = CURRENT_TIMESTAMP WHERE doc_no = ?', [jsonValue(balancesBefore, {}), jsonValue(balancesAfter, {}), docNo]);
  await syncLegacyStockItem(connection, sku);
  const [rows] = await connection.query('SELECT * FROM stock_movements WHERE doc_no = ?', [docNo]);
  return { movement: rows[0], before: balancesBefore, after: balancesAfter };
}


async function facilityEmployee(companyCode, employeeCode) {
  const code = text(employeeCode);
  if (!code) return null;
  const [rows] = await pool.query(
    "SELECT id, name, department, company FROM employees WHERE id = ? AND status = 'ACTIVE' LIMIT 1",
    [code]
  );
  if (!rows[0]) throw httpError(400, 'ไม่พบพนักงานที่ Active');
  if (normalizeCompany(rows[0].company) !== normalizeCompany(companyCode)) {
    throw httpError(400, 'พนักงานต้องอยู่ในบริษัทเดียวกับทรัพย์สินส่วนกลาง');
  }
  return rows[0];
}

async function facilityAssetRow(connection, id, lock = false) {
  const [rows] = await connection.query(
    `SELECT
       id, item_code, company_code, name, asset_type, responsible_department, category, unit,
       total_quantity, available_quantity, damaged_quantity,
       custodian_employee_code, custodian_name, storage_location, warehouse, note,
       asset_image_mime,
       CASE WHEN asset_image IS NOT NULL AND OCTET_LENGTH(asset_image) > 0 THEN 1 ELSE 0 END AS has_image,
       created_at, updated_at
     FROM facility_assets
     WHERE id = ? ${lock ? 'FOR UPDATE' : ''}`,
    [id]
  );
  return rows[0] || null;
}

async function addFacilityMovement(connection, asset, movementType, quantity, values = {}) {
  await connection.query(
    `INSERT INTO facility_asset_movements (
      facility_asset_id, company_code, movement_type, quantity, reference_no,
      from_location, to_location, employee_code, employee_name, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      asset.id,
      asset.company_code,
      movementType,
      quantity,
      text(values.referenceNo),
      text(values.fromLocation),
      text(values.toLocation),
      text(values.employeeCode),
      text(values.employeeName),
      text(values.note)
    ]
  );
}

const app = express();

app.disable('x-powered-by');
app.use(cors());
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(express.json({ limit: '80mb' }));

app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path === '/auth/login' || req.path.startsWith('/public/')) return next();
  return authenticateRequest(req, res, next);
});
app.use('/api', (req, res, next) => {
  const retiredStockPath = req.path.startsWith('/stock')
    || req.path.startsWith('/reports/stock')
    || /^\/maintenance\/[^/]+\/parts$/.test(req.path);
  if (retiredStockPath) {
    return res.status(410).json({ error: 'โมดูล Stock ถูกนำออกจากระบบแล้ว กรุณาจัดการผ่านทะเบียนทรัพย์สิน (Asset)' });
  }
  next();
});
app.use('/api', (req, res, next) => {
  if (req.path === '/health' || req.path === '/auth/login' || req.path.startsWith('/public/')) return next();
  return authorizeRequest(req, res, next);
});

app.get('/api/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'it-asset-backend', database: 'mysql' });
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/login', async (req, res, next) => {
  try {
    const login = text(req.body.username || req.body.email || req.body.employeeCode);
    const password = text(req.body.password);
    if (!login || !password) return res.status(400).json({ error: 'กรุณากรอกชื่อผู้ใช้และรหัสผ่าน' });

    const attemptKey = loginAttemptKey(req, login);
    const blockedFor = loginBlockRemaining(attemptKey);
    const row = await findUserByLogin(login);
    const credentialsValid = Boolean(
      row && row.status === 'ACTIVE' && verifyPassword(password, row.password_hash)
    );

    // A correct password immediately clears a previous temporary lock. This avoids
    // forcing an administrator to wait after correcting a mistyped password.
    if (blockedFor > 0 && !credentialsValid) {
      return res.status(429).json({ error: `เข้าสู่ระบบผิดหลายครั้ง กรุณารอ ${Math.ceil(blockedFor / 60000)} นาที` });
    }

    if (!credentialsValid) {
      const attempts = recordLoginFailure(attemptKey);
      if (attempts >= maxLoginAttempts) {
        return res.status(429).json({ error: 'เข้าสู่ระบบผิดหลายครั้ง บัญชีถูกพักชั่วคราว 15 นาที' });
      }
      return res.status(401).json({ error: 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง' });
    }
    loginAttempts.delete(attemptKey);

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + sessionTtlHours * 60 * 60 * 1000);
    await pool.query(
      `INSERT INTO auth_sessions (token_hash, employee_id, expires_at, last_seen_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)`,
      [tokenHash(token), row.id, expiresAt]
    );

    const user = toEmployee(row);
    await writeAudit(req, 'AUTH', 'LOGIN', user.id, null, { user: user.id }, user);
    res.json({ token, user, expiresAt: expiresAt.toISOString() });
  } catch (error) {
    next(error);
  }
});

app.get('/api/me', async (req, res, next) => {
  try {
    res.json(await getRequestUser(req));
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/logout', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    await pool.query('UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE id = ?', [req.sessionId]);
    await writeAudit(req, 'AUTH', 'LOGOUT', user.id, null, null, user);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post('/api/auth/change-password', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    assertSuperAdmin(user, 'เฉพาะ Admin เท่านั้นที่เปลี่ยนรหัสผ่านได้');
    const currentPassword = text(req.body.currentPassword);
    const newPassword = text(req.body.newPassword);
    if (newPassword.length < 8) return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร' });
    if (currentPassword === newPassword) return res.status(400).json({ error: 'รหัสผ่านใหม่ต้องไม่เหมือนรหัสผ่านเดิม' });
    const [rows] = await pool.query('SELECT password_hash FROM employees WHERE id = ? LIMIT 1', [user.id]);
    if (!rows[0] || !verifyPassword(currentPassword, rows[0].password_hash)) {
      return res.status(401).json({ error: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
    }
    await pool.query(
      'UPDATE employees SET password_hash = ?, must_change_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [hashPassword(newPassword), user.id]
    );
    await pool.query('UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE employee_id = ? AND id <> ?', [user.id, req.sessionId]);
    await writeAudit(req, 'AUTH', 'CHANGE_PASSWORD', user.id, null, null, user);
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/bootstrap', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const companyPromise = isSuperAdmin(user)
      ? pool.query('SELECT * FROM companies ORDER BY company_name_en ASC')
      : pool.query('SELECT * FROM companies WHERE company_code = ? ORDER BY company_name_en ASC', [normalizeCompany(user.company)]);
    const [assets, employees, companyRows, masterData] = await Promise.all([
      getAssets(user),
      getEmployees(user),
      companyPromise,
      getMasterData(user)
    ]);

    res.json({
      user,
      assets,
      employees,
      masterData,
      companies: companyRows[0].map((company) => ({
        id: company.company_code,
        code: company.company_code,
        name: company.company_name_en,
        status: company.status,
        data: company
      }))
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/dashboard', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    let approvalQuery = pool.query('SELECT 0 AS total');
    if (isSuperAdmin(user)) {
      approvalQuery = pool.query("SELECT COUNT(*) AS total FROM approvals WHERE status = 'PENDING'");
    } else if (user.role === 'SUPERVISOR') {
      approvalQuery = pool.query(
        "SELECT COUNT(*) AS total FROM approvals WHERE status = 'PENDING' AND company_code = ? AND request_type <> 'PURCHASE'",
        [normalizeCompany(user.company)]
      );
    }

    const [assets, approvalRows] = await Promise.all([
      getAssets(user),
      approvalQuery
    ]);

    res.json({
      totalAssets: assets.length,
      activeAssets: assets.filter((asset) => asset.status === 'ACTIVE').length,
      inRepair: assets.filter((asset) => ['IN_REPAIR', 'BROKEN'].includes(asset.status)).length,
      attention: assets.filter((asset) => Number(asset.condition) <= 70 || ['IN_REPAIR', 'BROKEN', 'LOST'].includes(asset.status)).length,
      assetValue: assets.reduce((sum, asset) => sum + Number(asset.purchasePrice || 0), 0),
      pendingApprovals: Number(approvalRows[0][0]?.total || 0)
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/public/assets/:id', async (req, res, next) => {
  try {
    const asset = await getAssetById(req.params.id);
    if (!asset) return res.status(404).json({ error: 'ไม่พบทรัพย์สิน' });

    const {
      accountingAssetId: _accountingAssetId,
      purchasePrice: _purchasePrice,
      salvageValue: _salvageValue,
      purchaseDocumentType: _purchaseDocumentType,
      purchaseDocumentNo: _purchaseDocumentNo,
      purchaseDocumentDate: _purchaseDocumentDate,
      taxInvoiceNo: _taxInvoiceNo,
      accountingNote: _accountingNote,
      purchaseDocumentName: _purchaseDocumentName,
      purchaseDocumentMime: _purchaseDocumentMime,
      hasPurchaseDocument: _hasPurchaseDocument,
      purchaseDocumentUrl: _purchaseDocumentUrl,
      assignedTo: _assignedTo,
      department: _department,
      repairs: _repairs,
      returns: _returns,
      events: _events,
      ...publicAsset
    } = asset;

    const publicRepairs = (asset.repairs || []).map((repair) => ({
      date: repair.date || '',
      ticketNo: repair.ticketNo || '',
      issue: repair.issue || '',
      diagnosis: repair.diagnosis || '',
      repairMethod: repair.repairMethod || '',
      vendor: repair.vendor || '',
      detail: repair.detail || '',
      technician: repair.technician || ''
    }));
    const publicReturns = (asset.returns || []).map((record) => ({
      date: record.date || '',
      reason: record.reason || 'RETURN_TO_POOL',
      location: record.location || '',
      condition: Number(record.condition ?? 0),
      note: record.note || ''
    }));

    const publicImages = (asset.images || []).map((image) => ({
      ...image,
      url: image.id
        ? `/api/public/assets/${encodeURIComponent(asset.id)}/images/${encodeURIComponent(image.id)}`
        : `/api/public/assets/${encodeURIComponent(asset.id)}/image`
    }));

    res.json({
      ...publicAsset,
      images: publicImages,
      imageCount: publicImages.length,

      // แสดงข้อมูลผู้ถือครองล่าสุดในหน้าสาธารณะหลังสแกน QR
      assignedTo:
        asset.assignedTo ||
        (asset.custodianType === 'SHARED'
          ? 'ทรัพย์สินส่วนกลาง'
          : 'ไม่มีผู้ถือครอง'),
      department: asset.department || '-',
      repairs: publicRepairs,
      returns: publicReturns,

      imageUrl: publicImages[0]?.url || (publicAsset.hasImage
        ? `/api/public/assets/${encodeURIComponent(publicAsset.id)}/image${
            publicAsset.updatedAt ? `?v=${new Date(publicAsset.updatedAt).getTime()}` : ''
          }`
        : '')
    });
  } catch (error) {
    next(error);
  }
});

app.get('/api/public/assets/:id/images/:imageId', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT ai.image_data, ai.mime_type
       FROM asset_images ai
       INNER JOIN assets a ON a.id = ai.asset_id
       WHERE ai.id = ? AND ai.asset_id = ?
       LIMIT 1`,
      [req.params.imageId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบรูปภาพทรัพย์สิน' });
    res.setHeader('Content-Type', rows[0].mime_type || 'image/jpeg');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(rows[0].image_data);
  } catch (error) { next(error); }
});

app.get('/api/public/assets/:id/image', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      'SELECT asset_image, asset_image_mime FROM assets WHERE id = ? LIMIT 1',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบทรัพย์สิน' });
    const [imageRows] = await pool.query(
      `SELECT image_data, mime_type FROM asset_images
       WHERE asset_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1`,
      [req.params.id]
    );
    const imageData = imageRows[0]?.image_data || rows[0].asset_image;
    const imageMime = imageRows[0]?.mime_type || rows[0].asset_image_mime || 'image/jpeg';
    if (!imageData) return res.status(404).json({ error: 'ไม่พบรูปภาพทรัพย์สิน' });

    res.setHeader('Content-Type', imageMime);
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(imageData);
  } catch (error) {
    next(error);
  }
});

app.get('/api/assets/:id/images/:imageId', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const visible = await getAssetById(req.params.id, user);
    if (!visible) return res.status(404).json({ error: 'ไม่พบทรัพย์สิน' });
    const [rows] = await pool.query(
      `SELECT image_data, mime_type FROM asset_images
       WHERE id = ? AND asset_id = ? LIMIT 1`,
      [req.params.imageId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบรูปภาพทรัพย์สิน' });
    res.setHeader('Content-Type', rows[0].mime_type || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(rows[0].image_data);
  } catch (error) { next(error); }
});

app.get('/api/assets/:id/image', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const visible = await getAssetById(req.params.id, user);
    if (!visible) return res.status(404).json({ error: 'ไม่พบทรัพย์สิน' });
    const [rows] = await pool.query(
      'SELECT asset_image, asset_image_mime FROM assets WHERE id = ? LIMIT 1',
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบทรัพย์สิน' });
    const [imageRows] = await pool.query(
      `SELECT image_data, mime_type FROM asset_images
       WHERE asset_id = ? ORDER BY sort_order ASC, id ASC LIMIT 1`,
      [req.params.id]
    );
    const imageData = imageRows[0]?.image_data || rows[0].asset_image;
    const imageMime = imageRows[0]?.mime_type || rows[0].asset_image_mime || 'image/jpeg';
    if (!imageData) return res.status(404).json({ error: 'ไม่พบรูปภาพทรัพย์สิน' });

    res.setHeader('Content-Type', imageMime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(imageData);
  } catch (error) {
    next(error);
  }
});

app.get('/api/assets/:id/purchase-documents/:documentId', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const visible = await getAssetById(req.params.id, user);
    if (!visible) return res.status(404).json({ error: 'ไม่พบทรัพย์สิน' });

    const documentId = Number(req.params.documentId);
    if (!Number.isInteger(documentId) || documentId <= 0) {
      return res.status(400).json({ error: 'รหัสเอกสารไม่ถูกต้อง' });
    }

    const [rows] = await pool.query(
      `SELECT d.file_data, d.mime_type, d.file_name, a.company
       FROM asset_purchase_documents d
       INNER JOIN assets a ON a.id = d.asset_id
       WHERE d.id = ? AND d.asset_id = ?
       LIMIT 1`,
      [documentId, req.params.id]
    );

    const document = rows[0];
    if (!document) return res.status(404).json({ error: 'ไม่พบเอกสารแนบ' });
    assertCompanyAccess(user, document.company);

    const safeName = document.file_name || `purchase-document-${documentId}`;
    res.setHeader('Content-Type', document.mime_type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(safeName)}`
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(document.file_data);
  } catch (error) {
    next(error);
  }
});

app.get('/api/assets/:id/purchase-document', async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT
        purchase_document_file,
        purchase_document_mime,
        purchase_document_name,
        company
       FROM assets
       WHERE id = ?
       LIMIT 1`,
      [req.params.id]
    );

    const document = rows[0];
    const user = await getRequestUser(req);
    const visible = await getAssetById(req.params.id, user);
    if (!visible) return res.status(404).json({ error: 'ไม่พบทรัพย์สิน' });
    if (document) assertCompanyAccess(user, document.company);
    if (!document || !document.purchase_document_file) {
      return res.status(404).json({ error: 'ไม่พบเอกสารการซื้อ' });
    }

    const safeName = document.purchase_document_name || `purchase-document-${req.params.id}`;
    res.setHeader('Content-Type', document.purchase_document_mime || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `inline; filename*=UTF-8''${encodeURIComponent(safeName)}`
    );
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.send(document.purchase_document_file);
  } catch (error) {
    next(error);
  }
});

app.get('/api/assets', async (req, res, next) => {
  try {
    res.json(await getAssets(await getRequestUser(req)));
  } catch (error) {
    next(error);
  }
});


app.get('/api/assets/next-id', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const company = scopedCompany(user, req.query.company);
    res.json({ id: await previewNextAssetId(company), company });
  } catch (error) {
    next(error);
  }
});


app.get('/api/assets/borrowable', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const availability = "((a.status = 'IN_STOCK' AND a.custodian_type = 'UNASSIGNED') OR (a.status = 'ACTIVE' AND a.custodian_type = 'SHARED'))";
    const params = [];
    const where = [availability, "COALESCE(NULLIF(a.responsible_department, ''), 'IT') = 'IT'"];
    if (!isSuperAdmin(user)) {
      where.push('a.company = ?');
      params.push(normalizeCompany(user.company));
    }
    const [rows] = await pool.query(
      `SELECT id, accounting_asset_id, company, name, serial, category, subcategory, location, department, status, custodian_type, responsible_department
       FROM assets a WHERE ${where.join(' AND ')}
         AND NOT EXISTS (
           SELECT 1 FROM borrow_records b
           WHERE b.asset_id = a.id AND b.status IN ('PENDING','APPROVED','RETURN_REQUESTED')
         )
       ORDER BY a.name, a.id`,
      params
    );
    res.json(rows.map((row) => ({
      id: row.id,
      accountingAssetId: row.accounting_asset_id || '',
      company: normalizeCompany(row.company),
      name: row.name,
      serial: row.serial,
      category: row.category,
      subcategory: row.subcategory || '',
      location: row.location,
      department: row.department || '',
      status: row.status,
      custodianType: row.custodian_type,
      responsibleDepartment: row.responsible_department || 'IT'
    })));
  } catch (error) {
    next(error);
  }
});


app.post('/api/assets', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    const missing = requireFields(req.body, [
      'company',
      'name',
      'category',
      'serial',
      'location',
      'status'
    ]);
    if (missing.length) {
      return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
    }

    const company = scopedCompany(user, req.body.company);
    const custodian = await resolveAssetCustodian(connection, req.body, company);
    if (workflowAssetStatuses.has(custodian.status)) {
      return res.status(409).json({ error: `ไม่สามารถสร้าง Asset ใหม่ด้วยสถานะ ${custodian.status} ได้` });
    }

    await connection.beginTransaction();
    const assetId = await allocateAssetId(connection, company);
    const canEditFinancial = hasPermission(user, 'assets.financial');
    const asset = {
      id: assetId,
      accountingAssetId: canEditFinancial ? text(req.body.accountingAssetId || req.body.accounting_asset_id) : '',
      company,
      name: text(req.body.name),
      brand: text(req.body.brand),
      model: text(req.body.model),
      category: text(req.body.category),
      subcategory: text(req.body.subcategory),
      serial: text(req.body.serial),
      assignedTo: custodian.assignedTo,
      custodianType: custodian.custodianType,
      responsibleDepartment: normalizeOperationalDepartment(req.body.responsibleDepartment || req.body.responsible_department, 'IT'),
      department: custodian.department,
      location: text(req.body.location, custodian.locationFallback),
      status: custodian.status,
      purchaseDate: canEditFinancial ? dateOnly(req.body.purchaseDate) : '',
      warrantyUntil: canEditFinancial ? dateOnly(req.body.warrantyUntil) : '',
      condition: numberValue(req.body.condition, 100),
      purchasePrice: canEditFinancial ? numberValue(req.body.purchasePrice) : 0,
      usefulLifeYears: canEditFinancial ? numberValue(req.body.usefulLifeYears, 5) : 5,
      salvageValue: canEditFinancial ? numberValue(req.body.salvageValue) : 0,
      criticality: text(req.body.criticality, 'MEDIUM'),
      ownershipType: text(req.body.ownershipType, 'OWNED').toUpperCase(),
      ownershipTypeOther: text(req.body.ownershipType).toUpperCase() === 'OTHER' ? text(req.body.ownershipTypeOther) : '',
      vendor: canEditFinancial ? text(req.body.vendor) : '',
      manufacturer: '',
      purchaseDocumentType: canEditFinancial ? text(req.body.purchaseDocumentType).toUpperCase() : '',
      purchaseDocumentTypeOther: canEditFinancial && text(req.body.purchaseDocumentType).toUpperCase() === 'OTHER' ? text(req.body.purchaseDocumentTypeOther) : '',
      purchaseDocumentNo: canEditFinancial ? text(req.body.purchaseDocumentNo) : '',
      purchaseDocumentDate: canEditFinancial ? dateOnly(req.body.purchaseDocumentDate) : '',
      taxInvoiceNo: canEditFinancial ? text(req.body.taxInvoiceNo) : '',
      accountingNote: canEditFinancial ? text(req.body.accountingNote) : '',
      purchaseDocuments: canEditFinancial
        ? parsePurchaseDocuments(
            req.body.purchaseDocumentsData,
            req.body.purchaseDocumentData,
            req.body.purchaseDocumentName
          )
        : [],
      images: parseAssetImages(
        Array.isArray(req.body.imagesData) ? req.body.imagesData : (req.body.imageData ? [req.body.imageData] : []),
        'รูปภาพทะเบียนทรัพย์สิน'
      ),
      items: normalizeAssetItems(req.body.items)
    };
    validateAssetValues(asset);
    if (asset.ownershipType === 'OTHER' && !asset.ownershipTypeOther) throw httpError(400, 'กรุณาระบุประเภทการถือครองอื่นๆ');
    if (asset.purchaseDocumentType === 'OTHER' && !asset.purchaseDocumentTypeOther) throw httpError(400, 'กรุณาระบุประเภทเอกสารการซื้ออื่นๆ');

    const [serialRows] = await connection.query(
      'SELECT id FROM assets WHERE company = ? AND serial = ? LIMIT 1 FOR UPDATE',
      [asset.company, asset.serial]
    );
    if (serialRows[0]) throw httpError(409, `Serial Number นี้ถูกใช้กับ Asset ${serialRows[0].id} แล้ว`);

    await connection.query(
      `INSERT INTO assets (
        id, accounting_asset_id, company, name, brand, model, category, subcategory, serial,
        assigned_to, custodian_type, responsible_department, department, location, status,
        purchase_date, warranty_until, \`condition\`, purchase_price,
        useful_life_years, salvage_value, criticality, ownership_type, ownership_type_other,
        vendor, manufacturer, asset_image, asset_image_mime,
        purchase_document_type, purchase_document_type_other, purchase_document_no, purchase_document_date,
        purchase_order_no, tax_invoice_no, accounting_note,
        purchase_document_file, purchase_document_mime, purchase_document_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        asset.id, asset.accountingAssetId, asset.company, asset.name, asset.brand, asset.model,
        asset.category, asset.subcategory, asset.serial, asset.assignedTo,
        asset.custodianType, asset.responsibleDepartment, asset.department, asset.location, asset.status,
        asset.purchaseDate, asset.warrantyUntil, asset.condition,
        asset.purchasePrice, asset.usefulLifeYears, asset.salvageValue,
        asset.criticality, asset.ownershipType, asset.ownershipTypeOther, asset.vendor, asset.manufacturer,
        null, '',
        asset.purchaseDocumentType, asset.purchaseDocumentTypeOther, asset.purchaseDocumentNo,
        asset.purchaseDocumentDate || null, '',
        asset.taxInvoiceNo, asset.accountingNote,
        null,
        '',
        ''
      ]
    );
    await insertAssetItems(connection, asset.id, asset.items);
    await insertAssetPurchaseDocuments(connection, asset.id, asset.purchaseDocuments);
    for (let index = 0; index < asset.images.length; index += 1) {
      const image = asset.images[index];
      await connection.query(
        'INSERT INTO asset_images (asset_id, mime_type, image_data, sort_order) VALUES (?, ?, ?, ?)',
        [asset.id, image.mime, image.buffer, index + 1]
      );
    }
    await connection.query(
      `INSERT INTO asset_events (company_code, asset_id, event_type, old_value, new_value, actor, note)
       VALUES (?, ?, 'REGISTERED', '', ?, ?, ?)`,
      [asset.company, asset.id, asset.status, user.name, `ลงทะเบียนทรัพย์สิน · ${asset.assignedTo || 'ไม่มีผู้ถือครอง'} @ ${asset.location || '-'}`]
    );
    await connection.commit();

    const created = await getAssetById(asset.id, user);
    await writeAudit(req, 'ASSET', 'CREATE', asset.id, null, created, user);
    res.status(201).json(created);
  } catch (error) {
    try { await connection.rollback(); } catch { /* no active transaction */ }
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'ระบบตรวจพบ Asset ID หรือ Serial Number ซ้ำ กรุณาลองบันทึกใหม่อีกครั้ง' });
    }
    next(error);
  } finally {
    connection.release();
  }
});

app.get('/api/assets/:id', async (req, res, next) => {
  try {
    const asset = await getAssetById(req.params.id, await getRequestUser(req));
    if (!asset) return res.status(404).json({ error: 'Asset not found' });
    res.json(asset);
  } catch (error) {
    next(error);
  }
});

app.put('/api/assets/:id', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    const missing = requireFields(req.body, ['name', 'category', 'serial', 'location', 'status']);
    if (missing.length) {
      return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
    }

    const before = await getAssetById(req.params.id, user);
    if (!before) return res.status(404).json({ error: 'Asset not found' });

    const requestedCompany = scopedCompany(user, req.body.company || before.company);
    if (normalizeCompany(requestedCompany) !== normalizeCompany(before.company)) {
      return res.status(409).json({ error: 'ไม่สามารถเปลี่ยนบริษัทของ Asset ที่สร้างแล้วได้ กรุณาสร้าง Asset ใหม่ภายใต้บริษัทที่ถูกต้อง' });
    }

    const custodian = await resolveAssetCustodian(connection, req.body, before.company, before);
    const requestedStatus = custodian.status;
    if (workflowAssetStatuses.has(requestedStatus) && requestedStatus !== before.status) {
      return res.status(409).json({ error: `สถานะ ${requestedStatus} ต้องเปลี่ยนผ่าน Workflow ที่เกี่ยวข้อง` });
    }
    if (workflowAssetStatuses.has(before.status) && requestedStatus !== before.status) {
      return res.status(409).json({ error: `Asset อยู่ในสถานะ ${before.status} กรุณาปิด Workflow ก่อนแก้ไขสถานะ` });
    }

    const canEditFinancial = hasPermission(user, 'assets.financial');
    const asset = {
      company: normalizeCompany(before.company),
      accountingAssetId: canEditFinancial ? text(req.body.accountingAssetId || req.body.accounting_asset_id) : before.accountingAssetId,
      name: text(req.body.name),
      brand: text(req.body.brand),
      model: text(req.body.model),
      category: text(req.body.category),
      subcategory: text(req.body.subcategory),
      serial: text(req.body.serial),
      assignedTo: custodian.assignedTo,
      custodianType: custodian.custodianType,
      responsibleDepartment: normalizeOperationalDepartment(
        req.body.responsibleDepartment || req.body.responsible_department,
        before.responsibleDepartment || 'IT'
      ),
      department: custodian.department,
      location: text(req.body.location, custodian.locationFallback || before.location),
      status: requestedStatus,
      purchaseDate: canEditFinancial ? dateOnly(req.body.purchaseDate) : before.purchaseDate,
      warrantyUntil: canEditFinancial ? dateOnly(req.body.warrantyUntil) : before.warrantyUntil,
      condition: numberValue(req.body.condition, 100),
      purchasePrice: canEditFinancial ? numberValue(req.body.purchasePrice) : before.purchasePrice,
      usefulLifeYears: canEditFinancial ? numberValue(req.body.usefulLifeYears, 5) : before.usefulLifeYears,
      salvageValue: canEditFinancial ? numberValue(req.body.salvageValue) : before.salvageValue,
      criticality: text(req.body.criticality, before.criticality || 'MEDIUM'),
      ownershipType: text(req.body.ownershipType, before.ownershipType || 'OWNED').toUpperCase(),
      ownershipTypeOther: text(req.body.ownershipType, before.ownershipType).toUpperCase() === 'OTHER' ? text(req.body.ownershipTypeOther, before.ownershipTypeOther || '') : '',
      vendor: canEditFinancial ? text(req.body.vendor) : before.vendor,
      manufacturer: before.manufacturer || '',
      purchaseDocumentType: canEditFinancial ? text(req.body.purchaseDocumentType, before.purchaseDocumentType).toUpperCase() : before.purchaseDocumentType,
      purchaseDocumentTypeOther: canEditFinancial && text(req.body.purchaseDocumentType, before.purchaseDocumentType).toUpperCase() === 'OTHER' ? text(req.body.purchaseDocumentTypeOther, before.purchaseDocumentTypeOther || '') : '',
      purchaseDocumentNo: canEditFinancial ? text(req.body.purchaseDocumentNo) : before.purchaseDocumentNo,
      purchaseDocumentDate: canEditFinancial ? dateOnly(req.body.purchaseDocumentDate) : before.purchaseDocumentDate,
      taxInvoiceNo: canEditFinancial ? text(req.body.taxInvoiceNo) : before.taxInvoiceNo,
      accountingNote: canEditFinancial ? text(req.body.accountingNote) : before.accountingNote,
      purchaseDocuments: canEditFinancial
        ? parsePurchaseDocuments(
            req.body.purchaseDocumentsData,
            req.body.purchaseDocumentData,
            req.body.purchaseDocumentName
          )
        : [],
      removePurchaseDocumentIds: canEditFinancial && Array.isArray(req.body.removePurchaseDocumentIds)
        ? req.body.removePurchaseDocumentIds
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
        : [],
      newImages: parseAssetImages(
        Array.isArray(req.body.imagesData) ? req.body.imagesData : (req.body.imageData ? [req.body.imageData] : []),
        'รูปภาพทะเบียนทรัพย์สิน'
      ),
      removeImageIds: normalizeImageIds(req.body.removeImageIds || req.body.remove_image_ids),
      removeImage: req.body.removeImage === true,
      items: normalizeAssetItems(req.body.items)
    };
    validateAssetValues(asset, { allowWorkflowStatus: requestedStatus === before.status });
    if (asset.ownershipType === 'OTHER' && !asset.ownershipTypeOther) throw httpError(400, 'กรุณาระบุประเภทการถือครองอื่นๆ');
    if (asset.purchaseDocumentType === 'OTHER' && !asset.purchaseDocumentTypeOther) throw httpError(400, 'กรุณาระบุประเภทเอกสารการซื้ออื่นๆ');

    const removedDocumentIds = new Set(asset.removePurchaseDocumentIds);
    const remainingDocumentCount = (before.purchaseDocuments || []).filter(
      (document) => !removedDocumentIds.has(Number(document.id))
    ).length + asset.purchaseDocuments.length;
    if (remainingDocumentCount > maxPurchaseDocumentCount) {
      throw httpError(400, `แนบเอกสารได้สูงสุด ${maxPurchaseDocumentCount} ไฟล์ต่อทรัพย์สิน`);
    }

    await connection.beginTransaction();
    const [serialRows] = await connection.query(
      'SELECT id FROM assets WHERE company = ? AND serial = ? AND id <> ? LIMIT 1 FOR UPDATE',
      [asset.company, asset.serial, req.params.id]
    );
    if (serialRows[0]) throw httpError(409, `Serial Number นี้ถูกใช้กับ Asset ${serialRows[0].id} แล้ว`);

    const [result] = await connection.query(
      `UPDATE assets SET
        company = ?, accounting_asset_id = ?, name = ?, brand = ?, model = ?, category = ?, subcategory = ?, serial = ?,
        assigned_to = ?, custodian_type = ?, responsible_department = ?, department = ?, location = ?, status = ?,
        purchase_date = ?, warranty_until = ?, \`condition\` = ?, purchase_price = ?,
        useful_life_years = ?, salvage_value = ?, criticality = ?, ownership_type = ?, ownership_type_other = ?,
        vendor = ?, manufacturer = ?, purchase_document_type = ?, purchase_document_type_other = ?, purchase_document_no = ?,
        purchase_document_date = ?, purchase_order_no = ?, tax_invoice_no = ?, accounting_note = ?,
        asset_image = CASE WHEN ? = 1 THEN NULL ELSE asset_image END,
        asset_image_mime = CASE WHEN ? = 1 THEN '' ELSE asset_image_mime END,
        purchase_document_file = NULL,
        purchase_document_mime = '',
        purchase_document_name = '',
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        asset.company, asset.accountingAssetId, asset.name, asset.brand, asset.model, asset.category,
        asset.subcategory, asset.serial, asset.assignedTo, asset.custodianType,
        asset.responsibleDepartment, asset.department, asset.location, asset.status, asset.purchaseDate,
        asset.warrantyUntil, asset.condition, asset.purchasePrice,
        asset.usefulLifeYears, asset.salvageValue, asset.criticality,
        asset.ownershipType, asset.ownershipTypeOther, asset.vendor, asset.manufacturer,
        asset.purchaseDocumentType, asset.purchaseDocumentTypeOther, asset.purchaseDocumentNo,
        asset.purchaseDocumentDate || null, '',
        asset.taxInvoiceNo, asset.accountingNote,
        asset.removeImage ? 1 : 0,
        asset.removeImage ? 1 : 0,
        req.params.id
      ]
    );
    if (!result.affectedRows) throw httpError(404, 'Asset not found');

    if (asset.removeImage) {
      await connection.query('DELETE FROM asset_images WHERE asset_id = ?', [req.params.id]);
    } else if (asset.removeImageIds.length) {
      const imageMarks = asset.removeImageIds.map(() => '?').join(',');
      await connection.query(
        `DELETE FROM asset_images WHERE asset_id = ? AND id IN (${imageMarks})`,
        [req.params.id, ...asset.removeImageIds]
      );
    }
    const [imageCountRows] = await connection.query(
      'SELECT COUNT(*) AS total, COALESCE(MAX(sort_order), 0) AS max_sort FROM asset_images WHERE asset_id = ?',
      [req.params.id]
    );
    const existingImageCount = Number(imageCountRows[0]?.total || 0);
    if (existingImageCount + asset.newImages.length > 5) {
      throw httpError(400, 'รูปภาพทะเบียนทรัพย์สินรวมกันได้สูงสุด 5 รูป');
    }
    const currentMaxSort = Number(imageCountRows[0]?.max_sort || 0);
    for (let index = 0; index < asset.newImages.length; index += 1) {
      const image = asset.newImages[index];
      await connection.query(
        'INSERT INTO asset_images (asset_id, mime_type, image_data, sort_order) VALUES (?, ?, ?, ?)',
        [req.params.id, image.mime, image.buffer, currentMaxSort + index + 1]
      );
    }

    await connection.query('DELETE FROM asset_items WHERE asset_id = ?', [req.params.id]);
    await insertAssetItems(connection, req.params.id, asset.items);

    if (asset.removePurchaseDocumentIds.length) {
      const marks = asset.removePurchaseDocumentIds.map(() => '?').join(',');
      await connection.query(
        `DELETE FROM asset_purchase_documents
         WHERE asset_id = ? AND id IN (${marks})`,
        [req.params.id, ...asset.removePurchaseDocumentIds]
      );
    }
    await insertAssetPurchaseDocuments(connection, req.params.id, asset.purchaseDocuments);
    const changedLabels = [];
    if (before.name !== asset.name) changedLabels.push('ชื่อทรัพย์สิน');
    if (before.serial !== asset.serial) changedLabels.push('Serial');
    if (before.status !== asset.status) changedLabels.push('สถานะ');
    if (before.condition !== asset.condition) changedLabels.push('สภาพ');
    if (before.location !== asset.location) changedLabels.push('ตำแหน่ง');
    if (before.assignedTo !== asset.assignedTo) changedLabels.push('ผู้ครอบครอง');
    if (changedLabels.length) {
      await connection.query(
        `INSERT INTO asset_events (company_code, asset_id, event_type, old_value, new_value, actor, note)
         VALUES (?, ?, 'ASSET_UPDATED', ?, ?, ?, ?)`,
        [
          before.company,
          req.params.id,
          `${before.assignedTo || 'ไม่มีผู้ถือครอง'} @ ${before.location || '-'}`,
          `${asset.assignedTo || 'ไม่มีผู้ถือครอง'} @ ${asset.location || '-'}`,
          user.name,
          `แก้ไข: ${changedLabels.join(', ')}`
        ]
      );
    }
    await connection.commit();

    const updated = await getAssetById(req.params.id, user);
    await writeAudit(req, 'ASSET', 'UPDATE', req.params.id, before, updated, user);
    res.json(updated);
  } catch (error) {
    try { await connection.rollback(); } catch { /* no active transaction */ }
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Serial Number นี้ถูกใช้แล้ว' });
    }
    next(error);
  } finally {
    connection.release();
  }
});

app.delete('/api/assets/:id', async (req, res, next) => {
  const connection = await pool.getConnection();
  let transactionStarted = false;

  try {
    const user = await getRequestUser(req);
    if (!isSuperAdmin(user)) throw httpError(403, 'เฉพาะ Admin เท่านั้นที่ลบทะเบียนทรัพย์สินได้');

    const assetId = text(req.params.id);
    if (!assetId) return res.status(400).json({ error: 'Asset ID ไม่ถูกต้อง' });

    await connection.beginTransaction();
    transactionStarted = true;

    const [assetRows] = await connection.query(
      'SELECT * FROM assets WHERE id = ? LIMIT 1 FOR UPDATE',
      [assetId]
    );

    const beforeRow = assetRows[0];
    if (!beforeRow) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(404).json({ error: 'ไม่พบทรัพย์สิน หรือรายการถูกลบไปแล้ว' });
    }

    assertCompanyAccess(user, beforeRow.company);

    const cascade = ['1', 'true', 'yes'].includes(
      text(req.query.cascade).toLowerCase()
    );

    const [referenceRows] = await connection.query(
      `SELECT
        (SELECT COUNT(*) FROM transfers WHERE asset_id = ?) AS transfers_count,
        (SELECT COUNT(*) FROM borrow_records WHERE asset_id = ?) AS borrow_count,
        (SELECT COUNT(*) FROM maintenance WHERE asset_id = ?) AS maintenance_count,
        (SELECT COUNT(*) FROM disposals WHERE asset_id = ?) AS disposal_count,
        (SELECT COUNT(*) FROM asset_assignment_allocations WHERE asset_id = ?) AS allocation_count,
        (SELECT COUNT(*) FROM asset_handovers WHERE asset_id = ?) AS handover_count`,
      Array(6).fill(assetId)
    );

    const ref = referenceRows[0] || {};
    const totalReferences = Object.values(ref).reduce(
      (sum, value) => sum + Number(value || 0),
      0
    );

    if (totalReferences > 0 && !cascade) {
      await connection.rollback();
      transactionStarted = false;
      return res.status(409).json({
        error: 'ทรัพย์สินนี้มีประวัติอ้างอิง กรุณายืนยันการลบแบบ Cascade'
      });
    }

    // ลบ Approval ที่ไม่ได้ผูก Foreign Key ก่อนลบเอกสารต้นทาง
    const [transferRows] = await connection.query(
      'SELECT id FROM transfers WHERE asset_id = ?',
      [assetId]
    );
    const [borrowRows] = await connection.query(
      'SELECT id FROM borrow_records WHERE asset_id = ?',
      [assetId]
    );
    const [disposalRows] = await connection.query(
      'SELECT id FROM disposals WHERE asset_id = ?',
      [assetId]
    );

    for (const row of transferRows) {
      await connection.query(
        "DELETE FROM approvals WHERE UPPER(request_type) = 'TRANSFER' AND request_id = ?",
        [row.id]
      );
    }
    for (const row of borrowRows) {
      await connection.query(
        "DELETE FROM approvals WHERE UPPER(request_type) = 'BORROW' AND request_id = ?",
        [row.id]
      );
    }
    for (const row of disposalRows) {
      await connection.query(
        "DELETE FROM approvals WHERE UPPER(request_type) = 'DISPOSAL' AND request_id = ?",
        [row.id]
      );
    }

    // ลบตารางลูกระดับลึกก่อน เพื่อรองรับฐานข้อมูลเดิมที่ FK อาจไม่มี ON DELETE CASCADE
    await connection.query(
      `DELETE mp FROM maintenance_parts mp
       INNER JOIN maintenance m ON m.id = mp.maintenance_id
       WHERE m.asset_id = ?`,
      [assetId]
    );
    await connection.query('DELETE FROM asset_handovers WHERE asset_id = ?', [assetId]);
    await connection.query('DELETE FROM asset_assignment_allocations WHERE asset_id = ?', [assetId]);

    // อ่าน Foreign Key จริงจาก Database เพื่อให้ลบได้แม้มีตารางลูกจาก Migration รุ่นก่อน
    const [foreignKeys] = await connection.query(
      `SELECT TABLE_NAME, COLUMN_NAME
       FROM information_schema.KEY_COLUMN_USAGE
       WHERE REFERENCED_TABLE_SCHEMA = DATABASE()
         AND REFERENCED_TABLE_NAME = 'assets'
         AND REFERENCED_COLUMN_NAME = 'id'`
    );

    const preferredOrder = [
      'maintenance',
      'transfers',
      'borrow_records',
      'disposals',
      'asset_events',
      'repair_records',
      'return_records',
      'asset_items'
    ];

    const rank = new Map(preferredOrder.map((name, index) => [name, index]));
    foreignKeys.sort((a, b) =>
      (rank.get(a.TABLE_NAME) ?? 999) - (rank.get(b.TABLE_NAME) ?? 999)
    );

    const deletedFrom = [];
    for (const fk of foreignKeys) {
      const tableName = String(fk.TABLE_NAME || '');
      const columnName = String(fk.COLUMN_NAME || '');

      if (!/^[A-Za-z0-9_]+$/.test(tableName) || !/^[A-Za-z0-9_]+$/.test(columnName)) {
        throw httpError(500, 'พบชื่อ Table หรือ Column ที่ไม่ปลอดภัยระหว่างลบข้อมูล');
      }

      const [result] = await connection.query(
        `DELETE FROM \`${tableName}\` WHERE \`${columnName}\` = ?`,
        [assetId]
      );

      if (Number(result.affectedRows || 0) > 0) {
        deletedFrom.push({ table: tableName, rows: Number(result.affectedRows) });
      }
    }

    const [deleteResult] = await connection.query(
      'DELETE FROM assets WHERE id = ?',
      [assetId]
    );

    if (Number(deleteResult.affectedRows || 0) !== 1) {
      throw httpError(409, 'ลบทรัพย์สินไม่สำเร็จ เนื่องจากรายการเปลี่ยนแปลงระหว่างดำเนินการ');
    }

    const [verifyRows] = await connection.query(
      'SELECT id FROM assets WHERE id = ? LIMIT 1',
      [assetId]
    );
    if (verifyRows.length) {
      throw httpError(500, 'ตรวจสอบหลังลบแล้วพบว่าข้อมูลยังอยู่ใน Database');
    }

    await connection.commit();
    transactionStarted = false;

    await writeAudit(
      req,
      'ASSET',
      cascade ? 'CASCADE_DELETE' : 'DELETE',
      assetId,
      beforeRow,
      { deleted: true, deletedFrom },
      user
    );

    return res.json({
      ok: true,
      deletedId: assetId,
      deletedReferences: deletedFrom
    });
  } catch (error) {
    if (transactionStarted) {
      try {
        await connection.rollback();
      } catch (rollbackError) {
        console.error('Asset delete rollback failed:', rollbackError);
      }
    }

    if (error.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({
        error: 'ลบไม่สำเร็จ เพราะยังมีข้อมูลอื่นอ้างอิง Asset นี้ กรุณาตรวจ Backend Log เพื่อดูชื่อตารางที่ค้างอยู่'
      });
    }

    next(error);
  } finally {
    connection.release();
  }
});

app.post('/api/assets/:id/qr-printed', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    if (!hasPermission(user, 'assets.read')) throw httpError(403, 'ไม่มีสิทธิ์ดูหรือพิมพ์ QR Label');
    const before = await getAssetById(req.params.id, user);
    if (!before) return res.status(404).json({ error: 'ไม่พบทรัพย์สิน' });
    const [result] = await pool.query(
      'UPDATE assets SET qr_printed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND company = ?',
      [req.params.id, before.company]
    );
    if (!result.affectedRows) return res.status(404).json({ error: 'ไม่พบทรัพย์สิน' });

    const updated = await getAssetById(req.params.id, user);
    await writeAudit(req, 'ASSET', 'QR_PRINTED', req.params.id, before, updated, user);
    res.status(201).json(updated);
  } catch (error) {
    next(error);
  }
});

app.post('/api/assets/:id/assignment', async (_req, res) => {
  res.status(410).json({
    error: 'การเปลี่ยนผู้ครอบครองโดยตรงถูกยกเลิกแล้ว กรุณาสร้างคำขอโอนย้ายจากหน้าผู้ครอบครองปัจจุบัน เพื่อให้ผ่าน Approval Workflow และเก็บประวัติครบถ้วน'
  });
});

app.post('/api/assets/:id/repairs', async (_req, res) => {
  res.status(410).json({
    error: 'เส้นทางบันทึกซ่อมแบบเดิมถูกยกเลิกแล้ว กรุณาเปิด Maintenance Ticket ผ่าน /api/maintenance เพื่อให้บันทึกสถานะและประวัติครบถ้วน'
  });
});

app.post('/api/assets/:id/returns', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    assertWorkflowDepartment(user, 'HR', 'การโอนย้ายและรับคืนทรัพย์สินต้องดำเนินการโดย HR');
    if (!hasPermission(user, 'assets.assign') && !hasPermission(user, 'assets.write')) {
      throw httpError(403, 'ไม่มีสิทธิ์รับคืนทรัพย์สิน');
    }

    const before = await getAssetById(req.params.id, user);
    if (!before) return res.status(404).json({ error: 'Asset not found' });
    if (['BORROWED', 'IN_REPAIR', 'DISPOSED', 'SOLD', 'LOST'].includes(before.status)) {
      return res.status(409).json({ error: `สถานะ ${before.status} ต้องปิดผ่าน Workflow ที่เกี่ยวข้องก่อน` });
    }

    const returnDate = dateOnly(req.body.date || req.body.returnDate || req.body.return_date, bangkokDateOnly());
    const receivedBy = text(req.body.receivedBy || req.body.received_by, user.name);
    const returnLocation = text(req.body.location || req.body.returnLocation || req.body.return_location, before.location);
    if (!receivedBy || !returnLocation) return res.status(400).json({ error: 'กรุณาระบุผู้รับคืนและสถานที่รับคืน' });
    const returnedBy = text(req.body.returnedBy || req.body.returned_by, before.assignedTo || 'ไม่มีผู้ถือครอง');
    const returnReason = normalizeAssetReturnReason(req.body.reason || req.body.returnReason || req.body.return_reason);
    const condition = numberValue(req.body.condition, before.condition ?? 100);
    if (condition < 0 || condition > 100) return res.status(400).json({ error: 'สภาพทรัพย์สินต้องอยู่ระหว่าง 0 ถึง 100' });
    const returnedItems = Array.isArray(req.body.returnedItems) ? req.body.returnedItems.map(String) : [];
    const missingItems = Array.isArray(req.body.missingItems) ? req.body.missingItems.map(String) : [];
    const needsRepair = missingItems.length > 0 || returnReason === 'DAMAGED' || condition < 70;
    const nextStatus = needsRepair ? 'IN_REPAIR' : 'IN_STOCK';
    const note = text(req.body.note, '-');

    await connection.beginTransaction();
    const [lockedRows] = await connection.query(
      'SELECT * FROM assets WHERE id = ? AND company = ? FOR UPDATE',
      [req.params.id, before.company]
    );
    const locked = lockedRows[0];
    if (!locked) throw httpError(404, 'Asset not found');
    if (normalizeAssetStatus(locked.status) !== before.status) {
      throw httpError(409, 'สถานะทรัพย์สินเปลี่ยนไปแล้ว กรุณารีเฟรชและทำรายการใหม่');
    }
    const [[transferOpen], [borrowOpen], [disposalOpen]] = await Promise.all([
      connection.query("SELECT COUNT(*) AS total FROM transfers WHERE asset_id = ? AND status = 'PENDING'", [req.params.id]),
      connection.query("SELECT COUNT(*) AS total FROM borrow_records WHERE asset_id = ? AND status IN ('PENDING','APPROVED','RETURN_REQUESTED')", [req.params.id]),
      connection.query("SELECT COUNT(*) AS total FROM disposals WHERE asset_id = ? AND status = 'PENDING'", [req.params.id])
    ]);
    if (Number(transferOpen[0]?.total || 0) > 0) throw httpError(409, 'มีคำขอโอนย้ายที่ยังไม่สิ้นสุด กรุณาจัดการรายการนั้นก่อนคืนทรัพย์สิน');
    if (Number(borrowOpen[0]?.total || 0) > 0) throw httpError(409, 'มีรายการยืม-คืนที่ยังไม่สิ้นสุด กรุณาปิดรายการนั้นก่อนคืนทรัพย์สิน');
    if (Number(disposalOpen[0]?.total || 0) > 0) throw httpError(409, 'มีคำขอตัดจำหน่ายที่ยังรอดำเนินการ กรุณาจัดการรายการนั้นก่อนคืนทรัพย์สิน');

    await connection.query(
      `INSERT INTO return_records (
        asset_id, return_date, returned_by, received_by, return_location,
        \`condition\`, note, returned_items, missing_items, return_reason,
        previous_assignee, previous_department, previous_location
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.params.id, returnDate, returnedBy, receivedBy, returnLocation, condition, note,
        jsonValue(returnedItems, []), jsonValue(missingItems, []), returnReason,
        before.assignedTo || '', before.department || '', before.location || ''
      ]
    );
    await connection.query(
      `UPDATE assets SET
        assigned_to = '', custodian_type = 'UNASSIGNED', department = '', location = ?,
        status = ?, \`condition\` = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [returnLocation, nextStatus, condition, req.params.id]
    );
    await connection.query(
      `INSERT INTO asset_events (company_code, asset_id, event_type, old_value, new_value, actor, note)
       VALUES (?, ?, 'RETURN_TO_ASSET_POOL', ?, ?, ?, ?)`,
      [before.company, req.params.id, `${before.assignedTo || 'UNASSIGNED'} / ${before.status}`, `${returnedBy} -> ${nextStatus}`, user.name, `${returnReason} · ${note}`]
    );

    // If a returned Asset is damaged or incomplete, create the repair workflow immediately.
    // This prevents the invalid state IN_REPAIR with no Maintenance Ticket to close later.
    if (needsRepair) {
      const [openTickets] = await connection.query(
        "SELECT id FROM maintenance WHERE asset_id = ? AND status <> 'CLOSED' LIMIT 1 FOR UPDATE",
        [req.params.id]
      );
      if (!openTickets[0]) {
        const ticketNo = generateNo('MNT');
        const issue = missingItems.length
          ? `รับคืนทรัพย์สินไม่ครบ: ${missingItems.join(', ')}`
          : `รับคืนทรัพย์สินสภาพ ${condition}%`;
        await connection.query(
          `INSERT INTO maintenance (
            ticket_no, company_code, asset_id, service_department, issue, priority, technician, estimated_cost,
            diagnosis, repair_method, vendor, parts_json, cost, status, opened_date, closed_date,
            note, requested_by, requester_employee_code, previous_asset_status, updated_at
          ) VALUES (?, ?, ?, ?, ?, 'NORMAL', '', NULL, '', '', '', '[]', 0, 'OPEN', ?, '', ?, ?, ?, 'IN_STOCK', CURRENT_TIMESTAMP)`,
          [ticketNo, before.company, req.params.id, before.responsibleDepartment || 'IT', issue, returnDate, note, user.name, user.id]
        );
        await connection.query(
          `INSERT INTO asset_events (company_code, asset_id, event_type, old_value, new_value, actor, note)
           VALUES (?, ?, 'MAINTENANCE_OPENED', 'IN_STOCK', 'IN_REPAIR', ?, ?)`,
          [before.company, req.params.id, user.name, `${ticketNo} · ${issue}`]
        );
      }
    }

    await connection.commit();
    const updated = await getAssetById(req.params.id, user);
    await writeAudit(req, 'ASSET', 'RETURN', req.params.id, before, updated, user);
    res.status(201).json(updated);
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.get('/api/asset-events', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const assets = await getAssets(user);
    const ids = assets.map((asset) => asset.id);
    if (!ids.length) return res.json([]);
    const marks = ids.map(() => '?').join(',');
    const [rows] = await pool.query(
      `SELECT * FROM asset_events WHERE asset_id IN (${marks}) ORDER BY created_at DESC, id DESC LIMIT 500`,
      ids
    );
    res.json(rows);
  } catch (error) {
    next(error);
  }
});


app.get('/api/assignment-requests', async (req, res, next) => {
  try {
    res.json(await loadAssignmentRequests(await getRequestUser(req)));
  } catch (error) {
    next(error);
  }
});

app.get('/api/assignment-requests/:id', async (req, res, next) => {
  try {
    const request = await loadAssignmentRequestById(req.params.id, await getRequestUser(req));
    if (!request) return res.status(404).json({ error: 'ไม่พบคำขอจัดสรรทรัพย์สิน' });
    res.json(request);
  } catch (error) {
    next(error);
  }
});

app.post('/api/assignment-requests', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    const employeeCode = text(req.body.employeeCode || req.body.employee_code);
    const requestReason = text(req.body.requestReason || req.body.request_reason);
    if (!employeeCode) return res.status(400).json({ error: 'กรุณาเลือกพนักงานผู้รับทรัพย์สิน' });
    if (!requestReason) return res.status(400).json({ error: 'กรุณาระบุเหตุผลการขอจัดสรร' });
    const employee = await assertAssignmentEmployee(user, employeeCode);
    const items = normalizeAssignmentItems(req.body.items);
    const requestNo = generateNo('ASG');

    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO asset_assignment_requests (
        request_no, company_code, employee_code, employee_name, department,
        position_name, work_location, required_date, request_reason, status,
        requested_by, requested_by_name, decision_note, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'DRAFT', ?, ?, '', CURRENT_TIMESTAMP)`,
      [
        requestNo,
        normalizeCompany(employee.company),
        employee.id,
        employee.name,
        text(req.body.department, employee.department),
        text(req.body.positionName || req.body.position_name, employee.position),
        text(req.body.workLocation || req.body.work_location, employee.location),
        dateOnly(req.body.requiredDate || req.body.required_date) || null,
        requestReason,
        user.id,
        user.name
      ]
    );
    await insertAssignmentItems(connection, result.insertId, items);
    await connection.commit();

    const created = await loadAssignmentRequestById(result.insertId, user);
    await writeAudit(req, 'ASSET_ASSIGNMENT', 'CREATE_REQUEST', requestNo, null, created, user);
    res.status(201).json(created);
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.put('/api/assignment-requests/:id', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    const before = await loadAssignmentRequestById(req.params.id, user);
    if (!before) return res.status(404).json({ error: 'ไม่พบคำขอจัดสรรทรัพย์สิน' });
    if (!assignmentEditableStatuses.has(before.status) && !isDataAdmin(user)) {
      return res.status(409).json({ error: 'แก้ไขได้เฉพาะคำขอฉบับร่าง หรือใช้สิทธิ์ Admin เพื่อแก้ไขย้อนหลัง' });
    }
    if (!canRequestAssignments(user) && !isDataAdmin(user)) return res.status(403).json({ error: 'ไม่มีสิทธิ์แก้ไขคำขอ' });

    const employeeCode = text(req.body.employeeCode || req.body.employee_code, before.employeeCode);
    const employee = await assertAssignmentEmployee(user, employeeCode);
    const items = normalizeAssignmentItems(req.body.items);
    const requestReason = text(req.body.requestReason || req.body.request_reason, before.requestReason);
    if (!requestReason) return res.status(400).json({ error: 'กรุณาระบุเหตุผลการขอจัดสรร' });

    await connection.beginTransaction();
    await connection.query(
      `UPDATE asset_assignment_requests SET
        employee_code = ?, employee_name = ?, department = ?, position_name = ?,
        work_location = ?, required_date = ?, request_reason = ?, decision_note = '',
        status = 'DRAFT', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        employee.id,
        employee.name,
        text(req.body.department, employee.department),
        text(req.body.positionName || req.body.position_name, employee.position),
        text(req.body.workLocation || req.body.work_location, employee.location),
        dateOnly(req.body.requiredDate || req.body.required_date) || null,
        requestReason,
        before.id
      ]
    );
    await connection.query('DELETE FROM asset_assignment_request_items WHERE request_id = ?', [before.id]);
    await insertAssignmentItems(connection, before.id, items);
    await connection.commit();

    const updated = await loadAssignmentRequestById(before.id, user);
    await writeAudit(req, 'ASSET_ASSIGNMENT', 'UPDATE_REQUEST', before.requestNo, before, updated, user);
    res.json(updated);
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.post('/api/assignment-requests/:id/submit', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const before = await loadAssignmentRequestById(req.params.id, user);
    if (!before) return res.status(404).json({ error: 'ไม่พบคำขอจัดสรรทรัพย์สิน' });
    if (!assignmentEditableStatuses.has(before.status)) return res.status(409).json({ error: 'คำขอนี้ส่งให้ IT แล้วหรือดำเนินการเสร็จแล้ว' });
    if (!before.items.length || before.requestedCount < 1) return res.status(400).json({ error: 'คำขอต้องมีรายการทรัพย์สินอย่างน้อย 1 รายการ' });
    await pool.query(
      `UPDATE asset_assignment_requests
       SET status = 'SUBMITTED', submitted_at = CURRENT_TIMESTAMP, decision_note = '', updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [before.id]
    );
    const updated = await loadAssignmentRequestById(before.id, user);
    await writeAudit(req, 'ASSET_ASSIGNMENT', 'SUBMIT_REQUEST', before.requestNo, before, updated, user);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

app.post('/api/assignment-requests/:id/review', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const before = await loadAssignmentRequestById(req.params.id, user);
    if (!before) return res.status(404).json({ error: 'ไม่พบคำขอจัดสรรทรัพย์สิน' });
    if (before.status !== 'SUBMITTED') return res.status(409).json({ error: 'เริ่มตรวจสอบได้เฉพาะคำขอที่ผู้ร้องขอส่งมาใหม่' });
    await pool.query(
      `UPDATE asset_assignment_requests
       SET status = 'IT_REVIEW', reviewed_by = ?, reviewed_by_name = ?, reviewed_at = CURRENT_TIMESTAMP,
           decision_note = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [user.id, user.name, text(req.body.note), before.id]
    );
    const updated = await loadAssignmentRequestById(before.id, user);
    await writeAudit(req, 'ASSET_ASSIGNMENT', 'START_REVIEW', before.requestNo, before, updated, user);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

app.post('/api/assignment-requests/:id/return-for-edit', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    const before = await loadAssignmentRequestById(req.params.id, user);
    if (!before) return res.status(404).json({ error: 'ไม่พบคำขอจัดสรรทรัพย์สิน' });
    if (!['SUBMITTED', 'IT_REVIEW'].includes(before.status)) return res.status(409).json({ error: 'ไม่สามารถส่งคำขอนี้กลับแก้ไขได้' });
    const note = text(req.body.note);
    if (!note) return res.status(400).json({ error: 'กรุณาระบุสิ่งที่ผู้ร้องขอต้องแก้ไข' });
    await connection.beginTransaction();
    await connection.query('DELETE FROM asset_assignment_allocations WHERE request_id = ?', [before.id]);
    await connection.query(
      `UPDATE asset_assignment_requests
       SET status = 'RETURNED_FOR_EDIT', reviewed_by = ?, reviewed_by_name = ?, reviewed_at = CURRENT_TIMESTAMP,
           decision_note = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [user.id, user.name, note, before.id]
    );
    await refreshAssignmentItemStatuses(connection, before.id);
    await connection.commit();
    const updated = await loadAssignmentRequestById(before.id, user);
    await writeAudit(req, 'ASSET_ASSIGNMENT', 'RETURN_FOR_EDIT', before.requestNo, before, updated, user);
    res.json(updated);
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.post('/api/assignment-requests/:id/reject', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    const before = await loadAssignmentRequestById(req.params.id, user);
    if (!before) return res.status(404).json({ error: 'ไม่พบคำขอจัดสรรทรัพย์สิน' });
    if (!['SUBMITTED', 'IT_REVIEW'].includes(before.status)) return res.status(409).json({ error: 'ไม่สามารถปฏิเสธคำขอนี้ได้' });
    const note = text(req.body.note);
    if (!note) return res.status(400).json({ error: 'กรุณาระบุเหตุผลที่ไม่อนุมัติ' });
    await connection.beginTransaction();
    await connection.query("UPDATE asset_assignment_allocations SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE request_id = ?", [before.id]);
    await connection.query("UPDATE asset_assignment_request_items SET item_status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE request_id = ?", [before.id]);
    await connection.query(
      `UPDATE asset_assignment_requests
       SET status = 'REJECTED', reviewed_by = ?, reviewed_by_name = ?, reviewed_at = CURRENT_TIMESTAMP,
           decision_note = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [user.id, user.name, note, before.id]
    );
    await connection.commit();
    const updated = await loadAssignmentRequestById(before.id, user);
    await writeAudit(req, 'ASSET_ASSIGNMENT', 'REJECT_REQUEST', before.requestNo, before, updated, user);
    res.json(updated);
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.post('/api/assignment-requests/:id/allocations', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    const requestItemId = Number(req.body.requestItemId || req.body.request_item_id);
    const assetId = text(req.body.assetId || req.body.asset_id);
    if (!requestItemId || !assetId) return res.status(400).json({ error: 'กรุณาเลือกรายการคำขอและ Asset' });

    await connection.beginTransaction();
    const [requestRows] = await connection.query('SELECT * FROM asset_assignment_requests WHERE id = ? FOR UPDATE', [req.params.id]);
    const request = requestRows[0];
    if (!request) throw httpError(404, 'ไม่พบคำขอจัดสรรทรัพย์สิน');
    assertCompanyAccess(user, request.company_code);
    if (!['SUBMITTED', 'IT_REVIEW'].includes(request.status)) throw httpError(409, 'เลือก Asset ได้เฉพาะรายการที่อยู่ระหว่าง IT ตรวจสอบ');

    const [itemRows] = await connection.query(
      'SELECT * FROM asset_assignment_request_items WHERE id = ? AND request_id = ? FOR UPDATE',
      [requestItemId, request.id]
    );
    const item = itemRows[0];
    if (!item) throw httpError(404, 'ไม่พบรายการทรัพย์สินในคำขอ');
    const [countRows] = await connection.query(
      "SELECT COUNT(*) AS total FROM asset_assignment_allocations WHERE request_item_id = ? AND status <> 'CANCELLED'",
      [item.id]
    );
    if (Number(countRows[0]?.total || 0) >= Number(item.requested_quantity)) {
      throw httpError(409, 'รายการนี้เลือก Asset ครบตามจำนวนแล้ว');
    }

    const [assetRows] = await connection.query('SELECT * FROM assets WHERE id = ? FOR UPDATE', [assetId]);
    const asset = assetRows[0];
    if (!asset) throw httpError(404, 'ไม่พบ Asset');
    if (normalizeCompany(asset.company) !== normalizeCompany(request.company_code)) throw httpError(403, 'Asset อยู่คนละบริษัทกับพนักงาน');
    const assetStatus = normalizeAssetStatus(asset.status);
    const custodianType = text(asset.custodian_type, asset.assigned_to ? 'EMPLOYEE' : 'UNASSIGNED').toUpperCase();
    if (assetStatus !== 'IN_STOCK' || custodianType !== 'UNASSIGNED') {
      throw httpError(409, `Asset ต้องอยู่ในสถานะ IN_STOCK และไม่มีผู้ถือครองก่อนจอง (ปัจจุบัน ${assetStatus}/${custodianType})`);
    }
    if (text(item.asset_category).toLowerCase() !== text(asset.category).toLowerCase()) {
      throw httpError(409, `หมวด Asset ไม่ตรงกับคำขอ (${asset.category} ≠ ${item.asset_category})`);
    }
    if (text(item.asset_subcategory) && text(item.asset_subcategory).toLowerCase() !== text(asset.subcategory).toLowerCase()) {
      throw httpError(409, 'หมวดย่อยของ Asset ไม่ตรงกับคำขอ');
    }
    const [reservedRows] = await connection.query(
      `SELECT a.id, r.request_no
       FROM asset_assignment_allocations a
       INNER JOIN asset_assignment_requests r ON r.id = a.request_id
       WHERE a.asset_id = ? AND a.status IN ('RESERVED', 'HANDED_OVER')
       LIMIT 1 FOR UPDATE`,
      [assetId]
    );
    if (reservedRows[0]) throw httpError(409, `Asset ถูกจองในคำขอ ${reservedRows[0].request_no} แล้ว`);

    await connection.query(
      `INSERT INTO asset_assignment_allocations (
        request_id, request_item_id, asset_id, status, reserved_by,
        reserved_by_name, reserved_at, note, updated_at
      ) VALUES (?, ?, ?, 'RESERVED', ?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP)`,
      [request.id, item.id, assetId, user.id, user.name, text(req.body.note)]
    );
    if (request.status === 'SUBMITTED') {
      await connection.query(
        `UPDATE asset_assignment_requests
         SET status = 'IT_REVIEW', reviewed_by = ?, reviewed_by_name = ?, reviewed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [user.id, user.name, request.id]
      );
    }
    await refreshAssignmentItemStatuses(connection, request.id);
    await connection.commit();

    const updated = await loadAssignmentRequestById(request.id, user);
    await writeAudit(req, 'ASSET_ASSIGNMENT', 'RESERVE_ASSET', `${request.request_no}:${assetId}`, null, updated, user);
    res.status(201).json(updated);
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.delete('/api/assignment-requests/:id/allocations/:allocationId', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    await connection.beginTransaction();
    const [requestRows] = await connection.query('SELECT * FROM asset_assignment_requests WHERE id = ? FOR UPDATE', [req.params.id]);
    const request = requestRows[0];
    if (!request) throw httpError(404, 'ไม่พบคำขอจัดสรรทรัพย์สิน');
    assertCompanyAccess(user, request.company_code);
    if (!['SUBMITTED', 'IT_REVIEW'].includes(request.status)) throw httpError(409, 'ถอดการจองได้เฉพาะช่วง IT ตรวจสอบ');
    const [allocationRows] = await connection.query(
      'SELECT * FROM asset_assignment_allocations WHERE id = ? AND request_id = ? FOR UPDATE',
      [req.params.allocationId, request.id]
    );
    if (!allocationRows[0]) throw httpError(404, 'ไม่พบรายการจอง Asset');
    if (allocationRows[0].status !== 'RESERVED') throw httpError(409, 'รายการนี้ส่งมอบหรือปิดงานแล้ว');
    await connection.query('DELETE FROM asset_assignment_allocations WHERE id = ?', [allocationRows[0].id]);
    await refreshAssignmentItemStatuses(connection, request.id);
    await connection.commit();
    const updated = await loadAssignmentRequestById(request.id, user);
    await writeAudit(req, 'ASSET_ASSIGNMENT', 'REMOVE_RESERVATION', `${request.request_no}:${allocationRows[0].asset_id}`, allocationRows[0], null, user);
    res.json(updated);
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.post('/api/assignment-requests/:id/approve', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const before = await loadAssignmentRequestById(req.params.id, user);
    if (!before) return res.status(404).json({ error: 'ไม่พบคำขอจัดสรรทรัพย์สิน' });
    if (!['SUBMITTED', 'IT_REVIEW'].includes(before.status)) return res.status(409).json({ error: 'คำขอนี้ไม่อยู่ในขั้นตอนตรวจสอบ' });
    if (before.allocatedCount !== before.requestedCount) {
      return res.status(409).json({ error: `ต้องเลือก Asset ให้ครบ ${before.requestedCount} รายการ ปัจจุบันเลือกแล้ว ${before.allocatedCount}` });
    }
    await pool.query(
      `UPDATE asset_assignment_requests
       SET status = 'APPROVED', reviewed_by = ?, reviewed_by_name = ?, reviewed_at = CURRENT_TIMESTAMP,
           decision_note = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [user.id, user.name, text(req.body.note), before.id]
    );
    const updated = await loadAssignmentRequestById(before.id, user);
    await writeAudit(req, 'ASSET_ASSIGNMENT', 'APPROVE_REQUEST', before.requestNo, before, updated, user);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

app.post('/api/assignment-requests/:id/handover', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    const condition = numberValue(req.body.assetCondition ?? req.body.asset_condition, 100);
    if (condition < 0 || condition > 100) return res.status(400).json({ error: 'สภาพทรัพย์สินต้องอยู่ระหว่าง 0 ถึง 100' });
    const accessories = Array.isArray(req.body.accessories)
      ? req.body.accessories.map((value) => text(value)).filter(Boolean)
      : text(req.body.accessories).split(',').map((value) => value.trim()).filter(Boolean);
    const handedOverAt = text(req.body.handedOverAt || req.body.handed_over_at, now());

    await connection.beginTransaction();
    const [requestRows] = await connection.query('SELECT * FROM asset_assignment_requests WHERE id = ? FOR UPDATE', [req.params.id]);
    const request = requestRows[0];
    if (!request) throw httpError(404, 'ไม่พบคำขอจัดสรรทรัพย์สิน');
    assertCompanyAccess(user, request.company_code);
    if (request.status !== 'APPROVED') throw httpError(409, 'ต้องอนุมัติและจอง Asset ให้ครบก่อนส่งมอบ');
    const [allocations] = await connection.query(
      "SELECT * FROM asset_assignment_allocations WHERE request_id = ? AND status = 'RESERVED' FOR UPDATE",
      [request.id]
    );
    if (!allocations.length) throw httpError(409, 'ไม่พบ Asset ที่จองไว้สำหรับส่งมอบ');

    for (const allocation of allocations) {
      await connection.query(
        `INSERT INTO asset_handovers (
          allocation_id, request_id, asset_id, employee_code, handed_over_by,
          handed_over_by_name, handed_over_at, asset_condition, accessories_json,
          handover_note, acknowledgement_status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', CURRENT_TIMESTAMP)
        ON DUPLICATE KEY UPDATE
          handed_over_by = VALUES(handed_over_by), handed_over_by_name = VALUES(handed_over_by_name),
          handed_over_at = VALUES(handed_over_at), asset_condition = VALUES(asset_condition),
          accessories_json = VALUES(accessories_json), handover_note = VALUES(handover_note),
          acknowledgement_status = 'PENDING', updated_at = CURRENT_TIMESTAMP`,
        [
          allocation.id,
          request.id,
          allocation.asset_id,
          request.employee_code,
          user.id,
          user.name,
          handedOverAt,
          condition,
          jsonValue(accessories, []),
          text(req.body.note)
        ]
      );
    }
    await connection.query(
      "UPDATE asset_assignment_allocations SET status = 'HANDED_OVER', updated_at = CURRENT_TIMESTAMP WHERE request_id = ? AND status = 'RESERVED'",
      [request.id]
    );
    await connection.query(
      "UPDATE asset_assignment_requests SET status = 'HANDED_OVER', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [request.id]
    );
    await connection.commit();
    const updated = await loadAssignmentRequestById(request.id, user);
    await writeAudit(req, 'ASSET_ASSIGNMENT', 'HANDOVER', request.request_no, null, updated, user);
    res.json(updated);
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.post('/api/assignment-requests/:id/acknowledge', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    await connection.beginTransaction();
    const [requestRows] = await connection.query('SELECT * FROM asset_assignment_requests WHERE id = ? FOR UPDATE', [req.params.id]);
    const request = requestRows[0];
    if (!request) throw httpError(404, 'ไม่พบคำขอจัดสรรทรัพย์สิน');
    assertCompanyAccess(user, request.company_code);
    if (request.status !== 'HANDED_OVER') throw httpError(409, 'คำขอนี้ยังไม่ได้ส่งมอบหรือยืนยันรับไปแล้ว');
    if (!canManageAssignments(user) && !canRequestAssignments(user) && request.employee_code !== user.id) {
      throw httpError(403, 'เฉพาะผู้รับทรัพย์สิน ผู้ร้องขอ หรือผู้ดูแลทรัพย์สินเท่านั้นที่ยืนยันรับได้');
    }

    const [employeeRows] = await connection.query(
      "SELECT * FROM employees WHERE id = ? AND status = 'ACTIVE' FOR UPDATE",
      [request.employee_code]
    );
    const employee = employeeRows[0];
    if (!employee) throw httpError(409, 'พนักงานผู้รับไม่อยู่ในสถานะ Active');
    const [allocations] = await connection.query(
      `SELECT a.*, h.id AS handover_id
       FROM asset_assignment_allocations a
       INNER JOIN asset_handovers h ON h.allocation_id = a.id
       WHERE a.request_id = ? AND a.status = 'HANDED_OVER'
       FOR UPDATE`,
      [request.id]
    );
    if (!allocations.length) throw httpError(409, 'ไม่พบรายการส่งมอบที่รอยืนยัน');
    const [requestedRows] = await connection.query(
      'SELECT COALESCE(SUM(requested_quantity), 0) AS total FROM asset_assignment_request_items WHERE request_id = ?',
      [request.id]
    );
    if (allocations.length !== Number(requestedRows[0]?.total || 0)) {
      throw httpError(409, 'จำนวน Asset ที่ส่งมอบไม่ครบตามคำขอ กรุณาให้ IT ตรวจสอบรายการอีกครั้ง');
    }

    const changedAssets = [];
    for (const allocation of allocations) {
      const [assetRows] = await connection.query('SELECT * FROM assets WHERE id = ? FOR UPDATE', [allocation.asset_id]);
      const asset = assetRows[0];
      if (!asset) throw httpError(404, `ไม่พบ Asset ${allocation.asset_id}`);
      if (normalizeCompany(asset.company) !== normalizeCompany(request.company_code)) throw httpError(403, 'พบ Asset ต่างบริษัทในคำขอ');
      const assetStatus = normalizeAssetStatus(asset.status);
      if (['BORROWED', 'IN_REPAIR', 'DISPOSED', 'SOLD', 'LOST'].includes(assetStatus)) {
        throw httpError(409, `Asset ${asset.id} อยู่ในสถานะ ${assetStatus} ไม่สามารถยืนยันส่งมอบได้`);
      }
      await connection.query(
        `UPDATE assets SET assigned_to = ?, custodian_type = 'EMPLOYEE', department = ?, location = ?, status = 'ACTIVE', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [employee.name, request.department || employee.department, request.work_location || employee.location, asset.id]
      );
      await connection.query(
        `INSERT INTO asset_events (company_code, asset_id, event_type, old_value, new_value, actor, note)
         VALUES (?, ?, 'ASSIGNMENT', ?, ?, ?, ?)`,
        [
          request.company_code,
          asset.id,
          asset.assigned_to || '',
          employee.name,
          user.name,
          `ส่งมอบตามคำขอ ${request.request_no}${text(req.body.note) ? ` · ${text(req.body.note)}` : ''}`
        ]
      );
      changedAssets.push({ assetId: asset.id, beforeAssignee: asset.assigned_to || '', afterAssignee: employee.name });
    }

    await connection.query(
      `UPDATE asset_handovers h
       INNER JOIN asset_assignment_allocations a ON a.id = h.allocation_id
       SET h.received_by = ?, h.received_by_name = ?, h.received_at = CURRENT_TIMESTAMP,
           h.acknowledgement_status = 'ACCEPTED', h.updated_at = CURRENT_TIMESTAMP
       WHERE a.request_id = ?`,
      [user.id, user.name, request.id]
    );
    await connection.query(
      "UPDATE asset_assignment_allocations SET status = 'COMPLETED', completed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE request_id = ?",
      [request.id]
    );
    await connection.query(
      "UPDATE asset_assignment_request_items SET item_status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE request_id = ?",
      [request.id]
    );
    await connection.query(
      "UPDATE asset_assignment_requests SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [request.id]
    );
    await connection.commit();

    const updated = await loadAssignmentRequestById(request.id, user);
    await writeAudit(req, 'ASSET_ASSIGNMENT', 'ACKNOWLEDGE_AND_ASSIGN', request.request_no, null, { request: updated, assets: changedAssets }, user);
    res.json(updated);
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.post('/api/assignment-requests/:id/cancel', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    const before = await loadAssignmentRequestById(req.params.id, user);
    if (!before) return res.status(404).json({ error: 'ไม่พบคำขอจัดสรรทรัพย์สิน' });
    if (!['DRAFT', 'RETURNED_FOR_EDIT', 'SUBMITTED', 'IT_REVIEW'].includes(before.status)) {
      return res.status(409).json({ error: 'ไม่สามารถยกเลิกคำขอหลังอนุมัติหรือส่งมอบแล้ว' });
    }
    if (!canRequestAssignments(user) && before.requestedBy !== user.id) return res.status(403).json({ error: 'ไม่มีสิทธิ์ยกเลิกคำขอนี้' });
    await connection.beginTransaction();
    await connection.query("UPDATE asset_assignment_allocations SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE request_id = ?", [before.id]);
    await connection.query("UPDATE asset_assignment_request_items SET item_status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE request_id = ?", [before.id]);
    await connection.query(
      "UPDATE asset_assignment_requests SET status = 'CANCELLED', decision_note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
      [text(req.body.note), before.id]
    );
    await connection.commit();
    const updated = await loadAssignmentRequestById(before.id, user);
    await writeAudit(req, 'ASSET_ASSIGNMENT', 'CANCEL_REQUEST', before.requestNo, before, updated, user);
    res.json(updated);
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.get('/api/employees', async (req, res, next) => {
  try {
    res.json(await getEmployees(await getRequestUser(req)));
  } catch (error) {
    next(error);
  }
});

app.post('/api/employees', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const missing = requireFields(req.body, ['name', 'department']);
    if (missing.length) return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });
    const employeeId = text(req.body.id || req.body.employeeCode) || await generateNextId('employees', 'id', 'EMP-', 1001, 4);
    const company = scopedCompany(user, req.body.company);
    const canLogin = Boolean(req.body.canLogin);
    if (canLogin) assertUserManagementAccess(user);
    else assertEmployeeManagementAccess(user);
    const role = canLogin ? text(req.body.role, 'VIEW') : 'VIEW';
    const status = text(req.body.status, 'ACTIVE').toUpperCase();
    if (!validRoles.has(role)) return res.status(400).json({ error: 'Role ไม่ถูกต้อง' });
    if (!['ACTIVE', 'INACTIVE'].includes(status)) return res.status(400).json({ error: 'สถานะผู้ใช้ต้องเป็น ACTIVE หรือ INACTIVE' });
    const password = canLogin ? text(req.body.password) : '';
    if (canLogin && !password) return res.status(400).json({ error: 'กรุณากำหนดรหัสผ่านสำหรับผู้ใช้ใหม่' });
    if (password && password.length < 8) return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
    const email = text(req.body.email);
    if (email) {
      const [emailRows] = await pool.query('SELECT id FROM employees WHERE LOWER(email) = LOWER(?) LIMIT 1', [email]);
      if (emailRows[0]) return res.status(409).json({ error: 'Email นี้ถูกใช้โดยบัญชีอื่นแล้ว' });
    }

    await pool.query(
      `INSERT INTO employees (
        id, company, name, department, position, email, phone, role, status,
        location, password_hash, must_change_password, can_login, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        employeeId, company, text(req.body.name || req.body.fullName), text(req.body.department),
        text(req.body.position, '-'), email, text(req.body.phone), role,
        status, text(req.body.location, ''), password ? hashPassword(password) : '', 0, canLogin ? 1 : 0
      ]
    );
    const [rows] = await pool.query('SELECT * FROM employees WHERE id = ? LIMIT 1', [employeeId]);
    const created = toEmployee(rows[0]);
    await writeAudit(req, canLogin ? 'USER' : 'EMPLOYEE', 'CREATE', employeeId, null, created, user);
    res.status(201).json(created);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Employee ID หรือ Email นี้มีอยู่แล้ว' });
    next(error);
  }
});

app.put('/api/employees/:id', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    const originalId = text(req.params.id);
    const [oldRows] = await connection.query(
      'SELECT * FROM employees WHERE id = ? LIMIT 1',
      [originalId]
    );
    if (!oldRows[0]) return res.status(404).json({ error: 'Employee not found' });

    const oldRow = oldRows[0];
    assertCompanyAccess(user, oldRow.company);
    const requestedCanLogin = req.body.canLogin === undefined
      ? Boolean(oldRow.can_login)
      : Boolean(req.body.canLogin);
    if (Boolean(oldRow.can_login) || requestedCanLogin) assertUserManagementAccess(user);
    else assertEmployeeManagementAccess(user);

    const requestedId = text(
      req.body.id || req.body.employeeCode || req.body.newEmployeeId,
      originalId
    );
    if (!requestedId) {
      return res.status(400).json({ error: 'กรุณาระบุรหัสพนักงาน' });
    }
    if (requestedId.length > 64) {
      return res.status(400).json({ error: 'รหัสพนักงานต้องไม่เกิน 64 ตัวอักษร' });
    }

    const oldCanLogin = Boolean(oldRow.can_login);
    const nextCanLogin = req.body.canLogin === undefined
      ? oldCanLogin
      : Boolean(req.body.canLogin);
    const nextCompany = scopedCompany(user, req.body.company || oldRow.company);
    const nextRole = nextCanLogin
      ? text(req.body.role, oldRow.role || 'VIEW')
      : 'VIEW';
    const nextStatus = text(req.body.status, oldRow.status).toUpperCase();

    if (!validRoles.has(nextRole)) {
      return res.status(400).json({ error: 'Role ไม่ถูกต้อง' });
    }
    if (!['ACTIVE', 'INACTIVE'].includes(nextStatus)) {
      return res.status(400).json({ error: 'สถานะผู้ใช้ต้องเป็น ACTIVE หรือ INACTIVE' });
    }

    if (
      originalId === user.id &&
      (!nextCanLogin || nextStatus !== 'ACTIVE' || nextRole !== oldRow.role)
    ) {
      return res.status(409).json({
        error: 'ไม่สามารถปิด Login เปลี่ยน Role หรือปิดใช้งานบัญชีของตนเองได้'
      });
    }

    if (
      oldRow.role === 'ADMIN' &&
      oldRow.status === 'ACTIVE' &&
      (nextRole !== 'ADMIN' || nextStatus !== 'ACTIVE' || !nextCanLogin)
    ) {
      const [adminRows] = await connection.query(
        "SELECT COUNT(*) AS total FROM employees WHERE role = 'ADMIN' AND status = 'ACTIVE' AND can_login = 1 AND id <> ?",
        [originalId]
      );
      if (Number(adminRows[0]?.total || 0) === 0) {
        return res.status(409).json({
          error: 'ต้องมี Admin ที่ Active อย่างน้อย 1 บัญชี'
        });
      }
    }

    const before = toEmployee(oldRow);
    const password = nextCanLogin ? text(req.body.password) : '';
    if (password && password.length < 8) {
      return res.status(400).json({ error: 'รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร' });
    }
    if (nextCanLogin && !oldCanLogin && !password) {
      return res.status(400).json({
        error: 'กรุณากำหนดรหัสผ่านเมื่อเปิดสิทธิ์ Login'
      });
    }

    const nextEmail = text(req.body.email, oldRow.email);
    if (nextEmail) {
      const [emailRows] = await connection.query(
        'SELECT id FROM employees WHERE LOWER(email) = LOWER(?) AND id <> ? LIMIT 1',
        [nextEmail, originalId]
      );
      if (emailRows[0]) {
        return res.status(409).json({ error: 'Email นี้ถูกใช้โดยบัญชีอื่นแล้ว' });
      }
    }

    await connection.beginTransaction();

    let targetId = originalId;
    if (requestedId !== originalId) {
      const [duplicateRows] = await connection.query(
        'SELECT id FROM employees WHERE id = ? LIMIT 1 FOR UPDATE',
        [requestedId]
      );
      if (duplicateRows[0]) {
        throw httpError(409, `รหัสพนักงาน ${requestedId} มีอยู่แล้ว`);
      }

      // สร้างแถวใหม่ก่อน เพื่อให้ Foreign Key สามารถย้ายจากรหัสเดิมไปยังรหัสใหม่ได้อย่างปลอดภัย
      await connection.query(
        `INSERT INTO employees (
          id, company, name, department, position, location, email, phone,
          role, status, created_at, updated_at, password_hash,
          must_change_password, can_login
        )
        SELECT ?, company, name, department, position, location, email, phone,
               role, status, created_at, updated_at, password_hash,
               must_change_password, can_login
        FROM employees
        WHERE id = ?`,
        [requestedId, originalId]
      );

      // ย้ายทุก Foreign Key ที่อ้างถึง employees.id จากฐานข้อมูลจริง
      const [foreignKeys] = await connection.query(
        `SELECT TABLE_NAME, COLUMN_NAME
         FROM information_schema.KEY_COLUMN_USAGE
         WHERE REFERENCED_TABLE_SCHEMA = DATABASE()
           AND REFERENCED_TABLE_NAME = 'employees'
           AND REFERENCED_COLUMN_NAME = 'id'`
      );

      for (const foreignKey of foreignKeys) {
        const tableName = String(foreignKey.TABLE_NAME || '');
        const columnName = String(foreignKey.COLUMN_NAME || '');
        if (!/^[A-Za-z0-9_]+$/.test(tableName) || !/^[A-Za-z0-9_]+$/.test(columnName)) {
          throw httpError(500, 'พบชื่อ Table หรือ Column ที่ไม่ปลอดภัยระหว่างเปลี่ยนรหัสพนักงาน');
        }
        await connection.query(
          `UPDATE \`${tableName}\` SET \`${columnName}\` = ? WHERE \`${columnName}\` = ?`,
          [requestedId, originalId]
        );
      }

      // ย้ายคอลัมน์อ้างอิงที่ไม่ได้ประกาศ Foreign Key
      const softReferences = [
        ['asset_assignment_requests', 'requested_by'],
        ['asset_assignment_requests', 'reviewed_by'],
        ['asset_assignment_allocations', 'reserved_by'],
        ['asset_handovers', 'handed_over_by'],
        ['asset_handovers', 'received_by'],
        ['approvals', 'requester_employee_code'],
        ['maintenance', 'requester_employee_code'],
        ['audit_logs', 'employee_code']
      ];

      for (const [tableName, columnName] of softReferences) {
        await connection.query(
          `UPDATE \`${tableName}\` SET \`${columnName}\` = ? WHERE \`${columnName}\` = ?`,
          [requestedId, originalId]
        );
      }

      await connection.query('DELETE FROM employees WHERE id = ?', [originalId]);
      targetId = requestedId;
    }

    await connection.query(
      `UPDATE employees SET
        company = ?, name = ?, department = ?, position = ?, email = ?, phone = ?,
        role = ?, status = ?, location = ?, can_login = ?,
        password_hash = CASE WHEN ? <> '' THEN ? WHEN ? = 0 THEN '' ELSE password_hash END,
        must_change_password = CASE WHEN ? <> '' THEN 0 WHEN ? = 0 THEN 0 ELSE must_change_password END,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        nextCompany,
        text(req.body.name || req.body.fullName, oldRow.name),
        text(req.body.department, oldRow.department),
        text(req.body.position, oldRow.position),
        nextEmail,
        text(req.body.phone, oldRow.phone),
        nextRole,
        nextStatus,
        text(req.body.location, oldRow.location),
        nextCanLogin ? 1 : 0,
        password,
        password ? hashPassword(password) : '',
        nextCanLogin ? 1 : 0,
        password,
        nextCanLogin ? 1 : 0,
        targetId
      ]
    );

    if (password || !nextCanLogin) {
      await connection.query(
        'UPDATE auth_sessions SET revoked_at = CURRENT_TIMESTAMP WHERE employee_id = ?',
        [targetId]
      );
    }

    await connection.commit();

    const [rows] = await pool.query(
      'SELECT * FROM employees WHERE id = ? LIMIT 1',
      [targetId]
    );
    const updated = toEmployee(rows[0]);
    await writeAudit(
      req,
      nextCanLogin ? 'USER' : 'EMPLOYEE',
      requestedId !== originalId ? 'RENAME_AND_UPDATE' : 'UPDATE',
      targetId,
      before,
      updated,
      user
    );
    res.json(updated);
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // ไม่มี transaction ที่ต้อง rollback หรือ rollback ไปแล้ว
    }
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'รหัสพนักงานหรือ Email นี้มีอยู่แล้ว' });
    }
    next(error);
  } finally {
    connection.release();
  }
});

app.delete('/api/employees/:id', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    if (req.params.id === user.id) return res.status(409).json({ error: 'ไม่สามารถลบบัญชีของตนเองได้' });
    const [rows] = await pool.query('SELECT * FROM employees WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'Employee not found' });
    assertCompanyAccess(user, rows[0].company);
    if (Boolean(rows[0].can_login)) assertUserManagementAccess(user);
    else assertEmployeeManagementAccess(user);
    const cascade = ['1', 'true', 'yes'].includes(text(req.query.cascade).toLowerCase());
    if (rows[0].role === 'ADMIN' && rows[0].status === 'ACTIVE') {
      const [adminRows] = await pool.query(
        "SELECT COUNT(*) AS total FROM employees WHERE role = 'ADMIN' AND status = 'ACTIVE' AND can_login = 1 AND id <> ?",
        [req.params.id]
      );
      if (Number(adminRows[0]?.total || 0) === 0) return res.status(409).json({ error: 'ต้องมี Admin ที่ Active อย่างน้อย 1 บัญชี' });
    }
    const [references] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM assets WHERE assigned_to = ?) +
        (SELECT COUNT(*) FROM borrow_records WHERE borrower = ?) +
        (SELECT COUNT(*) FROM approvals WHERE requester_employee_code = ?) +
        (SELECT COUNT(*) FROM maintenance WHERE requester_employee_code = ?) +
        (SELECT COUNT(*) FROM asset_assignment_requests WHERE employee_code = ? OR requested_by = ?) +
        (SELECT COUNT(*) FROM asset_handovers WHERE employee_code = ? OR handed_over_by = ? OR received_by = ?) AS total`,
      [rows[0].name, rows[0].name, req.params.id, req.params.id, req.params.id, req.params.id, req.params.id, req.params.id, req.params.id]
    );
    if (Number(references[0]?.total || 0) > 0 && !cascade) {
      return res.status(409).json({ error: 'บุคคลนี้มีข้อมูลอ้างอิง หากต้องการลบพร้อมคำขอและยกเลิกการครอบครองให้ยืนยันการลบแบบ Cascade' });
    }
    if (cascade) assertDataAdmin(user);
    const before = toEmployee(rows[0]);
    await connection.beginTransaction();
    if (cascade) {
      await connection.query("UPDATE assets SET assigned_to = '', custodian_type = 'UNASSIGNED', department = '', status = CASE WHEN status = 'ACTIVE' THEN 'IN_STOCK' ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE assigned_to = ?", [rows[0].name]);
      await connection.query("UPDATE approvals SET requester_employee_code = '' WHERE requester_employee_code = ?", [req.params.id]);
      await connection.query("UPDATE maintenance SET requester_employee_code = '' WHERE requester_employee_code = ?", [req.params.id]);
      await connection.query('DELETE FROM asset_assignment_requests WHERE employee_code = ? OR requested_by = ?', [req.params.id, req.params.id]);
    }
    await connection.query('DELETE FROM auth_sessions WHERE employee_id = ?', [req.params.id]);
    await connection.query('DELETE FROM employees WHERE id = ?', [req.params.id]);
    await connection.commit();
    await writeAudit(req, Boolean(rows[0].can_login) ? 'USER' : 'EMPLOYEE', cascade ? 'CASCADE_DELETE' : 'DELETE', req.params.id, before, null, user);
    res.status(204).end();
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.get('/api/companies', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const [rows] = isSuperAdmin(user)
      ? await pool.query('SELECT * FROM companies ORDER BY company_name_en ASC')
      : await pool.query('SELECT * FROM companies WHERE company_code = ? ORDER BY company_name_en ASC', [normalizeCompany(user.company)]);
    res.json(rows.map((company) => ({
      id: company.company_code,
      code: company.company_code,
      name: company.company_name_en,
      status: company.status,
      data: company
    })));
  } catch (error) {
    next(error);
  }
});

app.post('/api/companies', async (req, res, next) => {
  try {
    const code = normalizeCompany(text(req.body.code || req.body.company_code).toUpperCase());
    const name = text(req.body.name || req.body.company_name_en);
    if (!code || !name) return res.status(400).json({ error: 'กรุณากรอกรหัสและชื่อบริษัท' });

    await pool.query(
      `INSERT INTO companies (
        company_code,
        company_name_th,
        company_name_en,
        tax_id,
        address,
        phone,
        email,
        logo_url,
        status,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        code,
        text(req.body.company_name_th, name),
        name,
        text(req.body.tax_id),
        text(req.body.address),
        text(req.body.phone),
        text(req.body.email),
        text(req.body.logo_url),
        text(req.body.status, 'ACTIVE')
      ]
    );

    const [rows] = await pool.query('SELECT * FROM companies WHERE company_code = ?', [code]);
    const created = {
      id: code,
      code,
      name: rows[0].company_name_en,
      status: rows[0].status,
      data: rows[0]
    };
    await writeAudit(req, 'MASTER', 'CREATE', `company:${code}`, null, created);
    res.status(201).json(created);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'Company Code นี้มีอยู่แล้ว' });
    }
    next(error);
  }
});

app.put('/api/companies/:code', async (req, res, next) => {
  try {
    const [oldRows] = await pool.query('SELECT * FROM companies WHERE company_code = ?', [req.params.code]);
    if (!oldRows[0]) return res.status(404).json({ error: 'ไม่พบบริษัท' });

    const requestedCode = normalizeCompany(text(req.body.code || req.body.company_code, req.params.code).toUpperCase());
    if (requestedCode !== req.params.code) {
      return res.status(409).json({ error: 'ไม่รองรับการเปลี่ยน Company Code หลังมีการสร้างบริษัทแล้ว กรุณาสร้างรหัสใหม่แทน' });
    }
    const newCode = req.params.code;
    const name = text(req.body.name || req.body.company_name_en, oldRows[0].company_name_en);

    await pool.query(
      `UPDATE companies SET
        company_code = ?,
        company_name_th = ?,
        company_name_en = ?,
        tax_id = ?,
        address = ?,
        phone = ?,
        email = ?,
        logo_url = ?,
        status = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE company_code = ?`,
      [
        newCode,
        text(req.body.company_name_th, oldRows[0].company_name_th),
        name,
        text(req.body.tax_id, oldRows[0].tax_id),
        text(req.body.address, oldRows[0].address),
        text(req.body.phone, oldRows[0].phone),
        text(req.body.email, oldRows[0].email),
        text(req.body.logo_url, oldRows[0].logo_url),
        text(req.body.status, oldRows[0].status),
        req.params.code
      ]
    );

    const [rows] = await pool.query('SELECT * FROM companies WHERE company_code = ?', [newCode]);
    const updated = {
      id: newCode,
      code: newCode,
      name: rows[0].company_name_en,
      status: rows[0].status,
      data: rows[0]
    };
    await writeAudit(req, 'MASTER', 'UPDATE', `company:${newCode}`, oldRows[0], updated);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/companies/:code', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    if (!isSuperAdmin(user)) return res.status(403).json({ error: 'เฉพาะ Admin เท่านั้นที่ลบบริษัทได้' });
    const code = normalizeCompany(req.params.code);
    if (code === normalizeCompany(user.company)) return res.status(409).json({ error: 'ไม่สามารถลบบริษัทของบัญชีที่กำลังใช้งานอยู่' });
    const [rows] = await pool.query('SELECT * FROM companies WHERE company_code = ?', [code]);
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบบริษัท' });
    const cascade = ['1', 'true', 'yes'].includes(text(req.query.cascade).toLowerCase());
    const [refs] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM assets WHERE company = ?) +
        (SELECT COUNT(*) FROM employees WHERE company = ?) +
        (SELECT COUNT(*) FROM stock_items WHERE company = ?) AS total`,
      [code, code, code]
    );
    if (Number(refs[0]?.total || 0) > 0 && !cascade) {
      return res.status(409).json({ error: 'บริษัทนี้มีข้อมูลอ้างอิง หากต้องการลบทั้งบริษัทให้ยืนยัน Cascade Delete' });
    }
    await connection.beginTransaction();
    if (cascade) {
      const [assetRows] = await connection.query('SELECT id FROM assets WHERE company = ?', [code]);
      for (const asset of assetRows) {
        await connection.query('DELETE FROM asset_handovers WHERE asset_id = ?', [asset.id]);
        await connection.query('DELETE FROM asset_assignment_allocations WHERE asset_id = ?', [asset.id]);
        await connection.query('DELETE FROM maintenance WHERE asset_id = ?', [asset.id]);
        await connection.query('DELETE FROM transfers WHERE asset_id = ?', [asset.id]);
        await connection.query('DELETE FROM borrow_records WHERE asset_id = ?', [asset.id]);
        await connection.query('DELETE FROM disposals WHERE asset_id = ?', [asset.id]);
      }
      await connection.query('DELETE FROM approvals WHERE company_code = ?', [code]);
      await connection.query('DELETE FROM asset_assignment_requests WHERE company_code = ?', [code]);
      await connection.query('DELETE FROM stock_movements WHERE company_code = ?', [code]);
      await connection.query('DELETE FROM stock_balances WHERE company_code = ?', [code]);
      await connection.query('DELETE FROM stock_items WHERE company = ?', [code]);
      await connection.query('DELETE FROM assets WHERE company = ?', [code]);
      await connection.query('DELETE FROM auth_sessions WHERE employee_id IN (SELECT id FROM employees WHERE company = ?)', [code]);
      await connection.query('DELETE FROM employees WHERE company = ?', [code]);
      await connection.query('DELETE FROM master_records WHERE company_code = ?', [code]);
      await connection.query('DELETE FROM audit_logs WHERE company_code = ?', [code]);
    }
    await connection.query('DELETE FROM companies WHERE company_code = ?', [code]);
    await connection.commit();
    await writeAudit(req, 'MASTER', cascade ? 'CASCADE_DELETE' : 'DELETE', `company:${code}`, rows[0], null, user);
    res.status(204).end();
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.get('/api/master/:type', async (req, res, next) => {
  try {
    if (!allowedMasterTypes.has(req.params.type)) {
      return res.status(404).json({ error: 'ไม่พบ Master Data ประเภทนี้' });
    }

    const user = await getRequestUser(req);
    const [rows] = isSuperAdmin(user)
      ? await pool.query('SELECT * FROM master_records WHERE master_type = ? ORDER BY name ASC', [req.params.type])
      : await pool.query(
          "SELECT * FROM master_records WHERE master_type = ? AND (company_code = '' OR company_code = ?) ORDER BY name ASC",
          [req.params.type, normalizeCompany(user.company)]
        );
    res.json(rows.map((row) => ({ ...row, data: safeJsonObject(row.data_json) })));
  } catch (error) {
    next(error);
  }
});

async function normalizeRoomOwnerData(type, companyCode, rawData) {
  const data = rawData && typeof rawData === 'object' && !Array.isArray(rawData) ? { ...rawData } : {};
  if (type !== 'room') return data;
  const ownerEmployeeCode = text(data.ownerEmployeeCode || data.owner_employee_code);
  if (!ownerEmployeeCode) {
    return { ...data, ownerEmployeeCode: '', ownerName: '', ownerDepartment: '' };
  }
  const [rows] = await pool.query(
    'SELECT id, name, department, company FROM employees WHERE id = ? LIMIT 1',
    [ownerEmployeeCode]
  );
  const owner = rows[0];
  if (!owner) throw httpError(400, 'ไม่พบพนักงานผู้ดูแลห้องที่เลือก');
  if (companyCode && normalizeCompany(owner.company) !== normalizeCompany(companyCode)) {
    throw httpError(400, 'ผู้ดูแลห้องต้องอยู่บริษัทเดียวกับห้อง');
  }
  return {
    ...data,
    ownerEmployeeCode: owner.id,
    ownerName: owner.name,
    ownerDepartment: owner.department || ''
  };
}

app.post('/api/master/:type', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    assertMasterWriteAccess(user, req.params.type);
    if (!allowedMasterTypes.has(req.params.type)) {
      return res.status(404).json({ error: 'ไม่พบ Master Data ประเภทนี้' });
    }

    const code = text(req.body.code);
    const name = text(req.body.name);
    const parentCode = text(req.body.parentCode || req.body.parent_code);
    const companyCode = resolveMasterCompanyCode(
      user,
      req.params.type,
      req.body.companyCode ?? req.body.company_code ?? ''
    );
    const status = text(req.body.status, 'ACTIVE').toUpperCase();
    if (!code || !name) return res.status(400).json({ error: 'กรุณากรอกรหัสและชื่อ' });
    if (!['ACTIVE', 'INACTIVE'].includes(status)) return res.status(400).json({ error: 'สถานะ Master Data ต้องเป็น ACTIVE หรือ INACTIVE' });
    if (companyCode) await assertCompanyExists(companyCode);
    await assertMasterParent(req.params.type, parentCode, companyCode);
    const masterData = await normalizeRoomOwnerData(req.params.type, companyCode, req.body.data || {});

    const [result] = await pool.query(
      `INSERT INTO master_records (
        master_type,
        code,
        name,
        parent_code,
        company_code,
        status,
        data_json,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        req.params.type,
        code,
        name,
        parentCode,
        companyCode,
        status,
        jsonValue(masterData, {})
      ]
    );

    const [rows] = await pool.query('SELECT * FROM master_records WHERE id = ?', [result.insertId]);
    const created = { ...rows[0], data: safeJsonObject(rows[0].data_json) };
    await writeAudit(req, 'MASTER', 'CREATE', `${req.params.type}:${code}`, null, created, user);
    res.status(201).json(created);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'รหัสนี้มีอยู่ใน Master Data แล้ว' });
    }
    next(error);
  }
});

app.put('/api/master/:type/:id', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    assertMasterWriteAccess(user, req.params.type);
    if (!allowedMasterTypes.has(req.params.type)) {
      return res.status(404).json({ error: 'ไม่พบ Master Data ประเภทนี้' });
    }

    const [oldRows] = await pool.query(
      'SELECT * FROM master_records WHERE id = ? AND master_type = ?',
      [req.params.id, req.params.type]
    );
    if (!oldRows[0]) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    if (oldRows[0].company_code) assertCompanyAccess(user, oldRows[0].company_code);
    const requestedCode = text(req.body.code, oldRows[0].code);
    if (requestedCode !== oldRows[0].code) {
      return res.status(409).json({ error: 'ไม่สามารถเปลี่ยนรหัส Master Data หลังสร้างแล้ว กรุณาสร้างรหัสใหม่แทน' });
    }
    const parentCode = text(req.body.parentCode || req.body.parent_code, oldRows[0].parent_code);
    const companyCode = resolveMasterCompanyCode(
      user,
      req.params.type,
      req.body.companyCode ?? req.body.company_code ?? oldRows[0].company_code,
      oldRows[0].company_code
    );
    const status = text(req.body.status, oldRows[0].status).toUpperCase();
    if (!['ACTIVE', 'INACTIVE'].includes(status)) return res.status(400).json({ error: 'สถานะ Master Data ต้องเป็น ACTIVE หรือ INACTIVE' });
    if (companyCode) await assertCompanyExists(companyCode);
    await assertMasterParent(req.params.type, parentCode, companyCode);
    const masterData = await normalizeRoomOwnerData(
      req.params.type,
      companyCode,
      req.body.data ?? safeJsonObject(oldRows[0].data_json)
    );

    await pool.query(
      `UPDATE master_records SET
        code = ?,
        name = ?,
        parent_code = ?,
        company_code = ?,
        status = ?,
        data_json = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ? AND master_type = ?`,
      [
        oldRows[0].code,
        text(req.body.name, oldRows[0].name),
        parentCode,
        companyCode,
        status,
        jsonValue(masterData, {}),
        req.params.id,
        req.params.type
      ]
    );

    const [rows] = await pool.query('SELECT * FROM master_records WHERE id = ?', [req.params.id]);
    const updated = { ...rows[0], data: safeJsonObject(rows[0].data_json) };
    await writeAudit(req, 'MASTER', 'UPDATE', `${req.params.type}:${updated.code}`, oldRows[0], updated, user);
    res.json(updated);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(409).json({ error: 'รหัสนี้มีอยู่ใน Master Data แล้ว' });
    }
    next(error);
  }
});

app.delete('/api/master/:type/:id', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    assertMasterWriteAccess(user, req.params.type);
    if (!allowedMasterTypes.has(req.params.type)) {
      return res.status(404).json({ error: 'ไม่พบ Master Data ประเภทนี้' });
    }

    const [rows] = await connection.query(
      'SELECT * FROM master_records WHERE id = ? AND master_type = ?',
      [req.params.id, req.params.type]
    );
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบข้อมูล' });
    if (rows[0].company_code) assertCompanyAccess(user, rows[0].company_code);

    const childTypes = childMasterTypes(rows[0].master_type);
    let totalChildren = 0;
    if (childTypes.length) {
      const placeholders = childTypes.map(() => '?').join(',');
      const params = rows[0].company_code
        ? [...childTypes, rows[0].code, rows[0].company_code]
        : [...childTypes, rows[0].code];
      const [children] = rows[0].company_code
        ? await connection.query(
            `SELECT COUNT(*) AS total FROM master_records
             WHERE master_type IN (${placeholders}) AND parent_code = ? AND company_code = ?`,
            params
          )
        : await connection.query(
            `SELECT COUNT(*) AS total FROM master_records
             WHERE master_type IN (${placeholders}) AND parent_code = ?`,
            params
          );
      totalChildren = Number(children[0]?.total || 0);
    }

    const cascade = ['1', 'true', 'yes'].includes(text(req.query.cascade).toLowerCase());
    if (totalChildren > 0 && !cascade) {
      return res.status(409).json({ error: 'ข้อมูลนี้มี Master Data ลูกอ้างอิงอยู่ หากต้องการลบทั้งสายให้ยืนยัน Cascade Delete' });
    }
    if (cascade) assertDataAdmin(user);

    await connection.beginTransaction();
    if (cascade) await deleteMasterBranch(connection, rows[0]);
    else await connection.query('DELETE FROM master_records WHERE id = ? AND master_type = ?', [req.params.id, req.params.type]);
    await connection.commit();

    await writeAudit(req, 'MASTER', cascade ? 'CASCADE_DELETE' : 'DELETE', `${req.params.type}:${rows[0].code}`, rows[0], null, user);
    res.status(204).end();
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});


app.get('/api/facility-assets', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const params = [];
    let where = '';
    if (!isSuperAdmin(user)) {
      where = 'WHERE company_code = ?';
      params.push(normalizeCompany(user.company));
    }
    const [rows] = await pool.query(
      `SELECT
         id, item_code, company_code, name, asset_type, responsible_department, category, unit,
         total_quantity, available_quantity, damaged_quantity,
         custodian_employee_code, custodian_name, storage_location, warehouse, note,
         asset_image_mime,
         CASE WHEN asset_image IS NOT NULL AND OCTET_LENGTH(asset_image) > 0 THEN 1 ELSE 0 END AS has_legacy_image,
         created_at, updated_at
       FROM facility_assets ${where}
       ORDER BY name ASC, item_code ASC`,
      params
    );

    const imageMap = new Map();
    if (rows.length) {
      const assetIds = rows.map((row) => Number(row.id));
      const placeholders = assetIds.map(() => '?').join(',');
      const [imageRows] = await pool.query(
        `SELECT id, facility_asset_id, mime_type, sort_order
         FROM facility_asset_images
         WHERE facility_asset_id IN (${placeholders})
         ORDER BY facility_asset_id ASC, sort_order ASC, id ASC`,
        assetIds
      );
      for (const image of imageRows) {
        const key = Number(image.facility_asset_id);
        if (!imageMap.has(key)) imageMap.set(key, []);
        imageMap.get(key).push({
          id: Number(image.id),
          mime: image.mime_type || '',
          url: `/api/facility-assets/${encodeURIComponent(key)}/images/${encodeURIComponent(image.id)}`
        });
      }
    }

    res.json(rows.map((row) => {
      const images = imageMap.get(Number(row.id)) || [];
      const legacyImageUrl = row.has_legacy_image
        ? `/api/facility-assets/${encodeURIComponent(row.id)}/image${row.updated_at ? `?v=${new Date(row.updated_at).getTime()}` : ''}`
        : '';
      const normalizedImages = images.length
        ? images
        : (legacyImageUrl ? [{ id: 0, mime: row.asset_image_mime || '', url: legacyImageUrl }] : []);
      return {
        ...row,
        has_image: normalizedImages.length > 0,
        image_count: normalizedImages.length,
        images: normalizedImages,
        image_url: normalizedImages[0]?.url || '',
        total_quantity: Number(row.total_quantity || 0),
        available_quantity: Number(row.available_quantity || 0),
        damaged_quantity: Number(row.damaged_quantity || 0)
      };
    }));
  } catch (error) { next(error); }
});

app.get('/api/facility-assets/:id/images/:imageId', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const [rows] = await pool.query(
      `SELECT fi.image_data, fi.mime_type, f.company_code
       FROM facility_asset_images fi
       INNER JOIN facility_assets f ON f.id = fi.facility_asset_id
       WHERE fi.id = ? AND fi.facility_asset_id = ?
       LIMIT 1`,
      [req.params.imageId, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบรูปภาพทรัพย์สินส่วนกลาง' });
    assertCompanyAccess(user, rows[0].company_code);
    res.setHeader('Content-Type', rows[0].mime_type || 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(rows[0].image_data);
  } catch (error) { next(error); }
});

// Endpoint เดิมยังคงไว้เพื่อรองรับข้อมูล/ลิงก์เก่า โดยคืนรูปแรกของรายการ
app.get('/api/facility-assets/:id/image', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const [visibleRows] = await pool.query(
      'SELECT id, company_code, asset_image, asset_image_mime FROM facility_assets WHERE id = ? LIMIT 1',
      [req.params.id]
    );
    if (!visibleRows[0]) return res.status(404).json({ error: 'ไม่พบทรัพย์สินส่วนกลาง' });
    assertCompanyAccess(user, visibleRows[0].company_code);

    const [imageRows] = await pool.query(
      `SELECT image_data, mime_type
       FROM facility_asset_images
       WHERE facility_asset_id = ?
       ORDER BY sort_order ASC, id ASC
       LIMIT 1`,
      [req.params.id]
    );
    const imageData = imageRows[0]?.image_data || visibleRows[0].asset_image;
    const imageMime = imageRows[0]?.mime_type || visibleRows[0].asset_image_mime || 'image/jpeg';
    if (!imageData) return res.status(404).json({ error: 'ยังไม่มีรูปภาพทรัพย์สินส่วนกลาง' });

    res.setHeader('Content-Type', imageMime);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(imageData);
  } catch (error) { next(error); }
});

app.post('/api/facility-assets', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    assertDataAdmin(user);
    const companyCode = await assertCompanyExists(scopedCompany(user, req.body.companyCode || req.body.company_code));
    const name = text(req.body.name);
    const assetType = normalizeFacilityAssetType(req.body.assetType || req.body.asset_type, 'ASSET');
    const responsibleDepartment = normalizeOperationalDepartment(
      req.body.responsibleDepartment || req.body.responsible_department,
      'GA'
    );
    assertWorkflowDepartment(user, responsibleDepartment, `รายการนี้อยู่ในความรับผิดชอบของ ${responsibleDepartment}`);
    const category = text(req.body.category);
    const unit = text(req.body.unit, 'ชิ้น');
    const initialQuantity = numberValue(
      req.body.totalQuantity ?? req.body.total_quantity ?? req.body.initialQuantity ?? req.body.initial_quantity,
      0
    );
    const requestedItemCode = text(req.body.itemCode ?? req.body.item_code);
    const storageLocation = text(req.body.storageLocation || req.body.storage_location);
    if (!name || !category || !unit || !storageLocation) throw httpError(400, 'กรุณากรอกชื่อ หมวดหมู่ หน่วย และสถานที่เก็บหลักให้ครบ');
    if (!(initialQuantity > 0)) throw httpError(400, 'จำนวนเริ่มต้นต้องมากกว่า 0');
    if (requestedItemCode.length > 80) throw httpError(400, 'รหัสทรัพย์สินส่วนกลางต้องไม่เกิน 80 ตัวอักษร');
    const custodian = await facilityEmployee(companyCode, req.body.custodianEmployeeCode || req.body.custodian_employee_code);
    const imageValues = Array.isArray(req.body.imagesData || req.body.images_data)
      ? (req.body.imagesData || req.body.images_data)
      : (req.body.imageData || req.body.image_data ? [req.body.imageData || req.body.image_data] : []);
    const images = parseFacilityImages(imageValues);
    const itemCode = requestedItemCode || generateNo('FAC');

    const [duplicateCodeRows] = await connection.query(
      'SELECT id FROM facility_assets WHERE item_code = ? LIMIT 1',
      [itemCode]
    );
    if (duplicateCodeRows[0]) throw httpError(409, `รหัส ${itemCode} มีอยู่ในระบบแล้ว`);

    await connection.beginTransaction();
    const [result] = await connection.query(
      `INSERT INTO facility_assets (
        item_code, company_code, name, asset_type, responsible_department, category, unit, total_quantity,
        available_quantity, damaged_quantity, custodian_employee_code,
        custodian_name, storage_location, warehouse, asset_image, asset_image_mime, note, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, NULL, '', ?, CURRENT_TIMESTAMP)`,
      [
        itemCode, companyCode, name, assetType, responsibleDepartment, category, unit, initialQuantity, initialQuantity,
        custodian?.id || '', custodian?.name || '', storageLocation,
        text(req.body.warehouse), text(req.body.note)
      ]
    );
    for (let index = 0; index < images.length; index += 1) {
      const image = images[index];
      await connection.query(
        'INSERT INTO facility_asset_images (facility_asset_id, mime_type, image_data, sort_order) VALUES (?, ?, ?, ?)',
        [result.insertId, image.mime, image.buffer, index + 1]
      );
    }
    const asset = await facilityAssetRow(connection, result.insertId, true);
    await addFacilityMovement(connection, asset, 'INITIAL_RECEIVE', initialQuantity, {
      referenceNo: itemCode,
      toLocation: storageLocation,
      employeeCode: custodian?.id || '',
      employeeName: custodian?.name || '',
      note: 'รับเข้าทรัพย์สินส่วนกลางครั้งแรก'
    });
    await connection.commit();
    await writeAudit(req, 'FACILITY_ASSET', 'CREATE', itemCode, null, { ...asset, image_count: images.length }, user);
    res.status(201).json({ ...asset, image_count: images.length });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
});

app.put('/api/facility-assets/:id', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    assertDataAdmin(user);
    await connection.beginTransaction();
    const before = await facilityAssetRow(connection, req.params.id, true);
    if (!before) {
      await connection.rollback();
      return res.status(404).json({ error: 'ไม่พบทรัพย์สินส่วนกลาง' });
    }
    assertCompanyAccess(user, before.company_code);
    const custodian = await facilityEmployee(before.company_code, req.body.custodianEmployeeCode ?? req.body.custodian_employee_code ?? before.custodian_employee_code);
    const itemCode = text(req.body.itemCode ?? req.body.item_code, before.item_code);
    const name = text(req.body.name, before.name);
    const assetType = normalizeFacilityAssetType(req.body.assetType ?? req.body.asset_type, before.asset_type || 'ASSET');
    const responsibleDepartment = normalizeOperationalDepartment(
      req.body.responsibleDepartment ?? req.body.responsible_department,
      before.responsible_department || 'GA'
    );
    assertWorkflowDepartment(user, responsibleDepartment, `รายการนี้อยู่ในความรับผิดชอบของ ${responsibleDepartment}`);
    const category = text(req.body.category, before.category);
    const unit = text(req.body.unit, before.unit);
    const totalQuantity = numberValue(req.body.totalQuantity ?? req.body.total_quantity, Number(before.total_quantity));
    const storageLocation = text(req.body.storageLocation ?? req.body.storage_location, before.storage_location);
    if (!itemCode || !name || !category || !unit || !storageLocation) throw httpError(400, 'ข้อมูลหลักของทรัพย์สินส่วนกลางไม่ครบ');
    if (itemCode.length > 80) throw httpError(400, 'รหัสทรัพย์สินส่วนกลางต้องไม่เกิน 80 ตัวอักษร');
    if (totalQuantity < 0) throw httpError(400, 'จำนวนทั้งหมดต้องไม่ติดลบ');

    if (itemCode !== before.item_code) {
      const [duplicateCodeRows] = await connection.query(
        'SELECT id FROM facility_assets WHERE item_code = ? AND id <> ? LIMIT 1',
        [itemCode, before.id]
      );
      if (duplicateCodeRows[0]) throw httpError(409, `รหัส ${itemCode} มีอยู่ในระบบแล้ว`);
    }

    const inUseQuantity = Math.max(
      0,
      Number(before.total_quantity || 0)
        - Number(before.available_quantity || 0)
        - Number(before.damaged_quantity || 0)
    );
    const minimumTotalQuantity = inUseQuantity + Number(before.damaged_quantity || 0);
    if (totalQuantity + 0.0001 < minimumTotalQuantity) {
      throw httpError(
        409,
        `ลดจำนวนทั้งหมดต่ำกว่า ${minimumTotalQuantity} ไม่ได้ เนื่องจากมีจำนวนกำลังใช้งาน ${inUseQuantity} และชำรุด ${Number(before.damaged_quantity || 0)} ${before.unit}`
      );
    }
    const availableQuantity = totalQuantity - inUseQuantity - Number(before.damaged_quantity || 0);
    const quantityDifference = totalQuantity - Number(before.total_quantity || 0);

    const removeImageIds = normalizeFacilityImageIds(req.body.removeImageIds || req.body.remove_image_ids);
    const imageValues = Array.isArray(req.body.imagesData || req.body.images_data)
      ? (req.body.imagesData || req.body.images_data)
      : (req.body.imageData || req.body.image_data ? [req.body.imageData || req.body.image_data] : []);
    const newImages = parseFacilityImages(imageValues);

    if (removeImageIds.length) {
      const placeholders = removeImageIds.map(() => '?').join(',');
      await connection.query(
        `DELETE FROM facility_asset_images WHERE facility_asset_id = ? AND id IN (${placeholders})`,
        [req.params.id, ...removeImageIds]
      );
    }
    const [countRows] = await connection.query(
      'SELECT COUNT(*) AS total, COALESCE(MAX(sort_order), 0) AS max_sort FROM facility_asset_images WHERE facility_asset_id = ?',
      [req.params.id]
    );
    const existingCount = Number(countRows[0]?.total || 0);
    if (existingCount + newImages.length > 5) throw httpError(400, 'รูปภาพทรัพย์สินส่วนกลางรวมกันได้สูงสุด 5 รูป');
    const maxSort = Number(countRows[0]?.max_sort || 0);
    for (let index = 0; index < newImages.length; index += 1) {
      const image = newImages[index];
      await connection.query(
        'INSERT INTO facility_asset_images (facility_asset_id, mime_type, image_data, sort_order) VALUES (?, ?, ?, ?)',
        [req.params.id, image.mime, image.buffer, maxSort + index + 1]
      );
    }

    await connection.query(
      `UPDATE facility_assets SET
        item_code = ?, name = ?, asset_type = ?, responsible_department = ?, category = ?, unit = ?, total_quantity = ?, available_quantity = ?,
        custodian_employee_code = ?, custodian_name = ?, storage_location = ?, warehouse = ?, note = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        itemCode, name, assetType, responsibleDepartment, category, unit, totalQuantity, availableQuantity,
        custodian?.id || '', custodian?.name || '', storageLocation,
        text(req.body.warehouse, before.warehouse), text(req.body.note, before.note), req.params.id
      ]
    );
    if (Math.abs(quantityDifference) > 0.0001) {
      await addFacilityMovement(connection, before, 'ADJUST_TOTAL', quantityDifference, {
        referenceNo: itemCode,
        toLocation: storageLocation,
        employeeCode: custodian?.id || '',
        employeeName: custodian?.name || '',
        note: `ปรับจำนวนทั้งหมดจาก ${Number(before.total_quantity || 0)} เป็น ${totalQuantity} ${unit}`
      });
    }
    const [afterCountRows] = await connection.query(
      'SELECT COUNT(*) AS total FROM facility_asset_images WHERE facility_asset_id = ?',
      [req.params.id]
    );
    const updated = await facilityAssetRow(connection, req.params.id);
    await connection.commit();
    await writeAudit(req, 'FACILITY_ASSET', 'UPDATE', itemCode, before, { ...updated, image_count: Number(afterCountRows[0]?.total || 0) }, user);
    res.json({ ...updated, image_count: Number(afterCountRows[0]?.total || 0) });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
});

app.delete('/api/facility-assets/:id', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    assertDataAdmin(user);
    await connection.beginTransaction();

    const before = await facilityAssetRow(connection, req.params.id, true);
    if (!before) throw httpError(404, 'ไม่พบทรัพย์สินส่วนกลาง');
    assertCompanyAccess(user, before.company_code);
    assertWorkflowDepartment(user, before.responsible_department || 'GA', `รายการนี้อยู่ในความรับผิดชอบของ ${before.responsible_department || 'GA'}`);

    const [activeRows] = await connection.query(
      `SELECT COUNT(*) AS total
       FROM facility_issues
       WHERE facility_asset_id = ?
         AND quantity > (returned_quantity + damaged_quantity)`,
      [before.id]
    );
    if (Number(activeRows[0]?.total || 0) > 0) {
      throw httpError(409, 'ยังลบไม่ได้ เนื่องจากมีทรัพย์สินรายการนี้กำลังถูกเบิกใช้งาน กรุณารับคืนให้ครบก่อน');
    }

    await connection.query('DELETE FROM facility_assets WHERE id = ?', [before.id]);
    await connection.commit();
    await writeAudit(req, 'FACILITY_ASSET', 'DELETE', before.item_code, before, null, user);
    res.status(204).end();
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.post('/api/facility-assets/:id/receive', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    assertDataAdmin(user);
    await connection.beginTransaction();
    const asset = await facilityAssetRow(connection, req.params.id, true);
    if (!asset) throw httpError(404, 'ไม่พบทรัพย์สินส่วนกลาง');
    assertCompanyAccess(user, asset.company_code);
    assertWorkflowDepartment(user, asset.responsible_department || 'GA', `รายการนี้อยู่ในความรับผิดชอบของ ${asset.responsible_department || 'GA'}`);
    const quantity = numberValue(req.body.quantity, 0);
    if (!(quantity > 0)) throw httpError(400, 'จำนวนรับเพิ่มต้องมากกว่า 0');
    const receiveNo = generateNo('FRC');
    await connection.query(
      `UPDATE facility_assets
       SET total_quantity = total_quantity + ?, available_quantity = available_quantity + ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [quantity, quantity, asset.id]
    );
    await addFacilityMovement(connection, asset, 'RECEIVE', quantity, {
      referenceNo: receiveNo,
      toLocation: asset.storage_location,
      employeeCode: user.id,
      employeeName: user.name,
      note: text(req.body.note) || `รับเข้า ${dateOnly(req.body.receiveDate || req.body.receive_date, bangkokDateOnly())}`
    });
    await connection.commit();
    await writeAudit(req, 'FACILITY_ASSET', 'RECEIVE', receiveNo, asset, { quantity }, user);
    res.status(201).json({ receiveNo, quantity });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
});

app.get('/api/facility-issues', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const params = [];
    let where = '';
    if (!isSuperAdmin(user)) {
      where = 'WHERE i.company_code = ?';
      params.push(normalizeCompany(user.company));
    }
    const [rows] = await pool.query(
      `SELECT i.*, f.item_code, f.name AS asset_name, f.unit
       FROM facility_issues i
       INNER JOIN facility_assets f ON f.id = i.facility_asset_id
       ${where}
       ORDER BY i.created_at DESC, i.id DESC`,
      params
    );
    res.json(rows.map((row) => ({
      ...row,
      quantity: Number(row.quantity || 0),
      returned_quantity: Number(row.returned_quantity || 0),
      damaged_quantity: Number(row.damaged_quantity || 0)
    })));
  } catch (error) { next(error); }
});

app.post('/api/facility-assets/:id/issues', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    assertDataAdmin(user);
    await connection.beginTransaction();
    const asset = await facilityAssetRow(connection, req.params.id, true);
    if (!asset) throw httpError(404, 'ไม่พบทรัพย์สินส่วนกลาง');
    assertCompanyAccess(user, asset.company_code);
    assertWorkflowDepartment(user, asset.responsible_department || 'GA', `รายการนี้อยู่ในความรับผิดชอบของ ${asset.responsible_department || 'GA'}`);
    const quantity = numberValue(req.body.quantity, 0);
    if (!(quantity > 0)) throw httpError(400, 'จำนวนเบิกต้องมากกว่า 0');
    if (quantity > Number(asset.available_quantity || 0)) throw httpError(409, `จำนวนพร้อมเบิกไม่พอ ปัจจุบันเหลือ ${Number(asset.available_quantity || 0)} ${asset.unit}`);
    const destinationLocation = text(req.body.destinationLocation || req.body.destination_location);
    const purpose = text(req.body.purpose);
    if (!destinationLocation || !purpose) throw httpError(400, 'กรุณาระบุพื้นที่ใช้งานและวัตถุประสงค์');
    const receiver = await facilityEmployee(asset.company_code, req.body.receiverEmployeeCode || req.body.receiver_employee_code);
    const issueNo = generateNo('FIS');
    const issueDate = dateOnly(req.body.issueDate || req.body.issue_date, bangkokDateOnly());
    const dueDate = dateOnly(req.body.dueDate || req.body.due_date);
    const [result] = await connection.query(
      `INSERT INTO facility_issues (
        issue_no, facility_asset_id, company_code, quantity, returned_quantity,
        damaged_quantity, receiver_employee_code, receiver_name, department,
        destination_location, purpose, issue_date, due_date, status,
        issued_by, issued_by_name, note, updated_at
      ) VALUES (?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, ?, NULLIF(?, ''), 'ISSUED', ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        issueNo, asset.id, asset.company_code, quantity,
        receiver?.id || '', receiver?.name || '', receiver?.department || text(req.body.department),
        destinationLocation, purpose, issueDate, dueDate,
        user.id, user.name, text(req.body.note)
      ]
    );
    const isConsumable = asset.asset_type === 'NON_ASSET';
    if (isConsumable) {
      await connection.query(
        `UPDATE facility_issues
         SET returned_quantity = quantity, status = 'CONSUMED', updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [result.insertId]
      );
      await connection.query(
        `UPDATE facility_assets
         SET total_quantity = total_quantity - ?, available_quantity = available_quantity - ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [quantity, quantity, asset.id]
      );
    } else {
      await connection.query(
        'UPDATE facility_assets SET available_quantity = available_quantity - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [quantity, asset.id]
      );
    }
    await addFacilityMovement(connection, asset, isConsumable ? 'ISSUE_CONSUMABLE' : 'ISSUE', quantity, {
      referenceNo: issueNo,
      fromLocation: asset.storage_location,
      toLocation: destinationLocation,
      employeeCode: receiver?.id || '',
      employeeName: receiver?.name || '',
      note: purpose
    });
    const [issueRows] = await connection.query('SELECT * FROM facility_issues WHERE id = ? LIMIT 1', [result.insertId]);
    await connection.commit();
    await writeAudit(req, 'FACILITY_ASSET', 'ISSUE', issueNo, asset, issueRows[0], user);
    res.status(201).json(issueRows[0]);
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
});

app.post('/api/facility-issues/:id/returns', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    assertDataAdmin(user);
    await connection.beginTransaction();
    const [issueRows] = await connection.query('SELECT * FROM facility_issues WHERE id = ? FOR UPDATE', [req.params.id]);
    const issue = issueRows[0];
    if (!issue) throw httpError(404, 'ไม่พบรายการเบิก');
    if (issue.status === 'CONSUMED') throw httpError(409, 'Non-Asset เป็นวัสดุจ่ายออกและไม่ต้องรับคืน');
    assertCompanyAccess(user, issue.company_code);
    const asset = await facilityAssetRow(connection, issue.facility_asset_id, true);
    if (!asset) throw httpError(404, 'ไม่พบทรัพย์สินส่วนกลาง');
    assertWorkflowDepartment(user, asset.responsible_department || 'GA', `รายการนี้อยู่ในความรับผิดชอบของ ${asset.responsible_department || 'GA'}`);
    const outstanding = Number(issue.quantity || 0) - Number(issue.returned_quantity || 0) - Number(issue.damaged_quantity || 0);
    const goodQuantity = numberValue(req.body.goodQuantity ?? req.body.good_quantity, 0);
    const damagedQuantity = numberValue(req.body.damagedQuantity ?? req.body.damaged_quantity, 0);
    const returnedNow = goodQuantity + damagedQuantity;
    if (!(returnedNow > 0)) throw httpError(400, 'กรุณาระบุจำนวนที่คืนอย่างน้อย 1 รายการ');
    if (goodQuantity < 0 || damagedQuantity < 0 || returnedNow > outstanding + 0.0001) throw httpError(400, 'จำนวนคืนเกินจำนวนที่ยังค้างใช้งาน');
    const returnNo = generateNo('FRT');
    const returnDate = dateOnly(req.body.returnDate || req.body.return_date, bangkokDateOnly());
    const returnLocation = text(req.body.returnLocation || req.body.return_location, asset.storage_location);
    const newReturned = Number(issue.returned_quantity || 0) + goodQuantity;
    const newDamaged = Number(issue.damaged_quantity || 0) + damagedQuantity;
    const remaining = Number(issue.quantity || 0) - newReturned - newDamaged;
    const status = remaining <= 0.0001 ? 'RETURNED' : 'PARTIAL_RETURN';

    await connection.query(
      `INSERT INTO facility_returns (
        issue_id, company_code, good_quantity, damaged_quantity, return_date,
        return_location, received_by, received_by_name, note
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [issue.id, issue.company_code, goodQuantity, damagedQuantity, returnDate, returnLocation, user.id, user.name, text(req.body.note)]
    );
    await connection.query(
      `UPDATE facility_issues
       SET returned_quantity = ?, damaged_quantity = ?, status = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [newReturned, newDamaged, status, issue.id]
    );
    await connection.query(
      `UPDATE facility_assets
       SET available_quantity = available_quantity + ?, damaged_quantity = damaged_quantity + ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [goodQuantity, damagedQuantity, asset.id]
    );
    if (goodQuantity > 0) {
      await addFacilityMovement(connection, asset, 'RETURN_GOOD', goodQuantity, {
        referenceNo: returnNo,
        fromLocation: issue.destination_location,
        toLocation: returnLocation,
        employeeCode: issue.receiver_employee_code,
        employeeName: issue.receiver_name,
        note: text(req.body.note)
      });
    }
    if (damagedQuantity > 0) {
      await addFacilityMovement(connection, asset, 'RETURN_DAMAGED', damagedQuantity, {
        referenceNo: returnNo,
        fromLocation: issue.destination_location,
        toLocation: returnLocation,
        employeeCode: issue.receiver_employee_code,
        employeeName: issue.receiver_name,
        note: text(req.body.note) || 'รับคืนในสถานะชำรุด'
      });
    }
    await connection.commit();
    await writeAudit(req, 'FACILITY_ASSET', 'RETURN', returnNo, issue, { goodQuantity, damagedQuantity, status }, user);
    res.status(201).json({ returnNo, goodQuantity, damagedQuantity, status });
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally { connection.release(); }
});

app.get('/api/facility-movements', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const params = [];
    let where = '';
    if (!isSuperAdmin(user)) {
      where = 'WHERE m.company_code = ?';
      params.push(normalizeCompany(user.company));
    }
    const [rows] = await pool.query(
      `SELECT m.*, f.item_code, f.name AS asset_name, f.unit
       FROM facility_asset_movements m
       INNER JOIN facility_assets f ON f.id = m.facility_asset_id
       ${where}
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT 1000`,
      params
    );
    res.json(rows.map((row) => ({ ...row, quantity: Number(row.quantity || 0) })));
  } catch (error) { next(error); }
});

function normalizeInventoryYear(value) {
  const currentYear = Number(bangkokDateOnly().slice(0, 4));
  const year = Math.trunc(numberValue(value, currentYear));
  if (year < 2000 || year > currentYear + 1) throw httpError(400, 'ปีตรวจนับไม่ถูกต้อง');
  return year;
}

function annualInventoryResult(expectedQuantity, countedQuantity, conditionStatus, expectedLocation, actualLocation) {
  if (conditionStatus === 'NOT_FOUND') return 'NOT_FOUND';
  const quantityMatches = Math.abs(Number(expectedQuantity || 0) - Number(countedQuantity || 0)) <= 0.0001;
  const locationMatches = !text(expectedLocation) || !text(actualLocation)
    ? true
    : text(expectedLocation).toUpperCase() === text(actualLocation).toUpperCase();
  return quantityMatches && locationMatches && conditionStatus === 'GOOD' ? 'MATCH' : 'DIFFERENCE';
}

async function annualInventoryRows(user, year) {
  const params = [];
  const facilityParams = [];
  const countParams = [year];
  let assetWhere = "WHERE status NOT IN ('DISPOSED', 'SOLD')";
  let facilityWhere = '';
  let countWhere = 'WHERE count_year = ?';
  if (!isSuperAdmin(user)) {
    const company = normalizeCompany(user.company);
    assetWhere += ' AND company = ?';
    facilityWhere = 'WHERE company_code = ?';
    countWhere += ' AND company_code = ?';
    params.push(company);
    facilityParams.push(company);
    countParams.push(company);
  }

  const [[assetRows], [facilityRows], [countRows]] = await Promise.all([
    pool.query(
      `SELECT id, company, name, category, location, status,
              COALESCE(NULLIF(responsible_department, ''), 'IT') AS responsible_department
       FROM assets ${assetWhere}
       ORDER BY name ASC, id ASC`,
      params
    ),
    pool.query(
      `SELECT id, item_code, company_code, name, category, unit, total_quantity,
              storage_location, asset_type,
              COALESCE(NULLIF(responsible_department, ''), 'GA') AS responsible_department
       FROM facility_assets ${facilityWhere}
       ORDER BY name ASC, item_code ASC`,
      facilityParams
    ),
    pool.query(
      `SELECT * FROM annual_inventory_counts ${countWhere}
       ORDER BY count_date DESC, id DESC`,
      countParams
    )
  ]);
  const countByKey = new Map(countRows.map((row) => [row.inventory_key, row]));

  const individual = assetRows.map((row) => {
    const inventoryKey = `ASSET:${row.id}`;
    const count = countByKey.get(inventoryKey);
    return {
      id: count?.id || inventoryKey,
      count_id: count?.id || null,
      count_no: count?.count_no || '',
      inventory_key: inventoryKey,
      inventory_type: 'ASSET',
      record_id: row.id,
      item_code: row.id,
      item_name: row.name,
      category: row.category || '',
      unit: 'ชิ้น',
      asset_type: 'ASSET',
      responsible_department: row.responsible_department || 'IT',
      company_code: normalizeCompany(row.company),
      expected_quantity: 1,
      counted_quantity: count ? Number(count.counted_quantity || 0) : null,
      difference: count ? Number(count.counted_quantity || 0) - 1 : null,
      expected_location: row.location || '',
      actual_location: count?.actual_location || '',
      condition_status: count?.condition_status || '',
      result_status: count?.result_status || 'NOT_COUNTED',
      count_date: count?.count_date || '',
      counted_by_name: count?.counted_by_name || '',
      note: count?.note || ''
    };
  });

  const grouped = facilityRows.map((row) => {
    const inventoryKey = `FACILITY:${row.id}`;
    const count = countByKey.get(inventoryKey);
    const expected = Number(row.total_quantity || 0);
    const counted = count ? Number(count.counted_quantity || 0) : null;
    return {
      id: count?.id || inventoryKey,
      count_id: count?.id || null,
      count_no: count?.count_no || '',
      inventory_key: inventoryKey,
      inventory_type: 'FACILITY',
      record_id: Number(row.id),
      item_code: row.item_code,
      item_name: row.name,
      category: row.category || '',
      unit: row.unit || 'ชิ้น',
      asset_type: row.asset_type || 'ASSET',
      responsible_department: row.responsible_department || 'GA',
      company_code: normalizeCompany(row.company_code),
      expected_quantity: expected,
      counted_quantity: counted,
      difference: counted == null ? null : counted - expected,
      expected_location: row.storage_location || '',
      actual_location: count?.actual_location || '',
      condition_status: count?.condition_status || '',
      result_status: count?.result_status || 'NOT_COUNTED',
      count_date: count?.count_date || '',
      counted_by_name: count?.counted_by_name || '',
      note: count?.note || ''
    };
  });

  return [...individual, ...grouped].sort((left, right) =>
    left.responsible_department.localeCompare(right.responsible_department, 'th')
      || left.item_name.localeCompare(right.item_name, 'th')
      || String(left.item_code).localeCompare(String(right.item_code), 'th')
  );
}

app.get('/api/annual-inventory', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const year = normalizeInventoryYear(req.query.year);
    res.json(await annualInventoryRows(user, year));
  } catch (error) {
    next(error);
  }
});

app.post('/api/annual-inventory', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    assertAnyRole(user, ['ADMIN', 'SUPERVISOR', 'HR'], 'เฉพาะผู้ดูแลระบบหรือผู้รับผิดชอบหน่วยงานเท่านั้นที่บันทึกการตรวจนับได้');
    const inventoryType = text(req.body.inventoryType || req.body.inventory_type).toUpperCase();
    const recordId = text(req.body.recordId || req.body.record_id);
    const countYear = normalizeInventoryYear(req.body.countYear || req.body.count_year);
    if (!['ASSET', 'FACILITY'].includes(inventoryType) || !recordId) throw httpError(400, 'กรุณาเลือกรายการที่ต้องการตรวจนับ');

    let source;
    if (inventoryType === 'ASSET') {
      const [rows] = await connection.query(
        `SELECT id, company AS company_code, name, category, location,
                COALESCE(NULLIF(responsible_department, ''), 'IT') AS responsible_department
         FROM assets WHERE id = ? LIMIT 1`,
        [recordId]
      );
      if (!rows[0]) throw httpError(404, 'ไม่พบทรัพย์สินที่ต้องการตรวจนับ');
      source = {
        ...rows[0],
        inventory_key: `ASSET:${rows[0].id}`,
        item_code: rows[0].id,
        item_name: rows[0].name,
        asset_type: 'ASSET',
        unit: 'ชิ้น',
        expected_quantity: 1,
        expected_location: rows[0].location || '',
        facility_asset_id: null,
        asset_id: rows[0].id
      };
    } else {
      const [rows] = await connection.query(
        `SELECT id, item_code, company_code, name, category, unit, total_quantity,
                storage_location, asset_type,
                COALESCE(NULLIF(responsible_department, ''), 'GA') AS responsible_department
         FROM facility_assets WHERE id = ? LIMIT 1`,
        [recordId]
      );
      if (!rows[0]) throw httpError(404, 'ไม่พบทรัพย์สินส่วนกลางที่ต้องการตรวจนับ');
      source = {
        ...rows[0],
        inventory_key: `FACILITY:${rows[0].id}`,
        item_name: rows[0].name,
        expected_quantity: Number(rows[0].total_quantity || 0),
        expected_location: rows[0].storage_location || '',
        facility_asset_id: Number(rows[0].id),
        asset_id: ''
      };
    }

    assertCompanyAccess(user, source.company_code);
    assertWorkflowDepartment(
      user,
      source.responsible_department,
      `รายการนี้กำหนดให้หน่วยงาน ${source.responsible_department} เป็นผู้ตรวจนับ`
    );
    let countedQuantity = numberValue(req.body.countedQuantity ?? req.body.counted_quantity, source.expected_quantity);
    if (countedQuantity < 0) throw httpError(400, 'จำนวนที่ตรวจพบต้องไม่ติดลบ');
    const conditionStatus = text(req.body.conditionStatus || req.body.condition_status, 'GOOD').toUpperCase();
    if (!['GOOD', 'DAMAGED', 'NOT_FOUND'].includes(conditionStatus)) throw httpError(400, 'สภาพที่ตรวจพบไม่ถูกต้อง');
    if (conditionStatus === 'NOT_FOUND') countedQuantity = 0;
    if (inventoryType === 'ASSET' && ![0, 1].includes(countedQuantity)) throw httpError(400, 'ทรัพย์สินรายชิ้นระบุจำนวนที่พบได้เฉพาะ 0 หรือ 1');
    const actualLocation = text(req.body.actualLocation || req.body.actual_location, conditionStatus === 'NOT_FOUND' ? '' : source.expected_location);
    if (conditionStatus !== 'NOT_FOUND' && !actualLocation) throw httpError(400, 'กรุณาระบุสถานที่ที่ตรวจพบ');
    const countDate = dateOnly(req.body.countDate || req.body.count_date, bangkokDateOnly());
    if (!countDate.startsWith(String(countYear))) throw httpError(400, 'วันที่ตรวจนับต้องอยู่ในปีที่เลือก');
    const resultStatus = annualInventoryResult(
      source.expected_quantity,
      countedQuantity,
      conditionStatus,
      source.expected_location,
      actualLocation
    );

    await connection.beginTransaction();
    const [beforeRows] = await connection.query(
      `SELECT * FROM annual_inventory_counts
       WHERE company_code = ? AND inventory_key = ? AND count_year = ?
       LIMIT 1 FOR UPDATE`,
      [normalizeCompany(source.company_code), source.inventory_key, countYear]
    );
    const before = beforeRows[0] || null;
    const countNo = before?.count_no || generateNo('CNT');
    if (before) {
      await connection.query(
        `UPDATE annual_inventory_counts SET
           item_code = ?, item_name = ?, asset_type = ?, responsible_department = ?,
           expected_quantity = ?, counted_quantity = ?, expected_location = ?, actual_location = ?,
           condition_status = ?, result_status = ?, count_date = ?, counted_by = ?, counted_by_name = ?,
           note = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          source.item_code, source.item_name, source.asset_type || 'ASSET', source.responsible_department,
          source.expected_quantity, countedQuantity, source.expected_location, actualLocation,
          conditionStatus, resultStatus, countDate, user.id, user.name, text(req.body.note), before.id
        ]
      );
    } else {
      await connection.query(
        `INSERT INTO annual_inventory_counts (
           count_no, company_code, inventory_key, inventory_type, asset_id, facility_asset_id,
           count_year, item_code, item_name, asset_type, responsible_department,
           expected_quantity, counted_quantity, expected_location, actual_location,
           condition_status, result_status, count_date, counted_by, counted_by_name, note, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          countNo, normalizeCompany(source.company_code), source.inventory_key, inventoryType,
          source.asset_id || '', source.facility_asset_id, countYear, source.item_code, source.item_name,
          source.asset_type || 'ASSET', source.responsible_department, source.expected_quantity,
          countedQuantity, source.expected_location, actualLocation, conditionStatus, resultStatus,
          countDate, user.id, user.name, text(req.body.note)
        ]
      );
    }
    const [afterRows] = await connection.query(
      'SELECT * FROM annual_inventory_counts WHERE company_code = ? AND inventory_key = ? AND count_year = ? LIMIT 1',
      [normalizeCompany(source.company_code), source.inventory_key, countYear]
    );
    await connection.commit();
    await writeAudit(req, 'ANNUAL_INVENTORY', before ? 'UPDATE' : 'COUNT', countNo, before, afterRows[0], user);
    res.status(before ? 200 : 201).json(afterRows[0]);
  } catch (error) {
    try { await connection.rollback(); } catch { /* no active transaction */ }
    next(error);
  } finally {
    connection.release();
  }
});

app.get('/api/stock', async (req, res, next) => {
  try {
    res.json(await getStock(await getRequestUser(req)));
  } catch (error) {
    next(error);
  }
});

app.post('/api/stock', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    const missing = requireFields(req.body, ['sku', 'name', 'unit', 'warehouse']);
    if (missing.length) return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });

    const item = {
      sku: text(req.body.sku),
      name: text(req.body.name),
      company: scopedCompany(user, req.body.company),
      category: text(req.body.category),
      unit: text(req.body.unit, 'pcs'),
      warehouse: text(req.body.warehouse),
      available: Math.max(0, numberValue(req.body.available)),
      min: Math.max(0, numberValue(req.body.min)),
      max: Math.max(0, numberValue(req.body.max)),
      location: text(req.body.location),
      status: text(req.body.status, 'ACTIVE'),
      unitCost: Math.max(0, numberValue(req.body.unitCost))
    };

    await connection.beginTransaction();
    const [existingRows] = await connection.query('SELECT * FROM stock_items WHERE sku = ? FOR UPDATE', [item.sku]);
    if (existingRows[0]) {
      assertCompanyAccess(user, existingRows[0].company);
      if (normalizeCompany(existingRows[0].company) !== normalizeCompany(item.company)) {
        throw httpError(409, `SKU ${item.sku} ถูกใช้โดยบริษัท ${existingRows[0].company} แล้ว`);
      }
      await connection.query(
        `UPDATE stock_items SET name = ?, category = ?, unit = ?, status = ?, unit_cost = ?, updated_at = CURRENT_TIMESTAMP WHERE sku = ?`,
        [item.name, item.category, item.unit, item.status, item.unitCost, item.sku]
      );
    } else {
      await connection.query(
        `INSERT INTO stock_items (
          sku, company, name, category, unit, warehouse, available, min_level,
          max_level, location, status, unit_cost, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [item.sku, item.company, item.name, item.category, item.unit, item.warehouse, item.available, item.min, item.max, item.location, item.status, item.unitCost]
      );
    }

    const [balanceRows] = await connection.query(
      'SELECT id FROM stock_balances WHERE sku = ? AND warehouse = ? FOR UPDATE',
      [item.sku, item.warehouse]
    );
    if (balanceRows[0]) throw httpError(409, `SKU ${item.sku} มีอยู่ในคลัง ${item.warehouse} แล้ว`);
    await connection.query(
      `INSERT INTO stock_balances (sku, company_code, warehouse, location, available, min_level, max_level, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [item.sku, item.company, item.warehouse, item.location, item.available, item.min, item.max]
    );
    if (item.available > 0) {
      await connection.query(
        `INSERT INTO stock_movements (
          doc_no, company_code, movement_type, sku, quantity, from_warehouse,
          to_warehouse, requester, reference, note, status, movement_date
        ) VALUES (?, ?, 'OPENING', ?, ?, '', ?, ?, 'OPENING_BALANCE', ?, 'POSTED', ?)`,
        [
          generateNo('OPEN'),
          item.company,
          item.sku,
          item.available,
          item.warehouse,
          user.name,
          'ยอดตั้งต้นจากการสร้าง SKU/คลัง',
          bangkokDateOnly()
        ]
      );
    }
    await syncLegacyStockItem(connection, item.sku);
    await connection.commit();

    const created = (await getStock(user)).find((row) => row.sku === item.sku && row.warehouse === item.warehouse);
    await writeAudit(req, 'STOCK', 'CREATE_BALANCE', `${item.sku}@${item.warehouse}`, null, created, user);
    res.status(201).json(created);
  } catch (error) {
    await connection.rollback();
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'SKU หรือคลังนี้มีอยู่แล้ว' });
    next(error);
  } finally {
    connection.release();
  }
});

app.put('/api/stock/:sku', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    const originalWarehouse = text(req.body.originalWarehouse || req.body.original_warehouse || req.body.warehouse);
    if (!originalWarehouse) return res.status(400).json({ error: 'กรุณาระบุคลังเดิม' });

    await connection.beginTransaction();
    const [itemRows] = await connection.query('SELECT * FROM stock_items WHERE sku = ? FOR UPDATE', [req.params.sku]);
    if (!itemRows[0]) throw httpError(404, 'Stock item not found');
    assertCompanyAccess(user, itemRows[0].company);
    const [balanceRows] = await connection.query(
      'SELECT * FROM stock_balances WHERE sku = ? AND warehouse = ? FOR UPDATE',
      [req.params.sku, originalWarehouse]
    );
    if (!balanceRows[0]) throw httpError(404, 'ไม่พบยอด Stock ของคลังเดิม');

    const requestedWarehouse = text(req.body.warehouse, originalWarehouse);
    if (requestedWarehouse !== originalWarehouse) {
      throw httpError(409, 'ไม่สามารถเปลี่ยน Warehouse ของยอดเดิมจากหน้าแก้ไขได้ กรุณาใช้ Stock Transfer');
    }
    if (req.body.available !== undefined && Number(req.body.available) !== Number(balanceRows[0].available)) {
      throw httpError(409, 'ไม่สามารถแก้ยอดคงเหลือโดยตรงได้ กรุณาใช้ Stock Movement');
    }
    const nextWarehouse = originalWarehouse;

    const before = toStock({ ...itemRows[0], ...balanceRows[0], balance_id: balanceRows[0].id });
    await connection.query(
      `UPDATE stock_items SET name = ?, category = ?, unit = ?, status = ?, unit_cost = ?, updated_at = CURRENT_TIMESTAMP WHERE sku = ?`,
      [
        text(req.body.name, itemRows[0].name),
        text(req.body.category, itemRows[0].category),
        text(req.body.unit, itemRows[0].unit),
        text(req.body.status, itemRows[0].status),
        Math.max(0, numberValue(req.body.unitCost, Number(itemRows[0].unit_cost))),
        req.params.sku
      ]
    );
    await connection.query(
      `UPDATE stock_balances SET location = ?, min_level = ?, max_level = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [
        text(req.body.location, balanceRows[0].location),
        Math.max(0, numberValue(req.body.min, Number(balanceRows[0].min_level))),
        Math.max(0, numberValue(req.body.max, Number(balanceRows[0].max_level))),
        balanceRows[0].id
      ]
    );
    await syncLegacyStockItem(connection, req.params.sku);
    await connection.commit();

    const updated = (await getStock(user)).find((row) => row.sku === req.params.sku && row.warehouse === nextWarehouse);
    await writeAudit(req, 'STOCK', 'UPDATE_BALANCE', `${req.params.sku}@${nextWarehouse}`, before, updated, user);
    res.json(updated);
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.delete('/api/stock/:sku', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    const warehouse = text(req.query.warehouse);
    const cascade = ['1', 'true', 'yes'].includes(text(req.query.cascade).toLowerCase());
    await connection.beginTransaction();
    const [itemRows] = await connection.query('SELECT * FROM stock_items WHERE sku = ? FOR UPDATE', [req.params.sku]);
    if (!itemRows[0]) throw httpError(404, 'Stock item not found');
    assertCompanyAccess(user, itemRows[0].company);

    if (cascade) {
      assertDataAdmin(user);
      const [balances] = await connection.query('SELECT * FROM stock_balances WHERE sku = ? FOR UPDATE', [req.params.sku]);
      const [movements] = await connection.query('SELECT * FROM stock_movements WHERE sku = ? FOR UPDATE', [req.params.sku]);
      const [maintenanceParts] = await connection.query('SELECT * FROM maintenance_parts WHERE sku = ? FOR UPDATE', [req.params.sku]);

      // maintenance_parts อ้างอิง stock_items โดยตรง จึงต้องลบก่อน Stock Movement/Balance/Item
      // การดำเนินการทั้งหมดอยู่ใน Transaction เดียว ถ้าจุดใดล้มเหลวจะ Rollback ทั้งชุด
      await connection.query('DELETE FROM maintenance_parts WHERE sku = ?', [req.params.sku]);
      await connection.query('DELETE FROM stock_movements WHERE sku = ?', [req.params.sku]);
      await connection.query('DELETE FROM stock_balances WHERE sku = ?', [req.params.sku]);
      await connection.query('DELETE FROM stock_items WHERE sku = ?', [req.params.sku]);
      await connection.commit();
      await writeAudit(
        req,
        'STOCK',
        'CASCADE_DELETE_SKU',
        req.params.sku,
        {
          item: itemRows[0],
          balances,
          movementCount: movements.length,
          maintenancePartCount: maintenanceParts.length
        },
        null,
        user
      );
      return res.status(204).end();
    }

    if (!warehouse) throw httpError(400, 'กรุณาระบุ warehouse ที่ต้องการลบ');
    const [balanceRows] = await connection.query('SELECT * FROM stock_balances WHERE sku = ? AND warehouse = ? FOR UPDATE', [req.params.sku, warehouse]);
    if (!balanceRows[0]) throw httpError(404, 'ไม่พบยอด Stock ในคลังนี้');
    if (Number(balanceRows[0].available || 0) !== 0) throw httpError(409, 'ต้องปรับยอดคงเหลือเป็น 0 ก่อนลบคลัง');

    const [refs] = await connection.query(
      `SELECT COUNT(*) AS total FROM stock_movements
       WHERE sku = ? AND (from_warehouse = ? OR to_warehouse = ?)`,
      [req.params.sku, warehouse, warehouse]
    );
    if (Number(refs[0]?.total || 0) > 0) throw httpError(409, 'คลังนี้มีประวัติการเคลื่อนไหว กรุณาเปลี่ยนสถานะ SKU เป็น INACTIVE หรือให้ Admin ลบ SKU ทั้งชุด');

    await connection.query('DELETE FROM stock_balances WHERE id = ?', [balanceRows[0].id]);
    const [remaining] = await connection.query('SELECT COUNT(*) AS total FROM stock_balances WHERE sku = ?', [req.params.sku]);
    if (Number(remaining[0]?.total || 0) === 0) await connection.query('DELETE FROM stock_items WHERE sku = ?', [req.params.sku]);
    else await syncLegacyStockItem(connection, req.params.sku);
    await connection.commit();
    await writeAudit(req, 'STOCK', 'DELETE_BALANCE', `${req.params.sku}@${warehouse}`, balanceRows[0], null, user);
    res.status(204).end();
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.get('/api/stock-movements', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const [rows] = isSuperAdmin(user)
      ? await pool.query('SELECT * FROM stock_movements ORDER BY created_at DESC, id DESC LIMIT 1000')
      : await pool.query('SELECT * FROM stock_movements WHERE company_code = ? ORDER BY created_at DESC, id DESC LIMIT 1000', [normalizeCompany(user.company)]);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post('/api/stock-movements', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    await connection.beginTransaction();
    const result = await applyStockMovement(connection, user, req.body);
    await connection.commit();
    await writeAudit(req, 'STOCK_MOVEMENT', result.movement.movement_type, result.movement.doc_no, result.before, { balances: result.after, movement: result.movement }, user);
    res.status(201).json(result.movement);
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.get('/api/transfers', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    let rows;
    if (isSuperAdmin(user)) {
      [rows] = await pool.query('SELECT * FROM transfers ORDER BY created_at DESC, id DESC');
    } else if (['SUPERVISOR', 'HR'].includes(user.role)) {
      [rows] = await pool.query('SELECT * FROM transfers WHERE company_code = ? ORDER BY created_at DESC, id DESC', [normalizeCompany(user.company)]);
    } else {
      rows = [];
    }
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post('/api/transfers', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    assertWorkflowDepartment(user, 'HR', 'การโอนย้ายทรัพย์สินต้องดำเนินการโดย HR');
    if (!hasPermission(user, 'workflow.request')) throw httpError(403, 'ไม่มีสิทธิ์สร้างคำขอโอนย้าย');
    const assetId = text(req.body.assetId || req.body.asset_id);
    const toLocation = text(req.body.toLocation || req.body.to_location);
    if (!assetId || !toLocation) {
      return res.status(400).json({ error: 'กรุณาระบุทรัพย์สินและปลายทาง' });
    }

    const asset = await getAssetById(assetId, user);
    if (!asset) return res.status(404).json({ error: 'ไม่พบทรัพย์สิน' });
    if (!['ACTIVE','IN_STOCK'].includes(asset.status)) {
      return res.status(409).json({ error: `สถานะ ${asset.status} ไม่สามารถโอนย้ายได้` });
    }
    const [pendingTransfers] = await pool.query(
      "SELECT COUNT(*) AS total FROM transfers WHERE asset_id = ? AND status = 'PENDING'",
      [asset.id]
    );
    if (Number(pendingTransfers[0]?.total || 0) > 0) {
      return res.status(409).json({ error: 'ทรัพย์สินนี้มีคำขอโอนย้ายที่รออนุมัติอยู่แล้ว' });
    }
    const requestNo = text(req.body.requestNo || req.body.request_no, generateNo('TRF'));
    const destinationCustodian = await resolveTransferCustodian(pool, req.body, asset.company);

    const connection = await pool.getConnection();
    let insertId;
    try {
      await connection.beginTransaction();
      const [lockedAssets] = await connection.query(
        'SELECT status, custodian_type FROM assets WHERE id = ? AND company = ? FOR UPDATE',
        [asset.id, asset.company]
      );
      if (!lockedAssets[0] || !['ACTIVE', 'IN_STOCK'].includes(normalizeAssetStatus(lockedAssets[0].status))) {
        throw httpError(409, 'สถานะทรัพย์สินเปลี่ยนไปแล้ว ไม่สามารถสร้างคำขอโอนได้');
      }
      const [duplicateRows] = await connection.query(
        "SELECT id FROM transfers WHERE asset_id = ? AND status = 'PENDING' LIMIT 1 FOR UPDATE",
        [asset.id]
      );
      if (duplicateRows[0]) throw httpError(409, 'ทรัพย์สินนี้มีคำขอโอนย้ายที่รออนุมัติอยู่แล้ว');
      const [result] = await connection.query(
        `INSERT INTO transfers (
          request_no,
          company_code,
          asset_id,
          from_location,
          to_location,
          from_department,
          to_department,
          from_assignee,
          to_assignee,
          requested_by,
          status,
          transfer_date,
          note,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, CURRENT_TIMESTAMP)`,
        [
          requestNo,
          asset.company,
          asset.id,
          asset.location,
          toLocation,
          asset.department,
          destinationCustodian.department,
          asset.assignedTo,
          destinationCustodian.assignee,
          user.name,
          dateOnly(req.body.transferDate || req.body.transfer_date, bangkokDateOnly()),
          text(req.body.note)
        ]
      );
      insertId = result.insertId;
      await createApproval(connection, user, 'TRANSFER', insertId, requestNo, asset.company);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const [rows] = await pool.query('SELECT * FROM transfers WHERE id = ?', [insertId]);
    await writeAudit(req, 'TRANSFER', 'REQUEST', requestNo, null, rows[0], user);
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

async function decorateBorrowRecords(rows) {
  const records = Array.isArray(rows) ? rows : [];
  const ids = records.map((row) => Number(row.id)).filter((id) => Number.isInteger(id) && id > 0);
  if (!ids.length) return records;
  const marks = ids.map(() => '?').join(',');
  const [photoRows] = await pool.query(
    `SELECT borrow_record_id, file_name, mime_type, created_at
     FROM borrow_return_photos
     WHERE borrow_record_id IN (${marks})`,
    ids
  );
  const photoByRecord = new Map(photoRows.map((row) => [Number(row.borrow_record_id), row]));
  return records.map((row) => {
    const photo = photoByRecord.get(Number(row.id));
    return {
      ...row,
      has_return_image: Boolean(photo),
      return_image_name: photo?.file_name || '',
      return_image_mime: photo?.mime_type || '',
      return_image_at: photo?.created_at || '',
      return_image_url: photo
        ? `/api/borrow-records/${encodeURIComponent(row.id)}/return-image${photo.created_at ? `?v=${new Date(photo.created_at).getTime()}` : ''}`
        : ''
    };
  });
}

async function assertBorrowRecordViewAccess(user, record) {
  if (!record) throw httpError(404, 'ไม่พบรายการยืม');
  if (isSuperAdmin(user)) return;
  assertCompanyAccess(user, record.company_code);
  if (['SUPERVISOR', 'HR'].includes(user.role)) return;
  throw httpError(403, 'ไม่มีสิทธิ์ดูหลักฐานการคืนของรายการนี้');
}

app.get('/api/borrow-records', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    let rows;
    if (isSuperAdmin(user)) {
      [rows] = await pool.query('SELECT * FROM borrow_records ORDER BY created_at DESC, id DESC');
    } else if (['SUPERVISOR', 'HR'].includes(user.role)) {
      [rows] = await pool.query('SELECT * FROM borrow_records WHERE company_code = ? ORDER BY created_at DESC, id DESC', [normalizeCompany(user.company)]);
    } else {
      rows = [];
    }
    res.json(await decorateBorrowRecords(rows));
  } catch (error) {
    next(error);
  }
});

app.get('/api/borrow-records/:id/return-image', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const [recordRows] = await pool.query('SELECT * FROM borrow_records WHERE id = ? LIMIT 1', [req.params.id]);
    const record = recordRows[0];
    await assertBorrowRecordViewAccess(user, record);
    const [rows] = await pool.query(
      'SELECT file_name, mime_type, file_data FROM borrow_return_photos WHERE borrow_record_id = ? LIMIT 1',
      [req.params.id]
    );
    const photo = rows[0];
    if (!photo?.file_data) return res.status(404).json({ error: 'ไม่พบรูปทรัพย์สินตอนคืน' });
    res.setHeader('Content-Type', photo.mime_type || 'image/jpeg');
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(photo.file_name || `return-${record.asset_id}.jpg`)}`);
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(photo.file_data);
  } catch (error) {
    next(error);
  }
});

app.post('/api/borrow-records', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    assertWorkflowDepartment(user, 'IT', 'การยืม–คืนอุปกรณ์ต้องดำเนินการโดย IT');
    if (!hasPermission(user, 'workflow.request')) throw httpError(403, 'ไม่มีสิทธิ์สร้างคำขอยืม');
    const assetId = text(req.body.assetId || req.body.asset_id);
    const asset = await getAssetById(assetId, user);
    if (!asset) return res.status(404).json({ error: 'ไม่พบทรัพย์สิน' });
    if ((asset.responsibleDepartment || 'IT') !== 'IT') {
      return res.status(409).json({ error: 'หน้าการยืม–คืนใช้ได้เฉพาะทรัพย์สินที่กำหนดหน่วยงานเจ้าของเป็น IT' });
    }
    const borrowable = (asset.status === 'IN_STOCK' && asset.custodianType === 'UNASSIGNED')
      || (asset.status === 'ACTIVE' && asset.custodianType === 'SHARED');
    if (!borrowable) {
      return res.status(409).json({ error: 'ยืมได้เฉพาะทรัพย์สินส่วนกลาง หรือทรัพย์สินในคลังที่ยังไม่มีผู้ถือครอง' });
    }
    const borrowDate = dateOnly(req.body.borrowDate || req.body.borrow_date, bangkokDateOnly());
    const dueDate = dateOnly(req.body.dueDate || req.body.due_date);
    if (!dueDate || dueDate < borrowDate) return res.status(400).json({ error: 'กำหนดคืนต้องไม่น้อยกว่าวันยืม' });
    const [activeBorrow] = await pool.query(
      "SELECT COUNT(*) AS total FROM borrow_records WHERE asset_id = ? AND status IN ('PENDING','APPROVED','RETURN_REQUESTED')",
      [asset.id]
    );
    if (Number(activeBorrow[0]?.total || 0) > 0) {
      return res.status(409).json({ error: 'ทรัพย์สินนี้มีรายการยืมหรือคำขอที่ยังไม่สิ้นสุด' });
    }

    const requestNo = text(req.body.requestNo || req.body.request_no, generateNo('BRW'));
    const borrower = text(req.body.borrower, user.name);
    if (!borrower) return res.status(400).json({ error: 'กรุณาระบุผู้ยืม' });
    const connection = await pool.getConnection();
    let insertId;

    try {
      await connection.beginTransaction();
      const [lockedAssets] = await connection.query(
        'SELECT status, custodian_type, responsible_department FROM assets WHERE id = ? AND company = ? FOR UPDATE',
        [asset.id, asset.company]
      );
      const locked = lockedAssets[0];
      const lockedBorrowable = locked && (locked.responsible_department || 'IT') === 'IT' && ((normalizeAssetStatus(locked.status) === 'IN_STOCK' && locked.custodian_type === 'UNASSIGNED')
        || (normalizeAssetStatus(locked.status) === 'ACTIVE' && locked.custodian_type === 'SHARED'));
      if (!lockedBorrowable) {
        throw httpError(409, 'สถานะหรือผู้ถือครองทรัพย์สินเปลี่ยนไปแล้ว ไม่สามารถสร้างคำขอยืมได้');
      }
      const [duplicateRows] = await connection.query(
        "SELECT id FROM borrow_records WHERE asset_id = ? AND status IN ('PENDING','APPROVED','RETURN_REQUESTED') LIMIT 1 FOR UPDATE",
        [asset.id]
      );
      if (duplicateRows[0]) throw httpError(409, 'ทรัพย์สินนี้มีรายการยืมหรือคำขอที่ยังไม่สิ้นสุด');
      const [result] = await connection.query(
        `INSERT INTO borrow_records (
          request_no,
          company_code,
          asset_id,
          borrower,
          borrow_date,
          due_date,
          condition_out,
          status,
          note,
          original_assignee,
          original_custodian_type,
          original_asset_status,
          original_department,
          original_location,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          requestNo,
          asset.company,
          asset.id,
          borrower,
          borrowDate,
          dueDate,
          numberValue(req.body.conditionOut || req.body.condition_out, asset.condition),
          text(req.body.note),
          asset.assignedTo,
          asset.custodianType || (asset.assignedTo ? 'EMPLOYEE' : 'UNASSIGNED'),
          asset.status,
          asset.department,
          asset.location
        ]
      );
      insertId = result.insertId;
      await createApproval(connection, user, 'BORROW', insertId, requestNo, asset.company);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const [rows] = await pool.query('SELECT * FROM borrow_records WHERE id = ?', [insertId]);
    await writeAudit(req, 'BORROW', 'REQUEST', requestNo, null, rows[0], user);
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});


app.post('/api/borrow-records/:id/confirm-return', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const [rows] = await pool.query('SELECT * FROM borrow_records WHERE id = ? LIMIT 1', [req.params.id]);
    const record = rows[0];
    if (!record) return res.status(404).json({ error: 'ไม่พบรายการยืม' });
    assertCompanyAccess(user, record.company_code);
    if (!['ADMIN', 'SUPERVISOR', 'HR'].includes(user.role) || ![text(user.name), text(user.id)].includes(text(record.borrower))) {
      return res.status(403).json({ error: 'พนักงานยืนยันคืนได้เฉพาะรายการยืมของตนเอง' });
    }
    if (record.status !== 'APPROVED') return res.status(409).json({ error: 'รายการนี้ไม่อยู่ในสถานะที่ยืนยันคืนได้' });
    await pool.query(
      `UPDATE borrow_records SET status = 'RETURN_REQUESTED', return_date = ?, note = CONCAT(note, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [dateOnly(req.body.returnDate || bangkokDateOnly()), `\n[Return requested by ${user.name}] ${text(req.body.note)}`, record.id]
    );
    const [updatedRows] = await pool.query('SELECT * FROM borrow_records WHERE id = ?', [record.id]);
    await writeAudit(req, 'BORROW', 'CONFIRM_RETURN', record.request_no, record, updatedRows[0], user);
    res.json(updatedRows[0]);
  } catch (error) {
    next(error);
  }
});

app.post('/api/borrow-records/:id/return', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    assertWorkflowDepartment(user, 'IT', 'การรับคืนอุปกรณ์ต้องดำเนินการโดย IT');
    await connection.beginTransaction();
    const [recordRows] = await connection.query('SELECT * FROM borrow_records WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!recordRows[0]) throw httpError(404, 'ไม่พบรายการยืม');
    const record = recordRows[0];
    assertCompanyAccess(user, record.company_code);
    if (!['APPROVED', 'RETURN_REQUESTED'].includes(record.status)) throw httpError(409, 'รับคืนได้เฉพาะรายการที่อนุมัติแล้วหรือผู้ยืมยืนยันคืนแล้ว');

    const [assetRows] = await connection.query('SELECT * FROM assets WHERE id = ? AND company = ? FOR UPDATE', [record.asset_id, record.company_code]);
    if (!assetRows[0]) throw httpError(404, 'ไม่พบทรัพย์สินที่อ้างอิง');
    const currentAsset = assetRows[0];
    if (normalizeAssetStatus(currentAsset.status) !== 'BORROWED') {
      throw httpError(409, 'สถานะทรัพย์สินไม่ใช่ BORROWED กรุณาตรวจสอบก่อนรับคืน');
    }

    const returnImage = parseAssetImage(req.body.returnImageData || req.body.return_image_data);
    if (!returnImage) throw httpError(400, 'กรุณาถ่ายรูปหรือแนบรูปทรัพย์สินตอนคืนก่อนบันทึกรับคืน');
    const returnImageName = text(req.body.returnImageName || req.body.return_image_name, `return-${record.asset_id}-${record.request_no}.jpg`).slice(0, 255);

    const returnDate = dateOnly(req.body.returnDate || req.body.return_date, bangkokDateOnly());
    if (returnDate < dateOnly(record.borrow_date)) throw httpError(400, 'วันที่คืนต้องไม่น้อยกว่าวันยืม');
    const conditionIn = Math.max(0, Math.min(100, numberValue(req.body.conditionIn || req.body.condition_in, 100)));
    const receivedBy = text(req.body.receivedBy || req.body.received_by, user.name);
    const returnLocation = text(
      req.body.returnLocation || req.body.return_location,
      record.original_location || currentAsset.location
    );
    let nextStatus = text(req.body.nextStatus || req.body.next_status, 'IN_STOCK').toUpperCase();
    if (!['ACTIVE', 'IN_STOCK', 'IN_REPAIR'].includes(nextStatus)) {
      throw httpError(400, 'สถานะหลังรับคืนต้องเป็น ACTIVE, IN_STOCK หรือ IN_REPAIR');
    }
    const returnedItems = Array.isArray(req.body.returnedItems) ? req.body.returnedItems.map(String) : [];
    const missingItems = Array.isArray(req.body.missingItems) ? req.body.missingItems.map(String) : [];
    // Box set ที่คืนไม่ครบหรือสภาพต่ำกว่าเกณฑ์ต้องเข้าสู่ Maintenance เสมอ
    // เพื่อไม่ให้ Asset กลับไปพร้อมใช้งานทั้งที่ยังมีความผิดปกติค้างอยู่
    if (missingItems.length > 0 || conditionIn < 70) nextStatus = 'IN_REPAIR';
    const originalCustodianType = text(record.original_custodian_type, record.original_assignee ? 'EMPLOYEE' : 'UNASSIGNED').toUpperCase();
    const nextCustodianType = nextStatus === 'ACTIVE' ? originalCustodianType : 'UNASSIGNED';
    const nextAssignee = nextStatus === 'ACTIVE' ? text(record.original_assignee) : '';
    const nextDepartment = nextStatus === 'ACTIVE' ? text(record.original_department) : '';
    if (nextStatus === 'ACTIVE' && !nextAssignee && nextCustodianType !== 'SHARED') {
      throw httpError(409, 'ไม่พบผู้ถือครองเดิม กรุณาเลือกสถานะ IN_STOCK หรือระบุผู้ถือครองผ่านหน้าผู้ครอบครองปัจจุบัน');
    }

    await connection.query(
      `UPDATE borrow_records SET
        return_date = ?,
        condition_in = ?,
        status = 'RETURNED',
        received_by = ?,
        return_location = ?,
        note = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [returnDate, conditionIn, receivedBy, returnLocation, text(req.body.note, record.note), req.params.id]
    );
    await connection.query(
      `INSERT INTO borrow_return_photos (
        borrow_record_id, asset_id, file_name, mime_type, file_data, created_by
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        asset_id = VALUES(asset_id),
        file_name = VALUES(file_name),
        mime_type = VALUES(mime_type),
        file_data = VALUES(file_data),
        created_by = VALUES(created_by),
        created_at = CURRENT_TIMESTAMP`,
      [record.id, record.asset_id, returnImageName, returnImage.mime, returnImage.buffer, user.name]
    );
    await connection.query(
      `INSERT INTO return_records (
        asset_id, return_date, returned_by, received_by, return_location,
        \`condition\`, note, returned_items, missing_items, return_reason,
        previous_assignee, previous_department, previous_location
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'BORROW_RETURN', ?, ?, ?)`,
      [
        record.asset_id,
        returnDate,
        record.borrower,
        receivedBy,
        returnLocation,
        conditionIn,
        text(req.body.note, record.note),
        jsonValue(returnedItems, []),
        jsonValue(missingItems, []),
        record.borrower,
        text(record.original_department),
        text(record.original_location)
      ]
    );
    await connection.query(
      `UPDATE assets SET
        status = ?,
        assigned_to = ?,
        custodian_type = ?,
        department = ?,
        location = ?,
        \`condition\` = ?,
        updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [nextStatus, nextAssignee, nextCustodianType, nextDepartment, returnLocation, conditionIn, record.asset_id]
    );
    await connection.query(
      `INSERT INTO asset_events (company_code, asset_id, event_type, old_value, new_value, actor, note)
       VALUES (?, ?, 'BORROW_RETURN', ?, ?, ?, ?)`,
      [record.company_code, record.asset_id, 'BORROWED', nextStatus, user.name, text(req.body.note)]
    );
    if (nextStatus === 'IN_REPAIR') {
      const [openTickets] = await connection.query(
        "SELECT id FROM maintenance WHERE asset_id = ? AND status <> 'CLOSED' LIMIT 1 FOR UPDATE",
        [record.asset_id]
      );
      if (!openTickets[0]) {
        const ticketNo = generateNo('MNT');
        const issue = missingItems.length ? `รับคืนจากการยืมไม่ครบ: ${missingItems.join(', ')}` : `รับคืนจากการยืมสภาพ ${conditionIn}%`;
        await connection.query(
          `INSERT INTO maintenance (
            ticket_no, company_code, asset_id, service_department, issue, priority, technician, estimated_cost,
            diagnosis, repair_method, vendor, parts_json, cost, status, opened_date, closed_date,
            note, requested_by, requester_employee_code, previous_asset_status, updated_at
          ) VALUES (?, ?, ?, 'IT', ?, 'NORMAL', '', NULL, '', '', '', '[]', 0, 'OPEN', ?, '', ?, ?, ?, 'IN_STOCK', CURRENT_TIMESTAMP)`,
          [ticketNo, record.company_code, record.asset_id, issue, returnDate, text(req.body.note, record.note), user.name, user.id]
        );
      }
    }
    await connection.commit();

    const [rows] = await pool.query('SELECT * FROM borrow_records WHERE id = ?', [req.params.id]);
    await writeAudit(req, 'BORROW', 'RETURN', record.request_no, record, rows[0], user);
    res.json((await decorateBorrowRecords(rows))[0]);
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

function normalizeMaintenancePriority(value) {
  const normalized = text(value, 'NORMAL').toUpperCase();
  return ['LOW', 'NORMAL', 'HIGH', 'URGENT'].includes(normalized) ? normalized : 'NORMAL';
}

function normalizeRepairMethod(value) {
  const normalized = text(value).toUpperCase();
  return ['INTERNAL', 'VENDOR', 'WARRANTY', 'REPLACE', 'OTHER'].includes(normalized) ? normalized : '';
}

function isMaintenanceEmployeeRow(employee, department) {
  const haystack = `${employee.department || ''} ${employee.position || ''}`.toLowerCase();
  return departmentCodeFromText(haystack) === normalizeOperationalDepartment(department);
}

async function maintenanceTechnicianCandidates(company, serviceDepartment = 'IT') {
  const [rows] = await pool.query(
    `SELECT id, name, department, position, company
     FROM employees
     WHERE status = 'ACTIVE' AND company = ?
     ORDER BY name ASC`,
    [normalizeCompany(company)]
  );
  const department = normalizeOperationalDepartment(serviceDepartment, 'IT');
  return rows.filter((row) => isMaintenanceEmployeeRow(row, department));
}

async function maintenanceRowsForUser(user) {
  const [rows] = isSuperAdmin(user)
    ? await pool.query('SELECT * FROM maintenance ORDER BY created_at DESC, id DESC')
    : await pool.query('SELECT * FROM maintenance WHERE company_code = ? ORDER BY created_at DESC, id DESC', [normalizeCompany(user.company)]);
  if (!rows.length) return [];
  const ids = rows.map((row) => row.id);
  const [parts] = await pool.query(
    `SELECT p.*, s.name AS stock_name FROM maintenance_parts p
     INNER JOIN stock_items s ON s.sku = p.sku
     WHERE p.maintenance_id IN (${ids.map(() => '?').join(',')}) ORDER BY p.id ASC`,
    ids
  );
  const byTicket = new Map();
  for (const part of parts) {
    const current = byTicket.get(part.maintenance_id) || [];
    current.push({ ...part, quantity: Number(part.quantity), unit_cost: Number(part.unit_cost) });
    byTicket.set(part.maintenance_id, current);
  }
  return rows.map((row) => ({
    ...row,
    cost: Number(row.cost),
    estimated_cost: row.estimated_cost == null ? null : Number(row.estimated_cost),
    priority: normalizeMaintenancePriority(row.priority),
    diagnosis: row.diagnosis || '',
    repair_method: row.repair_method || '',
    repair_method_other: row.repair_method_other || '',
    vendor: row.vendor || '',
    parts: byTicket.get(row.id) || safeJsonArray(row.parts_json)
  }));
}

app.get('/api/maintenance', async (req, res, next) => {
  try {
    res.json(await maintenanceRowsForUser(await getRequestUser(req)));
  } catch (error) {
    next(error);
  }
});

app.post('/api/maintenance', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    if (!hasPermission(user, 'maintenance.write') && !hasPermission(user, 'maintenance.request')) {
      throw httpError(403, 'ไม่มีสิทธิ์เปิดงานซ่อม');
    }
    const assetId = text(req.body.assetId || req.body.asset_id);
    const issue = text(req.body.issue);
    if (!assetId) return res.status(400).json({ error: 'กรุณาเลือกทรัพย์สิน' });
    if (!issue) return res.status(400).json({ error: 'กรุณาระบุอาการหรือปัญหา' });

    await connection.beginTransaction();
    const [assetRows] = await connection.query(
      'SELECT id, company, status, responsible_department FROM assets WHERE id = ? FOR UPDATE',
      [assetId]
    );
    const assetRow = assetRows[0];
    if (!assetRow) throw httpError(404, 'ไม่พบทรัพย์สิน');
    assertCompanyAccess(user, assetRow.company);
    const currentStatus = normalizeAssetStatus(assetRow.status);
    if (['DISPOSED', 'SOLD', 'LOST', 'BORROWED', 'IN_REPAIR'].includes(currentStatus)) {
      throw httpError(409, `สถานะ ${currentStatus} ไม่สามารถเปิดงานซ่อมได้`);
    }
    const [openTickets] = await connection.query(
      "SELECT id FROM maintenance WHERE asset_id = ? AND status <> 'CLOSED' LIMIT 1 FOR UPDATE",
      [assetId]
    );
    if (openTickets[0]) throw httpError(409, 'ทรัพย์สินนี้มี Ticket ซ่อมที่ยังไม่ปิด');

    const ticketNo = text(req.body.ticketNo || req.body.ticket_no, generateNo('MNT'));
    const serviceDepartment = normalizeOperationalDepartment(
      req.body.serviceDepartment || req.body.service_department,
      assetRow.responsible_department || 'IT'
    );
    if (!['IT', 'GA'].includes(serviceDepartment)) throw httpError(400, 'งานซ่อมต้องส่งให้ IT หรือ GA');
    const candidates = await maintenanceTechnicianCandidates(assetRow.company, serviceDepartment);
    const technician = candidates.length === 1 ? candidates[0].name : '';
    const priority = normalizeMaintenancePriority(req.body.priority);
    const openedDate = dateOnly(req.body.openedDate || req.body.opened_date, bangkokDateOnly());
    const note = text(req.body.note);
    const [insertResult] = await connection.query(
      `INSERT INTO maintenance (
        ticket_no, company_code, asset_id, service_department, issue, priority, technician, estimated_cost,
        diagnosis, repair_method, vendor, parts_json, cost,
        status, opened_date, closed_date, note, requested_by, requester_employee_code,
        previous_asset_status, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, '', '', '', '[]', 0, 'OPEN', ?, '', ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
      [
        ticketNo,
        normalizeCompany(assetRow.company),
        assetId,
        serviceDepartment,
        issue,
        priority,
        technician,
        openedDate,
        note,
        user.name,
        user.id,
        currentStatus
      ]
    );
    const [assetUpdate] = await connection.query(
      "UPDATE assets SET status = 'IN_REPAIR', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = ?",
      [assetId, assetRow.status]
    );
    if (!assetUpdate.affectedRows) throw httpError(409, 'สถานะทรัพย์สินเปลี่ยนไประหว่างเปิดงานซ่อม กรุณาลองใหม่');
    await connection.query(
      `INSERT INTO asset_events (company_code, asset_id, event_type, old_value, new_value, actor, note)
       VALUES (?, ?, 'MAINTENANCE_OPENED', ?, 'IN_REPAIR', ?, ?)`,
      [normalizeCompany(assetRow.company), assetId, currentStatus, user.name, `${ticketNo} · ${issue}`]
    );
    await connection.commit();

    const rows = await maintenanceRowsForUser(user);
    const created = rows.find((row) => Number(row.id) === Number(insertResult.insertId)) || rows.find((row) => row.ticket_no === ticketNo);
    await writeAudit(req, 'MAINTENANCE', 'CREATE', ticketNo, null, created, user);
    res.status(201).json(created);
  } catch (error) {
    try { await connection.rollback(); } catch { /* no active transaction */ }
    next(error);
  } finally {
    connection.release();
  }
});

app.post('/api/maintenance/:id/parts', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    if (!hasPermission(user, 'stock.issue') && !hasPermission(user, 'stock.write')) {
      throw httpError(403, 'ไม่มีสิทธิ์เบิกอะไหล่จาก Stock');
    }
    await connection.beginTransaction();
    const [ticketRows] = await connection.query('SELECT * FROM maintenance WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!ticketRows[0]) throw httpError(404, 'ไม่พบ Ticket');
    const ticket = ticketRows[0];
    assertCompanyAccess(user, ticket.company_code);
    if (ticket.status === 'CLOSED') throw httpError(409, 'Ticket นี้ปิดแล้ว');
    const sku = text(req.body.sku);
    const warehouse = text(req.body.warehouse);
    const quantity = numberValue(req.body.quantity);
    const result = await applyStockMovement(connection, user, {
      movementType: 'ISSUE', sku, quantity, fromWarehouse: warehouse,
      movementDate: req.body.movementDate || bangkokDateOnly(),
      reference: ticket.ticket_no,
      note: text(req.body.note, `เบิกอะไหล่สำหรับ ${ticket.ticket_no}`)
    });
    const [itemRows] = await connection.query('SELECT unit_cost FROM stock_items WHERE sku = ?', [sku]);
    const unitCost = Number(itemRows[0]?.unit_cost || 0);
    await connection.query(
      `INSERT INTO maintenance_parts (maintenance_id, sku, warehouse, quantity, unit_cost, movement_doc_no, issued_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [ticket.id, sku, warehouse, quantity, unitCost, result.movement.doc_no, user.name]
    );
    await connection.query('UPDATE maintenance SET cost = cost + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [quantity * unitCost, ticket.id]);
    await connection.commit();
    await writeAudit(req, 'MAINTENANCE', 'ISSUE_PART', `${ticket.ticket_no}:${sku}`, result.before, result.after, user);
    const rows = await maintenanceRowsForUser(user);
    res.status(201).json(rows.find((row) => Number(row.id) === Number(ticket.id)));
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.post('/api/maintenance/:id/close', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    if (!hasPermission(user, 'maintenance.write')) throw httpError(403, 'ไม่มีสิทธิ์ปิดงานซ่อม');
    await connection.beginTransaction();
    const [recordRows] = await connection.query('SELECT * FROM maintenance WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!recordRows[0]) throw httpError(404, 'ไม่พบ Ticket');
    const record = recordRows[0];
    assertCompanyAccess(user, record.company_code);
    if (record.status === 'CLOSED') throw httpError(409, 'Ticket นี้ปิดแล้ว');

    assertWorkflowDepartment(user, record.service_department || 'IT', `Ticket นี้อยู่ในความรับผิดชอบของ ${record.service_department || 'IT'}`);
    const candidates = await maintenanceTechnicianCandidates(record.company_code, record.service_department || 'IT');
    let technician = text(req.body.technician, record.technician);
    if (!technician && candidates.length === 1) technician = candidates[0].name;
    if (!technician) throw httpError(400, `กรุณากำหนดผู้รับผิดชอบจาก ${record.service_department || 'IT'} ก่อนปิดงาน`);
    if (technician !== record.technician && !candidates.some((row) => row.name === technician)) {
      throw httpError(400, `ผู้ดำเนินการต้องเป็นพนักงาน ${record.service_department || 'IT'} ที่ Active ในบริษัทเดียวกัน`);
    }

    const requestedActualCost = Math.max(0, numberValue(req.body.cost, Number(record.cost || 0)));
    const finalCost = Math.max(Number(record.cost || 0), requestedActualCost);
    const closedDate = dateOnly(req.body.closedDate || req.body.closed_date, bangkokDateOnly());
    const closeNote = text(req.body.note, record.note);
    await connection.query(
      `UPDATE maintenance SET technician = ?, cost = ?, status = 'CLOSED', closed_date = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [technician, finalCost, closedDate, closeNote, req.params.id]
    );

    // Keep the Asset timeline synchronized with the Maintenance module. This is an upsert
    // so re-running a migration or retrying a close request cannot duplicate the repair.
    const repairDetail = [record.issue, record.diagnosis, closeNote].map((value) => text(value)).filter(Boolean).join(' · ');
    await connection.query(
      `INSERT INTO repair_records (
        maintenance_id, asset_id, repair_date, detail, cost, technician,
        ticket_no, issue, diagnosis, repair_method, vendor
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        repair_date = VALUES(repair_date), detail = VALUES(detail), cost = VALUES(cost),
        technician = VALUES(technician), ticket_no = VALUES(ticket_no), issue = VALUES(issue),
        diagnosis = VALUES(diagnosis), repair_method = VALUES(repair_method), vendor = VALUES(vendor)`,
      [
        Number(record.id), record.asset_id, closedDate, repairDetail || record.issue || '-', finalCost,
        technician, record.ticket_no, record.issue || '', record.diagnosis || '',
        record.repair_method || '', record.vendor || ''
      ]
    );

    const restoredStatus = ['ACTIVE', 'IN_STOCK'].includes(normalizeAssetStatus(record.previous_asset_status))
      ? normalizeAssetStatus(record.previous_asset_status)
      : 'ACTIVE';
    await connection.query('UPDATE assets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [restoredStatus, record.asset_id]);
    await connection.query(
      `INSERT INTO asset_events (company_code, asset_id, event_type, old_value, new_value, actor, note)
       VALUES (?, ?, 'MAINTENANCE_CLOSED', 'IN_REPAIR', ?, ?, ?)`,
      [record.company_code, record.asset_id, restoredStatus, user.name, `${record.ticket_no} · ${repairDetail || closeNote || 'ปิดงานซ่อม'}`]
    );
    await connection.commit();
    const rows = await maintenanceRowsForUser(user);
    const updated = rows.find((row) => Number(row.id) === Number(req.params.id));
    await writeAudit(req, 'MAINTENANCE', 'CLOSE', record.ticket_no, record, updated, user);
    res.json(updated);
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.get('/api/disposals', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    if (!['ADMIN', 'SUPERVISOR', 'ACCOUNTING'].includes(user.role)) return res.json([]);
    const [rows] = isSuperAdmin(user)
      ? await pool.query('SELECT * FROM disposals ORDER BY created_at DESC, id DESC')
      : await pool.query('SELECT * FROM disposals WHERE company_code = ? ORDER BY created_at DESC, id DESC', [normalizeCompany(user.company)]);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.post('/api/disposals', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    assertAnyRole(user, ['ADMIN', 'SUPERVISOR'], 'เฉพาะ Admin หรือ Supervisor เท่านั้นที่สร้างคำขอตัดจำหน่ายได้');
    const assetId = text(req.body.assetId || req.body.asset_id);
    const reason = text(req.body.reason);
    if (!assetId || !reason) {
      return res.status(400).json({ error: 'กรุณาระบุทรัพย์สินและเหตุผลการตัดจำหน่าย' });
    }

    const asset = await getAssetById(assetId, user);
    if (!asset) return res.status(404).json({ error: 'ไม่พบทรัพย์สิน' });
    if (['DISPOSED', 'SOLD', 'BORROWED', 'IN_REPAIR'].includes(asset.status)) {
      return res.status(409).json({ error: `สถานะ ${asset.status} ไม่สามารถสร้างคำขอตัดจำหน่ายได้` });
    }
    const disposalMethod = text(req.body.disposalMethod || req.body.disposal_method, 'SCRAP').toUpperCase();
    if (!['SCRAP', 'SELL', 'DONATE', 'RETURN_VENDOR', 'OTHER'].includes(disposalMethod)) {
      return res.status(400).json({ error: 'วิธีตัดจำหน่ายไม่ถูกต้อง' });
    }
    const disposalMethodOther = disposalMethod === 'OTHER'
      ? text(req.body.disposalMethodOther || req.body.disposal_method_other)
      : '';
    if (disposalMethod === 'OTHER' && !disposalMethodOther) return res.status(400).json({ error: 'กรุณาระบุวิธีตัดจำหน่ายอื่นๆ' });
    const estimatedValue = numberValue(req.body.estimatedValue || req.body.estimated_value);
    if (estimatedValue < 0) return res.status(400).json({ error: 'มูลค่าประมาณต้องไม่ติดลบ' });
    const [pendingDisposals] = await pool.query(
      "SELECT COUNT(*) AS total FROM disposals WHERE asset_id = ? AND status = 'PENDING'",
      [asset.id]
    );
    if (Number(pendingDisposals[0]?.total || 0) > 0) {
      return res.status(409).json({ error: 'ทรัพย์สินนี้มีคำขอตัดจำหน่ายที่รออนุมัติอยู่แล้ว' });
    }

    const requestNo = text(req.body.requestNo || req.body.request_no, generateNo('DSP'));
    const connection = await pool.getConnection();
    let insertId;

    try {
      await connection.beginTransaction();
      const [lockedAssets] = await connection.query(
        'SELECT status, custodian_type FROM assets WHERE id = ? AND company = ? FOR UPDATE',
        [asset.id, asset.company]
      );
      if (!lockedAssets[0] || ['DISPOSED', 'SOLD', 'BORROWED', 'IN_REPAIR'].includes(normalizeAssetStatus(lockedAssets[0].status))) {
        throw httpError(409, 'สถานะทรัพย์สินเปลี่ยนไปแล้ว ไม่สามารถสร้างคำขอตัดจำหน่ายได้');
      }
      const [duplicateRows] = await connection.query(
        "SELECT id FROM disposals WHERE asset_id = ? AND status = 'PENDING' LIMIT 1 FOR UPDATE",
        [asset.id]
      );
      if (duplicateRows[0]) throw httpError(409, 'ทรัพย์สินนี้มีคำขอตัดจำหน่ายที่รออนุมัติอยู่แล้ว');
      const [result] = await connection.query(
        `INSERT INTO disposals (
          request_no,
          company_code,
          asset_id,
          reason,
          disposal_method,
          disposal_method_other,
          estimated_value,
          status,
          requested_by,
          disposal_date,
          note,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, ?, ?, CURRENT_TIMESTAMP)`,
        [
          requestNo,
          asset.company,
          asset.id,
          reason,
          disposalMethod,
          disposalMethodOther,
          estimatedValue,
          user.name,
          dateOnly(req.body.disposalDate || req.body.disposal_date, bangkokDateOnly()),
          text(req.body.note)
        ]
      );
      insertId = result.insertId;
      await createApproval(connection, user, 'DISPOSAL', insertId, requestNo, asset.company);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const [rows] = await pool.query('SELECT * FROM disposals WHERE id = ?', [insertId]);
    await writeAudit(req, 'DISPOSAL', 'REQUEST', requestNo, null, rows[0], user);
    res.status(201).json(rows[0]);
  } catch (error) {
    next(error);
  }
});

app.get('/api/approvals', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    let rows;
    const approvalSelect = `
      SELECT ap.*,
             COALESCE(t.asset_id, b.asset_id, d.asset_id, '') AS asset_id,
             COALESCE(a.accounting_asset_id, '') AS accounting_asset_id
      FROM approvals ap
      LEFT JOIN transfers t ON ap.request_type = 'TRANSFER' AND t.id = ap.request_id
      LEFT JOIN borrow_records b ON ap.request_type = 'BORROW' AND b.id = ap.request_id
      LEFT JOIN disposals d ON ap.request_type = 'DISPOSAL' AND d.id = ap.request_id
      LEFT JOIN assets a ON a.id = COALESCE(t.asset_id, b.asset_id, d.asset_id)
    `;
    if (isSuperAdmin(user)) {
      [rows] = await pool.query(`${approvalSelect} WHERE ap.request_type <> 'PURCHASE' ORDER BY ap.requested_at DESC, ap.id DESC`);
    } else if (user.role === 'SUPERVISOR') {
      [rows] = await pool.query(
        `${approvalSelect} WHERE ap.company_code = ? AND ap.request_type <> 'PURCHASE' ORDER BY ap.requested_at DESC, ap.id DESC`,
        [normalizeCompany(user.company)]
      );
    } else {
      rows = [];
    }
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get('/api/approvals/:id/detail', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const [approvalRows] = await pool.query('SELECT * FROM approvals WHERE id = ? LIMIT 1', [req.params.id]);
    const approval = approvalRows[0];
    if (!approval) return res.status(404).json({ error: 'ไม่พบคำขออนุมัติ' });
    assertCompanyAccess(user, approval.company_code);
    await assertApprovalScope(pool, user, approval);

    let request = null;
    let asset = null;
    if (approval.request_type === 'TRANSFER') {
      const [rows] = await pool.query('SELECT * FROM transfers WHERE id = ? LIMIT 1', [approval.request_id]);
      request = rows[0] || null;
    } else if (approval.request_type === 'BORROW') {
      const [rows] = await pool.query('SELECT * FROM borrow_records WHERE id = ? LIMIT 1', [approval.request_id]);
      request = rows[0] || null;
    } else if (approval.request_type === 'DISPOSAL') {
      const [rows] = await pool.query('SELECT * FROM disposals WHERE id = ? LIMIT 1', [approval.request_id]);
      request = rows[0] || null;

    }

    if (request?.asset_id) {
      asset = await getAssetById(request.asset_id, user);
    }

    res.json({ approval, request, asset });
  } catch (error) {
    next(error);
  }
});

app.post('/api/approvals/:id/decision', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const decision = text(req.body.decision).toUpperCase();
    if (!['APPROVED', 'REJECTED'].includes(decision)) {
      return res.status(400).json({ error: 'การตัดสินใจไม่ถูกต้อง' });
    }
    const user = await getRequestUser(req);
    await connection.beginTransaction();

    const [approvalRows] = await connection.query('SELECT * FROM approvals WHERE id = ? FOR UPDATE', [req.params.id]);
    if (!approvalRows[0]) throw httpError(404, 'ไม่พบคำขออนุมัติ');
    const approval = approvalRows[0];
    assertCompanyAccess(user, approval.company_code);
    await assertApprovalScope(connection, user, approval);
    if (approval.status !== 'PENDING') throw httpError(409, 'คำขอนี้ถูกดำเนินการแล้ว');
    const isOwnApprovalRequest =
      (approval.requester_employee_code && approval.requester_employee_code === user.id)
      || approval.requester === user.name;

    // อนุญาตเฉพาะ ADMIN ให้พิจารณาคำขอที่ตนเองสร้างได้
    if (isOwnApprovalRequest && !isSuperAdmin(user)) {
      throw httpError(409, 'ผู้ร้องขอไม่สามารถอนุมัติรายการของตนเองได้');
    }

    await connection.query(
      `UPDATE approvals SET status = ?, approver = ?, decided_at = CURRENT_TIMESTAMP, note = ? WHERE id = ?`,
      [decision, user.name, text(req.body.note), req.params.id]
    );

    if (approval.request_type === 'TRANSFER') {
      const [records] = await connection.query('SELECT * FROM transfers WHERE id = ? FOR UPDATE', [approval.request_id]);
      const record = records[0];
      if (!record) throw httpError(404, 'ไม่พบรายการโอนย้ายที่อ้างอิง');
      await connection.query(
        `UPDATE transfers SET status = ?, approved_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [decision, user.name, record.id]
      );
      if (decision === 'APPROVED') {
        const nextAssignee = text(record.to_assignee, record.from_assignee);
        const nextDepartment = text(record.to_department, record.from_department);
        const nextCustodianType = !nextAssignee
          ? 'UNASSIGNED'
          : nextAssignee === 'ทรัพย์สินส่วนกลาง'
            ? 'SHARED'
            : 'EMPLOYEE';
        const nextAssetStatus = nextCustodianType === 'UNASSIGNED' ? 'IN_STOCK' : 'ACTIVE';
        const [assetResult] = await connection.query(
          `UPDATE assets SET location = ?, department = ?, assigned_to = ?, custodian_type = ?, status = ?, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND company = ? AND status IN ('ACTIVE','IN_STOCK')`,
          [record.to_location, nextDepartment, nextAssignee, nextCustodianType, nextAssetStatus, record.asset_id, record.company_code]
        );
        if (!assetResult.affectedRows) throw httpError(409, 'สถานะทรัพย์สินเปลี่ยนไปแล้ว ไม่สามารถอนุมัติโอนย้ายได้');
        await connection.query(
          `INSERT INTO asset_events (company_code, asset_id, event_type, old_value, new_value, actor, note)
           VALUES (?, ?, 'TRANSFER', ?, ?, ?, ?)`,
          [
            record.company_code,
            record.asset_id,
            `${record.from_assignee || 'ไม่มีผู้ถือครอง'} @ ${record.from_location || '-'}`,
            `${nextAssignee || 'ไม่มีผู้ถือครอง'} @ ${record.to_location || '-'}`,
            user.name,
            record.note
          ]
        );
      }
    } else if (approval.request_type === 'BORROW') {
      const [records] = await connection.query('SELECT * FROM borrow_records WHERE id = ? FOR UPDATE', [approval.request_id]);
      const record = records[0];
      if (!record) throw httpError(404, 'ไม่พบรายการยืมที่อ้างอิง');
      await connection.query('UPDATE borrow_records SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [decision, record.id]);
      if (decision === 'APPROVED') {
        const [assetResult] = await connection.query(
          `UPDATE assets SET status = 'BORROWED', assigned_to = ?, custodian_type = 'EMPLOYEE', updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND company = ? AND status IN ('ACTIVE','IN_STOCK')`,
          [record.borrower, record.asset_id, record.company_code]
        );
        if (!assetResult.affectedRows) throw httpError(409, 'ทรัพย์สินถูกยืมหรือเปลี่ยนสถานะแล้ว ไม่สามารถอนุมัติได้');
        await connection.query(
          `INSERT INTO asset_events (company_code, asset_id, event_type, old_value, new_value, actor, note)
           VALUES (?, ?, 'BORROW', ?, 'BORROWED', ?, ?)`,
          [record.company_code, record.asset_id, 'ACTIVE/IN_STOCK', user.name, record.note]
        );
      }
    } else if (approval.request_type === 'DISPOSAL') {
      const [records] = await connection.query('SELECT * FROM disposals WHERE id = ? FOR UPDATE', [approval.request_id]);
      const record = records[0];
      if (!record) throw httpError(404, 'ไม่พบรายการตัดจำหน่ายที่อ้างอิง');
      await connection.query(
        `UPDATE disposals SET status = ?, approved_by = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        [decision, user.name, record.id]
      );
      if (decision === 'APPROVED') {
        const nextStatus = record.disposal_method === 'SELL' ? 'SOLD' : 'DISPOSED';
        const [assetBeforeRows] = await connection.query(
          `SELECT assigned_to, custodian_type, department, location, status
           FROM assets WHERE id = ? AND company = ? FOR UPDATE`,
          [record.asset_id, record.company_code]
        );
        const assetBefore = assetBeforeRows[0];
        if (!assetBefore || ['DISPOSED', 'SOLD', 'BORROWED', 'IN_REPAIR'].includes(normalizeAssetStatus(assetBefore.status))) {
          throw httpError(409, 'ทรัพย์สินกำลังถูกใช้งานใน Workflow อื่น ไม่สามารถตัดจำหน่ายได้');
        }
        const [assetResult] = await connection.query(
          `UPDATE assets SET status = ?, assigned_to = '', custodian_type = 'UNASSIGNED', department = '', updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND company = ? AND status = ?`,
          [nextStatus, record.asset_id, record.company_code, assetBefore.status]
        );
        if (!assetResult.affectedRows) throw httpError(409, 'สถานะทรัพย์สินเปลี่ยนไปแล้ว ไม่สามารถตัดจำหน่ายได้');
        await connection.query(
          `INSERT INTO asset_events (company_code, asset_id, event_type, old_value, new_value, actor, note)
           VALUES (?, ?, 'DISPOSAL', ?, ?, ?, ?)`,
          [
            record.company_code,
            record.asset_id,
            `${assetBefore.assigned_to || 'ไม่มีผู้ถือครอง'} @ ${assetBefore.location || '-'}`,
            nextStatus,
            user.name,
            record.note
          ]
        );
      }
    } else {
      throw httpError(400, 'ประเภท Approval ไม่รองรับ');
    }

    await connection.commit();
    const [rows] = await pool.query('SELECT * FROM approvals WHERE id = ?', [req.params.id]);
    await writeAudit(req, 'APPROVAL', decision, approval.request_no, approval, rows[0], user);
    res.json(rows[0]);
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.get('/api/depreciation', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const asOf = dateOnly(req.query.asOf || bangkokDateOnly());
    const assets = await getAssets(user);
    const asOfDate = new Date(`${asOf}T00:00:00Z`);

    const rows = assets.map((asset) => {
      const purchaseDate = new Date(`${asset.purchaseDate || asOf}T00:00:00Z`);
      const elapsedYears = Math.max(0, (asOfDate - purchaseDate) / (365.25 * 86400000));
      const usefulLife = Math.max(0.1, numberValue(asset.usefulLifeYears, 5));
      const depreciableAmount = Math.max(
        0,
        numberValue(asset.purchasePrice) - numberValue(asset.salvageValue)
      );
      const annualDepreciation = depreciableAmount / usefulLife;
      const accumulatedDepreciation = Math.min(
        depreciableAmount,
        annualDepreciation * elapsedYears
      );
      const bookValue = Math.max(
        numberValue(asset.salvageValue),
        numberValue(asset.purchasePrice) - accumulatedDepreciation
      );

      return {
        asset_id: asset.id,
        accounting_asset_id: asset.accountingAssetId || '',
        name: asset.name,
        company_code: asset.company,
        purchase_date: asset.purchaseDate,
        purchase_price: asset.purchasePrice,
        useful_life_years: usefulLife,
        annual_depreciation: annualDepreciation,
        accumulated_depreciation: accumulatedDepreciation,
        book_value: bookValue,
        as_of: asOf
      };
    });

    res.json(rows);
  } catch (error) {
    next(error);
  }
});

async function attachAccountingAssetIds(rows) {
  const source = Array.isArray(rows) ? rows : [];
  const assetIds = Array.from(new Set(source.map((row) => text(row?.asset_id)).filter(Boolean)));
  if (!assetIds.length) return source.map((row) => ({ ...row, accounting_asset_id: '' }));
  const marks = assetIds.map(() => '?').join(',');
  const [assetRows] = await pool.query(
    `SELECT id, accounting_asset_id FROM assets WHERE id IN (${marks})`,
    assetIds
  );
  const byId = new Map(assetRows.map((row) => [String(row.id), row.accounting_asset_id || '']));
  return source.map((row) => ({ ...row, accounting_asset_id: byId.get(String(row.asset_id || '')) || '' }));
}

app.get('/api/reports/:kind', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    let rows;
    if (req.params.kind === 'assets') {
      rows = await getAssets(user);
    } else if (req.params.kind === 'maintenance') {
      rows = await attachAccountingAssetIds(await maintenanceRowsForUser(user));
    } else if (req.params.kind === 'transfers') {
      const [records] = isSuperAdmin(user)
        ? await pool.query('SELECT * FROM transfers ORDER BY created_at DESC, id DESC')
        : await pool.query('SELECT * FROM transfers WHERE company_code = ? ORDER BY created_at DESC, id DESC', [normalizeCompany(user.company)]);
      rows = await attachAccountingAssetIds(records);
    } else if (req.params.kind === 'borrow') {
      const [records] = isSuperAdmin(user)
        ? await pool.query('SELECT * FROM borrow_records ORDER BY created_at DESC, id DESC')
        : await pool.query('SELECT * FROM borrow_records WHERE company_code = ? ORDER BY created_at DESC, id DESC', [normalizeCompany(user.company)]);
      rows = await attachAccountingAssetIds(records);
    } else if (req.params.kind === 'assignment-requests') {
      const requests = await loadAssignmentRequests(user);
      rows = requests.map((request) => ({
        request_no: request.requestNo,
        company_code: request.companyCode,
        employee_code: request.employeeCode,
        employee_name: request.employeeName,
        department: request.department,
        position: request.positionName,
        work_location: request.workLocation,
        required_date: request.requiredDate,
        status: request.status,
        requested_count: request.requestedCount,
        allocated_count: request.allocatedCount,
        completed_count: request.completedCount,
        requested_by: request.requestedByName,
        reviewed_by: request.reviewedByName,
        decision_note: request.decisionNote,
        created_at: request.createdAt,
        updated_at: request.updatedAt
      }));
    } else {
      return res.status(404).json({ error: 'ไม่พบรายงาน' });
    }

    res.json({ kind: req.params.kind, generatedAt: new Date().toISOString(), rows });
  } catch (error) {
    next(error);
  }
});

app.get('/api/audit-logs', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    const limit = Math.min(2000, Math.max(1, numberValue(req.query.limit, 500)));
    const [rows] = isSuperAdmin(user)
      ? await pool.query('SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ?', [limit])
      : await pool.query('SELECT * FROM audit_logs WHERE company_code = ? ORDER BY created_at DESC, id DESC LIMIT ?', [normalizeCompany(user.company), limit]);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});


// Administrative correction routes. These make imported/sample records behave exactly like normal production records.
app.put('/api/transfers/:id', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    assertWorkflowDepartment(user, 'HR', 'การแก้ไขคำขอโอนย้ายต้องดำเนินการโดย HR');
    const [rows] = await pool.query('SELECT * FROM transfers WHERE id = ? LIMIT 1', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบรายการโอนย้าย' });
    assertCompanyAccess(user, rows[0].company_code);
    const before = rows[0];
    if (before.status !== 'PENDING') throw httpError(409, 'แก้ไขได้เฉพาะคำขอโอนย้ายที่ยังรออนุมัติ');
    const destinationCustodian = await resolveTransferCustodian(pool, req.body, before.company_code, before);
    await pool.query(`UPDATE transfers SET to_location=?, to_department=?, to_assignee=?, transfer_date=?, note=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, [
      text(req.body.toLocation ?? req.body.to_location, before.to_location), destinationCustodian.department,
      destinationCustodian.assignee, dateOnly(req.body.transferDate ?? req.body.transfer_date, before.transfer_date),
      text(req.body.note, before.note), req.params.id
    ]);
    const [updatedRows] = await pool.query('SELECT * FROM transfers WHERE id = ?', [req.params.id]);
    await writeAudit(req,'TRANSFER','ADMIN_UPDATE',before.request_no,before,updatedRows[0],user); res.json(updatedRows[0]);
  } catch(error){ next(error); }
});
app.delete('/api/transfers/:id', async (req,res,next)=>{ const c=await pool.getConnection(); try{ const user=await getRequestUser(req);assertSuperAdmin(user);const [rows]=await c.query('SELECT * FROM transfers WHERE id=?',[req.params.id]);if(!rows[0])return res.status(404).json({error:'ไม่พบรายการโอนย้าย'});assertCompanyAccess(user,rows[0].company_code);await c.beginTransaction();await c.query("DELETE FROM approvals WHERE request_type='TRANSFER' AND request_id=?",[req.params.id]);await c.query('DELETE FROM transfers WHERE id=?',[req.params.id]);await c.commit();await writeAudit(req,'TRANSFER','DELETE',rows[0].request_no,rows[0],null,user);res.status(204).end();}catch(e){await c.rollback();next(e)}finally{c.release()} });

app.put('/api/borrow-records/:id', async (req,res,next)=>{try{const user=await getRequestUser(req);assertWorkflowDepartment(user,'IT','การแก้ไขรายการยืมต้องดำเนินการโดย IT');const [rows]=await pool.query('SELECT * FROM borrow_records WHERE id=?',[req.params.id]);if(!rows[0])return res.status(404).json({error:'ไม่พบรายการยืม'});assertCompanyAccess(user,rows[0].company_code);const b=rows[0];await pool.query(`UPDATE borrow_records SET borrower=?,borrow_date=?,due_date=?,condition_out=?,note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?`,[text(req.body.borrower,b.borrower),dateOnly(req.body.borrowDate??req.body.borrow_date,b.borrow_date),dateOnly(req.body.dueDate??req.body.due_date,b.due_date),numberValue(req.body.conditionOut??req.body.condition_out,Number(b.condition_out)),text(req.body.note,b.note),req.params.id]);const [u]=await pool.query('SELECT * FROM borrow_records WHERE id=?',[req.params.id]);await writeAudit(req,'BORROW','ADMIN_UPDATE',b.request_no,b,u[0],user);res.json(u[0])}catch(e){next(e)}});
app.delete('/api/borrow-records/:id', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    assertSuperAdmin(user);
    const [rows] = await connection.query('SELECT * FROM borrow_records WHERE id = ?', [req.params.id]);
    const record = rows[0];
    if (!record) return res.status(404).json({ error: 'ไม่พบรายการยืม' });
    assertCompanyAccess(user, record.company_code);

    await connection.beginTransaction();
    if (['APPROVED', 'RETURN_REQUESTED'].includes(record.status)) {
      const restoredStatus = normalizeAssetStatus(record.original_asset_status || 'ACTIVE');
      const restoredAssignee = text(record.original_assignee);
      const restoredCustodianType = text(
        record.original_custodian_type,
        restoredAssignee ? 'EMPLOYEE' : 'UNASSIGNED'
      ).toUpperCase();
      await connection.query(
        `UPDATE assets SET
          assigned_to = ?, custodian_type = ?, department = ?, location = ?, status = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`,
        [
          restoredAssignee,
          restoredCustodianType,
          text(record.original_department),
          text(record.original_location),
          restoredStatus,
          record.asset_id
        ]
      );
    }
    await connection.query("DELETE FROM approvals WHERE request_type = 'BORROW' AND request_id = ?", [req.params.id]);
    await connection.query('DELETE FROM borrow_records WHERE id = ?', [req.params.id]);
    await connection.commit();
    await writeAudit(req, 'BORROW', 'DELETE', record.request_no, record, null, user);
    res.status(204).end();
  } catch (error) {
    try { await connection.rollback(); } catch { /* no active transaction */ }
    next(error);
  } finally {
    connection.release();
  }
});

app.put('/api/maintenance/:id', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    if (!hasPermission(user, 'maintenance.write')) throw httpError(403, 'ไม่มีสิทธิ์แก้ไข Ticket ซ่อม');
    const [rows] = await pool.query('SELECT * FROM maintenance WHERE id = ?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบ Ticket' });
    const before = rows[0];
    assertCompanyAccess(user, before.company_code);
    if (before.status === 'CLOSED') throw httpError(409, 'Ticket นี้ปิดงานแล้ว');

    const serviceDepartment = normalizeOperationalDepartment(
      req.body.serviceDepartment ?? req.body.service_department,
      before.service_department || 'IT'
    );
    if (!['IT', 'GA'].includes(serviceDepartment)) throw httpError(400, 'งานซ่อมต้องส่งให้ IT หรือ GA');
    assertWorkflowDepartment(user, serviceDepartment, `Ticket นี้อยู่ในความรับผิดชอบของ ${serviceDepartment}`);
    const candidates = await maintenanceTechnicianCandidates(before.company_code, serviceDepartment);
    let technician = text(req.body.technician, before.technician);
    if (serviceDepartment !== (before.service_department || 'IT') && req.body.technician == null) technician = '';
    if (!technician && candidates.length === 1) technician = candidates[0].name;
    if (technician && technician !== before.technician && !candidates.some((row) => row.name === technician)) {
      throw httpError(400, `ผู้รับผิดชอบต้องเป็นพนักงาน ${serviceDepartment} ที่ Active ในบริษัทเดียวกัน`);
    }

    const estimatedCostValue = req.body.estimatedCost ?? req.body.estimated_cost;
    const estimatedCost = estimatedCostValue === '' || estimatedCostValue == null
      ? null
      : Math.max(0, numberValue(estimatedCostValue));
    const repairMethod = normalizeRepairMethod(req.body.repairMethod ?? req.body.repair_method ?? before.repair_method);
    const repairMethodOther = repairMethod === 'OTHER'
      ? text(req.body.repairMethodOther ?? req.body.repair_method_other, before.repair_method_other || '')
      : '';
    if (repairMethod === 'OTHER' && !repairMethodOther) throw httpError(400, 'กรุณาระบุวิธีดำเนินการอื่นๆ');
    const status = technician || estimatedCost != null || text(req.body.diagnosis, before.diagnosis) ? 'IN_PROGRESS' : 'OPEN';

    await pool.query(
      `UPDATE maintenance SET
        service_department = ?, issue = ?, priority = ?, technician = ?, estimated_cost = ?, diagnosis = ?,
        repair_method = ?, repair_method_other = ?, vendor = ?, status = ?, opened_date = ?, note = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [
        serviceDepartment,
        text(req.body.issue, before.issue),
        normalizeMaintenancePriority(req.body.priority ?? before.priority),
        technician,
        estimatedCost,
        text(req.body.diagnosis, before.diagnosis),
        repairMethod,
        repairMethodOther,
        ['VENDOR', 'WARRANTY'].includes(repairMethod) ? text(req.body.vendor, before.vendor) : '',
        status,
        dateOnly(req.body.openedDate ?? req.body.opened_date, before.opened_date),
        text(req.body.note, before.note),
        req.params.id
      ]
    );
    const rows2 = await maintenanceRowsForUser(user);
    const updated = rows2.find((row) => Number(row.id) === Number(req.params.id));
    await writeAudit(req, 'MAINTENANCE', 'ASSESS', before.ticket_no, before, updated, user);
    res.json(updated);
  } catch (error) {
    next(error);
  }
});
app.delete('/api/maintenance/:id', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    assertSuperAdmin(user);
    const [rows] = await connection.query('SELECT * FROM maintenance WHERE id = ?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบ Ticket' });
    const before = rows[0];
    assertCompanyAccess(user, before.company_code);
    await connection.beginTransaction();
    if (before.status !== 'CLOSED') {
      await connection.query(
        'UPDATE assets SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
        [normalizeAssetStatus(before.previous_asset_status || 'ACTIVE'), before.asset_id]
      );
    }
    await connection.query('DELETE FROM repair_records WHERE maintenance_id = ?', [before.id]);
    await connection.query('DELETE FROM maintenance WHERE id = ?', [req.params.id]);
    await connection.commit();
    await writeAudit(req, 'MAINTENANCE', 'DELETE', before.ticket_no, before, null, user);
    res.status(204).end();
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.put('/api/disposals/:id', async (req, res, next) => {
  try {
    const user = await getRequestUser(req);
    assertAnyRole(user, ['ADMIN', 'SUPERVISOR'], 'เฉพาะ Admin หรือ Supervisor เท่านั้นที่แก้ไขรายการตัดจำหน่ายได้');
    const [rows] = await pool.query('SELECT * FROM disposals WHERE id = ?', [req.params.id]);
    if (!rows[0]) return res.status(404).json({ error: 'ไม่พบรายการตัดจำหน่าย' });
    const before = rows[0];
    assertCompanyAccess(user, before.company_code);
    const disposalMethod = text(req.body.disposalMethod ?? req.body.disposal_method, before.disposal_method).toUpperCase();
    if (!['SCRAP', 'SELL', 'DONATE', 'RETURN_VENDOR', 'OTHER'].includes(disposalMethod)) throw httpError(400, 'วิธีตัดจำหน่ายไม่ถูกต้อง');
    const disposalMethodOther = disposalMethod === 'OTHER'
      ? text(req.body.disposalMethodOther ?? req.body.disposal_method_other, before.disposal_method_other || '')
      : '';
    if (disposalMethod === 'OTHER' && !disposalMethodOther) throw httpError(400, 'กรุณาระบุวิธีตัดจำหน่ายอื่นๆ');
    await pool.query(
      `UPDATE disposals SET reason = ?, disposal_method = ?, disposal_method_other = ?, estimated_value = ?, disposal_date = ?, note = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [
        text(req.body.reason, before.reason),
        disposalMethod,
        disposalMethodOther,
        Math.max(0, numberValue(req.body.estimatedValue ?? req.body.estimated_value, Number(before.estimated_value))),
        dateOnly(req.body.disposalDate ?? req.body.disposal_date, before.disposal_date),
        text(req.body.note, before.note),
        req.params.id
      ]
    );
    const [updatedRows] = await pool.query('SELECT * FROM disposals WHERE id = ?', [req.params.id]);
    await writeAudit(req, 'DISPOSAL', 'ADMIN_UPDATE', before.request_no, before, updatedRows[0], user);
    res.json(updatedRows[0]);
  } catch (error) {
    next(error);
  }
});
app.delete('/api/disposals/:id', async (req,res,next)=>{const c=await pool.getConnection();try{const user=await getRequestUser(req);assertSuperAdmin(user);const [rows]=await c.query('SELECT * FROM disposals WHERE id=?',[req.params.id]);if(!rows[0])return res.status(404).json({error:'ไม่พบรายการตัดจำหน่าย'});const b=rows[0];assertCompanyAccess(user,b.company_code);await c.beginTransaction();await c.query("DELETE FROM approvals WHERE request_type='DISPOSAL' AND request_id=?",[req.params.id]);await c.query('DELETE FROM disposals WHERE id=?',[req.params.id]);await c.commit();await writeAudit(req,'DISPOSAL','DELETE',b.request_no,b,null,user);res.status(204).end()}catch(e){await c.rollback();next(e)}finally{c.release()}});

app.put('/api/stock-movements/:id', async (req,res,next)=>{try{const user=await getRequestUser(req);if(!hasPermission(user,'stock.write'))throw httpError(403,'ไม่มีสิทธิ์แก้ไข Stock Movement');const [rows]=await pool.query('SELECT * FROM stock_movements WHERE id=?',[req.params.id]);if(!rows[0])return res.status(404).json({error:'ไม่พบ Stock Movement'});const b=rows[0];assertCompanyAccess(user,b.company_code);await pool.query('UPDATE stock_movements SET movement_date=?,reference=?,note=?,updated_at=CURRENT_TIMESTAMP WHERE id=?',[dateOnly(req.body.movementDate??req.body.movement_date,b.movement_date),text(req.body.reference,b.reference),text(req.body.note,b.note),req.params.id]);const [u]=await pool.query('SELECT * FROM stock_movements WHERE id=?',[req.params.id]);await writeAudit(req,'STOCK_MOVEMENT','ADMIN_UPDATE',b.doc_no,b,u[0],user);res.json(u[0])}catch(e){next(e)}});
app.delete('/api/stock-movements/:id', async (req,res,next)=>{const c=await pool.getConnection();try{const user=await getRequestUser(req);assertSuperAdmin(user);const [rows]=await c.query('SELECT * FROM stock_movements WHERE id=? FOR UPDATE',[req.params.id]);if(!rows[0])return res.status(404).json({error:'ไม่พบ Stock Movement'});const b=rows[0];assertCompanyAccess(user,b.company_code);await c.beginTransaction();const before=safeJsonObject(b.before_json);const after=safeJsonObject(b.after_json);const warehouses=Object.keys(after);if(warehouses.length){for(const wh of warehouses){const [balanceRows]=await c.query('SELECT * FROM stock_balances WHERE sku=? AND warehouse=? FOR UPDATE',[b.sku,wh]);const current=Number(balanceRows[0]?.available||0);if(Math.abs(current-Number(after[wh]))>0.0001)throw httpError(409,`ไม่สามารถลบ Movement นี้ได้ เพราะยอดคลัง ${wh} มีรายการถัดไปแล้ว`);}for(const wh of warehouses){await c.query('UPDATE stock_balances SET available=?,updated_at=CURRENT_TIMESTAMP WHERE sku=? AND warehouse=?',[Number(before[wh]||0),b.sku,wh]);}await syncLegacyStockItem(c,b.sku);}await c.query('DELETE FROM stock_movements WHERE id=?',[req.params.id]);await c.commit();await writeAudit(req,'STOCK_MOVEMENT','DELETE',b.doc_no,b,{restoredBalances:before},user);res.status(204).end()}catch(e){await c.rollback();next(e)}finally{c.release()}});

app.delete('/api/approvals/:id', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const user = await getRequestUser(req);
    assertSuperAdmin(user);
    await connection.beginTransaction();
    const [rows] = await connection.query('SELECT * FROM approvals WHERE id = ? FOR UPDATE', [req.params.id]);
    const approval = rows[0];
    if (!approval) throw httpError(404, 'ไม่พบรายการอนุมัติ');
    assertCompanyAccess(user, approval.company_code);
    if (approval.status !== 'PENDING') throw httpError(409, 'ยกเลิกได้เฉพาะ Approval ที่ยังเป็น PENDING');

    const sourceTables = {
      TRANSFER: 'transfers',
      BORROW: 'borrow_records',
      DISPOSAL: 'disposals'
    };
    const table = sourceTables[approval.request_type];
    if (!table) throw httpError(400, 'ประเภท Approval ไม่รองรับการยกเลิก');
    await connection.query(`UPDATE \`${table}\` SET status = 'CANCELLED', updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'PENDING'`, [approval.request_id]);
    await connection.query('DELETE FROM approvals WHERE id = ?', [approval.id]);
    await connection.commit();
    await writeAudit(req, 'APPROVAL', 'CANCEL', approval.request_no, approval, { status: 'CANCELLED' }, user);
    res.status(204).end();
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});
app.delete('/api/asset-events/:id', async (req,res,next)=>{try{const user=await getRequestUser(req);assertSuperAdmin(user);const [rows]=await pool.query('SELECT * FROM asset_events WHERE id=?',[req.params.id]);if(!rows[0])return res.status(404).json({error:'ไม่พบประวัติ'});assertCompanyAccess(user,rows[0].company_code);await pool.query('DELETE FROM asset_events WHERE id=?',[req.params.id]);await writeAudit(req,'ASSET_EVENT','DELETE',String(req.params.id),rows[0],null,user);res.status(204).end()}catch(e){next(e)}});
app.post('/api/audit-logs/bulk-delete', async (req,res,next)=>{
  const connection=await pool.getConnection();
  try{
    const user=await getRequestUser(req);
    if(!isSuperAdmin(user))return res.status(403).json({error:'เฉพาะ Admin เท่านั้นที่ลบ Audit Log ได้'});
    const ids=Array.from(new Set((Array.isArray(req.body?.ids)?req.body.ids:[])
      .map(value=>Number(value)).filter(value=>Number.isInteger(value)&&value>0))).slice(0,1000);
    if(!ids.length)return res.status(400).json({error:'กรุณาเลือกรายการ Audit Log ที่ต้องการลบ'});

    // Delete in moderate batches. This keeps SQL statements small and reduces
    // the chance of a long-running request when many rows are selected.
    await connection.beginTransaction();
    let deleted=0;
    const batchSize=200;
    for(let offset=0;offset<ids.length;offset+=batchSize){
      const batch=ids.slice(offset,offset+batchSize);
      const placeholders=batch.map(()=>'?').join(',');
      const [result]=await connection.query(`DELETE FROM audit_logs WHERE id IN (${placeholders})`,batch);
      deleted+=Number(result.affectedRows||0);
    }
    await connection.commit();
    res.json({deleted});
  }catch(e){
    try{await connection.rollback()}catch{/* ignore rollback errors */}
    next(e)
  }finally{connection.release()}
});
app.delete('/api/audit-logs/:id', async (req,res,next)=>{try{const user=await getRequestUser(req);if(!isSuperAdmin(user))return res.status(403).json({error:'เฉพาะ Admin เท่านั้นที่ลบ Audit Log ได้'});const [rows]=await pool.query('SELECT * FROM audit_logs WHERE id=?',[req.params.id]);if(!rows[0])return res.status(404).json({error:'ไม่พบ Audit Log'});await pool.query('DELETE FROM audit_logs WHERE id=?',[req.params.id]);res.status(204).end()}catch(e){next(e)}});
app.delete('/api/assignment-requests/:id', async (req,res,next)=>{try{const user=await getRequestUser(req);assertSuperAdmin(user);const [rows]=await pool.query('SELECT * FROM asset_assignment_requests WHERE id=?',[req.params.id]);if(!rows[0])return res.status(404).json({error:'ไม่พบคำขอ'});assertCompanyAccess(user,rows[0].company_code);await pool.query('DELETE FROM asset_assignment_requests WHERE id=?',[req.params.id]);await writeAudit(req,'ASSIGNMENT_REQUEST','DELETE',rows[0].request_no,rows[0],null,user);res.status(204).end()}catch(e){next(e)}});

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

app.use((error, _req, res, _next) => {
  console.error(error);

  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'ข้อมูลรหัสนี้มีอยู่ในระบบแล้ว' });
  }
  if (error.code === 'ER_ROW_IS_REFERENCED_2' || error.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(409).json({
      error: 'ไม่สามารถลบหรือแก้ไขข้อมูลนี้ได้ เนื่องจากมีประวัติหรือข้อมูลอื่นอ้างอิงอยู่'
    });
  }

  const status = Number(error.status || 500);
  res.status(status).json({
    error: status === 500 ? 'Internal server error' : error.message
  });
});

async function start() {
  await connectWithRetry();
  await migrate();
  console.log('Automatic sample-data seed is disabled. All records are managed through normal CRUD APIs.');
  app.listen(port, '0.0.0.0', () => {
    console.log(`Company Asset backend listening on port ${port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start backend', error);
  process.exit(1);
});
