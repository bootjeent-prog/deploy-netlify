import fs from 'node:fs';

const rolesSource = fs.readFileSync(new URL('../src/roles.ts', import.meta.url), 'utf8');
const usersSource = fs.readFileSync(new URL('../src/pages/UsersPage.tsx', import.meta.url), 'utf8');
const serverSource = fs.readFileSync(new URL('../backend/src/server.js', import.meta.url), 'utf8');

const expected = ['ADMIN', 'SUPERVISOR', 'HR', 'ACCOUNTING', 'VIEW'];

for (const role of expected) {
  if (!rolesSource.includes(`'${role}'`)) throw new Error(`Frontend role missing: ${role}`);
  if (!serverSource.includes(`'${role}'`)) throw new Error(`Backend role missing: ${role}`);
}


const literalLabels = [
  "{ value: 'ADMIN', label: 'ADMIN' }",
  "{ value: 'SUPERVISOR', label: 'SUPERVISOR' }",
  "{ value: 'HR', label: 'HR' }",
  "{ value: 'ACCOUNTING', label: 'ACCOUNTING' }",
  "{ value: 'VIEW', label: 'VIEW' }"
];
for (const item of literalLabels) {
  if (!usersSource.includes(item)) throw new Error(`User access selector missing fixed option: ${item}`);
}
if (!usersSource.includes('สิทธิ์เข้าใช้งาน *')) {
  throw new Error('User access field label was not updated to สิทธิ์เข้าใช้งาน');
}

const removedFrontendRoles = [
  'SUPER_ADMIN',
  'COMPANY_ADMIN',
  'ASSET_MANAGER',
  'WAREHOUSE',
  'MAINTENANCE',
  'DEPARTMENT_HEAD'
];

for (const role of removedFrontendRoles) {
  if (rolesSource.includes(`'${role}'`) || usersSource.includes(`'${role}'`)) {
    throw new Error(`Old access role still exists in frontend role contract: ${role}`);
  }
}

const requiredChecks = [
  "assertUserManagementAccess(user)",
  "เฉพาะ Admin เท่านั้นที่ลบทะเบียนทรัพย์สินได้",
  "user.role === 'SUPERVISOR'",
  "['ADMIN', 'HR'].includes(req.user?.role)",
  "ผู้ร้องขอไม่สามารถอนุมัติรายการของตนเองได้",
  "AND e.can_login = 1"
];

for (const check of requiredChecks) {
  if (!serverSource.includes(check)) throw new Error(`Role security check missing: ${check}`);
}

console.log('Role contract check ผ่าน: ใช้เฉพาะ Admin, Supervisor, HR, บัญชี และ View พร้อม security guard สำคัญครบ');
