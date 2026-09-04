import { readFileSync } from 'node:fs';

const server = readFileSync(new URL('../backend/src/server.js', import.meta.url), 'utf8');
const modules = readFileSync(new URL('../src/pages/ModulesPage.tsx', import.meta.url), 'utf8');
const employees = readFileSync(new URL('../src/pages/EmployeesPage.tsx', import.meta.url), 'utf8');
const assets = readFileSync(new URL('../src/pages/AssetsPage.tsx', import.meta.url), 'utf8');

const checks = [
  [server.includes('CREATE TABLE IF NOT EXISTS asset_id_counters') && server.includes('maxExistingAssetRunningNumber'), 'Asset ID must use a company-wide monotonic sequence'],
  [server.includes("app.post('/api/assets/:id/returns'"), 'Generic custody return API must exist'],
  [server.includes('const needsRepair = missingItems.length > 0') && server.includes('This prevents the invalid state IN_REPAIR with no Maintenance Ticket'), 'Damaged/incomplete returns must create maintenance work'],
  [server.includes("status IN ('PENDING','APPROVED','RETURN_REQUESTED')"), 'Return flow must block unfinished borrow workflow'],
  [server.includes("status = 'PENDING' LIMIT 1 FOR UPDATE"), 'Return flow must guard pending workflow records'],
  [modules.includes('GeneralAssetReturnForm'), 'Current-custodian page must expose generic return UI'],
  [modules.includes('เปลี่ยนเครื่อง / ได้เครื่องใหม่'), 'Return reason must support device replacement'],
  [server.includes("'RESIGNED'") && modules.includes("RESIGNED: 'พนักงานลาออก'"), 'Return workflow must distinguish normal return from offboarding'],
  [assets.includes("match(/-(\\d+)$/)"), 'Frontend Asset ID fallback must continue running suffix across dates']
];

for (const [ok, message] of checks) {
  if (!ok) throw new Error(`Operational flow contract failed: ${message}`);
}
console.log(`Operational flow contract ผ่าน: ${checks.length} checks`);
