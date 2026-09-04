import fs from 'node:fs';

const app = fs.readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const users = fs.readFileSync(new URL('../src/pages/UsersPage.tsx', import.meta.url), 'utf8');
const login = fs.readFileSync(new URL('../src/pages/LoginPage.tsx', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../backend/src/server.js', import.meta.url), 'utf8');

const failures = [];
const requireText = (source, text, label) => {
  if (!source.includes(text)) failures.push(`ไม่พบ ${label}: ${text}`);
};
const forbidText = (source, text, label) => {
  if (source.includes(text)) failures.push(`ยังพบ ${label}: ${text}`);
};

forbidText(app, 'PasswordChangeModal', 'หน้าต่างเปลี่ยนรหัสผ่านของผู้ใช้ทั่วไป');
forbidText(app, 'setPasswordOpen', 'ปุ่มเปลี่ยนรหัสผ่านของผู้ใช้ทั่วไป');
forbidText(login, 'บังคับเปลี่ยนรหัสผ่านชั่วคราว', 'ข้อความรหัสผ่านชั่วคราว');
forbidText(users, 'รหัสผ่านถาวร', 'ข้อความรหัสผ่านถาวร');
forbidText(login, 'รหัสผ่านถาวร', 'ข้อความรหัสผ่านถาวรในหน้า Login');
requireText(users, "editing ? 'รหัสผ่านใหม่' : 'รหัสผ่าน'", 'ช่องรหัสผ่าน');
requireText(users, 'ยืนยันรหัสผ่าน', 'ช่องยืนยันรหัสผ่าน');
requireText(server, "assertSuperAdmin(user, 'เฉพาะ Admin เท่านั้นที่เปลี่ยนรหัสผ่านได้')", 'Backend guard สำหรับเปลี่ยนรหัสผ่าน');
requireText(server, 'must_change_password = 0', 'Migration ปิดรหัสผ่านชั่วคราว');
forbidText(server, 'กรุณากำหนดรหัสผ่านชั่วคราว', 'ข้อความรหัสผ่านชั่วคราวใน Backend');
forbidText(server, 'กรุณาเปลี่ยนรหัสผ่านชั่วคราวก่อนทำรายการ', 'ตัวบังคับเปลี่ยนรหัสผ่านก่อนทำรายการ');

if (failures.length) {
  console.error('Password policy check ไม่ผ่าน:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('Password policy check ผ่าน: ใช้ข้อความ “รหัสผ่าน” และจำกัดการจัดการรหัสผ่านไว้ที่ Admin');
