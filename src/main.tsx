import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  AlertTriangle,
  Archive,
  Boxes,
  CalendarDays,
  ClipboardList,
  Laptop,
  LayoutDashboard,
  PackageCheck,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Search,
  Trash2,
  UserPlus,
  Users,
  Wrench
} from 'lucide-react';
import './styles.css';

type AssetStatus = 'ใช้งานอยู่' | 'อยู่ในสต็อก' | 'ซ่อมบำรุง' | 'ปลดระวาง';

type Asset = {
  id: string;
  name: string;
  category: string;
  serial: string;
  assignedTo: string;
  department: string;
  location: string;
  status: AssetStatus;
  purchaseDate: string;
  warrantyUntil: string;
  condition: number;
  repairs: { date: string; detail: string; cost: number; technician: string }[];
  returns?: ReturnRecord[];
};

type RepairRecord = Asset['repairs'][number];

type ReturnRecord = {
  date: string;
  returnedBy: string;
  receivedBy: string;
  location: string;
  condition: number;
  note: string;
};

type Employee = {
  id: string;
  name: string;
  department: string;
  position: string;
  email: string;
  location: string;
};

type StockItem = {
  name: string;
  sku: string;
  available: number;
  min: number;
  location: string;
};

type BootstrapData = {
  assets: Asset[];
  employees: Employee[];
  stock: StockItem[];
};

const initialAssets: Asset[] = [
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
];

const initialEmployees: Employee[] = [
  { id: 'EMP-1001', name: 'กมลชนก ศรีวัฒน์', department: 'บัญชี', position: 'Accounting Manager', email: 'kamonchanok@example.com', location: 'ชั้น 12 อาคาร A' },
  { id: 'EMP-1002', name: 'วรุตม์ ภักดี', department: 'Product', position: 'Product Manager', email: 'warut@example.com', location: 'ชั้น 9 อาคาร B' },
  { id: 'EMP-1003', name: 'พรทิพย์ ใจดี', department: 'Sales', position: 'Sales Executive', email: 'porntip@example.com', location: 'สาขาเชียงใหม่' },
  { id: 'EMP-IT-STOCK', name: 'คลังกลาง', department: 'IT', position: 'IT Stock', email: 'it-stock@example.com', location: 'คลัง IT ชั้น 4' }
];

const stock: StockItem[] = [
  { name: 'USB-C Hub 8-in-1', sku: 'ACC-HUB-08', available: 4, min: 8, location: 'คลัง IT ชั้น 4' },
  { name: 'Logitech MX Master 3S', sku: 'ACC-MOU-3S', available: 13, min: 10, location: 'คลัง IT ชั้น 4' },
  { name: 'RAM DDR5 16GB', sku: 'SP-RAM-D5-16', available: 3, min: 6, location: 'ห้องซ่อม' },
  { name: 'สาย HDMI 2m', sku: 'CB-HDMI-02', available: 28, min: 12, location: 'คลัง IT ชั้น 4' }
];

const tabs = [
  { id: 'dashboard', label: 'ภาพรวม', icon: LayoutDashboard },
  { id: 'assets', label: 'ทรัพย์สิน', icon: Laptop },
  { id: 'stock', label: 'สต็อก', icon: Archive },
  { id: 'users', label: 'ผู้ใช้', icon: Users }
] as const;

function formatDate(date: string) {
  if (!date) return '-';
  const parsedDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? new Date(`${date}T00:00:00+07:00`) : new Date(date);
  if (Number.isNaN(parsedDate.getTime())) return '-';
  const day = String(parsedDate.getDate()).padStart(2, '0');
  const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
  const year = parsedDate.getFullYear();
  return `${day}/${month}/${year}`;
}

function toDateInputValue(date: string) {
  if (!date) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const parsedDate = new Date(date);
  if (Number.isNaN(parsedDate.getTime())) return '';
  const year = parsedDate.getFullYear();
  const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
  const day = String(parsedDate.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function toDisplayDateValue(date: string) {
  const isoDate = toDateInputValue(date);
  if (!isoDate) return '';
  const [year, month, day] = isoDate.split('-');
  return `${day}/${month}/${year}`;
}

function fromDisplayDateValue(value: string) {
  const normalized = value.trim().replaceAll('.', '/').replaceAll('-', '/');
  const match = normalized.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return '';

  const [, day, month, year] = match;
  const parsedDate = new Date(`${year}-${month}-${day}T00:00:00+07:00`);
  if (
    Number.isNaN(parsedDate.getTime()) ||
    parsedDate.getDate() !== Number(day) ||
    parsedDate.getMonth() + 1 !== Number(month) ||
    parsedDate.getFullYear() !== Number(year)
  ) {
    return '';
  }

  return `${year}-${month}-${day}`;
}

function DateTextInput({
  value,
  onChange,
  required = false
}: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
}) {
  const [displayValue, setDisplayValue] = useState(toDisplayDateValue(value));
  const datePickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplayValue(toDisplayDateValue(value));
  }, [value]);

  function changeDate(event: React.ChangeEvent<HTMLInputElement>) {
    const nextValue = event.target.value;
    setDisplayValue(nextValue);

    if (!nextValue.trim()) {
      onChange('');
      return;
    }

    const isoDate = fromDisplayDateValue(nextValue);
    if (isoDate) onChange(isoDate);
  }

  function blurDate() {
    const isoDate = fromDisplayDateValue(displayValue);
    if (isoDate) {
      setDisplayValue(toDisplayDateValue(isoDate));
      onChange(isoDate);
    }
  }

  function openDatePicker() {
    const picker = datePickerRef.current;
    if (!picker) return;
    const pickerWithCalendar = picker as HTMLInputElement & { showPicker?: () => void };

    if (pickerWithCalendar.showPicker) {
      pickerWithCalendar.showPicker();
      return;
    }

    pickerWithCalendar.click();
  }

  return (
    <div className="date-input">
      <input
        inputMode="numeric"
        pattern="\d{2}/\d{2}/\d{4}"
        placeholder="dd/mm/yyyy"
        value={displayValue}
        onBlur={blurDate}
        onChange={changeDate}
        required={required}
      />
      <input
        ref={datePickerRef}
        className="date-input-native"
        tabIndex={-1}
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-hidden="true"
      />
      <button className="date-input-button" type="button" onClick={openDatePicker} aria-label="เลือกวันที่">
        <CalendarDays size={18} />
      </button>
    </div>
  );
}

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options?.headers ?? {})
    }
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: 'API request failed' }));
    throw new Error(payload.error ?? 'API request failed');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function App() {
  const [activeTab, setActiveTab] = useState<(typeof tabs)[number]['id']>('dashboard');
  const [assetList, setAssetList] = useState<Asset[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState('');
  const [query, setQuery] = useState('');
  const [selectedAssetId, setSelectedAssetId] = useState('');
  const selectedAsset = assetList.find((asset) => asset.id === selectedAssetId) ?? assetList[0];

  useEffect(() => {
    let isMounted = true;

    apiRequest<BootstrapData>('/api/bootstrap')
      .then((data) => {
        if (!isMounted) return;
        setAssetList(data.assets);
        setEmployees(data.employees);
        setStockItems(data.stock);
        setSelectedAssetId(data.assets[0]?.id ?? '');
        setErrorMessage('');
      })
      .catch((error: Error) => {
        if (isMounted) setErrorMessage(error.message);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, []);

  const filteredAssets = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return assetList;
    return assetList.filter((asset) =>
      [asset.id, asset.name, asset.serial, asset.assignedTo, asset.department, asset.status]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [assetList, query]);

  async function addAsset(asset: Asset) {
    const createdAsset = await apiRequest<Asset>('/api/assets', {
      method: 'POST',
      body: JSON.stringify(asset)
    });
    setAssetList((current) => [createdAsset, ...current]);
    setSelectedAssetId(createdAsset.id);
    setActiveTab('assets');
  }

  async function updateAsset(assetId: string, asset: Asset) {
    const updatedAsset = await apiRequest<Asset>(`/api/assets/${encodeURIComponent(assetId)}`, {
      method: 'PUT',
      body: JSON.stringify(asset)
    });
    setAssetList((current) => current.map((currentAsset) => (currentAsset.id === assetId ? updatedAsset : currentAsset)));
    setSelectedAssetId(updatedAsset.id);
  }

  async function deleteAsset(assetId: string) {
    await apiRequest<void>(`/api/assets/${encodeURIComponent(assetId)}`, { method: 'DELETE' });
    setAssetList((current) => {
      const nextAssets = current.filter((asset) => asset.id !== assetId);
      setSelectedAssetId((currentSelectedId) => (currentSelectedId === assetId ? nextAssets[0]?.id ?? '' : currentSelectedId));
      return nextAssets;
    });
  }

  async function addEmployee(employee: Employee) {
    const createdEmployee = await apiRequest<Employee>('/api/employees', {
      method: 'POST',
      body: JSON.stringify(employee)
    });
    setEmployees((current) => [createdEmployee, ...current]);
  }

  async function updateEmployee(employeeId: string, employee: Employee) {
    const updatedEmployee = await apiRequest<Employee>(`/api/employees/${encodeURIComponent(employeeId)}`, {
      method: 'PUT',
      body: JSON.stringify(employee)
    });
    setEmployees((current) => current.map((currentEmployee) => (currentEmployee.id === employeeId ? updatedEmployee : currentEmployee)));
  }

  async function deleteEmployee(employeeId: string) {
    await apiRequest<void>(`/api/employees/${encodeURIComponent(employeeId)}`, { method: 'DELETE' });
    setEmployees((current) => current.filter((employee) => employee.id !== employeeId));
  }

  async function addRepair(assetId: string, repair: RepairRecord) {
    const updatedAsset = await apiRequest<Asset>(`/api/assets/${encodeURIComponent(assetId)}/repairs`, {
      method: 'POST',
      body: JSON.stringify(repair)
    });
    setAssetList((current) => current.map((asset) => (asset.id === assetId ? updatedAsset : asset)));
  }

  async function returnAsset(assetId: string, returnRecord: ReturnRecord) {
    const updatedAsset = await apiRequest<Asset>(`/api/assets/${encodeURIComponent(assetId)}/returns`, {
      method: 'POST',
      body: JSON.stringify(returnRecord)
    });
    setAssetList((current) => current.map((asset) => (asset.id === assetId ? updatedAsset : asset)));
    setSelectedAssetId(updatedAsset.id);
  }

  async function addStockItem(item: StockItem) {
    const createdItem = await apiRequest<StockItem>('/api/stock', {
      method: 'POST',
      body: JSON.stringify(item)
    });
    setStockItems((current) => [createdItem, ...current]);
    setActiveTab('stock');
  }

  async function updateStockItem(sku: string, item: StockItem) {
    const updatedItem = await apiRequest<StockItem>(`/api/stock/${encodeURIComponent(sku)}`, {
      method: 'PUT',
      body: JSON.stringify(item)
    });
    setStockItems((current) => current.map((currentItem) => (currentItem.sku === sku ? updatedItem : currentItem)));
  }

  async function deleteStockItem(sku: string) {
    await apiRequest<void>(`/api/stock/${encodeURIComponent(sku)}`, { method: 'DELETE' });
    setStockItems((current) => current.filter((item) => item.sku !== sku));
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Boxes size={24} /></div>
          <div>
            <strong>IT Asset</strong>
            <span>Inventory Management</span>
          </div>
        </div>
        <nav>
          {tabs.map((tab) => {
            const Icon = tab.icon;
            return (
              <button key={tab.id} className={activeTab === tab.id ? 'active' : ''} onClick={() => setActiveTab(tab.id)}>
                <Icon size={18} />
                {tab.label}
              </button>
            );
          })}
        </nav>
        <div className="sidebar-note">
          <PackageCheck size={22} />
          <p>จัดการทะเบียนทรัพย์สิน ผู้ถือครอง สถานะคลัง และประวัติซ่อมในที่เดียว</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>ระบบจัดการทรัพย์สินไอที</h1>
            <p>ติดตามอุปกรณ์ ผู้ถือครอง สต็อก และงานซ่อมของทีม IT</p>
          </div>
          <label className="search">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหา Asset ID, Serial, ผู้ถือครอง..." />
          </label>
        </header>

        {isLoading && <div className="system-banner">กำลังโหลดข้อมูลจาก API...</div>}
        {errorMessage && <div className="system-banner error">เชื่อมต่อ API ไม่สำเร็จ: {errorMessage}</div>}

        {activeTab === 'dashboard' && <Dashboard assets={assetList} stock={stockItems} setActiveTab={setActiveTab} />}
        {activeTab === 'assets' && (
        <AssetsView assets={filteredAssets} allAssets={assetList} employees={employees} selectedAsset={selectedAsset} onAddAsset={addAsset} onUpdateAsset={updateAsset} onDeleteAsset={deleteAsset} onAddRepair={addRepair} onReturnAsset={returnAsset} onSelect={setSelectedAssetId} />
      )}
      {activeTab === 'stock' && <StockView stock={stockItems} onAddStock={addStockItem} onUpdateStock={updateStockItem} onDeleteStock={deleteStockItem} />}
      {activeTab === 'users' && <UsersView employees={employees} onAddEmployee={addEmployee} onUpdateEmployee={updateEmployee} onDeleteEmployee={deleteEmployee} />}
      </section>
    </main>
  );
}

function Dashboard({ assets, stock, setActiveTab }: { assets: Asset[]; stock: StockItem[]; setActiveTab: (tab: (typeof tabs)[number]['id']) => void }) {
  const lowStock = stock.filter((item) => item.available < item.min);
  const inRepair = assets.filter((asset) => asset.status === 'ซ่อมบำรุง');

  return (
    <div className="panel-grid">
      <section className="hero-band">
        <div>
          <span className="eyebrow">IT Asset Dashboard</span>
          <h2>ยินดีต้อนรับสู่ระบบจัดการทรัพย์สินไอที</h2>
          <p>ตรวจสอบผู้ถือครอง สถานะอุปกรณ์ สต็อก และประวัติซ่อมของทรัพย์สินทั้งหมดในระบบ</p>
          <div className="hero-tags">
            <span>ทะเบียนทรัพย์สิน</span>
            <span>ประวัติซ่อม</span>
            <span>สต็อกอุปกรณ์</span>
          </div>
        </div>
        <div className="hero-actions">
          <button onClick={() => setActiveTab('assets')}><ClipboardList size={18} /> เปิดทะเบียนทรัพย์สิน</button>
          <button className="secondary" onClick={() => setActiveTab('users')}><Users size={18} /> จัดการผู้ใช้</button>
        </div>
      </section>

      <div className="metric-row">
        <Metric icon={Laptop} label="ทรัพย์สินทั้งหมด" value={assets.length.toString()} tone="green" />
        <Metric icon={Archive} label="รายการต่ำกว่าขั้นต่ำ" value={lowStock.length.toString()} tone="amber" />
        <Metric icon={Wrench} label="กำลังซ่อม" value={inRepair.length.toString()} tone="blue" />
      </div>

      <section className="content-band two-col">
        <div>
          <div className="section-title">
            <h3>แจ้งเตือนสำคัญ</h3>
            <AlertTriangle size={20} />
          </div>
          <div className="alert-list">
            {lowStock.map((item) => (
              <article key={item.sku} className="alert-item stock-alert">
                <strong>{item.name}</strong>
                <span>เหลือ {item.available} ชิ้น ต่ำกว่าขั้นต่ำ {item.min} ชิ้น</span>
              </article>
            ))}
          </div>
        </div>
        <div>
          <div className="section-title">
            <h3>งานซ่อมล่าสุด</h3>
            <Wrench size={20} />
          </div>
          {assets.flatMap((asset) => asset.repairs.map((repair) => ({ asset, repair }))).slice(0, 4).map(({ asset, repair }) => (
            <article key={`${asset.id}-${repair.date}`} className="repair-row">
              <span>{formatDate(repair.date)}</span>
              <div>
                <strong>{asset.id}</strong>
                <p>{repair.detail}</p>
              </div>
              <b>{repair.cost.toLocaleString('th-TH')} บาท</b>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function Metric({ icon: Icon, label, value, tone }: { icon: typeof Laptop; label: string; value: string; tone: string }) {
  return (
    <article className={`metric ${tone}`}>
      <Icon size={22} />
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function EmployeeCombobox({
  employees,
  value,
  onChange,
  allowManual = false
}: {
  employees: Employee[];
  value: string;
  onChange: (employeeId: string) => void;
  allowManual?: boolean;
}) {
  const selectedEmployee = employees.find((employee) => employee.id === value);
  const [search, setSearch] = useState(selectedEmployee ? `${selectedEmployee.name} · ${selectedEmployee.department}` : '');
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const employee = employees.find((currentEmployee) => currentEmployee.id === value);
    setSearch(employee ? `${employee.name} · ${employee.department}` : '');
  }, [employees, value]);

  const filteredEmployees = useMemo(() => {
    const needle = search.trim().toLowerCase();
    if (!needle) return employees;
    return employees.filter((employee) =>
      [employee.id, employee.name, employee.department, employee.position, employee.email, employee.location]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [employees, search]);

  function chooseEmployee(employeeId: string) {
    const employee = employees.find((currentEmployee) => currentEmployee.id === employeeId);
    onChange(employeeId);
    setSearch(employee ? `${employee.name} · ${employee.department}` : '');
    setIsOpen(false);
  }

  return (
    <div className="field-label">
      <span>ผู้ถือครอง</span>
      <div className="combobox">
        <input
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
          placeholder="พิมพ์ชื่อ แผนก หรือรหัสพนักงาน"
        />
        {isOpen && (
          <div className="combobox-menu">
            {allowManual && (
              <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => chooseEmployee('')}>
                <strong>กรอกเอง</strong>
                <small>ใช้ช่องชื่อผู้ถือครองด้านล่าง</small>
              </button>
            )}
            {filteredEmployees.map((employee) => (
              <button key={employee.id} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => chooseEmployee(employee.id)}>
                <strong>{employee.name}</strong>
                <small>{employee.id} · {employee.department} · {employee.position}</small>
              </button>
            ))}
            {!filteredEmployees.length && !allowManual && <p>ไม่พบผู้ใช้ที่ตรงกับคำค้นหา</p>}
          </div>
        )}
      </div>
    </div>
  );
}

function AssetsView({
  assets,
  allAssets,
  employees,
  selectedAsset,
  onAddAsset,
  onUpdateAsset,
  onDeleteAsset,
  onAddRepair,
  onReturnAsset,
  onSelect
}: {
  assets: Asset[];
  allAssets: Asset[];
  employees: Employee[];
  selectedAsset?: Asset;
  onAddAsset: (asset: Asset) => void;
  onUpdateAsset: (assetId: string, asset: Asset) => void;
  onDeleteAsset: (assetId: string) => void;
  onAddRepair: (assetId: string, repair: RepairRecord) => void;
  onReturnAsset: (assetId: string, returnRecord: ReturnRecord) => void;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="stacked-layout">
      <AssetForm employees={employees} assets={allAssets} onAddAsset={onAddAsset} />
      <div className="assets-layout">
        <section className="content-band">
          <div className="section-title">
            <h3>ทะเบียนทรัพย์สิน</h3>
            <PackageCheck size={20} />
          </div>
          <div className="asset-table">
            <div className="table-head">
              <span>Asset ID</span><span>อุปกรณ์</span><span>ผู้ถือครอง</span><span>สถานะ</span>
            </div>
            {assets.map((asset) => (
              <button key={asset.id} className={asset.id === selectedAsset?.id ? 'asset-row selected' : 'asset-row'} onClick={() => onSelect(asset.id)}>
                <span>{asset.id}</span>
                <span>{asset.name}<small>{asset.serial}</small></span>
                <span>{asset.assignedTo}<small>{asset.department}</small></span>
                <Status status={asset.status} />
              </button>
            ))}
            {!assets.length && (
              <div className="empty-state">
                <Plus size={20} />
                <strong>ยังไม่มีทรัพย์สินในระบบ</strong>
                <span>กรอกฟอร์ม “เพิ่มทรัพย์สินไอที” ด้านบนเพื่อสร้างรายการแรก</span>
              </div>
            )}
          </div>
        </section>
        {selectedAsset ? (
          <AssetDetail asset={selectedAsset} employees={employees} onUpdateAsset={onUpdateAsset} onDeleteAsset={onDeleteAsset} onAddRepair={onAddRepair} onReturnAsset={onReturnAsset} />
        ) : (
          <aside className="detail-pane empty-state">
            <PackageCheck size={24} />
            <strong>เลือกทรัพย์สินเพื่อดูรายละเอียด</strong>
            <span>หลังเพิ่มทรัพย์สิน รายละเอียด แก้ไข คืนทรัพย์สิน และประวัติซ่อมจะแสดงตรงนี้</span>
          </aside>
        )}
      </div>
    </div>
  );
}

function AssetForm({ employees, assets, onAddAsset }: { employees: Employee[]; assets: Asset[]; onAddAsset: (asset: Asset) => void }) {
  const nextNumber = String(assets.length + 59).padStart(5, '0');
  const [form, setForm] = useState({
    id: `IT-NEW-${nextNumber}`,
    name: '',
    category: 'Notebook',
    serial: '',
    employeeId: '',
    status: 'ใช้งานอยู่' as AssetStatus,
    purchaseDate: '',
    warrantyUntil: '',
    condition: '100'
  });

  const selectedEmployee = employees.find((employee) => employee.id === form.employeeId);

  function updateField<T extends keyof typeof form>(key: T, value: (typeof form)[T]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.id.trim() || !form.name.trim() || !form.serial.trim()) return;
    if (form.status !== 'อยู่ในสต็อก' && !selectedEmployee) return;
    const assignedTo = form.status === 'อยู่ในสต็อก' ? 'คลังกลาง' : selectedEmployee!.name;
    const department = form.status === 'อยู่ในสต็อก' ? 'IT' : selectedEmployee!.department;
    const location = form.status === 'อยู่ในสต็อก' ? 'คลัง IT ชั้น 4' : selectedEmployee!.location;

    onAddAsset({
      id: form.id.trim(),
      name: form.name.trim(),
      category: form.category,
      serial: form.serial.trim(),
      assignedTo,
      department,
      location,
      status: form.status,
      purchaseDate: form.purchaseDate,
      warrantyUntil: form.warrantyUntil,
      condition: Number(form.condition || 0),
      repairs: []
    });

    setForm((current) => ({
      ...current,
      id: `IT-NEW-${String(assets.length + 60).padStart(5, '0')}`,
      name: '',
      serial: '',
      employeeId: '',
      condition: '100'
    }));
  }

  return (
    <section className="content-band">
      <div className="section-title">
        <h3>เพิ่มทรัพย์สินไอที</h3>
        <Plus size={20} />
      </div>
      <form className="entry-form asset-entry" onSubmit={submit}>
        <label>Asset ID<input value={form.id} onChange={(event) => updateField('id', event.target.value)} required /></label>
        <label>ชื่ออุปกรณ์<input value={form.name} onChange={(event) => updateField('name', event.target.value)} placeholder="เช่น Dell Latitude 5450" required /></label>
        <label>หมวดหมู่<select value={form.category} onChange={(event) => updateField('category', event.target.value)}>
          <option>Notebook</option><option>Monitor</option><option>Mobile</option><option>Network</option><option>Accessory</option>
        </select></label>
        <label>Serial<input value={form.serial} onChange={(event) => updateField('serial', event.target.value)} required /></label>
        <EmployeeCombobox employees={employees} value={form.employeeId} onChange={(employeeId) => updateField('employeeId', employeeId)} />
        <label>สถานะ<select value={form.status} onChange={(event) => updateField('status', event.target.value as AssetStatus)}>
          <option>ใช้งานอยู่</option><option>อยู่ในสต็อก</option><option>ซ่อมบำรุง</option><option>ปลดระวาง</option>
        </select></label>
        <label>วันที่ซื้อ<DateTextInput value={form.purchaseDate} onChange={(value) => updateField('purchaseDate', value)} /></label>
        <label>ประกันถึง<DateTextInput value={form.warrantyUntil} onChange={(value) => updateField('warrantyUntil', value)} /></label>
        <label>สภาพเครื่อง<input type="number" min="0" max="100" value={form.condition} onChange={(event) => updateField('condition', event.target.value)} /></label>
        <button type="submit"><Save size={18} /> บันทึกทรัพย์สิน</button>
      </form>
    </section>
  );
}

function StockView({
  stock,
  onAddStock,
  onUpdateStock,
  onDeleteStock
}: {
  stock: StockItem[];
  onAddStock: (item: StockItem) => void;
  onUpdateStock: (sku: string, item: StockItem) => void;
  onDeleteStock: (sku: string) => void;
}) {
  const [editingSku, setEditingSku] = useState('');
  const [form, setForm] = useState({
    sku: '',
    name: '',
    available: '0',
    min: '0',
    location: 'คลัง IT ชั้น 4'
  });

  function updateField<T extends keyof typeof form>(key: T, value: (typeof form)[T]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.sku.trim() || !form.name.trim()) return;

    onAddStock({
      sku: form.sku.trim(),
      name: form.name.trim(),
      available: Number(form.available || 0),
      min: Number(form.min || 0),
      location: form.location.trim() || '-'
    });

    setForm({
      sku: '',
      name: '',
      available: '0',
      min: '0',
      location: 'คลัง IT ชั้น 4'
    });
  }

  function removeStock(item: StockItem) {
    if (!window.confirm(`ลบรายการสต็อก ${item.name} ใช่ไหม?`)) return;
    onDeleteStock(item.sku);
  }

  return (
    <div className="stock-layout">
      <section className="content-band">
        <div className="section-title">
          <h3>เพิ่มรายการสต็อก</h3>
          <Archive size={20} />
        </div>
        <form className="entry-form stock-entry" onSubmit={submit}>
          <label>SKU<input value={form.sku} onChange={(event) => updateField('sku', event.target.value)} placeholder="เช่น ACC-HUB-08" required /></label>
          <label>ชื่อรายการ<input value={form.name} onChange={(event) => updateField('name', event.target.value)} placeholder="เช่น USB-C Hub 8-in-1" required /></label>
          <label>จำนวนคงเหลือ<input type="number" min="0" value={form.available} onChange={(event) => updateField('available', event.target.value)} /></label>
          <label>ขั้นต่ำที่ต้องมี<input type="number" min="0" value={form.min} onChange={(event) => updateField('min', event.target.value)} /></label>
          <label>ที่เก็บ<input value={form.location} onChange={(event) => updateField('location', event.target.value)} /></label>
          <button type="submit"><Save size={18} /> บันทึกสต็อก</button>
        </form>
      </section>

      <section className="content-band">
        <div className="section-title">
          <h3>รายการสต็อก</h3>
          <PackageCheck size={20} />
        </div>
        <div className="stock-list">
          {stock.map((item) => (
            <article key={item.sku} className={item.available < item.min ? 'stock-row is-low' : 'stock-row'}>
              <div className="stock-row-main">
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.sku} · {item.location}</span>
                  <small>เหลือ {item.available} ชิ้น · ขั้นต่ำ {item.min} ชิ้น</small>
                </div>
                <div className="record-actions">
                  <button type="button" className="icon-button" onClick={() => setEditingSku((current) => (current === item.sku ? '' : item.sku))} title="แก้ไขสต็อก">
                    <Pencil size={16} />
                  </button>
                  <button type="button" className="icon-button danger" onClick={() => removeStock(item)} title="ลบสต็อก">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              {editingSku === item.sku && (
                <StockEditForm
                  item={item}
                  onCancel={() => setEditingSku('')}
                  onSave={(updatedItem) => {
                    onUpdateStock(item.sku, updatedItem);
                    setEditingSku('');
                  }}
                />
              )}
            </article>
          ))}
          {!stock.length && (
            <div className="empty-state">
              <Archive size={20} />
              <strong>ยังไม่มีรายการสต็อก</strong>
              <span>เพิ่มรายการด้านบน แล้วระบบจะแจ้งเตือนเมื่อจำนวนต่ำกว่าขั้นต่ำ</span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

function StockEditForm({
  item,
  onSave,
  onCancel
}: {
  item: StockItem;
  onSave: (item: StockItem) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: item.name,
    available: String(item.available),
    min: String(item.min),
    location: item.location
  });

  function updateField<T extends keyof typeof form>(key: T, value: (typeof form)[T]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim()) return;
    onSave({
      sku: item.sku,
      name: form.name.trim(),
      available: Number(form.available || 0),
      min: Number(form.min || 0),
      location: form.location.trim() || '-'
    });
  }

  return (
    <form className="entry-form edit-form" onSubmit={submit}>
      <label>ชื่อรายการ<input value={form.name} onChange={(event) => updateField('name', event.target.value)} required /></label>
      <label>จำนวนคงเหลือ<input type="number" min="0" value={form.available} onChange={(event) => updateField('available', event.target.value)} /></label>
      <label>ขั้นต่ำที่ต้องมี<input type="number" min="0" value={form.min} onChange={(event) => updateField('min', event.target.value)} /></label>
      <label>ที่เก็บ<input value={form.location} onChange={(event) => updateField('location', event.target.value)} /></label>
      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>ยกเลิก</button>
        <button type="submit"><Save size={16} /> บันทึกการแก้ไข</button>
      </div>
    </form>
  );
}

function UsersView({
  employees,
  onAddEmployee,
  onUpdateEmployee,
  onDeleteEmployee
}: {
  employees: Employee[];
  onAddEmployee: (employee: Employee) => void;
  onUpdateEmployee: (employeeId: string, employee: Employee) => void;
  onDeleteEmployee: (employeeId: string) => void;
}) {
  const [editingEmployeeId, setEditingEmployeeId] = useState('');
  const [form, setForm] = useState({
    id: `EMP-${String(employees.length + 1001).padStart(4, '0')}`,
    name: '',
    department: '',
    position: '',
    email: '',
    location: ''
  });

  function updateField<T extends keyof typeof form>(key: T, value: (typeof form)[T]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.id.trim() || !form.name.trim() || !form.department.trim()) return;
    onAddEmployee({
      id: form.id.trim(),
      name: form.name.trim(),
      department: form.department.trim(),
      position: form.position.trim() || '-',
      email: form.email.trim() || '-',
      location: form.location.trim() || '-'
    });
    setForm({
      id: `EMP-${String(employees.length + 1002).padStart(4, '0')}`,
      name: '',
      department: '',
      position: '',
      email: '',
      location: ''
    });
  }

  function deleteUser(employee: Employee) {
    if (!window.confirm(`ลบผู้ใช้ ${employee.name} ใช่ไหม?`)) return;
    onDeleteEmployee(employee.id);
  }

  return (
    <div className="users-layout">
      <section className="content-band">
        <div className="section-title">
          <h3>เพิ่มผู้ใช้</h3>
          <UserPlus size={20} />
        </div>
        <form className="entry-form user-entry" onSubmit={submit}>
          <label>รหัสพนักงาน<input value={form.id} onChange={(event) => updateField('id', event.target.value)} required /></label>
          <label>ชื่อผู้ใช้<input value={form.name} onChange={(event) => updateField('name', event.target.value)} required /></label>
          <label>แผนก<input value={form.department} onChange={(event) => updateField('department', event.target.value)} required /></label>
          <label>ตำแหน่ง<input value={form.position} onChange={(event) => updateField('position', event.target.value)} /></label>
          <label>อีเมล<input type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} /></label>
          <label>สถานที่<input value={form.location} onChange={(event) => updateField('location', event.target.value)} placeholder="เช่น ชั้น 10 อาคาร A" /></label>
          <button type="submit"><Save size={18} /> บันทึกผู้ใช้</button>
        </form>
      </section>
      <section className="content-band">
        <div className="section-title">
          <h3>รายชื่อผู้ใช้</h3>
          <Users size={20} />
        </div>
        <div className="user-list">
          {employees.map((employee) => (
            <article key={employee.id} className="user-row">
              <div className="user-row-main">
                <div>
                  <strong>{employee.name}</strong>
                  <span>{employee.id} · {employee.department} · {employee.position}</span>
                  <small>{employee.email} · {employee.location}</small>
                </div>
                <div className="record-actions">
                  <button type="button" className="icon-button" onClick={() => setEditingEmployeeId((current) => (current === employee.id ? '' : employee.id))} title="แก้ไขผู้ใช้">
                    <Pencil size={16} />
                  </button>
                  <button type="button" className="icon-button danger" onClick={() => deleteUser(employee)} title="ลบผู้ใช้">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
              {editingEmployeeId === employee.id && (
                <UserEditForm
                  employee={employee}
                  onCancel={() => setEditingEmployeeId('')}
                  onSave={(updatedEmployee) => {
                    onUpdateEmployee(employee.id, updatedEmployee);
                    setEditingEmployeeId('');
                  }}
                />
              )}
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

function UserEditForm({
  employee,
  onSave,
  onCancel
}: {
  employee: Employee;
  onSave: (employee: Employee) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: employee.name,
    department: employee.department,
    position: employee.position,
    email: employee.email,
    location: employee.location
  });

  function updateField<T extends keyof typeof form>(key: T, value: (typeof form)[T]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || !form.department.trim()) return;
    onSave({
      ...employee,
      name: form.name.trim(),
      department: form.department.trim(),
      position: form.position.trim() || '-',
      email: form.email.trim() || '-',
      location: form.location.trim() || '-'
    });
  }

  return (
    <form className="entry-form edit-form" onSubmit={submit}>
      <label>ชื่อผู้ใช้<input value={form.name} onChange={(event) => updateField('name', event.target.value)} required /></label>
      <label>แผนก<input value={form.department} onChange={(event) => updateField('department', event.target.value)} required /></label>
      <label>ตำแหน่ง<input value={form.position} onChange={(event) => updateField('position', event.target.value)} /></label>
      <label>อีเมล<input type="email" value={form.email} onChange={(event) => updateField('email', event.target.value)} /></label>
      <label>สถานที่<input value={form.location} onChange={(event) => updateField('location', event.target.value)} /></label>
      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>ยกเลิก</button>
        <button type="submit"><Save size={16} /> บันทึกการแก้ไข</button>
      </div>
    </form>
  );
}

function AssetDetail({
  asset,
  employees,
  onUpdateAsset,
  onDeleteAsset,
  onAddRepair,
  onReturnAsset
}: {
  asset: Asset;
  employees: Employee[];
  onUpdateAsset: (assetId: string, asset: Asset) => void;
  onDeleteAsset: (assetId: string) => void;
  onAddRepair?: (assetId: string, repair: RepairRecord) => void;
  onReturnAsset: (assetId: string, returnRecord: ReturnRecord) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [isReturning, setIsReturning] = useState(false);

  function deleteCurrentAsset() {
    if (!window.confirm(`ลบทรัพย์สิน ${asset.id} ใช่ไหม?`)) return;
    onDeleteAsset(asset.id);
  }

  return (
    <aside className="detail-pane">
      <div className="section-title">
        <h3>{asset.id}</h3>
        <div className="record-actions">
          <button type="button" className="icon-button" onClick={() => setIsEditing((current) => !current)} title="แก้ไขทรัพย์สิน">
            <Pencil size={16} />
          </button>
          <button type="button" className="return-action-button" onClick={() => setIsReturning((current) => !current)}>
            <RotateCcw size={16} /> คืนทรัพย์สิน
          </button>
          <button type="button" className="icon-button danger" onClick={deleteCurrentAsset} title="ลบทรัพย์สิน">
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      {isEditing ? (
        <AssetEditForm
          asset={asset}
          employees={employees}
          onCancel={() => setIsEditing(false)}
          onSave={(updatedAsset) => {
            onUpdateAsset(asset.id, updatedAsset);
            setIsEditing(false);
          }}
        />
      ) : (
        <>
          <h2>{asset.name}</h2>
          <Status status={asset.status} />
          <div className="detail-grid">
            <span>Serial</span><strong>{asset.serial}</strong>
            <span>ผู้ถือครอง</span><strong>{asset.assignedTo}</strong>
            <span>แผนก</span><strong>{asset.department}</strong>
            <span>สถานที่</span><strong>{asset.location}</strong>
            <span>ประกันถึง</span><strong>{formatDate(asset.warrantyUntil)}</strong>
          </div>
          <label className="health">
            <span>สภาพเครื่อง {asset.condition}%</span>
            <meter min="0" max="100" value={asset.condition} />
          </label>
        </>
      )}
      {isReturning && (
        <div className="return-panel active">
          <h4>คืนทรัพย์สินบริษัท</h4>
          <ReturnAssetForm
            asset={asset}
            onReturnAsset={(assetId, returnRecord) => {
              onReturnAsset(assetId, returnRecord);
              setIsReturning(false);
            }}
          />
        </div>
      )}
      {(asset.returns ?? []).length > 0 && (
        <div className="return-panel">
          <h4>ประวัติการคืน</h4>
          <div className="return-history">
            {(asset.returns ?? []).map((returnRecord) => (
              <article key={`${returnRecord.date}-${returnRecord.returnedBy}`} className="return-event">
                <time>{formatDate(returnRecord.date)}</time>
                <strong>{returnRecord.returnedBy} คืนให้ {returnRecord.receivedBy}</strong>
                <span>{returnRecord.location} · สภาพ {returnRecord.condition}% · {returnRecord.note}</span>
              </article>
            ))}
          </div>
        </div>
      )}
      <div className="timeline">
        <h4>ประวัติซ่อม</h4>
        {onAddRepair && <RepairForm assetId={asset.id} onAddRepair={onAddRepair} />}
        {asset.repairs.length ? asset.repairs.map((repair) => (
          <article key={repair.date}>
            <time>{formatDate(repair.date)}</time>
            <strong>{repair.detail}</strong>
            <span>{repair.technician} · {repair.cost.toLocaleString('th-TH')} บาท</span>
          </article>
        )) : <p>ยังไม่มีประวัติซ่อม</p>}
      </div>
    </aside>
  );
}

function AssetEditForm({
  asset,
  employees,
  onSave,
  onCancel
}: {
  asset: Asset;
  employees: Employee[];
  onSave: (asset: Asset) => void;
  onCancel: () => void;
}) {
  const matchedEmployee = employees.find((employee) => employee.name === asset.assignedTo);
  const [form, setForm] = useState({
    name: asset.name,
    category: asset.category,
    serial: asset.serial,
    employeeId: matchedEmployee?.id ?? '',
    assignedTo: asset.assignedTo,
    department: asset.department,
    location: asset.location,
    status: asset.status,
    purchaseDate: toDateInputValue(asset.purchaseDate),
    warrantyUntil: toDateInputValue(asset.warrantyUntil),
    condition: String(asset.condition)
  });

  function updateField<T extends keyof typeof form>(key: T, value: (typeof form)[T]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function chooseEmployee(employeeId: string) {
    const employee = employees.find((currentEmployee) => currentEmployee.id === employeeId);
    setForm((current) => ({
      ...current,
      employeeId,
      assignedTo: employee?.name ?? current.assignedTo,
      department: employee?.department ?? current.department,
      location: employee?.location ?? current.location
    }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.name.trim() || !form.serial.trim() || !form.assignedTo.trim()) return;

    onSave({
      ...asset,
      name: form.name.trim(),
      category: form.category.trim() || 'Other',
      serial: form.serial.trim(),
      assignedTo: form.assignedTo.trim(),
      department: form.department.trim() || '-',
      location: form.location.trim() || '-',
      status: form.status,
      purchaseDate: form.purchaseDate,
      warrantyUntil: form.warrantyUntil,
      condition: Number(form.condition || 0)
    });
  }

  return (
    <form className="entry-form edit-form" onSubmit={submit}>
      <label>ชื่ออุปกรณ์<input value={form.name} onChange={(event) => updateField('name', event.target.value)} required /></label>
      <label>หมวดหมู่<select value={form.category} onChange={(event) => updateField('category', event.target.value)}>
        <option>Notebook</option><option>Monitor</option><option>Mobile</option><option>Network</option><option>Accessory</option><option>Other</option>
      </select></label>
      <label>Serial<input value={form.serial} onChange={(event) => updateField('serial', event.target.value)} required /></label>
      <EmployeeCombobox employees={employees} value={form.employeeId} onChange={chooseEmployee} allowManual />
      <label>แผนก<input value={form.department} onChange={(event) => updateField('department', event.target.value)} /></label>
      <label>สถานที่<input value={form.location} onChange={(event) => updateField('location', event.target.value)} /></label>
      <label>สถานะ<select value={form.status} onChange={(event) => updateField('status', event.target.value as AssetStatus)}>
        <option>ใช้งานอยู่</option><option>อยู่ในสต็อก</option><option>ซ่อมบำรุง</option><option>ปลดระวาง</option>
      </select></label>
      <label>วันที่ซื้อ<DateTextInput value={form.purchaseDate} onChange={(value) => updateField('purchaseDate', value)} /></label>
      <label>ประกันถึง<DateTextInput value={form.warrantyUntil} onChange={(value) => updateField('warrantyUntil', value)} /></label>
      <label>สภาพเครื่อง<input type="number" min="0" max="100" value={form.condition} onChange={(event) => updateField('condition', event.target.value)} /></label>
      <div className="form-actions">
        <button type="button" className="secondary-button" onClick={onCancel}>ยกเลิก</button>
        <button type="submit"><Save size={16} /> บันทึกการแก้ไข</button>
      </div>
    </form>
  );
}

function ReturnAssetForm({ asset, onReturnAsset }: { asset: Asset; onReturnAsset: (assetId: string, returnRecord: ReturnRecord) => void }) {
  const [form, setForm] = useState({
    date: '',
    returnedBy: asset.assignedTo === 'คลังกลาง' ? '' : asset.assignedTo,
    receivedBy: 'ทีม IT',
    location: 'คลัง IT ชั้น 4',
    condition: String(asset.condition),
    note: ''
  });

  function updateField<T extends keyof typeof form>(key: T, value: (typeof form)[T]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.date || !form.returnedBy.trim() || !form.receivedBy.trim() || !form.location.trim()) return;

    onReturnAsset(asset.id, {
      date: form.date,
      returnedBy: form.returnedBy.trim(),
      receivedBy: form.receivedBy.trim(),
      location: form.location.trim(),
      condition: Number(form.condition || 0),
      note: form.note.trim() || '-'
    });

    setForm((current) => ({
      ...current,
      returnedBy: '',
      note: ''
    }));
  }

  return (
    <form className="return-form" onSubmit={submit}>
      <label>วันที่คืน<DateTextInput value={form.date} onChange={(value) => updateField('date', value)} required /></label>
      <label>ผู้คืน<input value={form.returnedBy} onChange={(event) => updateField('returnedBy', event.target.value)} placeholder="ชื่อพนักงานที่นำมาคืน" required /></label>
      <label>ผู้รับคืน<input value={form.receivedBy} onChange={(event) => updateField('receivedBy', event.target.value)} required /></label>
      <label>จุดเก็บคืน<input value={form.location} onChange={(event) => updateField('location', event.target.value)} required /></label>
      <label>สภาพเครื่อง<input type="number" min="0" max="100" value={form.condition} onChange={(event) => updateField('condition', event.target.value)} /></label>
      <label>หมายเหตุ<input value={form.note} onChange={(event) => updateField('note', event.target.value)} placeholder="เช่น รับคืนพร้อมอะแดปเตอร์" /></label>
      <button type="submit"><RotateCcw size={16} /> บันทึกการคืน</button>
    </form>
  );
}

function RepairForm({ assetId, onAddRepair }: { assetId: string; onAddRepair: (assetId: string, repair: RepairRecord) => void }) {
  const [form, setForm] = useState({
    date: '',
    detail: '',
    cost: '0',
    technician: ''
  });

  function updateField<T extends keyof typeof form>(key: T, value: (typeof form)[T]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!form.date || !form.detail.trim() || !form.technician.trim()) return;

    onAddRepair(assetId, {
      date: form.date,
      detail: form.detail.trim(),
      cost: Number(form.cost || 0),
      technician: form.technician.trim()
    });

    setForm({
      date: '',
      detail: '',
      cost: '0',
      technician: ''
    });
  }

  return (
    <form className="repair-form" onSubmit={submit}>
      <label>วันที่ซ่อม<DateTextInput value={form.date} onChange={(value) => updateField('date', value)} required /></label>
      <label>รายละเอียด<input value={form.detail} onChange={(event) => updateField('detail', event.target.value)} placeholder="เช่น เปลี่ยนคีย์บอร์ด" required /></label>
      <label>ช่าง/ผู้ดำเนินการ<input value={form.technician} onChange={(event) => updateField('technician', event.target.value)} placeholder="เช่น ทีม Service Desk" required /></label>
      <label>ค่าใช้จ่าย<input type="number" min="0" value={form.cost} onChange={(event) => updateField('cost', event.target.value)} /></label>
      <button type="submit"><Wrench size={16} /> เพิ่มประวัติซ่อม</button>
    </form>
  );
}

function Status({ status }: { status: AssetStatus }) {
  return <span className={`status ${status.replace(/\s/g, '-')}`}>{status}</span>;
}

createRoot(document.getElementById('root')!).render(<App />);
