import { randomBytes, scryptSync } from 'node:crypto';
import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'mysql',
  port: Number(process.env.DB_PORT || 3306),
  database: process.env.DB_NAME || 'it_asset_db',
  user: process.env.DB_USER || 'it_asset_user',
  password: process.env.DB_PASSWORD || 'it_asset_password',
  waitForConnections: true,
  connectionLimit: 2,
  charset: 'utf8mb4'
});

const defaultCompany = String(process.env.INITIAL_COMPANY_CODE || 'COMPANY').trim().toUpperCase();
const defaultPassword = String(process.env.DEFAULT_LOGIN_PASSWORD || 'admin123');

function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const digest = scryptSync(String(password), salt, 64).toString('hex');
  return `scrypt$${salt}$${digest}`;
}

async function main() {
  const passwordHash = hashPassword(defaultPassword);
  const [rows] = await pool.query(
    `SELECT id FROM employees
     WHERE LOWER(email) = LOWER('admin@company.local') OR id IN ('ADMIN-001', 'ADMIN')
     ORDER BY CASE
       WHEN LOWER(email) = LOWER('admin@company.local') THEN 0
       WHEN id = 'ADMIN-001' THEN 1
       ELSE 2
     END
     LIMIT 1`
  );

  let adminId = rows[0]?.id;
  if (adminId) {
    await pool.query(
      `UPDATE employees
       SET role = 'ADMIN', status = 'ACTIVE', can_login = 1,
           email = 'admin@company.local', password_hash = ?, must_change_password = 0,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      [passwordHash, adminId]
    );
  } else {
    adminId = 'ADMIN-001';
    await pool.query(
      `INSERT INTO employees (
        id, company, name, department, position, location, email, phone,
        role, status, password_hash, must_change_password, can_login, updated_at
      ) VALUES (?, ?, ?, ?, ?, '-', ?, '', 'ADMIN', 'ACTIVE', ?, 0, 1, CURRENT_TIMESTAMP)`,
      [adminId, defaultCompany, 'ผู้ดูแลระบบ', 'IT', 'System Admin', 'admin@company.local', passwordHash]
    );
  }

  await pool.query('DELETE FROM auth_sessions WHERE employee_id = ?', [adminId]);
  console.log('ADMIN RECOVERY COMPLETE');
  console.log(`Employee ID : ${adminId}`);
  console.log('Email       : admin@company.local');
  console.log(`Password    : ${defaultPassword}`);
  console.log('Role        : ADMIN');
}

main()
  .catch((error) => {
    console.error('ADMIN RECOVERY FAILED:', error?.message || error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
