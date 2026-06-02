import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { seedData } from './seed-data.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || join(__dirname, 'data');
const dataFile = join(dataDir, 'db.json');
const port = Number(process.env.PORT || 4000);

async function ensureDataFile() {
  await mkdir(dataDir, { recursive: true });
  try {
    await readFile(dataFile, 'utf8');
  } catch {
    await writeJson(seedData);
  }
}

async function readJson() {
  await ensureDataFile();
  return JSON.parse(await readFile(dataFile, 'utf8'));
}

async function writeJson(data) {
  await mkdir(dataDir, { recursive: true });
  await writeFile(dataFile, JSON.stringify(data, null, 2), 'utf8');
}

function send(res, status, data) {
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json; charset=utf-8'
  });
  res.end(JSON.stringify(data));
}

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function validateAsset(asset) {
  const required = ['id', 'name', 'category', 'serial', 'assignedTo', 'department', 'location', 'status'];
  return required.every((key) => normalizeText(asset[key]));
}

function validateEmployee(employee) {
  return normalizeText(employee.id) && normalizeText(employee.name) && normalizeText(employee.department);
}

function validateRepair(repair) {
  return normalizeText(repair.date) && normalizeText(repair.detail) && normalizeText(repair.technician);
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, {});

    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const data = await readJson();

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return send(res, 200, { ok: true, service: 'it-asset-api' });
    }

    if (req.method === 'GET' && url.pathname === '/api/bootstrap') {
      return send(res, 200, data);
    }

    if (req.method === 'GET' && url.pathname === '/api/assets') {
      return send(res, 200, data.assets);
    }

    if (req.method === 'POST' && url.pathname === '/api/assets') {
      const asset = await parseBody(req);
      if (!validateAsset(asset)) return send(res, 400, { error: 'ข้อมูลทรัพย์สินไม่ครบ' });
      if (data.assets.some((item) => item.id === asset.id)) return send(res, 409, { error: 'Asset ID นี้มีอยู่แล้ว' });
      const nextAsset = { ...asset, repairs: Array.isArray(asset.repairs) ? asset.repairs : [] };
      data.assets = [nextAsset, ...data.assets];
      await writeJson(data);
      return send(res, 201, nextAsset);
    }

    if (req.method === 'GET' && url.pathname === '/api/employees') {
      return send(res, 200, data.employees);
    }

    if (req.method === 'POST' && url.pathname === '/api/employees') {
      const employee = await parseBody(req);
      if (!validateEmployee(employee)) return send(res, 400, { error: 'ข้อมูลผู้ใช้ไม่ครบ' });
      if (data.employees.some((item) => item.id === employee.id)) return send(res, 409, { error: 'รหัสพนักงานนี้มีอยู่แล้ว' });
      data.employees = [employee, ...data.employees];
      await writeJson(data);
      return send(res, 201, employee);
    }

    if (req.method === 'GET' && url.pathname === '/api/stock') {
      return send(res, 200, data.stock);
    }

    const repairMatch = url.pathname.match(/^\/api\/assets\/([^/]+)\/repairs$/);
    if (req.method === 'POST' && repairMatch) {
      const assetId = decodeURIComponent(repairMatch[1]);
      const repair = await parseBody(req);
      if (!validateRepair(repair)) return send(res, 400, { error: 'ข้อมูลประวัติซ่อมไม่ครบ' });

      const asset = data.assets.find((item) => item.id === assetId);
      if (!asset) return send(res, 404, { error: 'ไม่พบทรัพย์สินนี้' });

      asset.status = 'ซ่อมบำรุง';
      asset.repairs = [{ ...repair, cost: Number(repair.cost || 0) }, ...(asset.repairs || [])];
      await writeJson(data);
      return send(res, 201, asset);
    }

    return send(res, 404, { error: 'ไม่พบ API endpoint' });
  } catch (error) {
    console.error(error);
    return send(res, 500, { error: 'เกิดข้อผิดพลาดในระบบ backend' });
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`IT Asset API running on http://0.0.0.0:${port}`);
});
