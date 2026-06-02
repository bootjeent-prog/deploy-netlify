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

const seed = {
  assets: [
    {
      id: 'IT-NTB-00042',
      name: 'Lenovo ThinkPad X1 Carbon Gen 11',
      category: 'Notebook',
      serial: 'PF4Z9A21',
      assignedTo: 'กมลชนก ศรีวัฒน์',
      department: 'บัญชี',
      location: 'ชั้น 12 อาคาร A',
      status: 'ใช้งานอยู่',
      purchaseDate: '2024-03-18',
      warrantyUntil: '2027-03-17',
      condition: 92,
      repairs: [
        { date: '2025-08-14', detail: 'เปลี่ยนแบตเตอรี่', cost: 4200, technician: 'ทีม Service Desk' },
        { date: '2026-02-03', detail: 'อัปเดต BIOS และตรวจสุขภาพ SSD', cost: 0, technician: 'ณัฐพล' }
      ]
    },
    {
      id: 'IT-MON-00109',
      name: 'Dell UltraSharp U2723QE',
      category: 'Monitor',
      serial: 'CN0D7K92',
      assignedTo: 'วรุตม์ ภักดี',
      department: 'Product',
      location: 'ชั้น 9 อาคาร B',
      status: 'ใช้งานอยู่',
      purchaseDate: '2023-11-02',
      warrantyUntil: '2026-11-01',
      condition: 88,
      repairs: [{ date: '2025-12-19', detail: 'เคลมสาย USB-C', cost: 0, technician: 'Dell Onsite' }]
    },
    {
      id: 'IT-MOB-00031',
      name: 'iPhone 15 Pro',
      category: 'Mobile',
      serial: 'F2L92THQ0',
      assignedTo: 'พรทิพย์ ใจดี',
      department: 'Sales',
      location: 'สาขาเชียงใหม่',
      status: 'ซ่อมบำรุง',
      purchaseDate: '2024-09-24',
      warrantyUntil: '2026-09-23',
      condition: 67,
      repairs: [{ date: '2026-05-18', detail: 'หน้าจอแตก รออะไหล่', cost: 9800, technician: 'Apple Authorized' }]
    },
    {
      id: 'IT-NTB-00058',
      name: 'MacBook Air M3 13"',
      category: 'Notebook',
      serial: 'C02YY771Q6L4',
      assignedTo: 'คลังกลาง',
      department: 'IT',
      location: 'คลัง IT ชั้น 4',
      status: 'อยู่ในสต็อก',
      purchaseDate: '2025-01-15',
      warrantyUntil: '2028-01-14',
      condition: 100,
      repairs: []
    }
  ],
  employees: [
    { id: 'EMP-1001', name: 'กมลชนก ศรีวัฒน์', department: 'บัญชี', position: 'Accounting Manager', email: 'kamonchanok@example.com', location: 'ชั้น 12 อาคาร A' },
    { id: 'EMP-1002', name: 'วรุตม์ ภักดี', department: 'Product', position: 'Product Manager', email: 'warut@example.com', location: 'ชั้น 9 อาคาร B' },
    { id: 'EMP-1003', name: 'พรทิพย์ ใจดี', department: 'Sales', position: 'Sales Executive', email: 'porntip@example.com', location: 'สาขาเชียงใหม่' },
    { id: 'EMP-IT-STOCK', name: 'คลังกลาง', department: 'IT', position: 'IT Stock', email: 'it-stock@example.com', location: 'คลัง IT ชั้น 4' }
  ],
  stock: [
    { name: 'USB-C Hub 8-in-1', sku: 'ACC-HUB-08', available: 4, min: 8, location: 'คลัง IT ชั้น 4' },
    { name: 'Logitech MX Master 3S', sku: 'ACC-MOU-3S', available: 13, min: 10, location: 'คลัง IT ชั้น 4' },
    { name: 'RAM DDR5 16GB', sku: 'SP-RAM-D5-16', available: 3, min: 6, location: 'ห้องซ่อม' },
    { name: 'สาย HDMI 2m', sku: 'CB-HDMI-02', available: 28, min: 12, location: 'คลัง IT ชั้น 4' }
  ]
};

function requireFields(body, fields) {
  return fields.filter((field) => !String(body[field] ?? '').trim());
}

function toAsset(row, repairs = [], returns = []) {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    serial: row.serial,
    assignedTo: row.assigned_to,
    department: row.department,
    location: row.location,
    status: row.status,
    purchaseDate: row.purchase_date,
    warrantyUntil: row.warranty_until,
    condition: Number(row.condition),
    repairs,
    returns
  };
}

function toEmployee(row) {
  return {
    id: row.id,
    name: row.name,
    department: row.department,
    position: row.position,
    email: row.email,
    location: row.location
  };
}

function toStock(row) {
  return {
    name: row.name,
    sku: row.sku,
    available: Number(row.available),
    min: Number(row.min_level),
    location: row.location
  };
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

async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS employees (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      department VARCHAR(255) NOT NULL,
      position VARCHAR(255) NOT NULL DEFAULT '-',
      email VARCHAR(255) NOT NULL DEFAULT '-',
      location VARCHAR(255) NOT NULL DEFAULT '-',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS assets (
      id VARCHAR(64) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(120) NOT NULL,
      serial VARCHAR(160) NOT NULL,
      assigned_to VARCHAR(255) NOT NULL,
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
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT return_records_asset_fk FOREIGN KEY (asset_id) REFERENCES assets(id) ON DELETE CASCADE
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS stock_items (
      sku VARCHAR(80) PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      available INT NOT NULL DEFAULT 0,
      min_level INT NOT NULL DEFAULT 0,
      location VARCHAR(255) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    ) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  `);
}

async function seedDatabase() {
  const [[countRow]] = await pool.query('SELECT COUNT(*) AS count FROM assets');
  if (Number(countRow.count) > 0) return;

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    for (const employee of seed.employees) {
      await connection.query(
        `INSERT IGNORE INTO employees (id, name, department, position, email, location)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [employee.id, employee.name, employee.department, employee.position, employee.email, employee.location]
      );
    }

    for (const asset of seed.assets) {
      await connection.query(
        `INSERT IGNORE INTO assets (id, name, category, serial, assigned_to, department, location, status, purchase_date, warranty_until, \`condition\`)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          asset.id,
          asset.name,
          asset.category,
          asset.serial,
          asset.assignedTo,
          asset.department,
          asset.location,
          asset.status,
          asset.purchaseDate,
          asset.warrantyUntil,
          asset.condition
        ]
      );

      for (const repair of asset.repairs) {
        await connection.query(
          `INSERT INTO repair_records (asset_id, repair_date, detail, cost, technician)
           VALUES (?, ?, ?, ?, ?)`,
          [asset.id, repair.date, repair.detail, repair.cost, repair.technician]
        );
      }
    }

    for (const item of seed.stock) {
      await connection.query(
        `INSERT IGNORE INTO stock_items (sku, name, available, min_level, location)
         VALUES (?, ?, ?, ?, ?)`,
        [item.sku, item.name, item.available, item.min, item.location]
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

async function getAssets() {
  const [assets] = await pool.query('SELECT * FROM assets ORDER BY created_at DESC');
  const [repairs] = await pool.query('SELECT * FROM repair_records ORDER BY created_at DESC, id DESC');
  const [returns] = await pool.query('SELECT * FROM return_records ORDER BY created_at DESC, id DESC');
  const repairsByAsset = new Map();
  const returnsByAsset = new Map();

  for (const repair of repairs) {
    const current = repairsByAsset.get(repair.asset_id) ?? [];
    current.push({
      date: repair.repair_date,
      detail: repair.detail,
      cost: Number(repair.cost),
      technician: repair.technician
    });
    repairsByAsset.set(repair.asset_id, current);
  }

  for (const returnRecord of returns) {
    const current = returnsByAsset.get(returnRecord.asset_id) ?? [];
    current.push({
      date: returnRecord.return_date,
      returnedBy: returnRecord.returned_by,
      receivedBy: returnRecord.received_by,
      location: returnRecord.return_location,
      condition: Number(returnRecord.condition),
      note: returnRecord.note
    });
    returnsByAsset.set(returnRecord.asset_id, current);
  }

  return assets.map((asset) => toAsset(asset, repairsByAsset.get(asset.id) ?? [], returnsByAsset.get(asset.id) ?? []));
}

async function getEmployees() {
  const [rows] = await pool.query('SELECT * FROM employees ORDER BY created_at DESC');
  return rows.map(toEmployee);
}

async function getStock() {
  const [rows] = await pool.query('SELECT * FROM stock_items ORDER BY created_at DESC');
  return rows.map(toStock);
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, service: 'it-asset-backend', database: 'mysql' });
  } catch (error) {
    next(error);
  }
});

app.get('/api/bootstrap', async (_req, res, next) => {
  try {
    const [assets, employees, stock] = await Promise.all([getAssets(), getEmployees(), getStock()]);
    res.json({ assets, employees, stock });
  } catch (error) {
    next(error);
  }
});

app.get('/api/assets', async (_req, res, next) => {
  try {
    res.json(await getAssets());
  } catch (error) {
    next(error);
  }
});

app.post('/api/assets', async (req, res, next) => {
  try {
    const missing = requireFields(req.body, ['id', 'name', 'serial', 'assignedTo', 'department', 'location', 'status']);
    if (missing.length) return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });

    const asset = {
      id: String(req.body.id).trim(),
      name: String(req.body.name).trim(),
      category: String(req.body.category || 'Other').trim(),
      serial: String(req.body.serial).trim(),
      assignedTo: String(req.body.assignedTo).trim(),
      department: String(req.body.department).trim(),
      location: String(req.body.location).trim(),
      status: String(req.body.status).trim(),
      purchaseDate: String(req.body.purchaseDate || '').trim(),
      warrantyUntil: String(req.body.warrantyUntil || '').trim(),
      condition: Number(req.body.condition ?? 100)
    };

    await pool.query(
      `INSERT INTO assets (id, name, category, serial, assigned_to, department, location, status, purchase_date, warranty_until, \`condition\`)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        asset.id,
        asset.name,
        asset.category,
        asset.serial,
        asset.assignedTo,
        asset.department,
        asset.location,
        asset.status,
        asset.purchaseDate,
        asset.warrantyUntil,
        asset.condition
      ]
    );

    res.status(201).json({
      ...asset,
      repairs: []
    });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Asset ID already exists' });
    next(error);
  }
});

app.put('/api/assets/:id', async (req, res, next) => {
  try {
    const missing = requireFields(req.body, ['name', 'serial', 'assignedTo', 'department', 'location', 'status']);
    if (missing.length) return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });

    const asset = {
      name: String(req.body.name).trim(),
      category: String(req.body.category || 'Other').trim(),
      serial: String(req.body.serial).trim(),
      assignedTo: String(req.body.assignedTo).trim(),
      department: String(req.body.department).trim(),
      location: String(req.body.location).trim(),
      status: String(req.body.status).trim(),
      purchaseDate: String(req.body.purchaseDate || '').trim(),
      warrantyUntil: String(req.body.warrantyUntil || '').trim(),
      condition: Number(req.body.condition ?? 100)
    };

    const [result] = await pool.query(
      `UPDATE assets
       SET name = ?, category = ?, serial = ?, assigned_to = ?, department = ?, location = ?, status = ?, purchase_date = ?, warranty_until = ?, \`condition\` = ?
       WHERE id = ?`,
      [
        asset.name,
        asset.category,
        asset.serial,
        asset.assignedTo,
        asset.department,
        asset.location,
        asset.status,
        asset.purchaseDate,
        asset.warrantyUntil,
        asset.condition,
        req.params.id
      ]
    );

    if (!result.affectedRows) return res.status(404).json({ error: 'Asset not found' });

    const assets = await getAssets();
    res.json(assets.find((currentAsset) => currentAsset.id === req.params.id));
  } catch (error) {
    next(error);
  }
});

app.delete('/api/assets/:id', async (req, res, next) => {
  try {
    const [result] = await pool.query('DELETE FROM assets WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Asset not found' });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.post('/api/assets/:id/repairs', async (req, res, next) => {
  try {
    const missing = requireFields(req.body, ['date', 'detail', 'technician']);
    if (missing.length) return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [assets] = await connection.query('SELECT id FROM assets WHERE id = ?', [req.params.id]);
      if (!assets.length) {
        await connection.rollback();
        return res.status(404).json({ error: 'Asset not found' });
      }

      await connection.query(
        `INSERT INTO repair_records (asset_id, repair_date, detail, cost, technician)
         VALUES (?, ?, ?, ?, ?)`,
        [
          req.params.id,
          String(req.body.date).trim(),
          String(req.body.detail).trim(),
          Number(req.body.cost ?? 0),
          String(req.body.technician).trim()
        ]
      );

      await connection.query('UPDATE assets SET status = ? WHERE id = ?', ['ซ่อมบำรุง', req.params.id]);
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const assets = await getAssets();
    res.status(201).json(assets.find((asset) => asset.id === req.params.id));
  } catch (error) {
    next(error);
  }
});

app.post('/api/assets/:id/returns', async (req, res, next) => {
  try {
    const missing = requireFields(req.body, ['date', 'returnedBy', 'receivedBy', 'location']);
    if (missing.length) return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });

    const returnRecord = {
      date: String(req.body.date).trim(),
      returnedBy: String(req.body.returnedBy).trim(),
      receivedBy: String(req.body.receivedBy).trim(),
      location: String(req.body.location).trim(),
      condition: Number(req.body.condition ?? 100),
      note: String(req.body.note || '-').trim()
    };

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [assets] = await connection.query('SELECT id FROM assets WHERE id = ?', [req.params.id]);
      if (!assets.length) {
        await connection.rollback();
        return res.status(404).json({ error: 'Asset not found' });
      }

      await connection.query(
        `INSERT INTO return_records (asset_id, return_date, returned_by, received_by, return_location, \`condition\`, note)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          req.params.id,
          returnRecord.date,
          returnRecord.returnedBy,
          returnRecord.receivedBy,
          returnRecord.location,
          returnRecord.condition,
          returnRecord.note
        ]
      );

      await connection.query(
        `UPDATE assets
         SET assigned_to = ?, department = ?, location = ?, status = ?, \`condition\` = ?
         WHERE id = ?`,
        ['คลังกลาง', 'IT', returnRecord.location, 'อยู่ในสต็อก', returnRecord.condition, req.params.id]
      );

      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

    const assets = await getAssets();
    res.status(201).json(assets.find((asset) => asset.id === req.params.id));
  } catch (error) {
    next(error);
  }
});

app.get('/api/employees', async (_req, res, next) => {
  try {
    res.json(await getEmployees());
  } catch (error) {
    next(error);
  }
});

app.post('/api/employees', async (req, res, next) => {
  try {
    const missing = requireFields(req.body, ['id', 'name', 'department']);
    if (missing.length) return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });

    const employee = {
      id: String(req.body.id).trim(),
      name: String(req.body.name).trim(),
      department: String(req.body.department).trim(),
      position: String(req.body.position || '-').trim(),
      email: String(req.body.email || '-').trim(),
      location: String(req.body.location || '-').trim()
    };

    await pool.query(
      `INSERT INTO employees (id, name, department, position, email, location)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [employee.id, employee.name, employee.department, employee.position, employee.email, employee.location]
    );

    res.status(201).json(employee);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Employee ID already exists' });
    next(error);
  }
});

app.put('/api/employees/:id', async (req, res, next) => {
  try {
    const missing = requireFields(req.body, ['name', 'department']);
    if (missing.length) return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });

    const employee = {
      id: req.params.id,
      name: String(req.body.name).trim(),
      department: String(req.body.department).trim(),
      position: String(req.body.position || '-').trim(),
      email: String(req.body.email || '-').trim(),
      location: String(req.body.location || '-').trim()
    };

    const [result] = await pool.query(
      `UPDATE employees
       SET name = ?, department = ?, position = ?, email = ?, location = ?
       WHERE id = ?`,
      [employee.name, employee.department, employee.position, employee.email, employee.location, employee.id]
    );

    if (!result.affectedRows) return res.status(404).json({ error: 'Employee not found' });
    res.json(employee);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/employees/:id', async (req, res, next) => {
  try {
    const [result] = await pool.query('DELETE FROM employees WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Employee not found' });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.get('/api/stock', async (_req, res, next) => {
  try {
    res.json(await getStock());
  } catch (error) {
    next(error);
  }
});

app.post('/api/stock', async (req, res, next) => {
  try {
    const missing = requireFields(req.body, ['sku', 'name']);
    if (missing.length) return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });

    const item = {
      sku: String(req.body.sku).trim(),
      name: String(req.body.name).trim(),
      available: Number(req.body.available ?? 0),
      min: Number(req.body.min ?? 0),
      location: String(req.body.location || '-').trim()
    };

    await pool.query(
      `INSERT INTO stock_items (sku, name, available, min_level, location)
       VALUES (?, ?, ?, ?, ?)`,
      [item.sku, item.name, item.available, item.min, item.location]
    );

    res.status(201).json(item);
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Stock SKU already exists' });
    next(error);
  }
});

app.put('/api/stock/:sku', async (req, res, next) => {
  try {
    const missing = requireFields(req.body, ['name']);
    if (missing.length) return res.status(400).json({ error: `Missing fields: ${missing.join(', ')}` });

    const item = {
      sku: req.params.sku,
      name: String(req.body.name).trim(),
      available: Number(req.body.available ?? 0),
      min: Number(req.body.min ?? 0),
      location: String(req.body.location || '-').trim()
    };

    const [result] = await pool.query(
      `UPDATE stock_items
       SET name = ?, available = ?, min_level = ?, location = ?
       WHERE sku = ?`,
      [item.name, item.available, item.min, item.location, item.sku]
    );

    if (!result.affectedRows) return res.status(404).json({ error: 'Stock item not found' });
    res.json(item);
  } catch (error) {
    next(error);
  }
});

app.delete('/api/stock/:sku', async (req, res, next) => {
  try {
    const [result] = await pool.query('DELETE FROM stock_items WHERE sku = ?', [req.params.sku]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Stock item not found' });
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({ error: `Route not found: ${req.method} ${req.path}` });
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  await connectWithRetry();
  await migrate();
  await seedDatabase();
  app.listen(port, '0.0.0.0', () => {
    console.log(`IT Asset backend listening on port ${port}`);
  });
}

start().catch((error) => {
  console.error('Failed to start backend', error);
  process.exit(1);
});
