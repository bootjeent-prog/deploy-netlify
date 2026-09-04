import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { db, dbPath, now, verifyPassword, hashPassword, parseJson, audit } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const distDir = join(rootDir, 'dist');
const port = Number(process.env.PORT || 4000);

const ROLE_NAMES = {
  SUPER_ADMIN: 'Super Admin', COMPANY_ADMIN: 'Company Admin', ASSET_MANAGER: 'Asset Manager',
  WAREHOUSE: 'Warehouse / Stock Officer', MAINTENANCE: 'Maintenance / Engineer',
  DEPARTMENT_HEAD: 'Department Head', EMPLOYEE: 'Employee'
};

const permissions = {
  SUPER_ADMIN: ['*'],
  COMPANY_ADMIN: ['assets','employees','master','transfers','borrow','maintenance','disposals','stock','approvals','reports','audit'],
  ASSET_MANAGER: ['assets','master:read','transfers','borrow','maintenance','disposals','reports'],
  WAREHOUSE: ['stock','stock-movements','reports'],
  MAINTENANCE: ['assets:read','maintenance','stock:read','stock-movements','reports'],
  DEPARTMENT_HEAD: ['assets:read','borrow','transfers:read','approvals','reports'],
  EMPLOYEE: ['assets:read','borrow','maintenance:create']
};

function hasPermission(user, permission) {
  const allowed = permissions[user?.role] || [];
  return allowed.includes('*') || allowed.includes(permission) || allowed.includes(permission.split(':')[0]) || allowed.includes(`${permission.split(':')[0]}:read`) && permission.endsWith(':read');
}

function send(res, status, data, headers = {}) {
  const body = data === undefined ? '' : JSON.stringify(data);
  res.writeHead(status, {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type,Authorization',
    'Content-Type': 'application/json; charset=utf-8',
    ...headers
  });
  res.end(body);
}

function error(res, status, message) { return send(res, status, { error: message }); }

async function parseBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw Object.assign(new Error('รูปแบบ JSON ไม่ถูกต้อง'), { statusCode: 400 }); }
}

function text(value, fallback = '') { return String(value ?? fallback).trim(); }
function num(value, fallback = 0) { const n = Number(value); return Number.isFinite(n) ? n : fallback; }
function dateOnly(value, fallback = '') { return text(value, fallback).slice(0,10); }
function generateNo(prefix) { return `${prefix}-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${randomBytes(3).toString('hex').toUpperCase()}`; }
function ipOf(req) { return String(req.socket.remoteAddress || ''); }
function companyWhere(user, alias = '') { return user.role === 'SUPER_ADMIN' ? { sql: '', params: [] } : { sql: ` WHERE ${alias ? alias + '.' : ''}company_code = ?`, params: [user.company_code] }; }
function companyAnd(user, alias = '') { return user.role === 'SUPER_ADMIN' ? { sql: '', params: [] } : { sql: ` AND ${alias ? alias + '.' : ''}company_code = ?`, params: [user.company_code] }; }
function ensureCompany(user, companyCode) { return user.role === 'SUPER_ADMIN' ? text(companyCode, user.company_code) : user.company_code; }

function authenticate(req) {
  const auth = String(req.headers.authorization || '');
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!token) return null;
  const user = db.prepare(`SELECT e.employee_code,e.full_name,e.company_code,e.department,e.position,e.email,e.phone,e.line_user_id,e.role,e.status,e.location,s.token,s.expires_at
    FROM sessions s JOIN employees e ON e.employee_code=s.employee_code WHERE s.token=? AND s.expires_at>? AND e.status='ACTIVE'`).get(token, now());
  return user || null;
}

function requireAuth(req, res, permission = '') {
  const user = authenticate(req);
  if (!user) { error(res, 401, 'กรุณาเข้าสู่ระบบ'); return null; }
  if (permission && !hasPermission(user, permission)) { error(res, 403, 'บัญชีนี้ไม่มีสิทธิ์ดำเนินการ'); return null; }
  return user;
}

function mapAsset(row) {
  if (!row) return null;
  return {
    id: row.asset_code, assetCode: row.asset_code, company: row.company_code,
    name: row.name, brand: row.brand, model: row.model, category: row.category, subcategory: row.subcategory,
    serial: row.serial, assignedTo: row.assigned_to, department: row.department, location: row.location,
    status: row.status, purchaseDate: row.purchase_date, warrantyUntil: row.warranty_until,
    condition: row.condition_score, purchasePrice: row.purchase_price, usefulLifeYears: row.useful_life_years,
    salvageValue: row.salvage_value, criticality: row.criticality, ownershipType: row.ownership_type,
    vendor: row.vendor, manufacturer: row.manufacturer, items: parseJson(row.items_json, []),
    repairs: parseJson(row.repairs_json, []), returns: parseJson(row.returns_json, []), qrPrintedAt: row.qr_printed_at,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function mapEmployee(row) {
  if (!row) return null;
  return {
    id: row.employee_code, employeeCode: row.employee_code, name: row.full_name, fullName: row.full_name,
    company: row.company_code, companyCode: row.company_code, department: row.department, position: row.position,
    email: row.email, phone: row.phone, lineUserId: row.line_user_id, role: row.role, roleName: ROLE_NAMES[row.role] || row.role,
    status: row.status, location: row.location, createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function mapStock(row) {
  if (!row) return null;
  return {
    sku: row.sku, company: row.company_code, name: row.name, category: row.category, unit: row.unit,
    warehouse: row.warehouse, available: row.available, min: row.min_level, max: row.max_level,
    location: row.location, status: row.status, unitCost: row.unit_cost, lowStock: row.available <= row.min_level,
    updatedAt: row.updated_at
  };
}

function listAssets(user) {
  if (user.role === 'DEPARTMENT_HEAD') {
    return db.prepare(`SELECT * FROM assets WHERE company_code=? AND department=? ORDER BY updated_at DESC`).all(user.company_code,user.department).map(mapAsset);
  }
  if (user.role === 'EMPLOYEE') {
    return db.prepare(`SELECT * FROM assets WHERE company_code=? AND (assigned_to=? OR status='IN_STOCK') ORDER BY updated_at DESC`).all(user.company_code,user.full_name).map(mapAsset);
  }
  const scope = companyWhere(user);
  return db.prepare(`SELECT * FROM assets${scope.sql} ORDER BY updated_at DESC`).all(...scope.params).map(mapAsset);
}

function listEmployees(user) {
  const scope = companyWhere(user);
  return db.prepare(`SELECT * FROM employees${scope.sql} ORDER BY full_name`).all(...scope.params).map(mapEmployee);
}

function listStock(user) {
  const scope = companyWhere(user);
  return db.prepare(`SELECT * FROM stock_items${scope.sql} ORDER BY name`).all(...scope.params).map(mapStock);
}

function getAssetForUser(user, id) {
  if (user.role === 'DEPARTMENT_HEAD') return db.prepare(`SELECT * FROM assets WHERE asset_code=? AND company_code=? AND department=?`).get(id,user.company_code,user.department);
  if (user.role === 'EMPLOYEE') return db.prepare(`SELECT * FROM assets WHERE asset_code=? AND company_code=? AND (assigned_to=? OR status='IN_STOCK')`).get(id,user.company_code,user.full_name);
  const scope = companyAnd(user);
  return db.prepare(`SELECT * FROM assets WHERE asset_code=?${scope.sql}`).get(id, ...scope.params);
}

function createApproval(user, type, requestId, requestNo) {
  db.prepare(`INSERT INTO approvals(company_code,request_type,request_id,request_no,requester,status,requested_at) VALUES(?,?,?,?,?,'PENDING',?)`)
    .run(user.company_code, type, requestId, requestNo, user.full_name, now());
}

function publicAsset(id) {
  const row = db.prepare(`SELECT asset_code,company_code,name,brand,model,category,subcategory,serial,assigned_to,department,location,status,warranty_until,condition_score,criticality,updated_at FROM assets WHERE asset_code=?`).get(id);
  return row ? {
    id: row.asset_code, company: row.company_code, name: row.name, brand: row.brand, model: row.model,
    category: row.category, subcategory: row.subcategory, serial: row.serial, assignedTo: row.assigned_to,
    department: row.department, location: row.location, status: row.status, warrantyUntil: row.warranty_until,
    condition: row.condition_score, criticality: row.criticality, updatedAt: row.updated_at
  } : null;
}

async function serveStatic(req, res, pathname) {
  try {
    let relative = pathname === '/' ? 'index.html' : pathname.replace(/^\//,'');
    relative = normalize(relative).replace(/^\.\.(\/|\\)/, '');
    let filePath = join(distDir, relative);
    try { if (!(await stat(filePath)).isFile()) throw new Error(); }
    catch { filePath = join(distDir, 'index.html'); }
    const data = await readFile(filePath);
    const types = { '.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon' };
    res.writeHead(200, { 'Content-Type': types[extname(filePath)] || 'application/octet-stream' });
    res.end(data);
    return true;
  } catch { return false; }
}

const server = createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') return send(res, 204, undefined);
    const url = new URL(req.url || '/', `http://${req.headers.host}`);
    const p = url.pathname;

    if (req.method === 'GET' && p === '/api/health') return send(res, 200, { ok:true, service:'factory-asset-api', database:dbPath });
    if (req.method === 'GET' && p.startsWith('/api/public/assets/')) {
      const asset = publicAsset(decodeURIComponent(p.split('/').pop()));
      return asset ? send(res, 200, asset) : error(res, 404, 'ไม่พบทรัพย์สิน');
    }

    if (req.method === 'POST' && p === '/api/auth/login') {
      const body = await parseBody(req);
      const login = text(body.username || body.email || body.employeeCode);
      const employee = db.prepare(`SELECT * FROM employees WHERE (employee_code=? OR lower(email)=lower(?)) AND status='ACTIVE'`).get(login, login);
      if (!employee || !verifyPassword(text(body.password), employee.password_hash)) return error(res, 401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง');
      const token = randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
      db.prepare(`DELETE FROM sessions WHERE expires_at<=?`).run(now());
      db.prepare(`INSERT INTO sessions(token,employee_code,expires_at,created_at) VALUES(?,?,?,?)`).run(token, employee.employee_code, expires, now());
      audit({ user: employee, module:'AUTH', action:'LOGIN', entityId:employee.employee_code, ip:ipOf(req) });
      return send(res, 200, { token, user: mapEmployee(employee), expiresAt: expires });
    }

    if (req.method === 'GET' && p === '/api/me') {
      const user = requireAuth(req,res); if (!user) return;
      return send(res,200,{ ...mapEmployee(user), permissions: permissions[user.role] || [] });
    }

    if (req.method === 'POST' && p === '/api/auth/logout') {
      const user = requireAuth(req,res); if (!user) return;
      const token = String(req.headers.authorization || '').slice(7);
      db.prepare(`DELETE FROM sessions WHERE token=?`).run(token);
      audit({ user, module:'AUTH', action:'LOGOUT', entityId:user.employee_code, ip:ipOf(req) });
      return send(res,204,undefined);
    }

    if (req.method === 'GET' && p === '/api/bootstrap') {
      const user = requireAuth(req,res); if (!user) return;
      const companies = user.role === 'SUPER_ADMIN'
        ? db.prepare(`SELECT * FROM companies ORDER BY company_name_en`).all()
        : db.prepare(`SELECT * FROM companies WHERE company_code=?`).all(user.company_code);
      return send(res,200,{ user:mapEmployee(user), assets:listAssets(user), employees:listEmployees(user), stock:listStock(user), companies });
    }

    if (req.method === 'GET' && p === '/api/dashboard') {
      const user = requireAuth(req,res); if (!user) return;
      const scope = companyWhere(user);
      const assets = db.prepare(`SELECT status,condition_score,purchase_price FROM assets${scope.sql}`).all(...scope.params);
      const stock = db.prepare(`SELECT available,min_level,unit_cost FROM stock_items${scope.sql}`).all(...scope.params);
      const approvals = db.prepare(`SELECT COUNT(*) c FROM approvals${scope.sql}${scope.sql ? ' AND' : ' WHERE'} status='PENDING'`).get(...scope.params).c;
      return send(res,200,{
        totalAssets: assets.length,
        activeAssets: assets.filter(x=>x.status==='ACTIVE').length,
        inRepair: assets.filter(x=>x.status==='IN_REPAIR' || x.status==='BROKEN').length,
        attention: assets.filter(x=>x.condition_score<=70 || ['IN_REPAIR','BROKEN','LOST'].includes(x.status)).length,
        assetValue: assets.reduce((s,x)=>s+num(x.purchase_price),0),
        stockItems: stock.length, lowStock: stock.filter(x=>x.available<=x.min_level).length,
        stockValue: stock.reduce((s,x)=>s+num(x.available)*num(x.unit_cost),0), pendingApprovals:Number(approvals)
      });
    }

    // Assets CRUD
    if (req.method === 'GET' && p === '/api/assets') {
      const user = requireAuth(req,res,'assets:read'); if (!user) return;
      return send(res,200,listAssets(user));
    }
    if (req.method === 'POST' && p === '/api/assets') {
      const user = requireAuth(req,res,'assets'); if (!user) return;
      const b = await parseBody(req); const id = text(b.id || b.assetCode);
      if (!id || !text(b.name) || !text(b.category) || !text(b.serial)) return error(res,400,'กรุณากรอก Asset ID, ชื่อ, หมวด และ Serial');
      if (db.prepare(`SELECT 1 FROM assets WHERE asset_code=?`).get(id)) return error(res,409,'Asset ID นี้มีอยู่แล้ว');
      const company = ensureCompany(user,b.company || b.companyCode); const ts=now();
      db.prepare(`INSERT INTO assets(asset_code,company_code,name,brand,model,category,subcategory,serial,assigned_to,department,location,status,purchase_date,warranty_until,condition_score,purchase_price,useful_life_years,salvage_value,criticality,ownership_type,vendor,manufacturer,items_json,repairs_json,returns_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id,company,text(b.name),text(b.brand),text(b.model),text(b.category),text(b.subcategory),text(b.serial),text(b.assignedTo),text(b.department),text(b.location),text(b.status,'ACTIVE'),dateOnly(b.purchaseDate),dateOnly(b.warrantyUntil),num(b.condition,100),num(b.purchasePrice),num(b.usefulLifeYears,5),num(b.salvageValue),text(b.criticality,'MEDIUM'),text(b.ownershipType,'OWNED'),text(b.vendor),text(b.manufacturer),JSON.stringify(b.items||[]),JSON.stringify(b.repairs||[]),JSON.stringify(b.returns||[]),ts,ts);
      const created = mapAsset(db.prepare(`SELECT * FROM assets WHERE asset_code=?`).get(id));
      audit({user,module:'ASSET',action:'CREATE',entityId:id,after:created,ip:ipOf(req)});
      return send(res,201,created);
    }
    const assetMatch = p.match(/^\/api\/assets\/([^/]+)$/);
    if (assetMatch && req.method === 'GET') {
      const user=requireAuth(req,res,'assets:read'); if(!user)return; const row=getAssetForUser(user,decodeURIComponent(assetMatch[1]));
      return row?send(res,200,mapAsset(row)):error(res,404,'ไม่พบทรัพย์สิน');
    }
    if (assetMatch && req.method === 'PUT') {
      const user=requireAuth(req,res,'assets'); if(!user)return; const oldId=decodeURIComponent(assetMatch[1]); const old=getAssetForUser(user,oldId); if(!old)return error(res,404,'ไม่พบทรัพย์สิน');
      const b=await parseBody(req); const newId=text(b.id||b.assetCode,oldId); const company=ensureCompany(user,b.company||b.companyCode||old.company_code); const ts=now();
      db.prepare(`UPDATE assets SET asset_code=?,company_code=?,name=?,brand=?,model=?,category=?,subcategory=?,serial=?,assigned_to=?,department=?,location=?,status=?,purchase_date=?,warranty_until=?,condition_score=?,purchase_price=?,useful_life_years=?,salvage_value=?,criticality=?,ownership_type=?,vendor=?,manufacturer=?,items_json=?,repairs_json=?,returns_json=?,updated_at=? WHERE asset_code=?`)
        .run(newId,company,text(b.name,old.name),text(b.brand,old.brand),text(b.model,old.model),text(b.category,old.category),text(b.subcategory,old.subcategory),text(b.serial,old.serial),text(b.assignedTo,old.assigned_to),text(b.department,old.department),text(b.location,old.location),text(b.status,old.status),dateOnly(b.purchaseDate,old.purchase_date),dateOnly(b.warrantyUntil,old.warranty_until),num(b.condition,old.condition_score),num(b.purchasePrice,old.purchase_price),num(b.usefulLifeYears,old.useful_life_years),num(b.salvageValue,old.salvage_value),text(b.criticality,old.criticality),text(b.ownershipType,old.ownership_type),text(b.vendor,old.vendor),text(b.manufacturer,old.manufacturer),JSON.stringify(b.items??parseJson(old.items_json,[])),JSON.stringify(b.repairs??parseJson(old.repairs_json,[])),JSON.stringify(b.returns??parseJson(old.returns_json,[])),ts,oldId);
      const updated=mapAsset(db.prepare(`SELECT * FROM assets WHERE asset_code=?`).get(newId)); audit({user,module:'ASSET',action:'UPDATE',entityId:newId,before:mapAsset(old),after:updated,ip:ipOf(req)}); return send(res,200,updated);
    }
    if (assetMatch && req.method === 'DELETE') {
      const user=requireAuth(req,res,'assets'); if(!user)return; const id=decodeURIComponent(assetMatch[1]); const old=getAssetForUser(user,id); if(!old)return error(res,404,'ไม่พบทรัพย์สิน');
      if(user.role!=='SUPER_ADMIN'&&user.role!=='COMPANY_ADMIN') return error(res,403,'เฉพาะผู้ดูแลระบบ/บริษัทเท่านั้นที่ลบ Asset ได้');
      const refs = Number(db.prepare(`SELECT (SELECT COUNT(*) FROM transfers WHERE asset_id=?)+(SELECT COUNT(*) FROM borrow_records WHERE asset_id=?)+(SELECT COUNT(*) FROM maintenance WHERE asset_id=?)+(SELECT COUNT(*) FROM disposals WHERE asset_id=?)+(SELECT COUNT(*) FROM asset_events WHERE asset_id=?) AS c`).get(id,id,id,id,id).c);
      if (refs > 0) return error(res,409,'ทรัพย์สินนี้มีประวัติธุรกรรม ไม่สามารถลบถาวรได้ กรุณาใช้ขั้นตอนตัดจำหน่ายหรือเปลี่ยนสถานะ');
      db.prepare(`DELETE FROM assets WHERE asset_code=?`).run(id); audit({user,module:'ASSET',action:'DELETE',entityId:id,before:mapAsset(old),ip:ipOf(req)}); return send(res,204,undefined);
    }

    const assetAction = p.match(/^\/api\/assets\/([^/]+)\/(repairs|returns|location|assignment|qr-printed)$/);
    if (assetAction && req.method === 'POST') {
      const permission = assetAction[2] === 'qr-printed' ? 'assets:read' : ['location','assignment'].includes(assetAction[2]) ? 'assets' : 'maintenance';
      const user=requireAuth(req,res,permission); if(!user)return; const id=decodeURIComponent(assetAction[1]); const row=getAssetForUser(user,id); if(!row)return error(res,404,'ไม่พบทรัพย์สิน'); const b=await parseBody(req); const action=assetAction[2];
      if(action==='repairs') {
        const repairs=[{date:dateOnly(b.date,new Date().toISOString()),detail:text(b.detail||b.issue),cost:num(b.cost),technician:text(b.technician,user.full_name)},...parseJson(row.repairs_json,[])];
        db.prepare(`UPDATE assets SET repairs_json=?,status='IN_REPAIR',updated_at=? WHERE asset_code=?`).run(JSON.stringify(repairs),now(),id);
      } else if(action==='returns') {
        const returns=[{...b,date:dateOnly(b.date,new Date().toISOString())},...parseJson(row.returns_json,[])];
        db.prepare(`UPDATE assets SET returns_json=?,status='IN_STOCK',assigned_to='คลังกลาง',location=?,condition_score=?,updated_at=? WHERE asset_code=?`).run(JSON.stringify(returns),text(b.location,row.location),num(b.condition,row.condition_score),now(),id);
      } else if(action==='location') {
        const next=text(b.location); if(!next)return error(res,400,'กรุณาระบุตำแหน่งใหม่');
        db.prepare(`UPDATE assets SET location=?,updated_at=? WHERE asset_code=?`).run(next,now(),id);
        db.prepare(`INSERT INTO asset_events(company_code,asset_id,event_type,old_value,new_value,actor,note,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(row.company_code,id,'LOCATION',row.location,next,user.full_name,text(b.note),now());
      } else if(action==='assignment') {
        const assignee=text(b.assignedTo); if(!assignee)return error(res,400,'กรุณาระบุผู้รับผิดชอบ');
        db.prepare(`UPDATE assets SET assigned_to=?,department=?,updated_at=? WHERE asset_code=?`).run(assignee,text(b.department,row.department),now(),id);
        db.prepare(`INSERT INTO asset_events(company_code,asset_id,event_type,old_value,new_value,actor,note,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(row.company_code,id,'ASSIGNMENT',row.assigned_to,assignee,user.full_name,text(b.note),now());
      } else {
        db.prepare(`UPDATE assets SET qr_printed_at=?,updated_at=? WHERE asset_code=?`).run(now(),now(),id);
      }
      const updated=mapAsset(db.prepare(`SELECT * FROM assets WHERE asset_code=?`).get(id)); audit({user,module:'ASSET',action:action.toUpperCase(),entityId:id,before:mapAsset(row),after:updated,ip:ipOf(req)}); return send(res,201,updated);
    }

    if (req.method === 'GET' && p === '/api/asset-events') {
      const user=requireAuth(req,res,'assets:read'); if(!user)return; const scope=companyWhere(user);
      return send(res,200,db.prepare(`SELECT * FROM asset_events${scope.sql} ORDER BY created_at DESC LIMIT 500`).all(...scope.params));
    }

    // Employees / users
    if (req.method === 'GET' && p === '/api/employees') { const user=requireAuth(req,res,'employees'); if(!user)return; return send(res,200,listEmployees(user)); }
    if (req.method === 'POST' && p === '/api/employees') {
      const user=requireAuth(req,res,'employees'); if(!user)return; const b=await parseBody(req); const id=text(b.id||b.employeeCode); if(!id||!text(b.name||b.fullName)||!text(b.department))return error(res,400,'ข้อมูลผู้ใช้ไม่ครบ');
      if(db.prepare(`SELECT 1 FROM employees WHERE employee_code=?`).get(id))return error(res,409,'รหัสพนักงานนี้มีอยู่แล้ว'); const company=ensureCompany(user,b.company||b.companyCode); const ts=now();
      db.prepare(`INSERT INTO employees(employee_code,full_name,company_code,department,position,email,phone,line_user_id,role,status,location,password_hash,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(id,text(b.name||b.fullName),company,text(b.department),text(b.position),text(b.email),text(b.phone),text(b.lineUserId),text(b.role,'EMPLOYEE'),text(b.status,'ACTIVE'),text(b.location),hashPassword(text(b.password,'ChangeMe123!')),ts,ts);
      const created=mapEmployee(db.prepare(`SELECT * FROM employees WHERE employee_code=?`).get(id)); audit({user,module:'USER',action:'CREATE',entityId:id,after:created,ip:ipOf(req)}); return send(res,201,created);
    }
    const empMatch=p.match(/^\/api\/employees\/([^/]+)$/);
    if(empMatch && req.method==='PUT') {
      const user=requireAuth(req,res,'employees'); if(!user)return; const oldId=decodeURIComponent(empMatch[1]); const scope=companyAnd(user); const old=db.prepare(`SELECT * FROM employees WHERE employee_code=?${scope.sql}`).get(oldId,...scope.params); if(!old)return error(res,404,'ไม่พบผู้ใช้'); const b=await parseBody(req); const id=text(b.id||b.employeeCode,oldId); const company=ensureCompany(user,b.company||b.companyCode||old.company_code); const newHash=text(b.password)?hashPassword(text(b.password)):old.password_hash;
      db.prepare(`UPDATE employees SET employee_code=?,full_name=?,company_code=?,department=?,position=?,email=?,phone=?,line_user_id=?,role=?,status=?,location=?,password_hash=?,updated_at=? WHERE employee_code=?`).run(id,text(b.name||b.fullName,old.full_name),company,text(b.department,old.department),text(b.position,old.position),text(b.email,old.email),text(b.phone,old.phone),text(b.lineUserId,old.line_user_id),text(b.role,old.role),text(b.status,old.status),text(b.location,old.location),newHash,now(),oldId);
      const updated=mapEmployee(db.prepare(`SELECT * FROM employees WHERE employee_code=?`).get(id)); audit({user,module:'USER',action:'UPDATE',entityId:id,before:mapEmployee(old),after:updated,ip:ipOf(req)}); return send(res,200,updated);
    }
    if(empMatch && req.method==='DELETE') {
      const user=requireAuth(req,res,'employees'); if(!user)return; const id=decodeURIComponent(empMatch[1]); if(id===user.employee_code)return error(res,400,'ไม่สามารถลบบัญชีที่กำลังใช้งาน'); const scope=companyAnd(user); const old=db.prepare(`SELECT * FROM employees WHERE employee_code=?${scope.sql}`).get(id,...scope.params); if(!old)return error(res,404,'ไม่พบผู้ใช้'); db.prepare(`DELETE FROM employees WHERE employee_code=?`).run(id); audit({user,module:'USER',action:'DELETE',entityId:id,before:mapEmployee(old),ip:ipOf(req)}); return send(res,204,undefined);
    }

    // Stock items
    if(req.method==='GET'&&p==='/api/stock'){const user=requireAuth(req,res,'stock:read');if(!user)return;return send(res,200,listStock(user));}
    if(req.method==='POST'&&p==='/api/stock'){const user=requireAuth(req,res,'stock');if(!user)return;const b=await parseBody(req);const sku=text(b.sku);if(!sku||!text(b.name)||!text(b.warehouse))return error(res,400,'กรุณากรอก SKU, ชื่อ และคลัง');if(db.prepare(`SELECT 1 FROM stock_items WHERE sku=?`).get(sku))return error(res,409,'SKU นี้มีอยู่แล้ว');const company=ensureCompany(user,b.company||b.companyCode),ts=now();db.prepare(`INSERT INTO stock_items(sku,company_code,name,category,unit,warehouse,available,min_level,max_level,location,status,unit_cost,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(sku,company,text(b.name),text(b.category),text(b.unit,'pcs'),text(b.warehouse),num(b.available),num(b.min),num(b.max),text(b.location),text(b.status,'ACTIVE'),num(b.unitCost),ts,ts);const created=mapStock(db.prepare(`SELECT * FROM stock_items WHERE sku=?`).get(sku));audit({user,module:'STOCK',action:'CREATE',entityId:sku,after:created,ip:ipOf(req)});return send(res,201,created);}
    const stockMatch=p.match(/^\/api\/stock\/([^/]+)$/);
    if(stockMatch&&req.method==='PUT'){const user=requireAuth(req,res,'stock');if(!user)return;const oldSku=decodeURIComponent(stockMatch[1]);const scope=companyAnd(user);const old=db.prepare(`SELECT * FROM stock_items WHERE sku=?${scope.sql}`).get(oldSku,...scope.params);if(!old)return error(res,404,'ไม่พบรายการ Stock');const b=await parseBody(req),sku=text(b.sku,oldSku),company=ensureCompany(user,b.company||old.company_code);db.prepare(`UPDATE stock_items SET sku=?,company_code=?,name=?,category=?,unit=?,warehouse=?,available=?,min_level=?,max_level=?,location=?,status=?,unit_cost=?,updated_at=? WHERE sku=?`).run(sku,company,text(b.name,old.name),text(b.category,old.category),text(b.unit,old.unit),text(b.warehouse,old.warehouse),num(b.available,old.available),num(b.min,old.min_level),num(b.max,old.max_level),text(b.location,old.location),text(b.status,old.status),num(b.unitCost,old.unit_cost),now(),oldSku);const updated=mapStock(db.prepare(`SELECT * FROM stock_items WHERE sku=?`).get(sku));audit({user,module:'STOCK',action:'UPDATE',entityId:sku,before:mapStock(old),after:updated,ip:ipOf(req)});return send(res,200,updated);}
    if(stockMatch&&req.method==='DELETE'){const user=requireAuth(req,res,'stock');if(!user)return;const sku=decodeURIComponent(stockMatch[1]);const scope=companyAnd(user);const old=db.prepare(`SELECT * FROM stock_items WHERE sku=?${scope.sql}`).get(sku,...scope.params);if(!old)return error(res,404,'ไม่พบรายการ Stock');const refs=Number(db.prepare(`SELECT COUNT(*) AS c FROM stock_movements WHERE sku=?`).get(sku).c);if(refs>0)return error(res,409,'รายการ Stock นี้มีประวัติการเคลื่อนไหว ไม่สามารถลบถาวรได้ กรุณาเปลี่ยนสถานะเป็น INACTIVE');db.prepare(`DELETE FROM stock_items WHERE sku=?`).run(sku);audit({user,module:'STOCK',action:'DELETE',entityId:sku,before:mapStock(old),ip:ipOf(req)});return send(res,204,undefined);}

    if(req.method==='GET'&&p==='/api/stock-movements'){const user=requireAuth(req,res,'stock-movements');if(!user)return;const scope=companyWhere(user);return send(res,200,db.prepare(`SELECT * FROM stock_movements${scope.sql} ORDER BY created_at DESC LIMIT 1000`).all(...scope.params));}
    if(req.method==='POST'&&p==='/api/stock-movements'){const user=requireAuth(req,res,'stock-movements');if(!user)return;const b=await parseBody(req),sku=text(b.sku),type=text(b.movementType||b.movement_type).toUpperCase(),qty=num(b.quantity);if(!sku||!['RECEIVE','ISSUE','TRANSFER','ADJUST'].includes(type)||qty<=0)return error(res,400,'ข้อมูลการเคลื่อนไหว Stock ไม่ถูกต้อง');const scope=companyAnd(user);const item=db.prepare(`SELECT * FROM stock_items WHERE sku=?${scope.sql}`).get(sku,...scope.params);if(!item)return error(res,404,'ไม่พบ SKU');let next=item.available;if(type==='RECEIVE')next+=qty;else if(type==='ISSUE'||type==='TRANSFER')next-=qty;else next=num(b.adjustedBalance,qty);if(next<0)return error(res,400,'Stock ไม่เพียงพอ');const doc=text(b.docNo||b.doc_no,generateNo('STK'));const ts=now();db.exec('BEGIN');try{db.prepare(`UPDATE stock_items SET available=?,warehouse=?,updated_at=? WHERE sku=?`).run(next,type==='TRANSFER'?text(b.toWarehouse,item.warehouse):item.warehouse,ts,sku);db.prepare(`INSERT INTO stock_movements(doc_no,company_code,movement_type,sku,quantity,from_warehouse,to_warehouse,requester,reference,note,status,movement_date,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(doc,item.company_code,type,sku,qty,text(b.fromWarehouse,item.warehouse),text(b.toWarehouse),user.full_name,text(b.reference),text(b.note),'POSTED',dateOnly(b.movementDate,new Date().toISOString()),ts);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}const created=db.prepare(`SELECT * FROM stock_movements WHERE doc_no=?`).get(doc);audit({user,module:'STOCK_MOVEMENT',action:type,entityId:doc,before:{available:item.available},after:{available:next,movement:created},ip:ipOf(req)});return send(res,201,created);}

    // Generic request modules
    if(req.method==='GET'&&p==='/api/transfers'){const user=requireAuth(req,res,'transfers:read');if(!user)return;const scope=companyWhere(user);return send(res,200,db.prepare(`SELECT * FROM transfers${scope.sql} ORDER BY created_at DESC`).all(...scope.params));}
    if(req.method==='POST'&&p==='/api/transfers'){const user=requireAuth(req,res,'transfers');if(!user)return;const b=await parseBody(req),asset=getAssetForUser(user,text(b.assetId||b.asset_id));if(!asset)return error(res,404,'ไม่พบทรัพย์สิน');if(!text(b.toLocation||b.to_location))return error(res,400,'กรุณาระบุปลายทาง');const no=text(b.requestNo||b.request_no,generateNo('TRF')),ts=now();const result=db.prepare(`INSERT INTO transfers(request_no,company_code,asset_id,from_location,to_location,from_department,to_department,from_assignee,to_assignee,requested_by,status,transfer_date,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,'PENDING',?,?,?,?)`).run(no,asset.company_code,asset.asset_code,asset.location,text(b.toLocation||b.to_location),asset.department,text(b.toDepartment||b.to_department),asset.assigned_to,text(b.toAssignee||b.to_assignee),user.full_name,dateOnly(b.transferDate||b.transfer_date,new Date().toISOString()),text(b.note),ts,ts);createApproval(user,'TRANSFER',Number(result.lastInsertRowid),no);const created=db.prepare(`SELECT * FROM transfers WHERE id=?`).get(Number(result.lastInsertRowid));audit({user,module:'TRANSFER',action:'REQUEST',entityId:no,after:created,ip:ipOf(req)});return send(res,201,created);}

    if(req.method==='GET'&&p==='/api/borrow-records'){const user=requireAuth(req,res,'borrow');if(!user)return;const scope=companyWhere(user);return send(res,200,db.prepare(`SELECT * FROM borrow_records${scope.sql} ORDER BY created_at DESC`).all(...scope.params));}
    if(req.method==='POST'&&p==='/api/borrow-records'){const user=requireAuth(req,res,'borrow');if(!user)return;const b=await parseBody(req),asset=getAssetForUser(user,text(b.assetId||b.asset_id));if(!asset)return error(res,404,'ไม่พบทรัพย์สิน');const no=text(b.requestNo||b.request_no,generateNo('BRW')),ts=now();const borrower=user.role==='EMPLOYEE'?user.full_name:text(b.borrower,user.full_name);const result=db.prepare(`INSERT INTO borrow_records(request_no,company_code,asset_id,borrower,borrow_date,due_date,condition_out,status,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'PENDING',?,?,?)`).run(no,asset.company_code,asset.asset_code,borrower,dateOnly(b.borrowDate||b.borrow_date,new Date().toISOString()),dateOnly(b.dueDate||b.due_date),num(b.conditionOut||b.condition_out,asset.condition_score),text(b.note),ts,ts);createApproval(user,'BORROW',Number(result.lastInsertRowid),no);const created=db.prepare(`SELECT * FROM borrow_records WHERE id=?`).get(Number(result.lastInsertRowid));audit({user,module:'BORROW',action:'REQUEST',entityId:no,after:created,ip:ipOf(req)});return send(res,201,created);}
    const borrowReturn=p.match(/^\/api\/borrow-records\/(\d+)\/return$/);
    if(borrowReturn&&req.method==='POST'){const user=requireAuth(req,res,'borrow');if(!user)return;const id=Number(borrowReturn[1]),scope=companyAnd(user);const record=db.prepare(`SELECT * FROM borrow_records WHERE id=?${scope.sql}`).get(id,...scope.params);if(!record)return error(res,404,'ไม่พบรายการยืม');const b=await parseBody(req),ts=now();db.prepare(`UPDATE borrow_records SET return_date=?,condition_in=?,status='RETURNED',note=?,updated_at=? WHERE id=?`).run(dateOnly(b.returnDate||b.return_date,new Date().toISOString()),num(b.conditionIn||b.condition_in,100),text(b.note,record.note),ts,id);db.prepare(`UPDATE assets SET status='ACTIVE',assigned_to=?,condition_score=?,updated_at=? WHERE asset_code=?`).run(text(b.receivedBy,'คลังกลาง'),num(b.conditionIn||b.condition_in,100),ts,record.asset_id);audit({user,module:'BORROW',action:'RETURN',entityId:record.request_no,before:record,after:db.prepare(`SELECT * FROM borrow_records WHERE id=?`).get(id),ip:ipOf(req)});return send(res,200,db.prepare(`SELECT * FROM borrow_records WHERE id=?`).get(id));}

    if(req.method==='GET'&&p==='/api/maintenance'){const user=requireAuth(req,res,'maintenance');if(!user)return;const scope=companyWhere(user);return send(res,200,db.prepare(`SELECT * FROM maintenance${scope.sql} ORDER BY created_at DESC`).all(...scope.params).map(x=>({...x,parts:parseJson(x.parts_json,[])})));}
    if(req.method==='POST'&&p==='/api/maintenance'){const user=requireAuth(req,res,'maintenance:create');if(!user)return;const b=await parseBody(req),asset=getAssetForUser(user,text(b.assetId||b.asset_id));if(!asset)return error(res,404,'ไม่พบทรัพย์สิน');const ticket=text(b.ticketNo||b.ticket_no,generateNo('MNT')),ts=now();db.prepare(`INSERT INTO maintenance(ticket_no,company_code,asset_id,issue,technician,parts_json,cost,status,opened_date,closed_date,note,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(ticket,asset.company_code,asset.asset_code,text(b.issue),text(b.technician),JSON.stringify(b.parts||[]),num(b.cost),text(b.status,'OPEN'),dateOnly(b.openedDate||b.opened_date,new Date().toISOString()),dateOnly(b.closedDate||b.closed_date),text(b.note),ts,ts);db.prepare(`UPDATE assets SET status='IN_REPAIR',updated_at=? WHERE asset_code=?`).run(ts,asset.asset_code);const created=db.prepare(`SELECT * FROM maintenance WHERE ticket_no=?`).get(ticket);audit({user,module:'MAINTENANCE',action:'CREATE',entityId:ticket,after:created,ip:ipOf(req)});return send(res,201,{...created,parts:parseJson(created.parts_json,[])});}
    const maintenanceClose=p.match(/^\/api\/maintenance\/(\d+)\/close$/);
    if(maintenanceClose&&req.method==='POST'){const user=requireAuth(req,res,'maintenance');if(!user)return;const id=Number(maintenanceClose[1]),scope=companyAnd(user);const rec=db.prepare(`SELECT * FROM maintenance WHERE id=?${scope.sql}`).get(id,...scope.params);if(!rec)return error(res,404,'ไม่พบ Ticket');const b=await parseBody(req),ts=now();db.prepare(`UPDATE maintenance SET technician=?,cost=?,status='CLOSED',closed_date=?,note=?,updated_at=? WHERE id=?`).run(text(b.technician,rec.technician),num(b.cost,rec.cost),dateOnly(b.closedDate||b.closed_date,new Date().toISOString()),text(b.note,rec.note),ts,id);db.prepare(`UPDATE assets SET status='ACTIVE',updated_at=? WHERE asset_code=?`).run(ts,rec.asset_id);const updated=db.prepare(`SELECT * FROM maintenance WHERE id=?`).get(id);audit({user,module:'MAINTENANCE',action:'CLOSE',entityId:rec.ticket_no,before:rec,after:updated,ip:ipOf(req)});return send(res,200,{...updated,parts:parseJson(updated.parts_json,[])});}

    if(req.method==='GET'&&p==='/api/disposals'){const user=requireAuth(req,res,'disposals');if(!user)return;const scope=companyWhere(user);return send(res,200,db.prepare(`SELECT * FROM disposals${scope.sql} ORDER BY created_at DESC`).all(...scope.params));}
    if(req.method==='POST'&&p==='/api/disposals'){const user=requireAuth(req,res,'disposals');if(!user)return;const b=await parseBody(req),asset=getAssetForUser(user,text(b.assetId||b.asset_id));if(!asset)return error(res,404,'ไม่พบทรัพย์สิน');const no=text(b.requestNo||b.request_no,generateNo('DSP')),ts=now();const result=db.prepare(`INSERT INTO disposals(request_no,company_code,asset_id,reason,disposal_method,estimated_value,status,requested_by,disposal_date,note,created_at,updated_at) VALUES(?,?,?,?,?,?,'PENDING',?,?,?,?,?)`).run(no,asset.company_code,asset.asset_code,text(b.reason),text(b.disposalMethod||b.disposal_method,'SCRAP'),num(b.estimatedValue||b.estimated_value),user.full_name,dateOnly(b.disposalDate||b.disposal_date,new Date().toISOString()),text(b.note),ts,ts);createApproval(user,'DISPOSAL',Number(result.lastInsertRowid),no);const created=db.prepare(`SELECT * FROM disposals WHERE id=?`).get(Number(result.lastInsertRowid));audit({user,module:'DISPOSAL',action:'REQUEST',entityId:no,after:created,ip:ipOf(req)});return send(res,201,created);}

    // Approvals and workflow effects
    if(req.method==='GET'&&p==='/api/approvals'){const user=requireAuth(req,res,'approvals');if(!user)return;const scope=companyWhere(user);return send(res,200,db.prepare(`SELECT * FROM approvals${scope.sql} ORDER BY requested_at DESC`).all(...scope.params));}
    const approvalDecision=p.match(/^\/api\/approvals\/(\d+)\/decision$/);
    if(approvalDecision&&req.method==='POST'){const user=requireAuth(req,res,'approvals');if(!user)return;const id=Number(approvalDecision[1]),scope=companyAnd(user);const approval=db.prepare(`SELECT * FROM approvals WHERE id=?${scope.sql}`).get(id,...scope.params);if(!approval)return error(res,404,'ไม่พบคำขออนุมัติ');if(approval.status!=='PENDING')return error(res,400,'คำขอนี้ถูกดำเนินการแล้ว');const b=await parseBody(req),decision=text(b.decision).toUpperCase();if(!['APPROVED','REJECTED'].includes(decision))return error(res,400,'การตัดสินใจไม่ถูกต้อง');const ts=now();db.exec('BEGIN');try{db.prepare(`UPDATE approvals SET status=?,approver=?,decided_at=?,note=? WHERE id=?`).run(decision,user.full_name,ts,text(b.note),id);if(approval.request_type==='TRANSFER'){const r=db.prepare(`SELECT * FROM transfers WHERE id=?`).get(approval.request_id);db.prepare(`UPDATE transfers SET status=?,approved_by=?,updated_at=? WHERE id=?`).run(decision,user.full_name,ts,r.id);if(decision==='APPROVED'){db.prepare(`UPDATE assets SET location=?,department=?,assigned_to=?,status='ACTIVE',updated_at=? WHERE asset_code=?`).run(r.to_location,r.to_department||'',r.to_assignee||'',ts,r.asset_id);db.prepare(`INSERT INTO asset_events(company_code,asset_id,event_type,old_value,new_value,actor,note,created_at) VALUES(?,?,?,?,?,?,?,?)`).run(r.company_code,r.asset_id,'TRANSFER',r.from_location,r.to_location,user.full_name,r.note,ts);}}else if(approval.request_type==='BORROW'){const r=db.prepare(`SELECT * FROM borrow_records WHERE id=?`).get(approval.request_id);db.prepare(`UPDATE borrow_records SET status=?,updated_at=? WHERE id=?`).run(decision,ts,r.id);if(decision==='APPROVED')db.prepare(`UPDATE assets SET status='BORROWED',assigned_to=?,updated_at=? WHERE asset_code=?`).run(r.borrower,ts,r.asset_id);}else if(approval.request_type==='DISPOSAL'){const r=db.prepare(`SELECT * FROM disposals WHERE id=?`).get(approval.request_id);db.prepare(`UPDATE disposals SET status=?,approved_by=?,updated_at=? WHERE id=?`).run(decision,user.full_name,ts,r.id);if(decision==='APPROVED')db.prepare(`UPDATE assets SET status='DISPOSED',updated_at=? WHERE asset_code=?`).run(ts,r.asset_id);}db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}const updated=db.prepare(`SELECT * FROM approvals WHERE id=?`).get(id);audit({user,module:'APPROVAL',action:decision,entityId:approval.request_no,before:approval,after:updated,ip:ipOf(req)});return send(res,200,updated);}

    // Depreciation
    if(req.method==='GET'&&p==='/api/depreciation'){const user=requireAuth(req,res,'assets:read');if(!user)return;const asOf=dateOnly(url.searchParams.get('asOf')||new Date().toISOString());const records=listAssets(user).map(a=>{const purchase=new Date(`${a.purchaseDate||asOf}T00:00:00Z`),end=new Date(`${asOf}T00:00:00Z`);const years=Math.max(0,(end-purchase)/(365.25*86400000)),life=Math.max(0.1,num(a.usefulLifeYears,5)),depreciable=Math.max(0,num(a.purchasePrice)-num(a.salvageValue)),annual=depreciable/life,accumulated=Math.min(depreciable,annual*years),book=Math.max(num(a.salvageValue),num(a.purchasePrice)-accumulated);return{asset_id:a.id,name:a.name,company_code:a.company,purchase_date:a.purchaseDate,purchase_price:a.purchasePrice,useful_life_years:life,annual_depreciation:annual,accumulated_depreciation:accumulated,book_value:book,as_of:asOf};});return send(res,200,records);}

    // Company master CRUD
    if(req.method==='GET'&&p==='/api/companies'){const user=requireAuth(req,res,'master:read');if(!user)return;const rows=user.role==='SUPER_ADMIN'?db.prepare(`SELECT * FROM companies ORDER BY company_name_en`).all():db.prepare(`SELECT * FROM companies WHERE company_code=?`).all(user.company_code);return send(res,200,rows.map(x=>({id:x.company_code,code:x.company_code,name:x.company_name_en,status:x.status,data:x})));}
    if(req.method==='POST'&&p==='/api/companies'){const user=requireAuth(req,res,'master');if(!user)return;if(user.role!=='SUPER_ADMIN')return error(res,403,'เฉพาะ Super Admin เท่านั้นที่เพิ่มบริษัทได้');const b=await parseBody(req),code=text(b.code||b.company_code);if(!code||!text(b.name||b.company_name_en))return error(res,400,'กรุณากรอกรหัสและชื่อบริษัท');const ts=now();db.prepare(`INSERT INTO companies(company_code,company_name_th,company_name_en,tax_id,address,phone,email,logo_url,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)`).run(code,text(b.company_name_th||b.name),text(b.company_name_en||b.name),text(b.tax_id),text(b.address),text(b.phone),text(b.email),text(b.logo_url),text(b.status,'ACTIVE'),ts,ts);const created=db.prepare(`SELECT * FROM companies WHERE company_code=?`).get(code);audit({user,module:'MASTER',action:'CREATE',entityId:`company:${code}`,after:created,ip:ipOf(req)});return send(res,201,{id:code,code,name:created.company_name_en,status:created.status,data:created});}
    const companyMatch=p.match(/^\/api\/companies\/([^/]+)$/);
    if(companyMatch&&req.method==='PUT'){const user=requireAuth(req,res,'master');if(!user)return;if(user.role!=='SUPER_ADMIN')return error(res,403,'เฉพาะ Super Admin เท่านั้นที่แก้ไขบริษัทได้');const oldCode=decodeURIComponent(companyMatch[1]),old=db.prepare(`SELECT * FROM companies WHERE company_code=?`).get(oldCode);if(!old)return error(res,404,'ไม่พบบริษัท');const b=await parseBody(req),code=text(b.code||b.company_code,oldCode);db.prepare(`UPDATE companies SET company_code=?,company_name_th=?,company_name_en=?,tax_id=?,address=?,phone=?,email=?,logo_url=?,status=?,updated_at=? WHERE company_code=?`).run(code,text(b.company_name_th||b.name,old.company_name_th),text(b.company_name_en||b.name,old.company_name_en),text(b.tax_id,old.tax_id),text(b.address,old.address),text(b.phone,old.phone),text(b.email,old.email),text(b.logo_url,old.logo_url),text(b.status,old.status),now(),oldCode);const updated=db.prepare(`SELECT * FROM companies WHERE company_code=?`).get(code);audit({user,module:'MASTER',action:'UPDATE',entityId:`company:${code}`,before:old,after:updated,ip:ipOf(req)});return send(res,200,{id:code,code,name:updated.company_name_en,status:updated.status,data:updated});}
    if(companyMatch&&req.method==='DELETE'){const user=requireAuth(req,res,'master');if(!user)return;if(user.role!=='SUPER_ADMIN')return error(res,403,'เฉพาะ Super Admin เท่านั้นที่ลบบริษัทได้');const code=decodeURIComponent(companyMatch[1]),old=db.prepare(`SELECT * FROM companies WHERE company_code=?`).get(code);if(!old)return error(res,404,'ไม่พบบริษัท');const refs=db.prepare(`SELECT (SELECT COUNT(*) FROM assets WHERE company_code=?)+(SELECT COUNT(*) FROM employees WHERE company_code=?)+(SELECT COUNT(*) FROM stock_items WHERE company_code=?) c`).get(code,code,code).c;if(refs>0)return error(res,400,'ไม่สามารถลบบริษัทที่มีข้อมูลทรัพย์สิน ผู้ใช้ หรือ Stock อยู่');db.prepare(`DELETE FROM companies WHERE company_code=?`).run(code);audit({user,module:'MASTER',action:'DELETE',entityId:`company:${code}`,before:old,ip:ipOf(req)});return send(res,204,undefined);}

    // Master data all 20 groups. Company is mapped from companies table, employee is handled separately.
    const masterMatch=p.match(/^\/api\/master\/([a-z0-9-]+)(?:\/(\d+))?$/);
    if(masterMatch){const type=masterMatch[1],id=masterMatch[2]?Number(masterMatch[2]):0;const allowedTypes=new Set(['brand','site','building','floor','zone','room','department','cost-center','asset-category','asset-subcategory','asset-status','asset-condition','criticality','ownership-type','vendor','manufacturer','unit','warehouse']);if(!allowedTypes.has(type))return error(res,404,'ไม่พบ Master Data ประเภทนี้');if(req.method==='GET'){const user=requireAuth(req,res,'master:read');if(!user)return;let rows=db.prepare(`SELECT * FROM master_records WHERE master_type=? ORDER BY name`).all(type);if(user.role!=='SUPER_ADMIN')rows=rows.filter(x=>!x.company_code||x.company_code===user.company_code);return send(res,200,rows.map(x=>({...x,data:parseJson(x.data_json,{})})));}if(req.method==='POST'){const user=requireAuth(req,res,'master');if(!user)return;const b=await parseBody(req),code=text(b.code);if(!code||!text(b.name))return error(res,400,'กรุณากรอกรหัสและชื่อ');const ts=now();const result=db.prepare(`INSERT INTO master_records(master_type,code,name,parent_code,company_code,status,data_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)`).run(type,code,text(b.name),text(b.parentCode||b.parent_code),ensureCompany(user,b.companyCode||b.company_code||''),text(b.status,'ACTIVE'),JSON.stringify(b.data||{}),ts,ts);const created=db.prepare(`SELECT * FROM master_records WHERE id=?`).get(Number(result.lastInsertRowid));audit({user,module:'MASTER',action:'CREATE',entityId:`${type}:${code}`,after:created,ip:ipOf(req)});return send(res,201,{...created,data:parseJson(created.data_json,{})});}if(id&&req.method==='PUT'){const user=requireAuth(req,res,'master');if(!user)return;const old=db.prepare(`SELECT * FROM master_records WHERE id=? AND master_type=?`).get(id,type);if(!old)return error(res,404,'ไม่พบข้อมูล');if(user.role!=='SUPER_ADMIN'&&old.company_code&&old.company_code!==user.company_code)return error(res,403,'ไม่มีสิทธิ์แก้ไขข้อมูลบริษัทอื่น');const b=await parseBody(req);db.prepare(`UPDATE master_records SET code=?,name=?,parent_code=?,company_code=?,status=?,data_json=?,updated_at=? WHERE id=?`).run(text(b.code,old.code),text(b.name,old.name),text(b.parentCode||b.parent_code,old.parent_code),ensureCompany(user,b.companyCode||b.company_code||old.company_code),text(b.status,old.status),JSON.stringify(b.data??parseJson(old.data_json,{})),now(),id);const updated=db.prepare(`SELECT * FROM master_records WHERE id=?`).get(id);audit({user,module:'MASTER',action:'UPDATE',entityId:`${type}:${updated.code}`,before:old,after:updated,ip:ipOf(req)});return send(res,200,{...updated,data:parseJson(updated.data_json,{})});}if(id&&req.method==='DELETE'){const user=requireAuth(req,res,'master');if(!user)return;const old=db.prepare(`SELECT * FROM master_records WHERE id=? AND master_type=?`).get(id,type);if(!old)return error(res,404,'ไม่พบข้อมูล');if(user.role!=='SUPER_ADMIN'&&old.company_code&&old.company_code!==user.company_code)return error(res,403,'ไม่มีสิทธิ์ลบข้อมูลบริษัทอื่น');db.prepare(`DELETE FROM master_records WHERE id=?`).run(id);audit({user,module:'MASTER',action:'DELETE',entityId:`${type}:${old.code}`,before:old,ip:ipOf(req)});return send(res,204,undefined);}}

    if(req.method==='GET'&&p==='/api/master/company'){const user=requireAuth(req,res,'master:read');if(!user)return;const rows=user.role==='SUPER_ADMIN'?db.prepare(`SELECT * FROM companies ORDER BY company_name_en`).all():db.prepare(`SELECT * FROM companies WHERE company_code=?`).all(user.company_code);return send(res,200,rows.map(x=>({id:x.company_code,code:x.company_code,name:x.company_name_en,status:x.status,data:x})));}

    if(req.method==='GET'&&p==='/api/audit-logs'){const user=requireAuth(req,res,'audit');if(!user)return;const scope=companyWhere(user);const limit=Math.min(2000,Math.max(1,num(url.searchParams.get('limit'),500)));return send(res,200,db.prepare(`SELECT * FROM audit_logs${scope.sql} ORDER BY created_at DESC LIMIT ?`).all(...scope.params,limit));}

    if(req.method==='GET'&&p.startsWith('/api/reports/')){
      const user=requireAuth(req,res,'reports');if(!user)return;const kind=p.split('/').pop();let rows=[];
      if(kind==='assets')rows=listAssets(user);else if(kind==='stock')rows=listStock(user);else if(kind==='maintenance'){const scope=companyWhere(user);rows=db.prepare(`SELECT * FROM maintenance${scope.sql} ORDER BY created_at DESC`).all(...scope.params);}else if(kind==='transfers'){const scope=companyWhere(user);rows=db.prepare(`SELECT * FROM transfers${scope.sql} ORDER BY created_at DESC`).all(...scope.params);}else return error(res,404,'ไม่พบรายงาน');
      return send(res,200,{kind,generatedAt:now(),rows});
    }

    if(p.startsWith('/api/')) return error(res,404,'ไม่พบ API endpoint');
    if(await serveStatic(req,res,p))return;
    return error(res,404,'ไม่พบหน้าเว็บ กรุณารัน npm run build ก่อน');
  } catch (e) {
    console.error(e);
    const message = String(e?.message || '');
    if (message.includes('UNIQUE constraint failed')) return error(res,409,'ข้อมูลรหัสนี้มีอยู่ในระบบแล้ว');
    if (message.includes('FOREIGN KEY constraint failed')) return error(res,409,'ไม่สามารถลบหรือแก้ไขข้อมูลนี้ได้ เนื่องจากมีประวัติหรือข้อมูลอื่นอ้างอิงอยู่');
    return error(res,e.statusCode||500,e.statusCode?e.message:'เกิดข้อผิดพลาดในระบบ backend');
  }
});

server.listen(port,'0.0.0.0',()=>console.log(`Factory Asset Management running on http://0.0.0.0:${port}`));
