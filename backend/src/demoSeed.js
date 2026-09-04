const companyCode = 'EVES';

function isoDate(offsetDays = 0) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function isoYearOffset(years, offsetDays = 0) {
  const date = new Date();
  date.setUTCFullYear(date.getUTCFullYear() + years);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function demoSvg(title, subtitle, accent = '#2563eb') {
  const safeTitle = String(title).replace(/[<>&"]/g, '');
  const safeSubtitle = String(subtitle).replace(/[<>&"]/g, '');
  return Buffer.from(`
    <svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560">
      <rect width="900" height="560" rx="42" fill="#eef4ff"/>
      <rect x="52" y="52" width="796" height="456" rx="32" fill="#ffffff" stroke="#cbd5e1" stroke-width="4"/>
      <rect x="94" y="104" width="230" height="230" rx="28" fill="${accent}" opacity="0.12"/>
      <rect x="128" y="145" width="162" height="112" rx="12" fill="none" stroke="${accent}" stroke-width="14"/>
      <path d="M112 282h194l28 36H84z" fill="${accent}"/>
      <circle cx="209" cy="305" r="8" fill="#ffffff"/>
      <text x="380" y="205" font-family="Arial, sans-serif" font-size="42" font-weight="700" fill="#0f172a">${safeTitle}</text>
      <text x="380" y="264" font-family="Arial, sans-serif" font-size="27" fill="#475569">${safeSubtitle}</text>
      <rect x="380" y="310" width="220" height="12" rx="6" fill="${accent}" opacity="0.75"/>
      <rect x="380" y="342" width="330" height="10" rx="5" fill="#cbd5e1"/>
      <rect x="380" y="372" width="270" height="10" rx="5" fill="#e2e8f0"/>
      <text x="94" y="455" font-family="Arial, sans-serif" font-size="22" fill="#64748b">DEMO DATA • IT ASSET &amp; INVENTORY</text>
    </svg>
  `, 'utf8');
}

async function rowId(connection, table, field, value) {
  const [rows] = await connection.query(`SELECT id FROM ${table} WHERE ${field} = ? LIMIT 1`, [value]);
  return Number(rows[0]?.id || 0);
}

async function ensureApproval(connection, record) {
  const [rows] = await connection.query(
    'SELECT id FROM approvals WHERE request_type = ? AND request_no = ? LIMIT 1',
    [record.requestType, record.requestNo]
  );
  if (rows[0]) return Number(rows[0].id);
  const [result] = await connection.query(
    `INSERT INTO approvals (
      company_code, request_type, request_id, request_no, requester,
      requester_employee_code, approver, status, requested_at, decided_at, note
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      companyCode,
      record.requestType,
      record.requestId,
      record.requestNo,
      record.requester,
      record.requesterEmployeeCode,
      record.approver || '',
      record.status,
      record.requestedAt,
      record.decidedAt || null,
      record.note || ''
    ]
  );
  return Number(result.insertId);
}

async function ensureAssetEvent(connection, record) {
  await connection.query(
    `INSERT INTO asset_events (
      company_code, asset_id, event_type, old_value, new_value, actor, note, created_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM asset_events WHERE asset_id = ? AND event_type = ? AND note = ?
    )`,
    [
      companyCode,
      record.assetId,
      record.eventType,
      record.oldValue || '',
      record.newValue || '',
      record.actor,
      record.note,
      record.createdAt,
      record.assetId,
      record.eventType,
      record.note
    ]
  );
}

async function ensureAudit(connection, record) {
  await connection.query(
    `INSERT INTO audit_logs (
      company_code, employee_code, module, action, entity_id,
      before_json, after_json, ip_address, created_at
    )
    SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM audit_logs WHERE module = ? AND action = ? AND entity_id = ?
    )`,
    [
      companyCode,
      record.employeeCode,
      record.module,
      record.action,
      record.entityId,
      record.beforeJson || '{}',
      record.afterJson || '{}',
      '127.0.0.1',
      record.createdAt,
      record.module,
      record.action,
      record.entityId
    ]
  );
}

export async function seedDemoData({ pool, hashPassword, defaultPassword }) {
  const connection = await pool.getConnection();
  const passwordHash = hashPassword(defaultPassword);

  try {
    await connection.beginTransaction();

    const companies = [
      ['EVES', 'บริษัท อีฟส์ เอ็นเตอร์ไพรส์ จำกัด', 'EVES Enterprise Co., Ltd.', '0105566123456', '88/8 ถนนรัชดาภิเษก แขวงดินแดง เขตดินแดง กรุงเทพมหานคร 10400', '02-123-4567', 'contact@eves.example'],
      ['KIO', 'บริษัท เคไอโอ เทคโนโลยี จำกัด', 'KIO Technology Co., Ltd.', '0105566234567', '99/9 ถนนสุขุมวิท แขวงบางนา เขตบางนา กรุงเทพมหานคร 10260', '02-234-5678', 'contact@kio.example'],
      ['NEJ', 'บริษัท เอ็นอีเจ ไซเอนซ์ จำกัด', 'NEJ Science Co., Ltd.', '0105566345678', '55/5 ถนนพหลโยธิน แขวงจตุจักร เขตจตุจักร กรุงเทพมหานคร 10900', '02-345-6789', 'contact@nej.example'],
      ['WELLVENESS', 'บริษัท เวลล์เวเนส จำกัด', 'WELLVENESS Co., Ltd.', '0105566456789', '77/7 ถนนพระราม 9 แขวงห้วยขวาง เขตห้วยขวาง กรุงเทพมหานคร 10310', '02-456-7890', 'contact@wellveness.example']
    ];

    for (const company of companies) {
      await connection.query(
        `INSERT IGNORE INTO companies (
          company_code, company_name_th, company_name_en, tax_id, address,
          phone, email, logo_url, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, '', 'ACTIVE', CURRENT_TIMESTAMP)`,
        company
      );
      await connection.query(
        `UPDATE companies SET
          company_name_th = CASE WHEN company_name_th = '' THEN ? ELSE company_name_th END,
          company_name_en = CASE WHEN company_name_en = '' OR company_name_en = company_code THEN ? ELSE company_name_en END,
          tax_id = CASE WHEN tax_id = '' THEN ? ELSE tax_id END,
          address = CASE WHEN address = '' THEN ? ELSE address END,
          phone = CASE WHEN phone = '' THEN ? ELSE phone END,
          email = CASE WHEN email = '' THEN ? ELSE email END,
          updated_at = CURRENT_TIMESTAMP
        WHERE company_code = ?`,
        [company[1], company[2], company[3], company[4], company[5], company[6], company[0]]
      );
    }

    const masters = [
      ['brand', 'DELL', 'Dell', '', { country: 'USA', website: 'https://www.dell.com' }],
      ['brand', 'LENOVO', 'Lenovo', '', { country: 'China', website: 'https://www.lenovo.com' }],
      ['brand', 'HP', 'HP', '', { country: 'USA', website: 'https://www.hp.com' }],
      ['brand', 'APPLE', 'Apple', '', { country: 'USA', website: 'https://www.apple.com' }],
      ['brand', 'EPSON', 'Epson', '', { country: 'Japan', website: 'https://www.epson.com' }],
      ['brand', 'CANON', 'Canon', '', { country: 'Japan', website: 'https://www.canon.com' }],
      ['brand', 'CISCO', 'Cisco', '', { country: 'USA', website: 'https://www.cisco.com' }],
      ['brand', 'APC', 'APC', '', { country: 'USA', website: 'https://www.apc.com' }],

      ['department', 'IT', 'เทคโนโลยีสารสนเทศ', '', { managerName: 'คุณกิตติพงศ์ แซ่ลิ้ม', description: 'ดูแลระบบสารสนเทศและทรัพย์สิน IT' }],
      ['department', 'HR', 'ทรัพยากรบุคคล', '', { managerName: 'คุณพิมพ์ชนก ศรีสุข', description: 'ดูแลข้อมูลพนักงานและงานบุคคล' }],
      ['department', 'FIN', 'การเงิน', '', { managerName: 'คุณธนกฤต วัฒนกิจ', description: 'ดูแลการเงินและงบประมาณ' }],
      ['department', 'ACC', 'บัญชี', '', { managerName: 'คุณอรทัย บุญช่วย', description: 'ดูแลบัญชีและทะเบียนสินทรัพย์' }],
      ['department', 'SALES', 'ฝ่ายขาย', '', { managerName: 'คุณภูริณัฐ เจริญทรัพย์', description: 'ดูแลงานขายและลูกค้า' }],
      ['department', 'OPS', 'ปฏิบัติการ', '', { managerName: 'คุณณัฐชา พูนผล', description: 'ดูแลงานปฏิบัติการประจำวัน' }],
      ['department', 'WH', 'คลังสินค้า', '', { managerName: 'คุณชลธิชา สุขเกษม', description: 'ดูแลคลังและการเบิกจ่าย' }],
      ['department', 'MNT', 'ซ่อมบำรุง', '', { managerName: 'คุณศุภชัย คำดี', description: 'ดูแลการซ่อมและบำรุงรักษา' }],

      ['cost-center', 'CC-IT-001', 'ศูนย์ต้นทุนฝ่าย IT', 'IT', { budgetOwner: 'คุณกิตติพงศ์ แซ่ลิ้ม', description: 'งบประมาณระบบและอุปกรณ์ IT' }],
      ['cost-center', 'CC-HR-001', 'ศูนย์ต้นทุนฝ่าย HR', 'HR', { budgetOwner: 'คุณพิมพ์ชนก ศรีสุข', description: 'งบประมาณงานบุคคล' }],
      ['cost-center', 'CC-ACC-001', 'ศูนย์ต้นทุนฝ่ายบัญชี', 'ACC', { budgetOwner: 'คุณอรทัย บุญช่วย', description: 'งบประมาณฝ่ายบัญชี' }],
      ['cost-center', 'CC-OPS-001', 'ศูนย์ต้นทุนฝ่ายปฏิบัติการ', 'OPS', { budgetOwner: 'คุณณัฐชา พูนผล', description: 'งบประมาณงานปฏิบัติการ' }],

      ['site', 'HQ-BKK', 'สำนักงานใหญ่ กรุงเทพฯ', '', { address: '88/8 ถนนรัชดาภิเษก เขตดินแดง กรุงเทพมหานคร', province: 'กรุงเทพมหานคร', country: 'Thailand', latitude: 13.7693, longitude: 100.5732 }],
      ['site', 'FACTORY-AY', 'โรงงานพระนครศรีอยุธยา', '', { address: 'นิคมอุตสาหกรรมโรจนะ จังหวัดพระนครศรีอยุธยา', province: 'พระนครศรีอยุธยา', country: 'Thailand', latitude: 14.3377, longitude: 100.6128 }],
      ['building', 'HQ-A', 'อาคารสำนักงานใหญ่ A', 'HQ-BKK', { address: 'อาคาร A', description: 'อาคารสำนักงานหลัก' }],
      ['building', 'PLANT-1', 'อาคารโรงงาน 1', 'FACTORY-AY', { address: 'อาคารผลิต 1', description: 'พื้นที่ผลิตและคลังซ่อมบำรุง' }],
      ['floor', 'HQ-A-F1', 'ชั้น 1', 'HQ-A', { description: 'ประชาสัมพันธ์ HR และคลัง IT' }],
      ['floor', 'HQ-A-F2', 'ชั้น 2', 'HQ-A', { description: 'การเงิน บัญชี และฝ่ายขาย' }],
      ['floor', 'HQ-A-F3', 'ชั้น 3', 'HQ-A', { description: 'ฝ่าย IT และห้อง Server' }],
      ['floor', 'PLANT1-F1', 'ชั้น 1 โรงงาน', 'PLANT-1', { description: 'พื้นที่ซ่อมบำรุงและคลังอะไหล่' }],
      ['zone', 'HQ-F1-OFFICE', 'สำนักงานชั้น 1', 'HQ-A-F1', { description: 'พื้นที่สำนักงาน HR' }],
      ['zone', 'HQ-F2-OFFICE', 'สำนักงานชั้น 2', 'HQ-A-F2', { description: 'พื้นที่การเงิน บัญชี ฝ่ายขาย' }],
      ['zone', 'HQ-F3-IT', 'พื้นที่ IT ชั้น 3', 'HQ-A-F3', { description: 'สำนักงาน IT และ Data Center' }],
      ['zone', 'PLANT-MNT', 'พื้นที่ซ่อมบำรุง', 'PLANT1-F1', { description: 'พื้นที่ช่างและคลังอะไหล่' }],
      ['room', 'HR-OFFICE', 'ห้องฝ่ายบุคคล', 'HQ-F1-OFFICE', { capacity: 20, description: 'พื้นที่ทำงานฝ่าย HR' }],
      ['room', 'IT-STOCK', 'คลังอุปกรณ์ IT', 'HQ-F1-OFFICE', { capacity: 500, description: 'คลังเก็บอุปกรณ์ IT พร้อมจ่าย' }],
      ['room', 'FIN-OFFICE', 'ห้องฝ่ายการเงิน', 'HQ-F2-OFFICE', { capacity: 18, description: 'พื้นที่ฝ่ายการเงิน' }],
      ['room', 'ACC-OFFICE', 'ห้องฝ่ายบัญชี', 'HQ-F2-OFFICE', { capacity: 22, description: 'พื้นที่ฝ่ายบัญชี' }],
      ['room', 'SALES-OFFICE', 'ห้องฝ่ายขาย', 'HQ-F2-OFFICE', { capacity: 30, description: 'พื้นที่ฝ่ายขาย' }],
      ['room', 'IT-OFFICE', 'ห้องฝ่าย IT', 'HQ-F3-IT', { capacity: 24, description: 'พื้นที่ทำงานฝ่าย IT' }],
      ['room', 'SERVER-ROOM', 'ห้อง Server', 'HQ-F3-IT', { capacity: 12, description: 'Data Center ควบคุมการเข้าออก' }],
      ['room', 'MNT-WORKSHOP', 'ห้องช่างซ่อมบำรุง', 'PLANT-MNT', { capacity: 40, description: 'พื้นที่ซ่อมและทดสอบอุปกรณ์' }],

      ['asset-category', 'COMPUTER', 'คอมพิวเตอร์', '', { description: 'Notebook Desktop Server และ Tablet' }],
      ['asset-category', 'NETWORK', 'อุปกรณ์เครือข่าย', '', { description: 'Switch Router Access Point และ Firewall' }],
      ['asset-category', 'PRINTER', 'เครื่องพิมพ์และสแกนเนอร์', '', { description: 'Printer Scanner และ Multifunction' }],
      ['asset-category', 'POWER', 'ระบบไฟฟ้าสำรอง', '', { description: 'UPS และอุปกรณ์จ่ายไฟ' }],
      ['asset-category', 'MOBILE', 'อุปกรณ์พกพา', '', { description: 'Smartphone และ Tablet' }],
      ['asset-category', 'OFFICE', 'อุปกรณ์สำนักงาน', '', { description: 'จอภาพ โทรศัพท์ และอุปกรณ์สำนักงาน' }],
      ['asset-subcategory', 'NOTEBOOK', 'Notebook', 'COMPUTER', { description: 'คอมพิวเตอร์แบบพกพา' }],
      ['asset-subcategory', 'DESKTOP', 'Desktop PC', 'COMPUTER', { description: 'คอมพิวเตอร์ตั้งโต๊ะ' }],
      ['asset-subcategory', 'SERVER', 'Server', 'COMPUTER', { description: 'เครื่องแม่ข่าย' }],
      ['asset-subcategory', 'TABLET', 'Tablet', 'MOBILE', { description: 'แท็บเล็ตสำหรับงานภาคสนาม' }],
      ['asset-subcategory', 'SWITCH', 'Network Switch', 'NETWORK', { description: 'สวิตช์เครือข่าย' }],
      ['asset-subcategory', 'LASER-PRINTER', 'Laser Printer', 'PRINTER', { description: 'เครื่องพิมพ์เลเซอร์' }],
      ['asset-subcategory', 'INKJET-MFP', 'Inkjet Multifunction', 'PRINTER', { description: 'เครื่องพิมพ์มัลติฟังก์ชันอิงค์เจ็ต' }],
      ['asset-subcategory', 'UPS', 'UPS', 'POWER', { description: 'เครื่องสำรองไฟ' }],
      ['asset-subcategory', 'MONITOR', 'Monitor', 'OFFICE', { description: 'จอภาพคอมพิวเตอร์' }],

      ['asset-status', 'ACTIVE', 'ใช้งานอยู่', '', { colorCode: '#16a34a', description: 'อยู่ระหว่างใช้งานตามปกติ' }],
      ['asset-status', 'IN_STOCK', 'อยู่ในคลัง', '', { colorCode: '#2563eb', description: 'พร้อมจัดสรรหรือเบิกใช้งาน' }],
      ['asset-status', 'BORROWED', 'ถูกยืม', '', { colorCode: '#7c3aed', description: 'อยู่ระหว่างการยืม' }],
      ['asset-status', 'IN_REPAIR', 'กำลังซ่อม', '', { colorCode: '#f59e0b', description: 'อยู่ระหว่างการซ่อมบำรุง' }],
      ['asset-status', 'RESERVED', 'ถูกจอง', '', { colorCode: '#0891b2', description: 'จองไว้สำหรับคำขอจัดสรร' }],
      ['asset-status', 'DISPOSED', 'ตัดจำหน่ายแล้ว', '', { colorCode: '#64748b', description: 'ยุติการใช้งานและตัดจำหน่ายแล้ว' }],
      ['asset-status', 'SOLD', 'ขายแล้ว', '', { colorCode: '#475569', description: 'ขายออกจากทะเบียนแล้ว' }],
      ['asset-condition', 'NEW', 'ใหม่', '', { minPercent: 95, maxPercent: 100, description: 'สภาพใหม่หรือใกล้เคียงของใหม่' }],
      ['asset-condition', 'GOOD', 'ดี', '', { minPercent: 80, maxPercent: 94, description: 'ใช้งานได้ดี มีร่องรอยเล็กน้อย' }],
      ['asset-condition', 'FAIR', 'พอใช้', '', { minPercent: 60, maxPercent: 79, description: 'ใช้งานได้แต่ควรเฝ้าระวัง' }],
      ['asset-condition', 'POOR', 'ควรซ่อมหรือจำหน่าย', '', { minPercent: 0, maxPercent: 59, description: 'สภาพเสื่อม ต้องซ่อมหรือพิจารณาจำหน่าย' }],
      ['criticality', 'LOW', 'ต่ำ', '', { responseHours: 72, description: 'ไม่กระทบงานหลัก' }],
      ['criticality', 'MEDIUM', 'ปานกลาง', '', { responseHours: 24, description: 'กระทบผู้ใช้งานบางส่วน' }],
      ['criticality', 'HIGH', 'สูง', '', { responseHours: 8, description: 'กระทบหน่วยงานสำคัญ' }],
      ['criticality', 'CRITICAL', 'วิกฤต', '', { responseHours: 2, description: 'กระทบระบบหลักหรือการดำเนินธุรกิจ' }],
      ['ownership-type', 'OWNED', 'บริษัทเป็นเจ้าของ', '', { description: 'ซื้อและถือครองโดยบริษัท' }],
      ['ownership-type', 'LEASED', 'เช่าใช้งาน', '', { description: 'เช่าหรือสัญญาบริการรายเดือน' }],
      ['ownership-type', 'BORROWED', 'ยืมจากภายนอก', '', { description: 'รับยืมจากคู่ค้าหรือบริษัทในเครือ' }],

      ['vendor', 'VEND-ITCITY', 'บริษัท ไอที ซิตี้ จำกัด', '', { taxId: '0105539089990', contactName: 'คุณอนันต์ ฝ่ายขายองค์กร', phone: '02-999-1111', email: 'corporate@itcity.example', address: 'กรุงเทพมหานคร', paymentTerms: 'เครดิต 30 วัน' }],
      ['vendor', 'VEND-SYNNEX', 'บริษัท ซินเน็ค (ประเทศไทย) จำกัด', '', { taxId: '0107537001234', contactName: 'คุณศิริพร ฝ่ายขาย', phone: '02-553-8899', email: 'sales@synnex.example', address: 'กรุงเทพมหานคร', paymentTerms: 'เครดิต 45 วัน' }],
      ['vendor', 'VEND-OFFICE', 'บริษัท ออฟฟิศ โซลูชัน จำกัด', '', { taxId: '0105566778899', contactName: 'คุณวรัญญา', phone: '02-888-7788', email: 'sales@office-solution.example', address: 'นนทบุรี', paymentTerms: 'เครดิต 30 วัน' }],
      ['manufacturer', 'MFG-DELL', 'Dell Technologies', '', { country: 'USA', contactName: 'Dell Support', phone: '1800-006-007', website: 'https://www.dell.com/support' }],
      ['manufacturer', 'MFG-LENOVO', 'Lenovo', '', { country: 'China', contactName: 'Lenovo Support', phone: '1800-012-220', website: 'https://support.lenovo.com' }],
      ['manufacturer', 'MFG-EPSON', 'Seiko Epson Corporation', '', { country: 'Japan', contactName: 'Epson Service', phone: '02-685-9899', website: 'https://www.epson.co.th' }],
      ['manufacturer', 'MFG-CISCO', 'Cisco Systems', '', { country: 'USA', contactName: 'Cisco TAC', phone: '001-800-852-3149', website: 'https://www.cisco.com' }],
      ['unit', 'PCS', 'ชิ้น', '', { symbol: 'pcs', decimalAllowed: 'NO' }],
      ['unit', 'SET', 'ชุด', '', { symbol: 'set', decimalAllowed: 'NO' }],
      ['unit', 'BOX', 'กล่อง', '', { symbol: 'box', decimalAllowed: 'NO' }],
      ['unit', 'M', 'เมตร', '', { symbol: 'm', decimalAllowed: 'YES' }],
      ['warehouse', 'MAIN-WH', 'คลังกลางสำนักงานใหญ่', 'HQ-BKK', { warehouseType: 'MAIN', managerName: 'เจ้าหน้าที่คลัง', address: 'อาคาร A ชั้น 1' }],
      ['warehouse', 'IT-WH', 'คลังอุปกรณ์ IT', 'HQ-BKK', { warehouseType: 'SUB', managerName: 'ผู้จัดการทรัพย์สิน', address: 'ห้อง IT-STOCK อาคาร A ชั้น 1' }],
      ['warehouse', 'MNT-WH', 'คลังอะไหล่ซ่อมบำรุง', 'FACTORY-AY', { warehouseType: 'MAINTENANCE', managerName: 'ช่างซ่อมบำรุง', address: 'ห้อง MNT-WORKSHOP โรงงาน 1' }]
    ];

    for (const [masterType, code, name, parentCode, data] of masters) {
      await connection.query(
        `INSERT IGNORE INTO master_records (
          master_type, code, name, parent_code, company_code,
          status, data_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, 'ACTIVE', ?, CURRENT_TIMESTAMP)`,
        [masterType, code, name, parentCode, companyCode, JSON.stringify(data)]
      );
    }

    const employees = [
      ['EMP-DEMO-001', 'พิมพ์ชนก ศรีสุข', 'HR', 'HR Specialist', 'HR-OFFICE', 'pimchanok.s@eves.example', '081-111-1001', 'HR'],
      ['EMP-DEMO-002', 'ธนกฤต วัฒนกิจ', 'FIN', 'Finance Officer', 'FIN-OFFICE', 'thanakrit.w@eves.example', '081-111-1002', 'ACCOUNTING'],
      ['EMP-DEMO-003', 'กิตติพงศ์ แซ่ลิ้ม', 'IT', 'IT Support', 'IT-OFFICE', 'kittipong.s@eves.example', '081-111-1003', 'SUPERVISOR'],
      ['EMP-DEMO-004', 'อรทัย บุญช่วย', 'ACC', 'Senior Accountant', 'ACC-OFFICE', 'orathai.b@eves.example', '081-111-1004', 'ACCOUNTING'],
      ['EMP-DEMO-005', 'ภูริณัฐ เจริญทรัพย์', 'SALES', 'Sales Executive', 'SALES-OFFICE', 'phurinat.j@eves.example', '081-111-1005', 'VIEW'],
      ['EMP-DEMO-006', 'ณัฐชา พูนผล', 'OPS', 'Operations Coordinator', 'HQ-A-F1', 'natcha.p@eves.example', '081-111-1006', 'VIEW'],
      ['EMP-DEMO-007', 'ศุภชัย คำดี', 'MNT', 'Maintenance Technician', 'MNT-WORKSHOP', 'supachai.k@eves.example', '081-111-1007', 'SUPERVISOR'],
      ['EMP-DEMO-008', 'ชลธิชา สุขเกษม', 'WH', 'Warehouse Officer', 'MAIN-WH', 'chonticha.s@eves.example', '081-111-1008', 'SUPERVISOR'],
      ['EMP-DEMO-009', 'ศิริพร ตั้งมั่น', 'SALES', 'Sales Manager', 'SALES-OFFICE', 'siriporn.t@eves.example', '081-111-1009', 'SUPERVISOR'],
      ['EMP-DEMO-010', 'วรัญญา มีสุข', 'ACC', 'Accounting Officer', 'ACC-OFFICE', 'waranya.m@eves.example', '081-111-1010', 'ACCOUNTING']
    ];

    for (const employee of employees) {
      await connection.query(
        `INSERT IGNORE INTO employees (
          id, company, name, department, position, location, email, phone,
          role, status, password_hash, must_change_password, can_login, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', '', 0, 0, CURRENT_TIMESTAMP)`,
        [employee[0], companyCode, ...employee.slice(1)]
      );
    }

    const assets = [
      {
        id: 'AST-DEMO-NB-001', name: 'Notebook Dell Latitude 5440', brand: 'Dell', model: 'Latitude 5440', category: 'COMPUTER', subcategory: 'NOTEBOOK', serial: 'DL5440-DEMO-001', assignedTo: 'พิมพ์ชนก ศรีสุข', department: 'HR', location: 'HR-OFFICE', status: 'ACTIVE', condition: 98, price: 42900, life: 4, salvage: 3000, criticality: 'MEDIUM', vendor: 'บริษัท ไอที ซิตี้ จำกัด', manufacturer: 'Dell Technologies', purchaseYears: -1, warrantyYears: 2, accent: '#2563eb'
      },
      {
        id: 'AST-DEMO-NB-002', name: 'Notebook Lenovo ThinkPad T14', brand: 'Lenovo', model: 'ThinkPad T14 Gen 4', category: 'COMPUTER', subcategory: 'NOTEBOOK', serial: 'LNT14-DEMO-002', assignedTo: 'ธนกฤต วัฒนกิจ', department: 'FIN', location: 'FIN-OFFICE', status: 'ACTIVE', condition: 91, price: 48900, life: 4, salvage: 4000, criticality: 'HIGH', vendor: 'บริษัท ซินเน็ค (ประเทศไทย) จำกัด', manufacturer: 'Lenovo', purchaseYears: -2, warrantyYears: 1, accent: '#111827'
      },
      {
        id: 'AST-DEMO-DT-001', name: 'Desktop HP ProDesk 400 G9', brand: 'HP', model: 'ProDesk 400 G9', category: 'COMPUTER', subcategory: 'DESKTOP', serial: 'HP400G9-DEMO-001', assignedTo: 'กิตติพงศ์ แซ่ลิ้ม', department: 'IT', location: 'IT-OFFICE', status: 'ACTIVE', condition: 88, price: 32900, life: 5, salvage: 2500, criticality: 'HIGH', vendor: 'บริษัท ไอที ซิตี้ จำกัด', manufacturer: 'HP Inc.', purchaseYears: -2, warrantyYears: 1, accent: '#0284c7'
      },
      {
        id: 'AST-DEMO-PR-001', name: 'Epson EcoTank L6290', brand: 'Epson', model: 'L6290', category: 'PRINTER', subcategory: 'INKJET-MFP', serial: 'EPSL6290-DEMO-001', assignedTo: 'อรทัย บุญช่วย', department: 'ACC', location: 'ACC-OFFICE', status: 'ACTIVE', condition: 84, price: 15900, life: 5, salvage: 1000, criticality: 'MEDIUM', vendor: 'บริษัท ออฟฟิศ โซลูชัน จำกัด', manufacturer: 'Seiko Epson Corporation', purchaseYears: -3, warrantyYears: -1, accent: '#0f766e'
      },
      {
        id: 'AST-DEMO-SW-001', name: 'Cisco CBS350-24T-4G Switch', brand: 'Cisco', model: 'CBS350-24T-4G', category: 'NETWORK', subcategory: 'SWITCH', serial: 'CSC350-DEMO-001', assignedTo: 'ทีม IT Infrastructure', department: 'IT', location: 'SERVER-ROOM', status: 'ACTIVE', condition: 96, price: 28500, life: 6, salvage: 3000, criticality: 'CRITICAL', vendor: 'บริษัท ซินเน็ค (ประเทศไทย) จำกัด', manufacturer: 'Cisco Systems', purchaseYears: -1, warrantyYears: 3, accent: '#0369a1'
      },
      {
        id: 'AST-DEMO-NB-003', name: 'Apple MacBook Air M3', brand: 'Apple', model: 'MacBook Air 13-inch M3', category: 'COMPUTER', subcategory: 'NOTEBOOK', serial: 'MBA-M3-DEMO-003', assignedTo: '-', department: 'ส่วนกลาง', location: 'IT-STOCK', status: 'IN_STOCK', condition: 100, price: 39900, life: 4, salvage: 5000, criticality: 'MEDIUM', vendor: 'บริษัท ไอที ซิตี้ จำกัด', manufacturer: 'Apple Inc.', purchaseYears: 0, warrantyYears: 1, accent: '#64748b'
      },
      {
        id: 'AST-DEMO-TB-001', name: 'Apple iPad Air 11-inch', brand: 'Apple', model: 'iPad Air M2', category: 'MOBILE', subcategory: 'TABLET', serial: 'IPADAIR-DEMO-001', assignedTo: 'ภูริณัฐ เจริญทรัพย์', department: 'SALES', location: 'นอกสถานที่ / ลูกค้า', status: 'BORROWED', condition: 95, price: 23900, life: 4, salvage: 3000, criticality: 'MEDIUM', vendor: 'บริษัท ไอที ซิตี้ จำกัด', manufacturer: 'Apple Inc.', purchaseYears: -1, warrantyYears: 1, accent: '#7c3aed'
      },
      {
        id: 'AST-DEMO-NB-004', name: 'Notebook Dell Latitude 3420', brand: 'Dell', model: 'Latitude 3420', category: 'COMPUTER', subcategory: 'NOTEBOOK', serial: 'DL3420-DEMO-004', assignedTo: 'ศุภชัย คำดี', department: 'MNT', location: 'MNT-WORKSHOP', status: 'IN_REPAIR', condition: 62, price: 29900, life: 4, salvage: 1500, criticality: 'HIGH', vendor: 'บริษัท ไอที ซิตี้ จำกัด', manufacturer: 'Dell Technologies', purchaseYears: -4, warrantyYears: -2, accent: '#d97706'
      },
      {
        id: 'AST-DEMO-PR-002', name: 'Canon imageCLASS LBP623Cdw', brand: 'Canon', model: 'LBP623Cdw', category: 'PRINTER', subcategory: 'LASER-PRINTER', serial: 'CNL623-DEMO-002', assignedTo: 'วรัญญา มีสุข', department: 'ACC', location: 'ACC-OFFICE', status: 'ACTIVE', condition: 86, price: 18900, life: 5, salvage: 1200, criticality: 'MEDIUM', vendor: 'บริษัท ออฟฟิศ โซลูชัน จำกัด', manufacturer: 'Canon Inc.', purchaseYears: -3, warrantyYears: -1, accent: '#dc2626'
      },
      {
        id: 'AST-DEMO-UPS-001', name: 'APC Smart-UPS 1500VA', brand: 'APC', model: 'SMT1500IC', category: 'POWER', subcategory: 'UPS', serial: 'APC1500-DEMO-001', assignedTo: 'ทีม IT Infrastructure', department: 'IT', location: 'SERVER-ROOM', status: 'ACTIVE', condition: 45, price: 26900, life: 5, salvage: 500, criticality: 'CRITICAL', vendor: 'บริษัท ซินเน็ค (ประเทศไทย) จำกัด', manufacturer: 'APC by Schneider Electric', purchaseYears: -6, warrantyYears: -4, accent: '#ea580c'
      },
      {
        id: 'AST-DEMO-OLD-001', name: 'Desktop Dell OptiPlex 3020', brand: 'Dell', model: 'OptiPlex 3020', category: 'COMPUTER', subcategory: 'DESKTOP', serial: 'OP3020-DEMO-OLD', assignedTo: 'คลังตัดจำหน่าย', department: 'ส่วนกลาง', location: 'MAIN-WH', status: 'DISPOSED', condition: 25, price: 24500, life: 5, salvage: 0, criticality: 'LOW', vendor: 'บริษัท ไอที ซิตี้ จำกัด', manufacturer: 'Dell Technologies', purchaseYears: -9, warrantyYears: -7, accent: '#475569'
      },
      {
        id: 'AST-DEMO-NB-005', name: 'Notebook Acer TravelMate P2', brand: 'Acer', model: 'TravelMate P2', category: 'COMPUTER', subcategory: 'NOTEBOOK', serial: 'ACPT2-DEMO-005', assignedTo: 'คลังกลาง', department: 'ส่วนกลาง', location: 'IT-STOCK', status: 'IN_STOCK', condition: 78, price: 27900, life: 4, salvage: 1200, criticality: 'MEDIUM', vendor: 'บริษัท ไอที ซิตี้ จำกัด', manufacturer: 'Acer Inc.', purchaseYears: -4, warrantyYears: -2, accent: '#16a34a'
      },
      {
        id: 'AST-DEMO-MON-001', name: 'Dell Monitor P2422H', brand: 'Dell', model: 'P2422H', category: 'OFFICE', subcategory: 'MONITOR', serial: 'P2422H-DEMO-001', assignedTo: 'ณัฐชา พูนผล', department: 'OPS', location: 'HQ-A-F2', status: 'ACTIVE', condition: 89, price: 7200, life: 5, salvage: 500, criticality: 'LOW', vendor: 'บริษัท ไอที ซิตี้ จำกัด', manufacturer: 'Dell Technologies', purchaseYears: -2, warrantyYears: 1, accent: '#0d9488'
      }
    ];

    for (const asset of assets) {
      const purchaseDate = isoYearOffset(asset.purchaseYears, -30);
      const warrantyUntil = isoYearOffset(asset.warrantyYears, 30);
      await connection.query(
        `INSERT IGNORE INTO assets (
          id, company, name, brand, model, category, subcategory, serial,
          assigned_to, department, location, status, purchase_date, warranty_until,
          \`condition\`, purchase_price, useful_life_years, salvage_value,
          criticality, ownership_type, vendor, manufacturer,
          purchase_document_type, purchase_document_no, purchase_document_date,
          purchase_order_no, tax_invoice_no, accounting_note,
          asset_image, asset_image_mime, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'OWNED', ?, ?,
          'TAX_INVOICE', ?, ?, ?, ?, ?, ?, 'image/svg+xml', CURRENT_TIMESTAMP)`,
        [
          asset.id, companyCode, asset.name, asset.brand, asset.model, asset.category,
          asset.subcategory, asset.serial, asset.assignedTo, asset.department,
          asset.location, asset.status, purchaseDate, warrantyUntil, asset.condition,
          asset.price, asset.life, asset.salvage, asset.criticality, asset.vendor,
          asset.manufacturer, `INV-DEMO-${asset.id.slice(-3)}`, purchaseDate,
          '', `TAX-DEMO-${asset.id.slice(-3)}`,
          `ข้อมูลตัวอย่างสำหรับทดสอบโมดูลทะเบียนทรัพย์สินและค่าเสื่อมราคา`,
          demoSvg(asset.brand, asset.model, asset.accent)
        ]
      );
    }

    const assetItems = [
      ['AST-DEMO-NB-001', 'Adapter USB-C 65W', 'Dell', '65W USB-C', 'ADP-DEMO-001', 1, 1, 'ส่งมอบพร้อมเครื่อง'],
      ['AST-DEMO-NB-001', 'กระเป๋า Notebook', 'Dell', 'Pro Slim', '', 1, 1, 'กระเป๋าสีดำ'],
      ['AST-DEMO-TB-001', 'Apple Pencil', 'Apple', 'Pencil USB-C', 'PEN-DEMO-001', 1, 1, 'ต้องคืนพร้อม Tablet'],
      ['AST-DEMO-NB-004', 'Adapter USB-C 65W', 'Dell', '65W USB-C', 'ADP-DEMO-004', 1, 1, 'อยู่ระหว่างตรวจสอบ']
    ];
    for (const item of assetItems) {
      await connection.query(
        `INSERT INTO asset_items (asset_id, name, brand, model, serial, quantity, required_return, note)
         SELECT ?, ?, ?, ?, ?, ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM asset_items WHERE asset_id = ? AND name = ? AND serial = ?
         )`,
        [...item, item[0], item[1], item[4]]
      );
    }

    const stockItems = [
      ['SP-RAM-16GB', 'RAM DDR4 16GB', 'อะไหล่คอมพิวเตอร์', 'pcs', 'MNT-WH', 'ชั้น A-01', 24, 5, 50, 1350],
      ['SP-SSD-1TB', 'SSD NVMe 1TB', 'อะไหล่คอมพิวเตอร์', 'pcs', 'MNT-WH', 'ชั้น A-02', 12, 3, 25, 2650],
      ['SP-BAT-DELL', 'Battery Dell Latitude', 'อะไหล่คอมพิวเตอร์', 'pcs', 'MNT-WH', 'ชั้น B-01', 6, 2, 12, 3200],
      ['SP-TONER-057', 'Canon Toner 057', 'วัสดุสิ้นเปลือง', 'pcs', 'IT-WH', 'ชั้น C-01', 10, 3, 20, 2890],
      ['SUP-USB-C', 'USB-C Hub 7-in-1', 'อุปกรณ์เสริม', 'pcs', 'IT-WH', 'ชั้น D-01', 30, 8, 60, 890],
      ['SUP-MOUSE', 'Wireless Mouse', 'อุปกรณ์เสริม', 'pcs', 'IT-WH', 'ชั้น D-02', 18, 5, 40, 650]
    ];
    for (const item of stockItems) {
      await connection.query(
        `INSERT IGNORE INTO stock_items (
          sku, company, name, category, unit, warehouse, location,
          available, min_level, max_level, status, unit_cost, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, CURRENT_TIMESTAMP)`,
        [item[0], companyCode, ...item.slice(1)]
      );
    }

    const balances = [
      ['SP-RAM-16GB', 'MNT-WH', 'ชั้น A-01', 18, 5, 40], ['SP-RAM-16GB', 'IT-WH', 'ชั้นอะไหล่สำรอง', 6, 2, 10],
      ['SP-SSD-1TB', 'MNT-WH', 'ชั้น A-02', 9, 3, 20], ['SP-SSD-1TB', 'IT-WH', 'ชั้นอะไหล่สำรอง', 3, 1, 5],
      ['SP-BAT-DELL', 'MNT-WH', 'ชั้น B-01', 6, 2, 12],
      ['SP-TONER-057', 'IT-WH', 'ชั้น C-01', 10, 3, 20],
      ['SUP-USB-C', 'IT-WH', 'ชั้น D-01', 25, 8, 50], ['SUP-USB-C', 'MAIN-WH', 'ชั้นอุปกรณ์ทั่วไป', 5, 2, 10],
      ['SUP-MOUSE', 'IT-WH', 'ชั้น D-02', 14, 5, 30], ['SUP-MOUSE', 'MAIN-WH', 'ชั้นอุปกรณ์ทั่วไป', 4, 2, 10]
    ];
    for (const balance of balances) {
      await connection.query(
        `INSERT IGNORE INTO stock_balances (
          sku, company_code, warehouse, location, available, min_level, max_level, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [balance[0], companyCode, ...balance.slice(1)]
      );
    }

    const stockMovements = [
      ['RCV-DEMO-0001', 'RECEIVE', 'SP-RAM-16GB', 20, '', 'MNT-WH', 'เจ้าหน้าที่คลัง', 'PO-DEMO-1001', 'รับอะไหล่ RAM เข้าคลัง', isoDate(-40)],
      ['RCV-DEMO-0002', 'RECEIVE', 'SP-SSD-1TB', 12, '', 'MNT-WH', 'เจ้าหน้าที่คลัง', 'PO-DEMO-1002', 'รับ SSD เข้าคลัง', isoDate(-35)],
      ['ISS-DEMO-0001', 'ISSUE', 'SP-RAM-16GB', 1, 'MNT-WH', '', 'ช่างซ่อมบำรุง', 'MNT-DEMO-0001', 'เบิกเพื่อซ่อม Notebook', isoDate(-3)],
      ['ISS-DEMO-0002', 'ISSUE', 'SP-TONER-057', 1, 'IT-WH', '', 'เจ้าหน้าที่คลัง', 'ACC-PRINT', 'เบิก Toner ให้ฝ่ายบัญชี', isoDate(-10)],
      ['TRN-DEMO-0001', 'TRANSFER', 'SUP-MOUSE', 4, 'IT-WH', 'MAIN-WH', 'เจ้าหน้าที่คลัง', 'MOVE-DEMO-01', 'โอน Mouse ไปคลังกลาง', isoDate(-7)],
      ['ADJ-DEMO-0001', 'ADJUST', 'SUP-USB-C', 2, 'IT-WH', 'IT-WH', 'เจ้าหน้าที่คลัง', 'ADJ-DEMO-REF-01', 'ปรับยอดจากการตรวจสอบข้อมูล', isoDate(-5)]
    ];
    for (const movement of stockMovements) {
      await connection.query(
        `INSERT IGNORE INTO stock_movements (
          doc_no, company_code, movement_type, sku, quantity, from_warehouse,
          to_warehouse, requester, reference, note, status, movement_date
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'POSTED', ?)`,
        [movement[0], companyCode, ...movement.slice(1)]
      );
    }

    await ensureAssetEvent(connection, { assetId: 'AST-DEMO-NB-001', eventType: 'ASSIGNMENT', oldValue: '-', newValue: 'พิมพ์ชนก ศรีสุข', actor: 'ผู้จัดการทรัพย์สิน', note: 'ASG-DEMO-0001 ยืนยันรับทรัพย์สินแล้ว', createdAt: `${isoDate(-45)} 09:30:00` });
    await ensureAssetEvent(connection, { assetId: 'AST-DEMO-NB-002', eventType: 'TRANSFER', oldValue: 'IT-STOCK', newValue: 'FIN-OFFICE', actor: 'ผู้ดูแลบริษัท', note: 'TRF-DEMO-0001 อนุมัติการโอนย้าย', createdAt: `${isoDate(-30)} 14:00:00` });
    await ensureAssetEvent(connection, { assetId: 'AST-DEMO-MON-001', eventType: 'LOCATION', oldValue: 'OPS-OFFICE', newValue: 'HQ-A-F2', actor: 'เจ้าหน้าที่ตรวจสอบ', note: 'พบทรัพย์สินอยู่ผิดตำแหน่งระหว่างตรวจสอบข้อมูล', createdAt: `${isoDate(-14)} 11:15:00` });
    await ensureAssetEvent(connection, { assetId: 'AST-DEMO-TB-001', eventType: 'BORROW', oldValue: 'IN_STOCK', newValue: 'BORROWED', actor: 'ผู้ดูแลบริษัท', note: 'BRW-DEMO-0001 อนุมัติให้ฝ่ายขายยืมใช้งาน', createdAt: `${isoDate(-5)} 10:00:00` });
    await ensureAssetEvent(connection, { assetId: 'AST-DEMO-NB-004', eventType: 'MAINTENANCE_OPEN', oldValue: 'ACTIVE', newValue: 'IN_REPAIR', actor: 'ช่างซ่อมบำรุง', note: 'MNT-DEMO-0001 เครื่องเปิดไม่ติด', createdAt: `${isoDate(-3)} 08:45:00` });
    await ensureAssetEvent(connection, { assetId: 'AST-DEMO-OLD-001', eventType: 'DISPOSAL', oldValue: 'IN_STOCK', newValue: 'DISPOSED', actor: 'ผู้ดูแลบริษัท', note: 'DSP-DEMO-0002 อนุมัติตัดจำหน่าย', createdAt: `${isoDate(-60)} 16:00:00` });

    await connection.query(
      `INSERT IGNORE INTO transfers (
        request_no, company_code, asset_id, from_location, to_location,
        from_department, to_department, from_assignee, to_assignee,
        requested_by, status, approved_by, transfer_date, note, updated_at
      ) VALUES
        ('TRF-DEMO-0001', ?, 'AST-DEMO-NB-002', 'IT-STOCK', 'FIN-OFFICE', 'IT', 'FIN', '-', 'ธนกฤต วัฒนกิจ', 'ผู้จัดการทรัพย์สิน', 'APPROVED', 'ผู้ดูแลบริษัท', ?, 'จัดสรร Notebook ให้พนักงานฝ่ายการเงิน', CURRENT_TIMESTAMP),
        ('TRF-DEMO-0002', ?, 'AST-DEMO-PR-001', 'ACC-OFFICE', 'HR-OFFICE', 'ACC', 'HR', 'อรทัย บุญช่วย', 'พิมพ์ชนก ศรีสุข', 'ผู้จัดการทรัพย์สิน', 'PENDING', '', ?, 'ขอย้ายเครื่องพิมพ์สำรองให้ฝ่าย HR', CURRENT_TIMESTAMP)`,
      [companyCode, isoDate(-30), companyCode, isoDate(2)]
    );
    const transferApprovedId = await rowId(connection, 'transfers', 'request_no', 'TRF-DEMO-0001');
    const transferPendingId = await rowId(connection, 'transfers', 'request_no', 'TRF-DEMO-0002');
    await ensureApproval(connection, { requestType: 'TRANSFER', requestId: transferApprovedId, requestNo: 'TRF-DEMO-0001', requester: 'ผู้จัดการทรัพย์สิน', requesterEmployeeCode: 'ASSET-001', approver: 'ผู้ดูแลบริษัท', status: 'APPROVED', requestedAt: `${isoDate(-31)} 09:00:00`, decidedAt: `${isoDate(-30)} 14:00:00`, note: 'อนุมัติตามแผนจัดสรรอุปกรณ์' });
    await ensureApproval(connection, { requestType: 'TRANSFER', requestId: transferPendingId, requestNo: 'TRF-DEMO-0002', requester: 'ผู้จัดการทรัพย์สิน', requesterEmployeeCode: 'ASSET-001', status: 'PENDING', requestedAt: `${isoDate(-1)} 10:30:00`, note: 'รอหัวหน้าแผนกตรวจสอบ' });

    await connection.query(
      `INSERT IGNORE INTO borrow_records (
        request_no, company_code, asset_id, borrower, borrow_date, due_date,
        return_date, condition_out, condition_in, status, note,
        original_assignee, original_department, original_location,
        received_by, return_location, updated_at
      ) VALUES
        ('BRW-DEMO-0001', ?, 'AST-DEMO-TB-001', 'ภูริณัฐ เจริญทรัพย์', ?, ?, '', 98, NULL, 'APPROVED', 'นำเสนอสินค้าและเก็บข้อมูลลูกค้านอกสถานที่', 'คลังกลาง', 'ส่วนกลาง', 'IT-STOCK', '', '', CURRENT_TIMESTAMP),
        ('BRW-DEMO-0002', ?, 'AST-DEMO-NB-005', 'ณัฐชา พูนผล', ?, ?, ?, 82, 78, 'RETURNED', 'ยืมใช้ระหว่างจัดกิจกรรมบริษัท', 'คลังกลาง', 'ส่วนกลาง', 'IT-STOCK', 'เจ้าหน้าที่คลัง', 'IT-STOCK', CURRENT_TIMESTAMP)`,
      [companyCode, isoDate(-5), isoDate(5), companyCode, isoDate(-25), isoDate(-20), isoDate(-19)]
    );
    const borrowApprovedId = await rowId(connection, 'borrow_records', 'request_no', 'BRW-DEMO-0001');
    const borrowReturnedId = await rowId(connection, 'borrow_records', 'request_no', 'BRW-DEMO-0002');
    await ensureApproval(connection, { requestType: 'BORROW', requestId: borrowApprovedId, requestNo: 'BRW-DEMO-0001', requester: 'ภูริณัฐ เจริญทรัพย์', requesterEmployeeCode: 'EMP-DEMO-005', approver: 'หัวหน้าแผนก', status: 'APPROVED', requestedAt: `${isoDate(-6)} 10:00:00`, decidedAt: `${isoDate(-5)} 09:00:00`, note: 'อนุมัติสำหรับพบลูกค้า' });
    await ensureApproval(connection, { requestType: 'BORROW', requestId: borrowReturnedId, requestNo: 'BRW-DEMO-0002', requester: 'ณัฐชา พูนผล', requesterEmployeeCode: 'EMP-DEMO-006', approver: 'หัวหน้าแผนก', status: 'APPROVED', requestedAt: `${isoDate(-26)} 10:00:00`, decidedAt: `${isoDate(-25)} 08:30:00`, note: 'อนุมัติสำหรับกิจกรรมบริษัท' });
    await connection.query(
      `INSERT INTO return_records (
        asset_id, return_date, returned_by, received_by, return_location,
        \`condition\`, note, returned_items, missing_items
      )
      SELECT 'AST-DEMO-NB-005', ?, 'ณัฐชา พูนผล', 'เจ้าหน้าที่คลัง', 'IT-STOCK', 78,
             'คืนครบ อุปกรณ์ใช้งานได้ มีรอยขีดข่วนเล็กน้อย',
             '["Notebook","Adapter","กระเป๋า"]', '[]'
      WHERE NOT EXISTS (
        SELECT 1 FROM return_records WHERE asset_id = 'AST-DEMO-NB-005' AND return_date = ?
      )`,
      [isoDate(-19), isoDate(-19)]
    );

    await connection.query(
      `INSERT IGNORE INTO maintenance (
        ticket_no, company_code, asset_id, issue, technician, parts_json,
        cost, status, opened_date, closed_date, note,
        requested_by, requester_employee_code, previous_asset_status, updated_at
      ) VALUES
        ('MNT-DEMO-0001', ?, 'AST-DEMO-NB-004', 'เครื่องเปิดไม่ติดและมีอาการดับระหว่างใช้งาน', 'ศุภชัย คำดี', '[{"sku":"SP-RAM-16GB","quantity":1}]', 1350, 'IN_PROGRESS', ?, '', 'กำลังทดสอบ Mainboard และ RAM', 'ณัฐชา พูนผล', 'EMP-DEMO-006', 'ACTIVE', CURRENT_TIMESTAMP),
        ('MNT-DEMO-0002', ?, 'AST-DEMO-PR-002', 'พิมพ์มีเส้นและกระดาษติดบ่อย', 'ศุภชัย คำดี', '[{"sku":"SP-TONER-057","quantity":1}]', 3390, 'CLOSED', ?, ?, 'ทำความสะอาดชุดดึงกระดาษและเปลี่ยน Toner ทดสอบผ่าน', 'วรัญญา มีสุข', 'EMP-DEMO-010', 'ACTIVE', CURRENT_TIMESTAMP)`,
      [companyCode, isoDate(-3), companyCode, isoDate(-20), isoDate(-18)]
    );
    const maintenanceOpenId = await rowId(connection, 'maintenance', 'ticket_no', 'MNT-DEMO-0001');
    const maintenanceClosedId = await rowId(connection, 'maintenance', 'ticket_no', 'MNT-DEMO-0002');
    const maintenanceParts = [
      [maintenanceOpenId, 'SP-RAM-16GB', 'MNT-WH', 1, 1350, 'ISS-DEMO-0001', 'ศุภชัย คำดี'],
      [maintenanceClosedId, 'SP-TONER-057', 'IT-WH', 1, 2890, 'ISS-DEMO-0002', 'ศุภชัย คำดี']
    ];
    for (const part of maintenanceParts) {
      await connection.query(
        `INSERT INTO maintenance_parts (
          maintenance_id, sku, warehouse, quantity, unit_cost, movement_doc_no, issued_by
        )
        SELECT ?, ?, ?, ?, ?, ?, ?
        WHERE NOT EXISTS (
          SELECT 1 FROM maintenance_parts WHERE maintenance_id = ? AND sku = ? AND movement_doc_no = ?
        )`,
        [...part, part[0], part[1], part[5]]
      );
    }
    await connection.query(
      `INSERT INTO repair_records (asset_id, repair_date, detail, cost, technician)
       SELECT 'AST-DEMO-PR-002', ?, 'เปลี่ยน Toner และทำความสะอาดชุดดึงกระดาษ', 3390, 'ศุภชัย คำดี'
       WHERE NOT EXISTS (
         SELECT 1 FROM repair_records WHERE asset_id = 'AST-DEMO-PR-002' AND repair_date = ?
       )`,
      [isoDate(-18), isoDate(-18)]
    );

    await connection.query(
      `INSERT IGNORE INTO disposals (
        request_no, company_code, asset_id, reason, disposal_method,
        estimated_value, status, requested_by, approved_by, disposal_date,
        note, updated_at
      ) VALUES
        ('DSP-DEMO-0001', ?, 'AST-DEMO-UPS-001', 'แบตเตอรี่เสื่อมและค่าใช้จ่ายซ่อมสูงกว่ามูลค่าคงเหลือ', 'SCRAP', 500, 'PENDING', 'ผู้จัดการทรัพย์สิน', '', ?, 'รอฝ่ายบัญชีตรวจสอบมูลค่าคงเหลือ', CURRENT_TIMESTAMP),
        ('DSP-DEMO-0002', ?, 'AST-DEMO-OLD-001', 'อายุเกินเกณฑ์และไม่รองรับระบบปฏิบัติการปัจจุบัน', 'SCRAP', 0, 'APPROVED', 'ผู้จัดการทรัพย์สิน', 'ผู้ดูแลบริษัท', ?, 'อนุมัติทำลายตามระเบียบบริษัท', CURRENT_TIMESTAMP)`,
      [companyCode, isoDate(7), companyCode, isoDate(-60)]
    );
    const disposalPendingId = await rowId(connection, 'disposals', 'request_no', 'DSP-DEMO-0001');
    const disposalApprovedId = await rowId(connection, 'disposals', 'request_no', 'DSP-DEMO-0002');
    await ensureApproval(connection, { requestType: 'DISPOSAL', requestId: disposalPendingId, requestNo: 'DSP-DEMO-0001', requester: 'ผู้จัดการทรัพย์สิน', requesterEmployeeCode: 'ASSET-001', status: 'PENDING', requestedAt: `${isoDate(-1)} 14:00:00`, note: 'รอฝ่ายบัญชีตรวจสอบ' });
    await ensureApproval(connection, { requestType: 'DISPOSAL', requestId: disposalApprovedId, requestNo: 'DSP-DEMO-0002', requester: 'ผู้จัดการทรัพย์สิน', requesterEmployeeCode: 'ASSET-001', approver: 'ผู้ดูแลบริษัท', status: 'APPROVED', requestedAt: `${isoDate(-62)} 09:00:00`, decidedAt: `${isoDate(-60)} 16:00:00`, note: 'อนุมัติตามรายงานสภาพทรัพย์สิน' });

    const assignmentRequests = [
      ['ASG-DEMO-0001', 'EMP-DEMO-001', 'พิมพ์ชนก ศรีสุข', 'HR', 'HR Specialist', 'HR-OFFICE', isoDate(-45), 'พนักงานใหม่ต้องใช้ Notebook สำหรับงาน HR', 'COMPLETED', 'HR-001', 'เจ้าหน้าที่ฝ่ายบุคคล', `${isoDate(-50)} 09:00:00`, 'ASSET-001', 'ผู้จัดการทรัพย์สิน', `${isoDate(-48)} 13:00:00`, 'ส่งมอบและยืนยันรับเรียบร้อย'],
      ['ASG-DEMO-0002', 'EMP-DEMO-006', 'ณัฐชา พูนผล', 'OPS', 'Operations Coordinator', 'HQ-A-F1', isoDate(3), 'ขอ Notebook สำหรับประสานงานโครงการ', 'IT_REVIEW', 'HR-001', 'เจ้าหน้าที่ฝ่ายบุคคล', `${isoDate(-2)} 10:00:00`, 'ASSET-001', 'ผู้จัดการทรัพย์สิน', `${isoDate(-1)} 11:00:00`, 'เลือก Asset แล้ว รออนุมัติ'],
      ['ASG-DEMO-0003', 'EMP-DEMO-008', 'ชลธิชา สุขเกษม', 'WH', 'Warehouse Officer', 'MAIN-WH', isoDate(7), 'ขอเครื่องพิมพ์ฉลากสำหรับคลังกลาง', 'SUBMITTED', 'HR-001', 'เจ้าหน้าที่ฝ่ายบุคคล', `${isoDate(-1)} 15:00:00`, '', '', null, ''],
      ['ASG-DEMO-0004', 'EMP-DEMO-005', 'ภูริณัฐ เจริญทรัพย์', 'SALES', 'Sales Executive', 'SALES-OFFICE', isoDate(10), 'ขอ Smartphone เพิ่มสำหรับใช้ส่วนตัว', 'REJECTED', 'HR-001', 'เจ้าหน้าที่ฝ่ายบุคคล', `${isoDate(-12)} 09:00:00`, 'ASSET-001', 'ผู้จัดการทรัพย์สิน', `${isoDate(-11)} 10:00:00`, 'ไม่เป็นไปตามนโยบายบริษัท ให้ใช้เครื่องส่วนกลางแทน'],
      ['ASG-DEMO-0005', 'EMP-DEMO-007', 'ศุภชัย คำดี', 'MNT', 'Maintenance Technician', 'MNT-WORKSHOP', isoDate(14), 'ขอ Notebook Rugged สำหรับงานซ่อมหน้างาน', 'DRAFT', 'HR-001', 'เจ้าหน้าที่ฝ่ายบุคคล', null, '', '', null, 'รอ HR ตรวจสอบคุณสมบัติ']
    ];
    for (const request of assignmentRequests) {
      await connection.query(
        `INSERT IGNORE INTO asset_assignment_requests (
          request_no, company_code, employee_code, employee_name, department,
          position_name, work_location, required_date, request_reason, status,
          requested_by, requested_by_name, submitted_at, reviewed_by,
          reviewed_by_name, reviewed_at, decision_note, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [request[0], companyCode, ...request.slice(1)]
      );
    }

    const requestIds = {};
    for (const request of assignmentRequests) {
      requestIds[request[0]] = await rowId(connection, 'asset_assignment_requests', 'request_no', request[0]);
    }
    const assignmentItems = [
      ['ASG-DEMO-0001', 'COMPUTER', 'NOTEBOOK', 1, 'RAM 16GB, SSD 512GB, Windows 11 Pro', 'สำหรับงาน HR และประชุมออนไลน์', 'COMPLETED'],
      ['ASG-DEMO-0002', 'COMPUTER', 'NOTEBOOK', 1, 'น้ำหนักไม่เกิน 1.5 กก. แบตเตอรี่อย่างน้อย 8 ชั่วโมง', 'ใช้ประสานงานโครงการ', 'ALLOCATED'],
      ['ASG-DEMO-0003', 'PRINTER', 'LASER-PRINTER', 1, 'รองรับ Network และพิมพ์ฉลาก A4', 'ติดตั้งที่คลังกลาง', 'REQUESTED'],
      ['ASG-DEMO-0004', 'MOBILE', '', 1, 'Smartphone รองรับ 5G', 'คำขอถูกปฏิเสธ', 'CANCELLED'],
      ['ASG-DEMO-0005', 'COMPUTER', 'NOTEBOOK', 1, 'Rugged, กันฝุ่น และทนแรงกระแทก', 'ร่างคำขอ ยังไม่ส่ง', 'REQUESTED']
    ];
    const requestItemIds = {};
    for (const item of assignmentItems) {
      const requestId = requestIds[item[0]];
      const [existing] = await connection.query(
        'SELECT id FROM asset_assignment_request_items WHERE request_id = ? AND asset_category = ? AND asset_subcategory = ? LIMIT 1',
        [requestId, item[1], item[2]]
      );
      if (existing[0]) {
        requestItemIds[item[0]] = Number(existing[0].id);
      } else {
        const [result] = await connection.query(
          `INSERT INTO asset_assignment_request_items (
            request_id, asset_category, asset_subcategory, requested_quantity,
            specification, remarks, item_status, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
          [requestId, ...item.slice(1)]
        );
        requestItemIds[item[0]] = Number(result.insertId);
      }
    }

    const allocations = [
      ['ASG-DEMO-0001', 'AST-DEMO-NB-001', 'COMPLETED', 'ASSET-001', 'ผู้จัดการทรัพย์สิน', `${isoDate(-48)} 13:00:00`, `${isoDate(-45)} 10:00:00`, 'จัดสรรให้พนักงานใหม่'],
      ['ASG-DEMO-0002', 'AST-DEMO-NB-003', 'RESERVED', 'ASSET-001', 'ผู้จัดการทรัพย์สิน', `${isoDate(-1)} 11:00:00`, null, 'จอง MacBook Air รออนุมัติ']
    ];
    const allocationIds = {};
    for (const allocation of allocations) {
      const requestId = requestIds[allocation[0]];
      const itemId = requestItemIds[allocation[0]];
      await connection.query(
        `INSERT IGNORE INTO asset_assignment_allocations (
          request_id, request_item_id, asset_id, status, reserved_by,
          reserved_by_name, reserved_at, completed_at, note, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
        [requestId, itemId, ...allocation.slice(1)]
      );
      const [rows] = await connection.query(
        'SELECT id FROM asset_assignment_allocations WHERE request_id = ? AND asset_id = ? LIMIT 1',
        [requestId, allocation[1]]
      );
      allocationIds[allocation[0]] = Number(rows[0]?.id || 0);
    }

    await connection.query(
      `INSERT IGNORE INTO asset_handovers (
        allocation_id, request_id, asset_id, employee_code, handed_over_by,
        handed_over_by_name, handed_over_at, received_by, received_by_name,
        received_at, asset_condition, accessories_json, handover_note,
        acknowledgement_status, updated_at
      ) VALUES (?, ?, 'AST-DEMO-NB-001', 'EMP-DEMO-001', 'ASSET-001',
        'ผู้จัดการทรัพย์สิน', ?, 'EMP-DEMO-001', 'พิมพ์ชนก ศรีสุข', ?, 98,
        '["Adapter USB-C 65W","กระเป๋า Notebook"]',
        'ตรวจสอบ Serial และอุปกรณ์ครบถ้วน', 'ACKNOWLEDGED', CURRENT_TIMESTAMP)`,
      [allocationIds['ASG-DEMO-0001'], requestIds['ASG-DEMO-0001'], `${isoDate(-45)} 09:30:00`, `${isoDate(-45)} 10:00:00`]
    );

    const auditRecords = [
      ['ADMIN-001', 'AUTH', 'LOGIN', 'ADMIN-001', '{}', '{"result":"success"}', `${isoDate(-2)} 08:00:00`],
      ['ASSET-001', 'ASSET', 'CREATE', 'AST-DEMO-NB-003', '{}', '{"status":"IN_STOCK"}', `${isoDate(-10)} 10:00:00`],
      ['HR-001', 'ASSET_ASSIGNMENT', 'SUBMIT_REQUEST', 'ASG-DEMO-0003', '{}', '{"status":"SUBMITTED"}', `${isoDate(-1)} 15:00:00`],
      ['ASSET-001', 'ASSET_ASSIGNMENT', 'RESERVE_ASSET', 'ASG-DEMO-0002:AST-DEMO-NB-003', '{}', '{"status":"RESERVED"}', `${isoDate(-1)} 11:00:00`],
      ['ASSET-001', 'TRANSFER', 'REQUEST', 'TRF-DEMO-0002', '{}', '{"status":"PENDING"}', `${isoDate(-1)} 10:30:00`],
      ['EMP-DEMO-005', 'BORROW', 'REQUEST', 'BRW-DEMO-0001', '{}', '{"status":"APPROVED"}', `${isoDate(-6)} 10:00:00`],
      ['EMP-DEMO-007', 'MAINTENANCE', 'OPEN', 'MNT-DEMO-0001', '{}', '{"status":"IN_PROGRESS"}', `${isoDate(-3)} 08:45:00`],
      ['WH-001', 'STOCK', 'POST_MOVEMENT', 'ISS-DEMO-0001', '{}', '{"sku":"SP-RAM-16GB","quantity":1}', `${isoDate(-3)} 09:00:00`],
      ['ASSET-001', 'DISPOSAL', 'REQUEST', 'DSP-DEMO-0001', '{}', '{"status":"PENDING"}', `${isoDate(-1)} 14:00:00`]
    ];
    for (const record of auditRecords) {
      await ensureAudit(connection, {
        employeeCode: record[0], module: record[1], action: record[2], entityId: record[3],
        beforeJson: record[4], afterJson: record[5], createdAt: record[6]
      });
    }

    await connection.commit();
    console.log('Demo data seeded successfully (idempotent).');
  } catch (error) {
    await connection.rollback();
    console.error('Demo data seed failed:', error);
    throw error;
  } finally {
    connection.release();
  }
}
