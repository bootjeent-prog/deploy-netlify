import fs from 'node:fs';

const server = fs.readFileSync('backend/src/server.js', 'utf8');
const modules = fs.readFileSync('src/pages/ModulesPage.tsx', 'utf8');
const assets = fs.readFileSync('src/pages/AssetsPage.tsx', 'utf8');
const detail = fs.readFileSync('src/AssetPhotoButton.tsx', 'utf8');
const facility = fs.readFileSync('src/pages/FacilityAssetsPage.tsx', 'utf8');
const annualInventory = fs.readFileSync('src/pages/AnnualInventoryPage.tsx', 'utf8');
const navigation = fs.readFileSync('src/navigation.ts', 'utf8');

const contracts = [
  ['Workflow page Bangkok date helper does not recurse', modules.includes("new Intl.DateTimeFormat('en-CA'") && !/function\s+bangkokToday\s*\([^)]*\)[^{]*\{\s*return\s+bangkokToday\s*\(/s.test(modules)],
  ['Asset ID uses company-wide continuous counter', server.includes('CREATE TABLE IF NOT EXISTS asset_id_counters') && server.includes('SELECT last_number FROM asset_id_counters WHERE company_code = ? FOR UPDATE')],
  ['Asset ID preview does not reset by date', server.includes('maxExistingAssetRunningNumber') && assets.includes("match(/-(\\d+)$/)")],
  ['Maintenance close writes Asset repair history', server.includes('INSERT INTO repair_records (') && server.includes("'MAINTENANCE_CLOSED'")],
  ['Closed Maintenance backfills old repair history', server.includes('Backfill the Asset repair timeline from already-closed Maintenance Tickets')],
  ['General Asset return records old holder and reason', server.includes('previous_assignee') && server.includes('return_reason') && modules.includes('GeneralAssetReturnForm')],
  ['Damaged/incomplete returns create Maintenance workflow', server.includes('This prevents the invalid state IN_REPAIR with no Maintenance Ticket')],
  ['Borrow return records Asset return history', server.includes("'BORROW_RETURN'") && server.includes('borrow_return_photos')],
  ['Asset detail reloads fresh workflow data', detail.includes('Always fetch a fresh complete record')],
  ['Asset detail shows maintenance and movement timelines', detail.includes('ประวัติซ่อม') && detail.includes('ประวัติความเคลื่อนไหวของทรัพย์สิน')],
  ['Approval decisions update referenced workflows', server.includes("approval.request_type === 'TRANSFER'") && server.includes("approval.request_type === 'BORROW'") && server.includes("approval.request_type === 'DISPOSAL'")],
  ['Maintenance open is atomic with Asset status/event update', /SELECT id, company, status(?:, [a-z_]+)* FROM assets WHERE id = \? FOR UPDATE/.test(server) && server.includes("สถานะทรัพย์สินเปลี่ยนไประหว่างเปิดงานซ่อม")],
  ['Borrow return validates Box set and auto-routes damaged returns to Maintenance', modules.includes('ตรวจรายการย่อย / Box set ที่ต้องคืน') && server.includes("missingItems.length > 0 || conditionIn < 70")],
  ['Approved disposal clears current custodian', server.includes("assigned_to = '', custodian_type = 'UNASSIGNED', department = ''")],
  ['Asset lifecycle includes registration and edit events', server.includes("'REGISTERED'") && server.includes("'ASSET_UPDATED'") && detail.includes("REGISTERED: 'ลงทะเบียนทรัพย์สิน'")],
  ['Facility Asset edit supports item code and safe total quantity adjustment', facility.includes('รหัสทรัพย์สินส่วนกลาง') && facility.includes("row ? 'จำนวนทั้งหมด' : 'จำนวนเริ่มต้น'") && server.includes("'ADJUST_TOTAL'") && server.includes('minimumTotalQuantity')],
  ['Facility Asset supports Asset, Free Asset and Non-Asset classification', facility.includes("value: 'FREE_ASSET'") && facility.includes("value: 'NON_ASSET'") && server.includes('normalizeFacilityAssetType')],
  ['Facility Asset ownership is explicit and persisted', facility.includes('หน่วยงานผู้ดูแลสถานที่/รายการ') && server.includes('responsible_department VARCHAR(20)') && server.includes('assertWorkflowDepartment')],
  ['Transfer and general return are owned by HR', server.includes("assertWorkflowDepartment(user, 'HR', 'การโอนย้าย") && modules.includes('HR ดูแลการโอนย้าย')],
  ['Borrow and return only use IT-owned Assets', server.includes("assertWorkflowDepartment(user, 'IT', 'การยืม") && server.includes("COALESCE(NULLIF(a.responsible_department, ''), 'IT') = 'IT'") && modules.includes('ยืม-คืนอุปกรณ์ IT')],
  ['Maintenance can route tickets to IT or GA', server.includes("if (!['IT', 'GA'].includes(serviceDepartment))") && modules.includes('เลือกส่งงานให้ IT หรือ GA')],
  ['Annual inventory covers the UI, API and database table', navigation.includes("['annual-inventory', 'ตรวจนับประจำปี'") && annualInventory.includes("post('/api/annual-inventory'") && server.includes('CREATE TABLE IF NOT EXISTS annual_inventory_counts')]
];

const failed = contracts.filter(([, ok]) => !ok);
if (failed.length) {
  console.error('Operational integrity contract failed:');
  for (const [name] of failed) console.error(`- ${name}`);
  process.exit(1);
}
console.log(`Operational integrity check ผ่าน: ${contracts.length} contracts`);
