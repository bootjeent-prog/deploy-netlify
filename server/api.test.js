import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const port = 4199;
const base = `http://127.0.0.1:${port}`;
const temp = mkdtempSync(join(tmpdir(), 'factory-assets-test-'));
let child;

async function waitForServer() {
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(`${base}/api/health`); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('API server did not start');
}

async function request(path, { method='GET', token='', body } = {}) {
  const r = await fetch(base + path, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!r.ok) throw new Error(`${r.status}: ${data?.error || text}`);
  return data;
}

test.before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, PORT: String(port), DB_PATH: join(temp, 'test.sqlite') },
    stdio: ['ignore', 'ignore', 'inherit']
  });
  await waitForServer();
});

test.after(() => {
  child?.kill('SIGTERM');
  rmSync(temp, { recursive: true, force: true });
});

test('login, asset workflow, stock movement and audit log', async () => {
  const login = await request('/api/auth/login', { method:'POST', body:{ username:'ADMIN-001', password:'admin123' } });
  assert.ok(login.token);
  const token = login.token;

  const bootstrap = await request('/api/bootstrap', { token });
  assert.equal(bootstrap.user.role, 'SUPER_ADMIN');
  assert.ok(bootstrap.assets.length >= 5);

  const assetId = 'TEST-ASSET-001';
  await request('/api/assets', { method:'POST', token, body:{ id:assetId, company:'EVES', name:'Test Asset', category:'IT', serial:'TEST-SERIAL', status:'ACTIVE' } });
  const transfer = await request('/api/transfers', { method:'POST', token, body:{ assetId, toLocation:'Test Room B', transferDate:'2026-07-22' } });
  const approvals = await request('/api/approvals', { token });
  const approval = approvals.find((x) => x.request_no === transfer.request_no);
  assert.ok(approval);
  await request(`/api/approvals/${approval.id}/decision`, { method:'POST', token, body:{ decision:'APPROVED' } });
  const asset = await request(`/api/assets/${assetId}`, { token });
  assert.equal(asset.location, 'Test Room B');

  const stock = await request('/api/stock', { method:'POST', token, body:{ sku:'TEST-SKU-001', company:'EVES', name:'Test Stock', unit:'pcs', warehouse:'IT-STOCK', available:10, min:2 } });
  assert.equal(stock.available, 10);
  await request('/api/stock-movements', { method:'POST', token, body:{ movementType:'ISSUE', sku:'TEST-SKU-001', quantity:3, movementDate:'2026-07-22' } });
  const stockRows = await request('/api/stock', { token });
  assert.equal(stockRows.find((x) => x.sku === 'TEST-SKU-001').available, 7);

  const logs = await request('/api/audit-logs?limit=100', { token });
  assert.ok(logs.some((x) => x.module === 'APPROVAL' && x.action === 'APPROVED'));
});

test('warehouse role cannot create assets', async () => {
  const login = await request('/api/auth/login', { method:'POST', body:{ username:'WH-001', password:'admin123' } });
  const r = await fetch(`${base}/api/assets`, {
    method:'POST', headers:{ Authorization:`Bearer ${login.token}`, 'Content-Type':'application/json' },
    body:JSON.stringify({ id:'DENIED', name:'Denied', category:'IT', serial:'DENIED' })
  });
  assert.equal(r.status, 403);
});
