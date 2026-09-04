import fs from 'node:fs';

const read = (file) => fs.readFileSync(file, 'utf8');
const backend = read('backend/src/server.js');
const app = read('src/App.tsx');
const masterPage = read('src/pages/MasterDataPage.tsx');
const masterHelpers = read('src/masterData.ts');
const assets = read('src/pages/AssetsPage.tsx');
const modules = read('src/pages/ModulesPage.tsx');
const employees = read('src/pages/EmployeesPage.tsx');

const checks = [
  [backend.includes('getMasterData(user)'), 'Bootstrap ต้องโหลด Master Data จาก Database'],
  [backend.includes('masterData,'), 'Bootstrap response ต้องส่ง masterData'],
  [app.includes('masterData={data.masterData}'), 'App ต้องส่ง Master Data เข้าโมดูล'],
  [app.includes('companies={data.companies} masterData={data.masterData}'), 'ModulesPage ต้องได้รับ Company และ Master Data'],
  [(masterPage.match(/Promise\.all\(\[load\(\), onReload\(\)\]\)/g) || []).length >= 2, 'Master Data create/update/delete ต้อง Auto Refresh ทั้งหน้าปัจจุบันและ Bootstrap'],
  [masterHelpers.includes('const seen = new Set<string>()'), 'Dropdown ต้องตัดค่าซ้ำ'],
  [masterHelpers.includes('rowCompany === companyCode'), 'Dropdown ต้องรวมข้อมูลกลางและกรองข้อมูลเฉพาะบริษัท'],
  [masterPage.includes("const sharedMasterTypes = new Set<MasterType>"), 'Master Data มาตรฐานต้องรองรับข้อมูลกลางใช้ร่วมทุกบริษัท'],
  [backend.includes('consolidateSharedMasterRecords()'), 'Backend ต้องรวม Master Data มาตรฐานเดิมเป็นข้อมูลกลาง'],
  [assets.includes("masterOptions(masterData, 'asset-category'"), 'Asset form ต้องดึง Asset Category Master'],
  [assets.includes("masterOptions(masterData, 'vendor'"), 'Asset form ต้องดึง Vendor Master'],
  [employees.includes("masterOptions(masterData, 'department'"), 'Employee form ต้องดึง Department Master'],
  [modules.includes('locationOptions(masterData'), 'Location dropdown ต้องดึง Location Master'],
  [assets.includes("custodianType: 'SHARED'"), 'Asset form ต้องรองรับทรัพย์สินส่วนกลาง'],
  [assets.includes("custodianType: 'UNASSIGNED'"), 'Asset form ต้องรองรับไม่มีผู้ถือครอง']
];

const failed = checks.filter(([ok]) => !ok).map(([, message]) => message);
if (failed.length) {
  console.error('Master Data integration check ไม่ผ่าน:');
  for (const item of failed) console.error(`- ${item}`);
  process.exit(1);
}
console.log(`Master Data integration check ผ่าน: ${checks.length} contracts`);
