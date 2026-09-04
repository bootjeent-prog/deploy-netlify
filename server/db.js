import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || join(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });
export const dbPath = process.env.DB_PATH || join(dataDir, 'factory-assets.sqlite');
export const db = new DatabaseSync(dbPath);
db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');

export function now() {
  return new Date().toISOString();
}

export function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  try {
    const [salt, expectedHex] = String(stored || '').split(':');
    if (!salt || !expectedHex) return false;
    const actual = scryptSync(password, salt, 64);
    const expected = Buffer.from(expectedHex, 'hex');
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS companies (
      company_code TEXT PRIMARY KEY,
      company_name_th TEXT NOT NULL,
      company_name_en TEXT NOT NULL,
      tax_id TEXT DEFAULT '', address TEXT DEFAULT '', phone TEXT DEFAULT '', email TEXT DEFAULT '', logo_url TEXT DEFAULT '',
      status TEXT NOT NULL DEFAULT 'ACTIVE', created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS employees (
      employee_code TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      company_code TEXT NOT NULL,
      department TEXT NOT NULL,
      position TEXT DEFAULT '', email TEXT DEFAULT '', phone TEXT DEFAULT '', line_user_id TEXT DEFAULT '',
      role TEXT NOT NULL DEFAULT 'EMPLOYEE', status TEXT NOT NULL DEFAULT 'ACTIVE', location TEXT DEFAULT '',
      password_hash TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(company_code) REFERENCES companies(company_code)
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY, employee_code TEXT NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL,
      FOREIGN KEY(employee_code) REFERENCES employees(employee_code) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS assets (
      asset_code TEXT PRIMARY KEY,
      company_code TEXT NOT NULL,
      name TEXT NOT NULL, brand TEXT DEFAULT '', model TEXT DEFAULT '', category TEXT NOT NULL, subcategory TEXT DEFAULT '', serial TEXT NOT NULL,
      assigned_to TEXT DEFAULT '', department TEXT DEFAULT '', location TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'ACTIVE',
      purchase_date TEXT DEFAULT '', warranty_until TEXT DEFAULT '', condition_score REAL NOT NULL DEFAULT 100,
      purchase_price REAL NOT NULL DEFAULT 0, useful_life_years REAL NOT NULL DEFAULT 5, salvage_value REAL NOT NULL DEFAULT 0,
      criticality TEXT DEFAULT 'MEDIUM', ownership_type TEXT DEFAULT 'OWNED', vendor TEXT DEFAULT '', manufacturer TEXT DEFAULT '',
      items_json TEXT NOT NULL DEFAULT '[]', repairs_json TEXT NOT NULL DEFAULT '[]', returns_json TEXT NOT NULL DEFAULT '[]',
      qr_printed_at TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(company_code) REFERENCES companies(company_code)
    );

    CREATE TABLE IF NOT EXISTS stock_items (
      sku TEXT PRIMARY KEY, company_code TEXT NOT NULL, name TEXT NOT NULL, category TEXT DEFAULT '', unit TEXT NOT NULL DEFAULT 'pcs',
      warehouse TEXT NOT NULL, available REAL NOT NULL DEFAULT 0, min_level REAL NOT NULL DEFAULT 0, max_level REAL NOT NULL DEFAULT 0,
      location TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'ACTIVE', unit_cost REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(company_code) REFERENCES companies(company_code)
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT, doc_no TEXT UNIQUE NOT NULL, company_code TEXT NOT NULL, movement_type TEXT NOT NULL,
      sku TEXT NOT NULL, quantity REAL NOT NULL, from_warehouse TEXT DEFAULT '', to_warehouse TEXT DEFAULT '', requester TEXT DEFAULT '',
      reference TEXT DEFAULT '', note TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'POSTED', movement_date TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(sku) REFERENCES stock_items(sku), FOREIGN KEY(company_code) REFERENCES companies(company_code)
    );

    CREATE TABLE IF NOT EXISTS transfers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, request_no TEXT UNIQUE NOT NULL, company_code TEXT NOT NULL, asset_id TEXT NOT NULL,
      from_location TEXT DEFAULT '', to_location TEXT NOT NULL, from_department TEXT DEFAULT '', to_department TEXT DEFAULT '',
      from_assignee TEXT DEFAULT '', to_assignee TEXT DEFAULT '', requested_by TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'PENDING',
      approved_by TEXT DEFAULT '', transfer_date TEXT NOT NULL, note TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(asset_id) REFERENCES assets(asset_code), FOREIGN KEY(company_code) REFERENCES companies(company_code)
    );

    CREATE TABLE IF NOT EXISTS borrow_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, request_no TEXT UNIQUE NOT NULL, company_code TEXT NOT NULL, asset_id TEXT NOT NULL,
      borrower TEXT NOT NULL, borrow_date TEXT NOT NULL, due_date TEXT NOT NULL, return_date TEXT DEFAULT '',
      condition_out REAL NOT NULL DEFAULT 100, condition_in REAL, status TEXT NOT NULL DEFAULT 'PENDING', note TEXT DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(asset_id) REFERENCES assets(asset_code), FOREIGN KEY(company_code) REFERENCES companies(company_code)
    );

    CREATE TABLE IF NOT EXISTS maintenance (
      id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_no TEXT UNIQUE NOT NULL, company_code TEXT NOT NULL, asset_id TEXT NOT NULL,
      issue TEXT NOT NULL, technician TEXT DEFAULT '', parts_json TEXT NOT NULL DEFAULT '[]', cost REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'OPEN', opened_date TEXT NOT NULL, closed_date TEXT DEFAULT '', note TEXT DEFAULT '',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(asset_id) REFERENCES assets(asset_code), FOREIGN KEY(company_code) REFERENCES companies(company_code)
    );

    CREATE TABLE IF NOT EXISTS disposals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, request_no TEXT UNIQUE NOT NULL, company_code TEXT NOT NULL, asset_id TEXT NOT NULL,
      reason TEXT NOT NULL, disposal_method TEXT DEFAULT 'SCRAP', estimated_value REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'PENDING', requested_by TEXT NOT NULL, approved_by TEXT DEFAULT '', disposal_date TEXT NOT NULL,
      note TEXT DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
      FOREIGN KEY(asset_id) REFERENCES assets(asset_code), FOREIGN KEY(company_code) REFERENCES companies(company_code)
    );

    CREATE TABLE IF NOT EXISTS approvals (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_code TEXT NOT NULL, request_type TEXT NOT NULL, request_id INTEGER NOT NULL,
      request_no TEXT NOT NULL, requester TEXT NOT NULL, approver TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'PENDING',
      requested_at TEXT NOT NULL, decided_at TEXT DEFAULT '', note TEXT DEFAULT '',
      FOREIGN KEY(company_code) REFERENCES companies(company_code)
    );

    CREATE TABLE IF NOT EXISTS asset_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_code TEXT NOT NULL, asset_id TEXT NOT NULL, event_type TEXT NOT NULL,
      old_value TEXT DEFAULT '', new_value TEXT DEFAULT '', actor TEXT NOT NULL, note TEXT DEFAULT '', created_at TEXT NOT NULL,
      FOREIGN KEY(asset_id) REFERENCES assets(asset_code)
    );

    CREATE TABLE IF NOT EXISTS master_records (
      id INTEGER PRIMARY KEY AUTOINCREMENT, master_type TEXT NOT NULL, code TEXT NOT NULL, name TEXT NOT NULL,
      parent_code TEXT DEFAULT '', company_code TEXT DEFAULT '', status TEXT NOT NULL DEFAULT 'ACTIVE', data_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, UNIQUE(master_type, code)
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, company_code TEXT DEFAULT '', employee_code TEXT DEFAULT '', module TEXT NOT NULL,
      action TEXT NOT NULL, entity_id TEXT DEFAULT '', before_json TEXT DEFAULT '', after_json TEXT DEFAULT '', ip_address TEXT DEFAULT '',
      created_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_assets_company ON assets(company_code);
    CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
    CREATE INDEX IF NOT EXISTS idx_stock_company ON stock_items(company_code);
    CREATE INDEX IF NOT EXISTS idx_approval_status ON approvals(status);
    CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
  `);
  seedDb();
}

function count(table) {
  return Number(db.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c);
}

function seedDb() {
  const ts = now();
  if (!count('companies')) {
    const insert = db.prepare(`INSERT INTO companies(company_code,company_name_th,company_name_en,status,created_at,updated_at) VALUES(?,?,?,?,?,?)`);
    for (const [code, th, en] of [
      ['WELLVENESS', 'เวลล์เวเนส', 'Wellveness'], ['NEJ', 'เอ็นอีเจ ไซเอนซ์', 'NEJ Science'], ['KIO', 'เคไอโอ', 'KIO'], ['EVES', "อีฟส์", 'EVES']
    ]) insert.run(code, th, en, 'ACTIVE', ts, ts);
  }

  if (!count('employees')) {
    const insert = db.prepare(`INSERT INTO employees(employee_code,full_name,company_code,department,position,email,phone,line_user_id,role,status,location,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const users = [
      ['ADMIN-001','ผู้ดูแลระบบ','EVES','Management','Super Admin','admin@company.local','','','SUPER_ADMIN','ACTIVE','สำนักงานใหญ่','admin123'],
      ['COMP-001','ผู้ดูแลบริษัท EVES','EVES','Management','Company Admin','company@company.local','','','COMPANY_ADMIN','ACTIVE','สำนักงานใหญ่','admin123'],
      ['ASSET-001','ผู้จัดการทรัพย์สิน','EVES','IT','Asset Manager','asset@company.local','','','ASSET_MANAGER','ACTIVE','สำนักงานใหญ่','admin123'],
      ['WH-001','เจ้าหน้าที่คลัง','EVES','Warehouse','Warehouse Officer','warehouse@company.local','','','WAREHOUSE','ACTIVE','คลังกลาง','admin123'],
      ['ENG-001','ช่างซ่อมบำรุง','EVES','Engineering','Engineer','engineer@company.local','','','MAINTENANCE','ACTIVE','อาคาร Engineering','admin123'],
      ['HEAD-001','หัวหน้าแผนกบัญชี','EVES','Accounting','Department Head','head@company.local','','','DEPARTMENT_HEAD','ACTIVE','อาคารสำนักงาน','admin123'],
      ['EMP-1001','กมลชนก ศรีวัฒน์','EVES','Accounting','Accounting Manager','kamonchanok@example.com','','','EMPLOYEE','ACTIVE','ชั้น 12 อาคาร A','admin123'],
      ['EMP-1002','วรุตม์ ภักดี','KIO','Product','Product Manager','warut@example.com','','','EMPLOYEE','ACTIVE','ชั้น 9 อาคาร B','admin123'],
      ['EMP-1003','พรทิพย์ ใจดี','NEJ','Sales','Sales Executive','porntip@example.com','','','EMPLOYEE','ACTIVE','สาขาเชียงใหม่','admin123'],
      ['EMP-IT-STOCK','คลังกลาง','WELLVENESS','IT','IT Stock','it-stock@example.com','','','WAREHOUSE','ACTIVE','คลัง IT ชั้น 4','admin123']
    ];
    for (const row of users) insert.run(...row.slice(0,11), hashPassword(row[11]), ts, ts);
  }

  if (!count('assets')) {
    const insert = db.prepare(`INSERT INTO assets(asset_code,company_code,name,brand,model,category,subcategory,serial,assigned_to,department,location,status,purchase_date,warranty_until,condition_score,purchase_price,useful_life_years,salvage_value,criticality,ownership_type,vendor,manufacturer,items_json,repairs_json,returns_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    const assets = [
      ['IT-NTB-00042','EVES','Lenovo ThinkPad X1 Carbon Gen 11','Lenovo','X1 Carbon Gen 11','IT','Notebook','PF4Z9A21','กมลชนก ศรีวัฒน์','Accounting','ชั้น 12 อาคาร A','ACTIVE','2024-03-18','2027-03-17',92,68500,4,5000,'MEDIUM','OWNED','IT Supplier','Lenovo',[],[{date:'2025-08-14',detail:'เปลี่ยนแบตเตอรี่',cost:4200,technician:'ทีม Service Desk'}],[]],
      ['IT-MON-00109','KIO','Dell UltraSharp U2723QE','Dell','U2723QE','IT','Monitor','CN0D7K92','วรุตม์ ภักดี','Product','ชั้น 9 อาคาร B','ACTIVE','2023-11-02','2026-11-01',88,24500,5,2000,'LOW','OWNED','IT Supplier','Dell',[],[],[]],
      ['IT-MOB-00031','NEJ','iPhone 15 Pro','Apple','15 Pro','IT','Mobile Device','F2L92THQ0','พรทิพย์ ใจดี','Sales','สาขาเชียงใหม่','IN_REPAIR','2024-09-24','2026-09-23',67,41900,4,4000,'MEDIUM','OWNED','Mobile Supplier','Apple',[],[{date:'2026-05-18',detail:'หน้าจอแตก รออะไหล่',cost:9800,technician:'Apple Authorized'}],[]],
      ['IT-NTB-00058','WELLVENESS','MacBook Air M3 13"','Apple','MacBook Air M3','IT','Notebook','C02YY771Q6L4','คลังกลาง','IT','คลัง IT ชั้น 4','IN_STOCK','2025-01-15','2028-01-14',100,45900,4,5000,'MEDIUM','OWNED','IT Supplier','Apple',[],[],[]],
      ['MC-MIX-00001','NEJ','เครื่องผสมผลิตภัณฑ์ 500L','FactoryTech','MX-500','MACHINE','Mixer','MIX500-001','ฝ่ายผลิต','Production','อาคารผลิต/ชั้น 1/ห้องผสม','ACTIVE','2022-06-01','2027-05-31',81,1250000,10,100000,'CRITICAL','OWNED','Factory Supplier','FactoryTech',[{name:'Motor 5HP',quantity:1,required:true}],[],[]]
    ];
    for (const a of assets) insert.run(...a.slice(0,22), JSON.stringify(a[22]), JSON.stringify(a[23]), JSON.stringify(a[24]), ts, ts);
  }

  if (!count('stock_items')) {
    const insert = db.prepare(`INSERT INTO stock_items(sku,company_code,name,category,unit,warehouse,available,min_level,max_level,location,status,unit_cost,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const r of [
      ['ACC-HUB-08','EVES','USB-C Hub 8-in-1','IT Stock','pcs','IT-STOCK',4,8,30,'คลัง IT ชั้น 4','ACTIVE',1250],
      ['ACC-MOU-3S','EVES','Logitech MX Master 3S','IT Stock','pcs','IT-STOCK',13,10,40,'คลัง IT ชั้น 4','ACTIVE',3290],
      ['SP-RAM-D5-16','EVES','RAM DDR5 16GB','Spare Part','pcs','ENG-STORE',3,6,20,'ห้องซ่อม','ACTIVE',2100],
      ['CB-HDMI-02','KIO','สาย HDMI 2m','Consumable','pcs','IT-STOCK',28,12,60,'คลัง IT ชั้น 4','ACTIVE',180],
      ['SP-MOTOR-5HP','NEJ','Motor 5HP','Spare Part','pcs','ENG-STORE',2,1,6,'คลังอะไหล่','ACTIVE',18500]
    ]) insert.run(...r, ts, ts);
  }

  if (!count('master_records')) seedMasters(ts);
}

function seedMasters(ts) {
  const insert = db.prepare(`INSERT OR IGNORE INTO master_records(master_type,code,name,parent_code,company_code,status,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`);
  const rows = [];
  for (const c of ['WELLVENESS','NEJ','KIO','EVES']) rows.push(['brand',c,c,'',c,'ACTIVE',{}]);
  for (const [code,name,company] of [['EVES-OFFICE-01','สำนักงานใหญ่','EVES'],['NEJ-FACTORY-01','โรงงาน NEJ','NEJ'],['KIO-WAREHOUSE-01','คลัง KIO','KIO'],['WELLVENESS-OFFICE-01','สำนักงาน Wellveness','WELLVENESS']]) rows.push(['site',code,name,'',company,'ACTIVE',{}]);
  for (const [code,name] of [['PROD','อาคารผลิต'],['WH','อาคารคลังสินค้า'],['OFFICE','อาคารสำนักงาน'],['LAB','อาคาร Lab'],['QC','อาคาร QC'],['ENG','อาคาร Engineering']]) rows.push(['building',code,name,'','','ACTIVE',{}]);
  for (const [code,name] of [['F1','ชั้น 1'],['F2','ชั้น 2'],['MEZZ','Mezzanine'],['ROOF','Rooftop']]) rows.push(['floor',code,name,'','','ACTIVE',{}]);
  for (const [code,name] of [['PRODUCTION','Production'],['WAREHOUSE','Warehouse'],['PACKING','Packing'],['QC','QC'],['QA','QA'],['OFFICE','Office'],['ENGINEERING','Engineering'],['CLEANROOM','Clean Room']]) rows.push(['zone',code,name,'','','ACTIVE',{}]);
  for (const [code,name] of [['MIX','ห้องผสม'],['PACK','ห้องบรรจุ'],['WEIGH','ห้องชั่ง'],['SERVER','ห้อง Server'],['SPARE','ห้องเก็บอะไหล่']]) rows.push(['room',code,name,'','','ACTIVE',{}]);
  for (const [code,name] of [['IT','IT'],['HR','HR'],['QA','QA'],['QC','QC'],['RD','R&D'],['PROD','Production'],['ENG','Engineering'],['WH','Warehouse'],['ACC','Accounting'],['PUR','Purchasing'],['ADMIN','Admin'],['SALES','Sales'],['MKT','Marketing'],['MGT','Management']]) rows.push(['department',code,name,'','EVES','ACTIVE',{}]);
  for (const [code,name] of [['MACHINE','เครื่องจักร'],['IT','อุปกรณ์ IT'],['OFFICE','อุปกรณ์สำนักงาน'],['FURNITURE','เฟอร์นิเจอร์'],['TOOL','เครื่องมือ'],['VEHICLE','ยานพาหนะ'],['LAB','อุปกรณ์ Lab'],['QC','อุปกรณ์ QC'],['UTILITY','ระบบ Utility'],['SECURITY','ระบบรักษาความปลอดภัย'],['BUILDING','อาคาร/โครงสร้าง'],['PRODUCTION_LINE','ไลน์ผลิต'],['CLEANROOM','อุปกรณ์ Clean Room'],['WAREHOUSE_EQUIP','อุปกรณ์คลังสินค้า']]) rows.push(['asset-category',code,name,'','','ACTIVE',{}]);
  for (const [code,name,parent] of [['MIXER','Mixer','MACHINE'],['FILLING','Filling Machine','MACHINE'],['PACKING_MACHINE','Packing Machine','MACHINE'],['NOTEBOOK','Notebook','IT'],['DESKTOP','Desktop','IT'],['MONITOR','Monitor','IT'],['PRINTER','Printer','IT'],['SERVER','Server','IT'],['BALANCE','Balance','LAB'],['PH_METER','pH Meter','LAB']]) rows.push(['asset-subcategory',code,name,parent,'','ACTIVE',{}]);
  for (const [code,name] of [['ACTIVE','ใช้งานอยู่'],['INACTIVE','ไม่ได้ใช้งาน'],['IN_REPAIR','กำลังซ่อม'],['BROKEN','เสีย'],['LOST','สูญหาย'],['TRANSFERRED','โอนย้ายแล้ว'],['RESERVED','จองใช้งาน'],['BORROWED','ถูกยืม'],['RETURNED','คืนแล้ว'],['SCRAPPED','รอทำลาย'],['DISPOSED','ตัดจำหน่ายแล้ว'],['SOLD','ขายแล้ว'],['IN_STOCK','อยู่ในสต็อก']]) rows.push(['asset-status',code,name,'','','ACTIVE',{}]);
  for (const [code,name] of [['NEW','ใหม่'],['GOOD','ดี'],['NORMAL','ใช้งานได้ปกติ'],['NEED_REPAIR','ต้องซ่อม'],['DAMAGED','ชำรุด'],['UNSAFE','ไม่ปลอดภัย'],['END_OF_LIFE','หมดอายุการใช้งาน']]) rows.push(['asset-condition',code,name,'','','ACTIVE',{}]);
  for (const [code,name] of [['LOW','ต่ำ'],['MEDIUM','กลาง'],['HIGH','สูง'],['CRITICAL','สำคัญมาก / หยุดไลน์ผลิตได้']]) rows.push(['criticality',code,name,'','','ACTIVE',{}]);
  for (const [code,name] of [['OWNED','บริษัทเป็นเจ้าของ'],['LEASED','เช่า'],['RENTED','เช่ารายเดือน'],['BORROWED','ยืม'],['CUSTOMER_OWNED','ลูกค้าเป็นเจ้าของ'],['CONSIGNMENT','ฝากใช้']]) rows.push(['ownership-type',code,name,'','','ACTIVE',{}]);
  for (const u of ['pcs','set','box','roll','kg','g','liter','ml','meter','pack','pair','lot']) rows.push(['unit',u.toUpperCase(),u,'','','ACTIVE',{}]);
  for (const [code,name,type,company] of [['IT-STOCK','คลังอุปกรณ์ IT','IT Stock','EVES'],['ENG-STORE','คลังอะไหล่ Engineering','Engineering Store','NEJ'],['OFFICE-SUP','คลังอุปกรณ์สำนักงาน','Office Supply','KIO']]) rows.push(['warehouse',code,name,'',company,'ACTIVE',{warehouse_type:type}]);
  for (const [code,name] of [['VEND-001','IT Supplier'],['VEND-002','Factory Supplier'],['VEND-003','Mobile Supplier']]) rows.push(['vendor',code,name,'','','ACTIVE',{}]);
  for (const [code,name] of [['LENOVO','Lenovo'],['DELL','Dell'],['APPLE','Apple'],['FACTORYTECH','FactoryTech']]) rows.push(['manufacturer',code,name,'','','ACTIVE',{}]);
  for (const [code,name] of [['CC-IT','ศูนย์ต้นทุน IT'],['CC-ENG','ศูนย์ต้นทุน Engineering'],['CC-PROD','ศูนย์ต้นทุน Production']]) rows.push(['cost-center',code,name,'','EVES','ACTIVE',{}]);
  for (const r of rows) insert.run(r[0],r[1],r[2],r[3],r[4],r[5],JSON.stringify(r[6]),ts,ts);
}

export function parseJson(value, fallback = []) {
  try { return JSON.parse(value || ''); } catch { return fallback; }
}

export function audit({ user, module, action, entityId = '', before = null, after = null, ip = '' }) {
  db.prepare(`INSERT INTO audit_logs(company_code,employee_code,module,action,entity_id,before_json,after_json,ip_address,created_at) VALUES(?,?,?,?,?,?,?,?,?)`)
    .run(user?.company_code || '', user?.employee_code || '', module, action, String(entityId || ''), before ? JSON.stringify(before) : '', after ? JSON.stringify(after) : '', ip, now());
}

initDb();
