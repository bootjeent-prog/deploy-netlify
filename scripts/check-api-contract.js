import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const walk = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(directory, entry.name);
  return entry.isDirectory() ? walk(full) : [full];
});
const frontendFiles = walk(path.join(root, 'src')).filter((file) => /\.(ts|tsx)$/.test(file));
const frontend = frontendFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
const backend = fs.readFileSync(path.join(root, 'backend/src/server.js'), 'utf8');

const normalize = (value) => value
  .replace(/\$\{[^}]+\}/g, ':param')
  .replace(/\/:[^/]+/g, '/:param')
  .split('?')[0];

const methodMap = { api: 'GET', post: 'POST', put: 'PUT', del: 'DELETE' };
const frontendCalls = [];
for (const match of frontend.matchAll(/\b(api|post|put|del)\(\s*([`'"])(.*?)\2/gs)) {
  if (!match[3].startsWith('/api/')) continue;
  frontendCalls.push([methodMap[match[1]], match[3]]);
}
const routes = new Set();
for (const match of backend.matchAll(/app\.(get|post|put|delete|patch)\(\s*(['"])(.*?)\2/g)) {
  routes.add(`${match[1].toUpperCase()} ${normalize(match[3])}`);
}

const allowedDynamic = new Set(['POST /api/assets/:param/:param']);
const missing = [];
for (const [method, route] of frontendCalls) {
  const key = `${method} ${normalize(route)}`;
  if (!routes.has(key) && !allowedDynamic.has(key)) missing.push(`${method} ${route}`);
}
if (missing.length) {
  console.error('พบ Frontend API ที่ไม่มี Backend route:');
  for (const route of [...new Set(missing)]) console.error(`- ${route}`);
  process.exit(1);
}
console.log(`API contract check ผ่าน: Frontend ${new Set(frontendCalls.map(([m,p]) => `${m} ${p}`)).size} calls เชื่อมกับ Backend routes ครบ`);
