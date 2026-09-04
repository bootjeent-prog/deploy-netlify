import { seedDemoData } from '../backend/src/demoSeed.js';

let nextId = 100;
const ids = new Map();

function keyFromSql(sql, params) {
  if (/SELECT id FROM transfers WHERE request_no/.test(sql)) return `transfers:${params[0]}`;
  if (/SELECT id FROM borrow_records WHERE request_no/.test(sql)) return `borrow_records:${params[0]}`;
  if (/SELECT id FROM maintenance WHERE ticket_no/.test(sql)) return `maintenance:${params[0]}`;
  if (/SELECT id FROM disposals WHERE request_no/.test(sql)) return `disposals:${params[0]}`;
  if (/SELECT id FROM asset_assignment_requests WHERE request_no/.test(sql)) return `asset_assignment_requests:${params[0]}`;
  return '';
}

const connection = {
  async beginTransaction() {},
  async commit() {},
  async rollback() {},
  release() {},
  async query(sql, params = []) {
    const placeholders = (String(sql).match(/\?/g) || []).length;
    if (placeholders !== params.length) {
      throw new Error(
        `SQL placeholder mismatch: ${placeholders} placeholders, ${params.length} parameters\n`
        + String(sql).replace(/\s+/g, ' ').slice(0, 300)
      );
    }

    const key = keyFromSql(sql, params);
    if (key) {
      if (!ids.has(key)) ids.set(key, nextId++);
      return [[{ id: ids.get(key) }], []];
    }
    if (/SELECT id FROM approvals/.test(sql)) return [[], []];
    if (/SELECT id FROM asset_assignment_request_items/.test(sql)) return [[], []];
    if (/SELECT id FROM asset_assignment_allocations/.test(sql)) {
      const allocationKey = `allocation:${params.join(':')}`;
      if (!ids.has(allocationKey)) ids.set(allocationKey, nextId++);
      return [[{ id: ids.get(allocationKey) }], []];
    }
    if (/^\s*INSERT/i.test(sql)) return [{ insertId: nextId++, affectedRows: 1 }, []];
    return [[], []];
  }
};

const pool = {
  async getConnection() {
    return connection;
  }
};

await seedDemoData({
  pool,
  hashPassword: () => 'scrypt$demo$hash',
  defaultPassword: 'admin123'
});

console.log('Demo seed dry-run passed: SQL placeholders and JavaScript execution are valid.');
