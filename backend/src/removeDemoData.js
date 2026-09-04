import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'mysql',
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER || 'it_asset_user',
  password: process.env.DB_PASSWORD || 'it_asset_password',
  database: process.env.DB_NAME || 'it_asset_db',
  waitForConnections: true,
  connectionLimit: 2,
  charset: 'utf8mb4'
});

const demoStockSkus = [
  'SP-RAM-16GB',
  'SP-SSD-1TB',
  'SP-BAT-DELL',
  'SP-TONER-057',
  'SUP-USB-C',
  'SUP-MOUSE'
];

async function removeDemoData() {
  const connection = await pool.getConnection();
  const removed = {};

  async function run(name, sql, params = []) {
    const [result] = await connection.query(sql, params);
    removed[name] = Number(result.affectedRows || 0);
  }

  try {
    await connection.beginTransaction();

    // Remove sessions first so demo employee records can be deleted safely.
    await run('sessions', "DELETE FROM auth_sessions WHERE employee_id LIKE 'EMP-DEMO-%'");

    // Logs and approvals have no foreign-key cascade, so remove them explicitly.
    await run(
      'auditLogs',
      `DELETE FROM audit_logs
       WHERE employee_code LIKE 'EMP-DEMO-%'
          OR entity_id LIKE '%DEMO%'
          OR before_json LIKE '%DEMO%'
          OR after_json LIKE '%DEMO%'`
    );
    await run(
      'approvals',
      `DELETE FROM approvals
       WHERE request_no LIKE '%DEMO%'
          OR requester_employee_code LIKE 'EMP-DEMO-%'
          OR note LIKE '%DEMO%'`
    );

    // HR assignment requests cascade to request items, allocations and handovers.
    await run('assignmentRequests', "DELETE FROM asset_assignment_requests WHERE request_no LIKE 'ASG-DEMO-%'");

    // Delete transactional modules before deleting their assets.
    await run('maintenance', "DELETE FROM maintenance WHERE ticket_no LIKE 'MNT-DEMO-%' OR asset_id LIKE 'AST-DEMO-%'");
    await run('transfers', "DELETE FROM transfers WHERE request_no LIKE 'TRF-DEMO-%' OR asset_id LIKE 'AST-DEMO-%'");
    await run('borrowRecords', "DELETE FROM borrow_records WHERE request_no LIKE 'BRW-DEMO-%' OR asset_id LIKE 'AST-DEMO-%'");
    await run('disposals', "DELETE FROM disposals WHERE request_no LIKE 'DSP-DEMO-%' OR asset_id LIKE 'AST-DEMO-%'");

    await run(
      'stockMovements',
      `DELETE FROM stock_movements
       WHERE doc_no LIKE '%-DEMO-%'
          OR reference LIKE '%DEMO%'
          OR note LIKE '%DEMO%'`
    );

    const marks = demoStockSkus.map(() => '?').join(',');
    await run('stockBalances', `DELETE FROM stock_balances WHERE sku IN (${marks})`, demoStockSkus);
    await run('stockItems', `DELETE FROM stock_items WHERE sku IN (${marks})`, demoStockSkus);

    // Asset child rows and asset events use ON DELETE CASCADE.
    await run('assets', "DELETE FROM assets WHERE id LIKE 'AST-DEMO-%'");

    // Employee-master demo rows are deleted last because requests/handovers reference them.
    await run('employees', "DELETE FROM employees WHERE id LIKE 'EMP-DEMO-%'");

    await connection.commit();

    console.log('Demo data removed successfully.');
    console.table(removed);
    console.log('Master Data and the ADMIN-001 account were preserved intentionally.');
  } catch (error) {
    await connection.rollback();
    console.error('Demo cleanup failed. All changes were rolled back.');
    console.error(error);
    process.exitCode = 1;
  } finally {
    connection.release();
    await pool.end();
  }
}

removeDemoData();
