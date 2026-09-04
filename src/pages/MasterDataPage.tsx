import { useEffect, useState, type FormEvent } from 'react';
import { Database, ExternalLink } from 'lucide-react';
import { api, del, post, put } from '../api';
import { Badge, CompactSelect, DataTable, type Column, type Field, Modal, PageHeader } from '../ui';

export const masterDataDefs = [
  ['company', 'Company Master (บริษัท)', 'องค์กร'],
  ['brand', 'Brand Master (แบรนด์)', 'องค์กร'],
  ['department', 'Department Master (แผนก)', 'องค์กร'],
  ['employee', 'Employee / User Master', 'บุคคล'],
  ['site', 'Site / Factory Master', 'สถานที่'],
  ['building', 'Building Master', 'สถานที่'],
  ['floor', 'Floor Master', 'สถานที่'],
  ['zone', 'Zone Master', 'สถานที่'],
  ['room', 'Room / Area Master', 'สถานที่'],
  ['asset-category', 'Asset Category Master', 'ทรัพย์สิน'],
  ['asset-subcategory', 'Asset Subcategory Master', 'ทรัพย์สิน'],
  ['asset-status', 'Asset Status Master', 'ทรัพย์สิน'],
  ['asset-condition', 'Asset Condition Master', 'ทรัพย์สิน'],
  ['criticality', 'Criticality Master', 'ทรัพย์สิน'],
  ['ownership-type', 'Ownership Type Master', 'ทรัพย์สิน'],
  ['vendor', 'Vendor / Supplier Master', 'คู่ค้า'],
] as const;

export type MasterType = (typeof masterDataDefs)[number][0];

const defs = masterDataDefs;
const parentTypeMap: Partial<Record<MasterType, MasterType>> = {
  building: 'site',
  floor: 'building',
  zone: 'floor',
  room: 'zone',
  'asset-subcategory': 'asset-category'
};

const ALL_COMPANIES = '__ALL_COMPANIES__';

// Master Data กลุ่มมาตรฐาน ใช้ชุดเดียวกันทุกบริษัท เพื่อไม่ต้องสร้างข้อมูลซ้ำ
const sharedMasterTypes = new Set<MasterType>([
  'brand',
  'asset-category',
  'asset-subcategory',
  'asset-status',
  'asset-condition',
  'criticality',
  'ownership-type',
]);

// Vendor รองรับได้ทั้งผู้ขายกลางและผู้ขายเฉพาะบริษัท
const flexibleScopeMasterTypes = new Set<MasterType>(['vendor']);

function isSharedMasterType(type: MasterType) {
  return sharedMasterTypes.has(type);
}

function isFlexibleScopeMasterType(type: MasterType) {
  return flexibleScopeMasterTypes.has(type);
}

function formCompanyCode(type: MasterType, companyCode = '') {
  if (isSharedMasterType(type)) return ALL_COMPANIES;
  if (isFlexibleScopeMasterType(type) && !String(companyCode || '').trim()) return ALL_COMPANIES;
  return String(companyCode || '').trim();
}

function payloadCompanyCode(type: MasterType, companyCode = '') {
  if (isSharedMasterType(type) || companyCode === ALL_COMPANIES) return '';
  return String(companyCode || '').trim();
}

const extraFields: Partial<Record<MasterType, Field[]>> = {
  brand: [
    { key: 'country', label: 'ประเทศต้นกำเนิด' },
    { key: 'website', label: 'Website' }
  ],
  department: [
    { key: 'managerName', label: 'ผู้รับผิดชอบแผนก' },
    { key: 'description', label: 'รายละเอียด', type: 'textarea' }
  ],
  site: [
    { key: 'address', label: 'ที่อยู่', type: 'textarea' },
    { key: 'province', label: 'จังหวัด' },
    { key: 'country', label: 'ประเทศ' },
    { key: 'latitude', label: 'Latitude', type: 'number', step: '0.000001' },
    { key: 'longitude', label: 'Longitude', type: 'number', step: '0.000001' }
  ],
  building: [
    { key: 'address', label: 'รายละเอียดที่ตั้ง' },
    { key: 'description', label: 'รายละเอียด', type: 'textarea' }
  ],
  floor: [{ key: 'description', label: 'รายละเอียด', type: 'textarea' }],
  zone: [{ key: 'description', label: 'รายละเอียด', type: 'textarea' }],
  room: [
    { key: 'capacity', label: 'ความจุ/จำนวนที่รองรับ', type: 'number', min: 0 },
    { key: 'description', label: 'รายละเอียด', type: 'textarea' }
  ],
  'asset-category': [{ key: 'description', label: 'รายละเอียด', type: 'textarea' }],
  'asset-subcategory': [{ key: 'description', label: 'รายละเอียด', type: 'textarea' }],
  'asset-status': [
    { key: 'colorCode', label: 'รหัสสี เช่น #2563EB' },
    { key: 'description', label: 'รายละเอียด', type: 'textarea' }
  ],
  'asset-condition': [
    { key: 'minPercent', label: 'สภาพต่ำสุด (%)', type: 'number', min: 0, max: 100 },
    { key: 'maxPercent', label: 'สภาพสูงสุด (%)', type: 'number', min: 0, max: 100 },
    { key: 'description', label: 'รายละเอียด', type: 'textarea' }
  ],
  criticality: [
    { key: 'responseHours', label: 'เวลาตอบสนองเป้าหมาย (ชม.)', type: 'number', min: 0 },
    { key: 'description', label: 'รายละเอียด', type: 'textarea' }
  ],
  'ownership-type': [{ key: 'description', label: 'รายละเอียด', type: 'textarea' }],
  vendor: [
    { key: 'taxId', label: 'เลขประจำตัวผู้เสียภาษี' },
    { key: 'contactName', label: 'ผู้ติดต่อ' },
    { key: 'phone', label: 'โทรศัพท์' },
    { key: 'email', label: 'Email', type: 'email' },
    { key: 'address', label: 'ที่อยู่', type: 'textarea' },
    { key: 'paymentTerms', label: 'เงื่อนไขการชำระเงิน' }
  ],
};

const companyStatusOptions = [
  { value: 'ACTIVE', label: 'ACTIVE' },
  { value: 'INACTIVE', label: 'INACTIVE' }
];

function companyValue(row: any, key: string) {
  const value = row?.[key] ?? row?.data?.[key];
  return value === '' || value == null ? '-' : value;
}

function CompanyRecordForm({
  initial,
  editing,
  onSubmit,
  onCancel
}: {
  initial: any;
  editing: any;
  onSubmit: (values: any) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<any>({
    code: '',
    name: '',
    company_name_th: '',
    tax_id: '',
    address: '',
    phone: '',
    email: '',
    logo_url: '',
    status: 'ACTIVE',
    ...initial
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function setField(key: string, value: string) {
    setForm((current: any) => ({ ...current, [key]: value }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit({
        code: String(form.code || '').trim().toUpperCase(),
        name: String(form.name || '').trim(),
        company_name_th: String(form.company_name_th || '').trim(),
        tax_id: String(form.tax_id || '').trim(),
        address: String(form.address || '').trim(),
        phone: String(form.phone || '').trim(),
        email: String(form.email || '').trim(),
        logo_url: String(form.logo_url || '').trim(),
        status: form.status || 'ACTIVE'
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'บันทึกข้อมูลบริษัทไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="entity-form" onSubmit={submit}>
      {error && <div className="alert error">{error}</div>}
      <div className="form-grid">
        <label>
          <span>Company Code *</span>
          <input
            required
            disabled={Boolean(editing)}
            value={form.code || ''}
            onChange={(event) => setField('code', event.target.value.toUpperCase())}
          />
        </label>
        <label>
          <span>ชื่ออังกฤษ *</span>
          <input required value={form.name || ''} onChange={(event) => setField('name', event.target.value)} />
        </label>
        <label>
          <span>ชื่อไทย</span>
          <input value={form.company_name_th || ''} onChange={(event) => setField('company_name_th', event.target.value)} />
        </label>
        <label>
          <span>เลขประจำตัวผู้เสียภาษี</span>
          <input value={form.tax_id || ''} onChange={(event) => setField('tax_id', event.target.value)} />
        </label>
        <label className="span-2">
          <span>ที่อยู่</span>
          <textarea value={form.address || ''} onChange={(event) => setField('address', event.target.value)} />
        </label>
        <label>
          <span>โทรศัพท์</span>
          <input value={form.phone || ''} onChange={(event) => setField('phone', event.target.value)} />
        </label>
        <label>
          <span>Email</span>
          <input type="email" value={form.email || ''} onChange={(event) => setField('email', event.target.value)} />
        </label>
        <label>
          <span>Logo URL</span>
          <input value={form.logo_url || ''} onChange={(event) => setField('logo_url', event.target.value)} />
        </label>
        <label>
          <span>สถานะ *</span>
          <CompactSelect
            required
            value={form.status || 'ACTIVE'}
            options={companyStatusOptions}
            onChange={(value) => setField('status', value)}
          />
        </label>
      </div>
      <footer className="form-footer">
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>ยกเลิก</button>
        <button className="primary" disabled={busy}>{busy ? 'กำลังบันทึก...' : 'บันทึก'}</button>
      </footer>
    </form>
  );
}

function dataSummary(type: MasterType, row: any) {
  const fields = extraFields[type] || [];
  const values = fields
    .map((field) => {
      const rawValue = row.data?.[field.key];
      if (rawValue === '' || rawValue == null || Number.isNaN(rawValue)) return '';
      const optionLabel = field.options?.find((option) => option.value === String(rawValue))?.label;
      return `${field.label}: ${optionLabel || rawValue}`;
    })
    .filter(Boolean);
  return values.slice(0, 3).join(' · ') || '-';
}

const parentColumnLabels: Partial<Record<MasterType, string>> = {
  building: 'Site',
  floor: 'Building',
  zone: 'Floor',
  room: 'Zone',
  'asset-subcategory': 'หมวดทรัพย์สิน',
};

function tableColumnsFor(type: MasterType): Column[] {
  if (type === 'company') {
    return [
      { key: 'code', label: 'รหัสบริษัท' },
      { key: 'name', label: 'ชื่ออังกฤษ' },
      { key: 'company_name_th', label: 'ชื่อไทย', render: (row) => companyValue(row, 'company_name_th') },
      { key: 'tax_id', label: 'เลขประจำตัวผู้เสียภาษี', render: (row) => companyValue(row, 'tax_id') },
      { key: 'address', label: 'ที่อยู่', render: (row) => companyValue(row, 'address') },
      { key: 'phone', label: 'โทรศัพท์', render: (row) => companyValue(row, 'phone') },
      { key: 'email', label: 'Email', render: (row) => companyValue(row, 'email') },
      {
        key: 'logo_url',
        label: 'Logo',
        render: (row) => {
          const logoUrl = row?.logo_url ?? row?.data?.logo_url;
          return logoUrl
            ? <a href={logoUrl} target="_blank" rel="noreferrer">เปิด Logo</a>
            : '-';
        }
      },
      { key: 'status', label: 'สถานะ', render: (row) => <Badge value={row.status} /> }
    ];
  }

  if (type === 'employee') {
    return [
      { key: 'code', label: 'รหัสพนักงาน' },
      { key: 'name', label: 'ชื่อ' },
      { key: 'company_code', label: 'บริษัท' },
      { key: 'role', label: 'Role' },
      { key: 'status', label: 'สถานะ', render: (row) => <Badge value={row.status} /> }
    ];
  }

  const columns: Column[] = [
    { key: 'code', label: 'รหัส' },
    { key: 'name', label: 'ชื่อ' }
  ];

  // Master Data กลางไม่ต้องแสดงคอลัมน์บริษัท/ขอบเขต เพราะทุกแถวใช้ร่วมทุกบริษัทอยู่แล้ว
  if (!isSharedMasterType(type)) {
    columns.push({
      key: 'company_code',
      label: isFlexibleScopeMasterType(type) ? 'ขอบเขต' : 'บริษัท',
      render: (row) => row.company_code || 'ใช้ร่วมทุกบริษัท'
    });
  }

  // แสดง Parent เฉพาะ Master ที่มีการเลือก Parent ในแบบฟอร์มเท่านั้น
  if (parentTypeMap[type]) {
    columns.push({
      key: 'parent_code',
      label: parentColumnLabels[type] || 'Parent'
    });
  }

  if (type === 'room') {
    columns.push({
      key: 'room_owner',
      label: 'เจ้าของ / ผู้ดูแลห้อง',
      render: (row) => {
        const name = row.data?.ownerName || row.data?.owner_name;
        const department = row.data?.ownerDepartment || row.data?.owner_department;
        const employeeCode = row.data?.ownerEmployeeCode || row.data?.owner_employee_code;
        return name
          ? <span className="room-master-owner"><strong>{name}</strong><small>{[department, employeeCode].filter(Boolean).join(' · ')}</small></span>
          : <span className="room-owner-unassigned">ยังไม่กำหนด</span>;
      }
    });
  }

  // แสดงรายละเอียดเฉพาะ Master ที่มีช่องรายละเอียดเพิ่มเติมให้กรอก
  if ((extraFields[type] || []).length > 0) {
    columns.push({
      key: 'details',
      label: 'รายละเอียด',
      render: (row) => dataSummary(type, row)
    });
  }

  columns.push({
    key: 'status',
    label: 'สถานะ',
    render: (row) => <Badge value={row.status} />
  });

  return columns;
}

function MasterRecordForm({
  type,
  initial,
  editing,
  companies,
  employees,
  parentRows,
  parentType,
  userRole,
  userCompany,
  onSubmit,
  onCancel
}: {
  type: MasterType;
  initial: any;
  editing: any;
  companies: any[];
  employees: any[];
  parentRows: any[];
  parentType?: MasterType;
  userRole: string;
  userCompany: string;
  onSubmit: (values: any) => Promise<void>;
  onCancel: () => void;
}) {
  const sharedScope = isSharedMasterType(type);
  const flexibleScope = isFlexibleScopeMasterType(type);
  const [form, setForm] = useState<any>({
    code: '',
    name: '',
    parentCode: '',
    companyCode: sharedScope || flexibleScope
      ? ALL_COMPANIES
      : userCompany || companies[0]?.code || companies[0]?.id || '',
    status: 'ACTIVE',
    decimalAllowed: 'NO',
    ...initial
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const companyOptions = [
    ...(flexibleScope ? [{ value: ALL_COMPANIES, label: 'ใช้ร่วมทุกบริษัท' }] : []),
    ...companies
      .filter((company) => company.status !== 'INACTIVE')
      .map((company) => ({
        value: company.code || company.id,
        label: `${company.code || company.id} · ${company.name || company.code || company.id}`
      }))
  ];

  const effectiveCompanyCode = payloadCompanyCode(type, form.companyCode);
  const parentOptions = parentRows
    .filter((row) => !row.company_code || row.company_code === effectiveCompanyCode)
    .map((row) => ({
      value: row.code,
      label: `${row.code} · ${row.name}${row.company_code ? ` · ${row.company_code}` : ''}`,
      keywords: [row.name, row.company_code].filter(Boolean).join(' ')
    }));
  const currentParent = String(form.parentCode || '').trim();
  if (currentParent && !parentOptions.some((option) => option.value === currentParent)) {
    parentOptions.unshift({ value: currentParent, label: `${currentParent} · ข้อมูลเดิม`, keywords: '' });
  }
  const ownerOptions = employees
    .filter((employee) => employee.status === 'ACTIVE')
    .filter((employee) => !effectiveCompanyCode || String(employee.company || '').toUpperCase() === effectiveCompanyCode.toUpperCase())
    .map((employee) => ({
      value: employee.id,
      label: `${employee.name} · ${employee.department || '-'} (${employee.id})`,
      keywords: `${employee.name} ${employee.department || ''} ${employee.id}`
    }));
  if (form.ownerEmployeeCode && !ownerOptions.some((option) => option.value === form.ownerEmployeeCode)) {
    ownerOptions.unshift({ value: form.ownerEmployeeCode, label: `${form.ownerName || form.ownerEmployeeCode} · ข้อมูลเดิม`, keywords: form.ownerEmployeeCode });
  }

  function setField(key: string, value: any) {
    setForm((current: any) => {
      if (key === 'companyCode') return { ...current, companyCode: value, parentCode: '', ownerEmployeeCode: '', ownerName: '', ownerDepartment: '' };
      return { ...current, [key]: value };
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (parentType && !form.parentCode) throw new Error('กรุณาเลือก Parent Master ก่อนบันทึก');
      await onSubmit(form);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'บันทึก Master Data ไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  function renderExtra(field: Field) {
    const value = form[field.key] ?? '';
    if (field.type === 'select') {
      return <CompactSelect value={String(value)} options={field.options || []} required={Boolean(field.required)} searchable onChange={(next) => setField(field.key, next)} />;
    }
    if (field.type === 'textarea') {
      return <textarea value={String(value)} required={Boolean(field.required)} onChange={(event) => setField(field.key, event.target.value)} />;
    }
    return (
      <input
        type={field.type === 'number' || field.type === 'email' ? field.type : 'text'}
        value={value as any}
        required={Boolean(field.required)}
        min={field.min as any}
        max={field.max as any}
        step={field.step as any}
        onChange={(event) => setField(field.key, field.type === 'number' ? event.target.valueAsNumber : event.target.value)}
      />
    );
  }

  return (
    <form className="entity-form" onSubmit={submit}>
      {error && <div className="alert error">{error}</div>}
      <div className="form-grid">
        <label><span>รหัส *</span><input required disabled={Boolean(editing)} value={form.code || ''} onChange={(event) => setField('code', event.target.value)} /></label>
        <label><span>ชื่อ *</span><input required value={form.name || ''} onChange={(event) => setField('name', event.target.value)} /></label>
        {sharedScope ? null : userRole === 'ADMIN' ? (
          <label>
            <span>{flexibleScope ? 'ขอบเขต / บริษัท *' : 'บริษัท *'}</span>
            <CompactSelect required searchable value={form.companyCode || ''} options={companyOptions} onChange={(value) => setField('companyCode', value)} />
          </label>
        ) : null}
        {parentType && (
          <label>
            <span>Parent ({defs.find((item) => item[0] === parentType)?.[1] || parentType}) *</span>
            <CompactSelect required searchable value={form.parentCode || ''} options={parentOptions} searchPlaceholder="ค้นหารหัสหรือชื่อ Parent" onChange={(value) => setField('parentCode', value)} />
          </label>
        )}
        <label><span>สถานะ *</span><CompactSelect required value={form.status || 'ACTIVE'} options={[{ value: 'ACTIVE', label: 'ACTIVE' }, { value: 'INACTIVE', label: 'INACTIVE' }]} onChange={(value) => setField('status', value)} /></label>
        {type === 'room' && <label className="span-2">
          <span>ผู้ดูแลหลัก / เจ้าของห้อง</span>
          <CompactSelect searchable value={form.ownerEmployeeCode || ''} options={ownerOptions} placeholder="ยังไม่กำหนดผู้ดูแลห้อง" searchPlaceholder="ค้นหาชื่อ แผนก หรือรหัสพนักงาน" onChange={(value) => setField('ownerEmployeeCode', value)} />
          <small className="field-help">ชื่อนี้จะแสดงเมื่อเลือกดูทรัพย์สินตามห้อง</small>
        </label>}
        {(extraFields[type] || []).map((field) => (
          <label key={field.key} className={field.type === 'textarea' ? 'span-2' : ''}>
            <span>{field.label}{field.required ? ' *' : ''}</span>
            {renderExtra(field)}
          </label>
        ))}
      </div>
      <footer className="form-footer">
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>ยกเลิก</button>
        <button className="primary" disabled={busy}>{busy ? 'กำลังบันทึก...' : 'บันทึก'}</button>
      </footer>
    </form>
  );
}

export default function MasterDataPage({
  onNavigate,
  userRole,
  userCompany,
  companies,
  employees,
  onReload,
  selectedType,
  onSelectedTypeChange
}: {
  onNavigate: (page: any) => void;
  userRole: string;
  userCompany: string;
  companies: any[];
  employees: any[];
  onReload: () => Promise<void>;
  selectedType?: MasterType;
  onSelectedTypeChange?: (type: MasterType) => void;
}) {
  const companyLocationTypes = new Set<MasterType>(['site', 'building', 'floor', 'zone', 'room']);
  const defaultType: MasterType = userRole === 'SUPERVISOR' ? 'site' : 'company';
  const [internalType, setInternalType] = useState<MasterType>(selectedType || defaultType);
  const type = selectedType || internalType;
  const setType = (nextType: MasterType) => {
    setInternalType(nextType);
    onSelectedTypeChange?.(nextType);
  };
  const canWrite = userRole === 'ADMIN' || (userRole === 'SUPERVISOR' && companyLocationTypes.has(type));
  const companyWrite = userRole === 'ADMIN';
  const [rows, setRows] = useState<any[]>([]);
  const [parentRows, setParentRows] = useState<any[]>([]);
  const [editing, setEditing] = useState<any>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const selected = defs.find((item) => item[0] === type)!;

  async function load() {
    setError('');
    try {
      if (type === 'employee') {
        const result: any[] = await api('/api/employees');
        setRows(result.map((item) => ({
          id: item.id,
          code: item.id,
          name: item.name,
          company_code: item.company,
          role: item.role,
          status: item.status
        })));
      } else if (type === 'company') {
        const result: any[] = await api('/api/companies');
        setRows(result.map((item) => ({
          ...item,
          company_name_th: item.company_name_th ?? item.data?.company_name_th ?? '',
          tax_id: item.tax_id ?? item.data?.tax_id ?? '',
          address: item.address ?? item.data?.address ?? '',
          phone: item.phone ?? item.data?.phone ?? '',
          email: item.email ?? item.data?.email ?? '',
          logo_url: item.logo_url ?? item.data?.logo_url ?? ''
        })));
      } else {
        setRows(await api(`/api/master/${type}`));
      }

      const parentType = parentTypeMap[type];
      setParentRows(parentType ? await api(`/api/master/${parentType}`) : []);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'โหลด Master Data ไม่สำเร็จ');
    }
  }

  useEffect(() => {
    setEditing(null);
    setCreating(false);
    void load();
  }, [type]);

  useEffect(() => {
    if (selectedType && selectedType !== internalType) setInternalType(selectedType);
  }, [selectedType]);

  useEffect(() => {
    if (userRole !== 'ADMIN' && !companyLocationTypes.has(type)) setType(defaultType);
  }, [userRole, type]);

  const parentType = parentTypeMap[type];

  async function save(values: any) {
    if (type === 'company') {
      if (editing) await put(`/api/companies/${encodeURIComponent(editing.code)}`, values);
      else await post('/api/companies', values);
    } else {
      const dataKeys = (extraFields[type] || []).map((field) => field.key);
      const data = Object.fromEntries(dataKeys.map((key) => [key, values[key] ?? '']));
      const companyCode = payloadCompanyCode(
        type,
        values.companyCode ?? formCompanyCode(type, editing?.company_code || userCompany || '')
      );
      if (type === 'room') {
        const owner = employees.find((employee) => employee.id === values.ownerEmployeeCode);
        data.ownerEmployeeCode = values.ownerEmployeeCode || '';
        data.ownerName = owner?.name || values.ownerName || '';
        data.ownerDepartment = owner?.department || values.ownerDepartment || '';
      }
      const payload = {
        code: editing?.code || values.code,
        name: values.name,
        parentCode: values.parentCode || '',
        companyCode,
        status: values.status || 'ACTIVE',
        data
      };
      if (editing) await put(`/api/master/${type}/${editing.id}`, payload);
      else await post(`/api/master/${type}`, payload);
    }
    setEditing(null);
    setCreating(false);
    await Promise.all([load(), onReload()]);
  }

  async function remove(row: any) {
    if (!confirm(`ลบ ${row.code} - ${row.name} ใช่หรือไม่?`)) return;
    if (type === 'company') await del(`/api/companies/${encodeURIComponent(row.code)}?cascade=1`);
    else await del(`/api/master/${type}/${row.id}?cascade=1`);
    await Promise.all([load(), onReload()]);
  }

  const editInitial = editing
    ? type === 'company'
      ? {
          code: editing.code || editing.data?.company_code || '',
          name: editing.name || editing.data?.company_name_en || '',
          company_name_th: editing.company_name_th ?? editing.data?.company_name_th ?? '',
          tax_id: editing.tax_id ?? editing.data?.tax_id ?? '',
          address: editing.address ?? editing.data?.address ?? '',
          phone: editing.phone ?? editing.data?.phone ?? '',
          email: editing.email ?? editing.data?.email ?? '',
          logo_url: editing.logo_url ?? editing.data?.logo_url ?? '',
          status: editing.status || editing.data?.status || 'ACTIVE'
        }
      : {
          ...editing,
          ...(editing.data || {}),
          parentCode: editing.parent_code,
          companyCode: formCompanyCode(type, editing.company_code)
        }
    : type === 'company'
      ? { status: 'ACTIVE' }
      : {
          companyCode: isSharedMasterType(type) || isFlexibleScopeMasterType(type)
            ? ALL_COMPANIES
            : userCompany || companies[0]?.code || companies[0]?.id || '',
          status: 'ACTIVE',
          decimalAllowed: 'NO',
        };

  return (
    <>
      <PageHeader title="Master Data" description="หมวดหมู่และข้อมูลมาตรฐานใช้ร่วมทุกบริษัท ส่วนแผนกและสถานที่แยกตามบริษัท บันทึกแล้วอัปเดต Dropdown อัตโนมัติ" />
      <section className="card master-content">
          <div className="sub-header">
            <div>
              <Database size={20} />
              <div>
                <h3>{selected[1]}</h3>
                <p>
                  {type === 'room'
                    ? 'กำหนดเจ้าของหรือผู้ดูแลหลักของแต่ละห้อง กดปุ่มดินสอเพื่อเพิ่มหรือเปลี่ยนผู้ดูแล'
                    : isSharedMasterType(type)
                    ? 'ข้อมูลกลาง ใช้ใน Dropdown ของทุกบริษัท'
                    : isFlexibleScopeMasterType(type)
                      ? 'เลือกใช้ร่วมทุกบริษัท หรือกำหนดเฉพาะบริษัทได้'
                      : 'ข้อมูลแยกตามบริษัท พร้อม Parent Validation'}
                </p>
              </div>
            </div>
            {type === 'employee'
              ? <button className="primary" onClick={() => onNavigate('users')}><ExternalLink size={16} />จัดการผู้ใช้</button>
              : canWrite && (type !== 'company' || companyWrite)
                ? <button className="primary" onClick={() => setCreating(true)}>+ เพิ่มข้อมูล</button>
                : null}
          </div>
          {error && <div className="alert error">{error}</div>}
          <DataTable
            rows={rows}
            searchText={(row) => [
              row.code,
              row.name,
              row.company_code,
              row.parent_code,
              row.role,
              JSON.stringify(row.data || {})
            ].join(' ')}
            columns={tableColumnsFor(type)}
            onEdit={type === 'employee' || !canWrite || (type === 'company' && !companyWrite) ? undefined : setEditing}
            onDelete={type === 'employee' || !canWrite || (type === 'company' && !companyWrite) ? undefined : remove}
          />
      </section>
      <Modal
        open={creating || Boolean(editing)}
        title={`${editing ? 'แก้ไข' : 'เพิ่ม'} ${selected[1]}`}
        onClose={() => { setCreating(false); setEditing(null); }}
        wide={type === 'company' || (extraFields[type] || []).length > 4}
      >
        {type === 'company' ? (
          <CompanyRecordForm
            key={`company-${editing?.code || 'new'}`}
            initial={editInitial}
            editing={editing}
            onSubmit={save}
            onCancel={() => { setCreating(false); setEditing(null); }}
          />
        ) : (
          <MasterRecordForm
            key={`${type}-${editing?.id || 'new'}`}
            type={type}
            initial={editInitial}
            editing={editing}
            companies={companies}
            employees={employees}
            parentRows={parentRows}
            parentType={parentType}
            userRole={userRole}
            userCompany={userCompany}
            onSubmit={save}
            onCancel={() => { setCreating(false); setEditing(null); }}
          />
        )}
      </Modal>
    </>
  );
}
