import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import QRCode from 'qrcode';
import {
  AlertTriangle,
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
  company: string;
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
  company: string;
  name: string;
  department: string;
  position: string;
  email: string;
  location: string;
};

type BootstrapData = {
  assets: Asset[];
  employees: Employee[];
};

const parentCompany = 'Eves Enterprise';
const assetCompanies = ['Eves Enterprise', 'Wellveness', 'KIO', 'NEJ Science'] as const;

const initialAssets: Asset[] = [
  {
    id: 'AST-COM-00042',
    company: 'Eves Enterprise',
    name: 'Lenovo ThinkPad X1 Carbon Gen 11',
    category: 'คอมพิวเตอร์และอุปกรณ์',
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
    id: 'AST-OFF-00109',
    company: 'KIO',
    name: 'Dell UltraSharp U2723QE',
    category: 'เครื่องใช้สำนักงาน',
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
    id: 'AST-COM-00031',
    company: 'NEJ Science',
    name: 'iPhone 15 Pro',
    category: 'คอมพิวเตอร์และอุปกรณ์',
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
    id: 'AST-FUR-00058',
    company: 'Wellveness',
    name: 'โต๊ะทำงานปรับระดับ',
    category: 'เฟอร์นิเจอร์',
    serial: 'C02YY771Q6L4',
    assignedTo: 'คลังกลาง',
    department: 'ส่วนกลาง',
    location: 'คลังทรัพย์สินกลาง',
    status: 'อยู่ในสต็อก',
    purchaseDate: '2025-01-15',
    warrantyUntil: '2028-01-14',
    condition: 100,
    repairs: []
  }
];

const initialEmployees: Employee[] = [
  { id: 'EMP-1001', company: 'Eves Enterprise', name: 'กมลชนก ศรีวัฒน์', department: 'บัญชี', position: 'Accounting Manager', email: 'kamonchanok@example.com', location: 'ชั้น 12 อาคาร A' },
  { id: 'EMP-1002', company: 'KIO', name: 'วรุตม์ ภักดี', department: 'Product', position: 'Product Manager', email: 'warut@example.com', location: 'ชั้น 9 อาคาร B' },
  { id: 'EMP-1003', company: 'NEJ Science', name: 'พรทิพย์ ใจดี', department: 'Sales', position: 'Sales Executive', email: 'porntip@example.com', location: 'สาขาเชียงใหม่' },
  { id: 'EMP-IT-STOCK', company: 'Wellveness', name: 'คลังกลาง', department: 'ส่วนกลาง', position: 'Asset Stock', email: 'asset-stock@example.com', location: 'คลังทรัพย์สินกลาง' }
];

const tabs = [
  { id: 'dashboard', label: 'ภาพรวม', icon: LayoutDashboard },
  { id: 'assets', label: 'ทรัพย์สิน', icon: Laptop },
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
        const assetFromUrl = new URLSearchParams(window.location.search).get('asset');
        const linkedAsset = data.assets.find((asset) => asset.id === assetFromUrl);
        setAssetList(data.assets);
        setEmployees(data.employees);
        setSelectedAssetId(linkedAsset?.id ?? data.assets[0]?.id ?? '');
        if (linkedAsset) setActiveTab('assets');
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
      [asset.id, asset.company, asset.name, asset.serial, asset.assignedTo, asset.department, asset.status]
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

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark"><Boxes size={24} /></div>
          <div>
            <strong>Company Asset</strong>
            <span>Asset Management</span>
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
            <p>จัดการทรัพย์สินของ {parentCompany} แยกตามบริษัท ผู้ถือครอง สถานะ และประวัติซ่อมในที่เดียว</p>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <h1>ระบบจัดการทรัพย์สินบริษัท</h1>
            <p>ติดตามทรัพย์สินของ {parentCompany} แยกตาม EVES, Wellveness, KIO และ NEJ Science</p>
          </div>
          <label className="search">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="ค้นหา Asset ID, Serial, ผู้ถือครอง..." />
          </label>
        </header>

        {isLoading && <div className="system-banner">กำลังโหลดข้อมูลจาก API...</div>}
        {errorMessage && <div className="system-banner error">เชื่อมต่อ API ไม่สำเร็จ: {errorMessage}</div>}

        {activeTab === 'dashboard' && <Dashboard assets={assetList} setActiveTab={setActiveTab} />}
        {activeTab === 'assets' && (
        <AssetsView assets={filteredAssets} allAssets={assetList} employees={employees} selectedAsset={selectedAsset} onAddAsset={addAsset} onUpdateAsset={updateAsset} onDeleteAsset={deleteAsset} onAddRepair={addRepair} onReturnAsset={returnAsset} onSelect={setSelectedAssetId} />
      )}
      {activeTab === 'users' && <UsersView employees={employees} onAddEmployee={addEmployee} onUpdateEmployee={updateEmployee} onDeleteEmployee={deleteEmployee} />}
      </section>
    </main>
  );
}

function Dashboard({ assets, setActiveTab }: { assets: Asset[]; setActiveTab: (tab: (typeof tabs)[number]['id']) => void }) {
  const inStorage = assets.filter((asset) => asset.status === 'อยู่ในสต็อก');
  const inRepair = assets.filter((asset) => asset.status === 'ซ่อมบำรุง');
  const attentionAssets = assets.filter((asset) => asset.status === 'ซ่อมบำรุง' || asset.condition <= 70);
  const companySummary = assetCompanies.map((company) => ({
    company,
    total: assets.filter((asset) => asset.company === company).length,
    inUse: assets.filter((asset) => asset.company === company && asset.status === 'ใช้งานอยู่').length,
    inStorage: assets.filter((asset) => asset.company === company && asset.status === 'อยู่ในสต็อก').length
  }));

  return (
    <div className="panel-grid">
      <section className="hero-band">
        <div>
          <span className="eyebrow">Company Asset Dashboard</span>
          <h2>ยินดีต้อนรับสู่ระบบจัดการทรัพย์สินบริษัท</h2>
          <p>ตรวจสอบผู้ถือครอง สถานะ ที่จัดเก็บ QR Code และประวัติซ่อมของทรัพย์สินภายใต้ {parentCompany}</p>
          <div className="hero-tags">
            <span>ทะเบียนทรัพย์สิน</span>
            <span>ประวัติซ่อม</span>
            <span>QR ทรัพย์สิน</span>
          </div>
        </div>
        <div className="hero-actions">
          <button onClick={() => setActiveTab('assets')}><ClipboardList size={18} /> เปิดทะเบียนทรัพย์สิน</button>
          <button className="secondary" onClick={() => setActiveTab('users')}><Users size={18} /> จัดการผู้ใช้</button>
        </div>
      </section>

        <div className="metric-row">
          <Metric icon={Laptop} label="ทรัพย์สินทั้งหมด" value={assets.length.toString()} tone="green" />
        <Metric icon={PackageCheck} label="อยู่ในคลัง" value={inStorage.length.toString()} tone="amber" />
          <Metric icon={Wrench} label="กำลังซ่อม" value={inRepair.length.toString()} tone="blue" />
        </div>

      <section className="content-band company-summary">
        <div className="section-title">
          <h3>จำแนกทรัพย์สินตามบริษัท</h3>
          <Boxes size={20} />
        </div>
        <div className="company-summary-grid">
          {companySummary.map((item) => (
            <article key={item.company} className="company-summary-card">
              <span>บริษัท</span>
              <strong>{item.company}</strong>
              <div>
                <b>{item.total}</b>
                <small>ทั้งหมด</small>
              </div>
              <p>ใช้งาน {item.inUse} · อยู่ในคลัง {item.inStorage}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="content-band two-col">
        <div>
          <div className="section-title">
            <h3>แจ้งเตือนสำคัญ</h3>
            <AlertTriangle size={20} />
          </div>
          <div className="alert-list">
            {attentionAssets.map((asset) => (
              <article key={asset.id} className="alert-item stock-alert">
                <strong>{asset.id} · {asset.name}</strong>
                <span>{asset.status === 'ซ่อมบำรุง' ? 'กำลังซ่อมบำรุง' : `สภาพทรัพย์สิน ${asset.condition}% ควรตรวจสอบ`}</span>
              </article>
            ))}
            {!attentionAssets.length && <p className="muted-text">ยังไม่มีทรัพย์สินที่ต้องติดตามเป็นพิเศษ</p>}
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
  allowManual = false,
  company = ''
}: {
  employees: Employee[];
  value: string;
  onChange: (employeeId: string) => void;
  allowManual?: boolean;
  company?: string;
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
    const companyEmployees = company ? employees.filter((employee) => employee.company === company) : employees;
    if (!needle) return companyEmployees;
    return companyEmployees.filter((employee) =>
      [employee.id, employee.company, employee.name, employee.department, employee.position, employee.email, employee.location]
        .join(' ')
        .toLowerCase()
        .includes(needle)
    );
  }, [company, employees, search]);

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
                <small>{employee.id} · {employee.company} · {employee.department} · {employee.position}</small>
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
              <span>Asset ID</span><span>บริษัท</span><span>ทรัพย์สิน</span><span>ผู้ถือครอง</span><span>สถานะ</span>
            </div>
            {assets.map((asset) => (
              <button key={asset.id} className={asset.id === selectedAsset?.id ? 'asset-row selected' : 'asset-row'} onClick={() => onSelect(asset.id)}>
                <span>{asset.id}</span>
                <span>{asset.company}</span>
                <span>{asset.name}<small>{asset.serial}</small></span>
                <span>{asset.assignedTo}<small>{asset.department}</small></span>
                <Status status={asset.status} />
              </button>
            ))}
            {!assets.length && (
              <div className="empty-state">
                <Plus size={20} />
                <strong>ยังไม่มีทรัพย์สินในระบบ</strong>
                <span>กรอกฟอร์ม “เพิ่มทรัพย์สินบริษัท” ด้านบนเพื่อสร้างรายการแรก</span>
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
    id: `AST-NEW-${nextNumber}`,
    company: assetCompanies[0] as string,
    name: '',
    category: 'คอมพิวเตอร์และอุปกรณ์',
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
    const department = form.status === 'อยู่ในสต็อก' ? 'ส่วนกลาง' : selectedEmployee!.department;
    const location = form.status === 'อยู่ในสต็อก' ? 'คลังทรัพย์สินกลาง' : selectedEmployee!.location;

    onAddAsset({
      id: form.id.trim(),
      company: form.company,
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
      id: `AST-NEW-${String(assets.length + 60).padStart(5, '0')}`,
      company: current.company,
      name: '',
      serial: '',
      employeeId: '',
      condition: '100'
    }));
  }

  return (
    <section className="content-band">
      <div className="section-title">
        <h3>เพิ่มทรัพย์สินบริษัท</h3>
        <Plus size={20} />
      </div>
      <form className="entry-form asset-entry" onSubmit={submit}>
        <label>Asset ID<input value={form.id} onChange={(event) => updateField('id', event.target.value)} required /></label>
        <label>บริษัท<select value={form.company} onChange={(event) => {
          updateField('company', event.target.value);
          updateField('employeeId', '');
        }}>
          {assetCompanies.map((company) => <option key={company}>{company}</option>)}
        </select></label>
        <label>ชื่อทรัพย์สิน<input value={form.name} onChange={(event) => updateField('name', event.target.value)} placeholder="เช่น โต๊ะทำงาน, รถยนต์, คอมพิวเตอร์, เครื่องมือช่าง" required /></label>
        <label>หมวดหมู่<select value={form.category} onChange={(event) => updateField('category', event.target.value)}>
          <option>คอมพิวเตอร์และอุปกรณ์</option><option>เฟอร์นิเจอร์</option><option>เครื่องใช้สำนักงาน</option><option>เครื่องมือและอุปกรณ์ช่าง</option><option>ยานพาหนะ</option><option>อาคารและสถานที่</option><option>อื่น ๆ</option>
        </select></label>
        <label>Serial<input value={form.serial} onChange={(event) => updateField('serial', event.target.value)} required /></label>
        <EmployeeCombobox employees={employees} value={form.employeeId} onChange={(employeeId) => updateField('employeeId', employeeId)} company={form.company} />
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
    company: assetCompanies[0] as string,
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
      company: form.company,
      name: form.name.trim(),
      department: form.department.trim(),
      position: form.position.trim() || '-',
      email: form.email.trim() || '-',
      location: form.location.trim() || '-'
    });
    setForm({
      id: `EMP-${String(employees.length + 1002).padStart(4, '0')}`,
      company: form.company,
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
          <label>บริษัท<select value={form.company} onChange={(event) => updateField('company', event.target.value)}>
            {assetCompanies.map((company) => <option key={company}>{company}</option>)}
          </select></label>
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
                  <span>{employee.id} · {employee.company} · {employee.department} · {employee.position}</span>
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
    company: employee.company,
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
      company: form.company,
      name: form.name.trim(),
      department: form.department.trim(),
      position: form.position.trim() || '-',
      email: form.email.trim() || '-',
      location: form.location.trim() || '-'
    });
  }

  return (
    <form className="entry-form edit-form" onSubmit={submit}>
      <label>บริษัท<select value={form.company} onChange={(event) => updateField('company', event.target.value)}>
        {assetCompanies.map((company) => <option key={company}>{company}</option>)}
      </select></label>
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

function AssetQrCode({ asset }: { asset: Asset }) {
  const [qrDataUrl, setQrDataUrl] = useState('');
  const assetUrl = useMemo(() => {
    const url = new URL(window.location.href);
    url.searchParams.set('asset', asset.id);
    return url.toString();
  }, [asset.id]);

  useEffect(() => {
    let isMounted = true;

    QRCode.toDataURL(assetUrl, {
      width: 180,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: {
        dark: '#0f172a',
        light: '#ffffff'
      }
    }).then((dataUrl) => {
      if (isMounted) setQrDataUrl(dataUrl);
    });

    return () => {
      isMounted = false;
    };
  }, [assetUrl]);

  function downloadSticker() {
    if (!qrDataUrl) return;

    const canvas = document.createElement('canvas');
    const scale = 2;
    const width = 720;
    const height = 300;
    canvas.width = width * scale;
    canvas.height = height * scale;

    const context = canvas.getContext('2d');
    if (!context) return;

    context.scale(scale, scale);
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
    context.strokeStyle = '#cbd5e1';
    context.lineWidth = 3;
    context.strokeRect(10, 10, width - 20, height - 20);

    const qrImage = new Image();
    qrImage.onload = () => {
      context.drawImage(qrImage, 32, 52, 196, 196);

      context.fillStyle = '#1d4ed8';
      context.font = '700 24px Arial, sans-serif';
      context.fillText('COMPANY ASSET', 260, 70);

      context.fillStyle = '#0f172a';
      context.font = '700 38px Arial, sans-serif';
      context.fillText(asset.id, 260, 120);

      context.font = '600 24px Arial, sans-serif';
      context.fillText(asset.name.slice(0, 32), 260, 164);

      context.fillStyle = '#475569';
      context.font = '20px Arial, sans-serif';
      context.fillText(`Company: ${asset.company}`, 260, 196);
      context.fillText(`Serial: ${asset.serial}`, 260, 226);
      context.fillText(`Owner: ${asset.assignedTo}`, 260, 256);

      context.fillStyle = '#64748b';
      context.font = '15px Arial, sans-serif';
      context.fillText('Scan QR to open asset record', 260, 278);

      const link = document.createElement('a');
      link.href = canvas.toDataURL('image/png');
      link.download = `${asset.id}-qr-sticker.png`;
      link.click();
    };
    qrImage.src = qrDataUrl;
  }

  return (
    <div className="asset-qr">
      <div className="asset-qr-code">
        {qrDataUrl ? <img src={qrDataUrl} alt={`QR Code ${asset.id}`} /> : <span>กำลังสร้าง QR...</span>}
      </div>
      <div className="asset-qr-copy">
        <strong>QR Code ทรัพย์สิน</strong>
        <span>สแกนเพื่อเปิดข้อมูล {asset.id}</span>
        <button type="button" className="qr-download-button" onClick={downloadSticker} disabled={!qrDataUrl}>
          ดาวน์โหลดสติกเกอร์
        </button>
      </div>
    </div>
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
          <AssetQrCode asset={asset} />
          <div className="detail-grid">
            <span>บริษัท</span><strong>{asset.company}</strong>
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
    company: asset.company ?? assetCompanies[0],
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
      company: employee?.company ?? current.company,
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
      company: form.company,
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
      <label>บริษัท<select value={form.company} onChange={(event) => {
        updateField('company', event.target.value);
        updateField('employeeId', '');
      }}>
        {assetCompanies.map((company) => <option key={company}>{company}</option>)}
      </select></label>
      <label>ชื่อทรัพย์สิน<input value={form.name} onChange={(event) => updateField('name', event.target.value)} required /></label>
      <label>หมวดหมู่<select value={form.category} onChange={(event) => updateField('category', event.target.value)}>
        <option>คอมพิวเตอร์และอุปกรณ์</option><option>เฟอร์นิเจอร์</option><option>เครื่องใช้สำนักงาน</option><option>เครื่องมือและอุปกรณ์ช่าง</option><option>ยานพาหนะ</option><option>อาคารและสถานที่</option><option>อื่น ๆ</option>
      </select></label>
      <label>Serial<input value={form.serial} onChange={(event) => updateField('serial', event.target.value)} required /></label>
      <EmployeeCombobox employees={employees} value={form.employeeId} onChange={chooseEmployee} allowManual company={form.company} />
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
    receivedBy: 'ผู้รับผิดชอบทรัพย์สิน',
    location: 'คลังทรัพย์สินกลาง',
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
