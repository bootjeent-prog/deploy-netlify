import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  Armchair,
  ArrowDownToLine,
  Box,
  Download,
  Eye,
  Image as ImageIcon,
  ImagePlus,
  MapPin,
  PackageCheck,
  Pencil,
  RotateCcw,
  Trash2,
  UserCog,
  Warehouse,
  X
} from 'lucide-react';
import type { Employee, User } from '../types';
import { api, del, downloadXlsx, post, put, type ExcelColumn } from '../api';
import {
  Badge,
  CompactSelect,
  DataTable,
  DatePickerInput,
  Modal,
  PageHeader,
  SectionTabs,
  dateText,
  type SelectOption
} from '../ui';
import { locationOptions, masterOptions, masterRows, roomOwnerForLocation, roomRecordForLocation, type MasterDataMap, type MasterRecord } from '../masterData';
import { AuthenticatedImage } from '../protectedMedia';
import { ImageGallery } from '../ImageGallery';

const today = () => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
}).format(new Date());

const qtyText = (value: unknown) => {
  const number = Number(value || 0);
  return Number.isInteger(number)
    ? new Intl.NumberFormat('th-TH', { maximumFractionDigits: 0 }).format(number)
    : new Intl.NumberFormat('th-TH', { maximumFractionDigits: 2 }).format(number);
};

const normalize = (value: unknown) => String(value || '').trim().toUpperCase();
const MAX_FACILITY_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_FACILITY_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const facilityTypeOptions: SelectOption[] = [
  { value: 'ASSET', label: 'Asset · ทรัพย์สินที่ต้องควบคุม' },
  { value: 'FREE_ASSET', label: 'Free Asset · ของส่วนกลางที่เบิก–คืนได้' },
  { value: 'NON_ASSET', label: 'Non-Asset · วัสดุจ่ายออก ไม่ต้องคืน' }
];
const responsibleDepartmentOptions: SelectOption[] = [
  { value: 'GA', label: 'GA · อาคาร สถานที่ และอุปกรณ์สำนักงาน' },
  { value: 'IT', label: 'IT · อุปกรณ์และระบบสารสนเทศ' },
  { value: 'HR', label: 'HR · งานที่ฝ่ายบุคคลดูแล' }
];

function facilityTypeLabel(value: string) {
  return facilityTypeOptions.find((option) => option.value === value)?.label || value || '-';
}

function departmentCode(value: unknown) {
  const raw = String(value || '').trim();
  const upper = raw.toUpperCase();
  if (['IT', 'GA', 'HR'].includes(upper)) return upper;
  const normalized = raw.toLowerCase();
  if (/(^|[^a-z])it([^a-z]|$)|information\s*technology|ไอที|สารสนเทศ/.test(normalized)) return 'IT';
  if (/(^|[^a-z])ga([^a-z]|$)|general\s*affairs?|facilit(?:y|ies)|ธุรการ|อาคาร|สถานที่|บริหารทั่วไป/.test(normalized)) return 'GA';
  if (/(^|[^a-z])hr([^a-z]|$)|human\s*resources?|บุคคล|ทรัพยากรบุคคล/.test(normalized)) return 'HR';
  return '';
}

type FacilityImage = {
  id: number;
  url: string;
  mime?: string;
};

type FacilityAsset = {
  id: number;
  item_code: string;
  company_code: string;
  name: string;
  asset_type: string;
  responsible_department: string;
  category: string;
  unit: string;
  total_quantity: number;
  available_quantity: number;
  damaged_quantity: number;
  custodian_employee_code: string;
  custodian_name: string;
  storage_location: string;
  warehouse: string;
  note: string;
  has_image?: boolean;
  image_count?: number;
  images?: FacilityImage[];
  asset_image_mime?: string;
  image_url?: string;
  created_at: string;
  updated_at?: string;
};

type FacilityIssue = {
  id: number;
  issue_no: string;
  facility_asset_id: number;
  company_code: string;
  item_code: string;
  asset_name: string;
  unit: string;
  quantity: number;
  returned_quantity: number;
  damaged_quantity: number;
  receiver_employee_code: string;
  receiver_name: string;
  department: string;
  destination_location: string;
  purpose: string;
  issue_date: string;
  due_date: string;
  status: string;
  issued_by: string;
  created_at: string;
};

type FacilityMovement = {
  id: number;
  facility_asset_id: number;
  company_code: string;
  item_code: string;
  asset_name: string;
  movement_type: string;
  quantity: number;
  reference_no: string;
  from_location: string;
  to_location: string;
  employee_code: string;
  employee_name: string;
  note: string;
  created_at: string;
};

function facilityStatus(row: FacilityAsset) {
  const available = Number(row.available_quantity || 0);
  const damaged = Number(row.damaged_quantity || 0);
  const total = Number(row.total_quantity || 0);
  const inUse = Math.max(0, total - available - damaged);
  if (damaged > 0) return 'DAMAGED';
  if (inUse > 0) return 'IN_USE';
  return 'AVAILABLE';
}

function movementLabel(value: string) {
  const labels: Record<string, string> = {
    INITIAL_RECEIVE: 'รับเข้าครั้งแรก',
    RECEIVE: 'รับเพิ่ม',
    ADJUST_TOTAL: 'ปรับจำนวนทั้งหมด',
    ISSUE: 'เบิกใช้',
    ISSUE_CONSUMABLE: 'จ่ายออก (ไม่รับคืน)',
    RETURN_GOOD: 'คืนพร้อมใช้',
    RETURN_DAMAGED: 'คืนชำรุด'
  };
  return labels[value] || value;
}

function companyOptions(companies: any[], user: User): SelectOption[] {
  const rows = companies
    .map((row) => ({
      value: String(row.code || row.id || row.data?.company_code || '').trim(),
      label: String(row.name || row.data?.company_name_th || row.data?.company_name_en || row.code || row.id || '').trim()
    }))
    .filter((row) => row.value);
  if (!rows.some((row) => normalize(row.value) === normalize(user.company))) {
    rows.unshift({ value: user.company, label: user.company });
  }
  return rows;
}

function employeeOptions(employees: Employee[], company: string, current = ''): SelectOption[] {
  const rows = employees
    .filter((employee) => !company || normalize(employee.company) === normalize(company))
    .filter((employee) => employee.status === 'ACTIVE')
    .map((employee) => ({
      value: employee.id,
      label: `${employee.name} · ${employee.department || '-'} (${employee.id})`,
      keywords: `${employee.name} ${employee.department} ${employee.position} ${employee.id}`
    }));
  if (current && !rows.some((row) => row.value === current)) {
    const employee = employees.find((item) => item.id === current);
    rows.unshift({ value: current, label: employee ? `${employee.name} (${employee.id})` : current, keywords: current });
  }
  return rows;
}

function locationLabel(value: string, masterData: MasterDataMap, company: string) {
  const option = locationOptions(masterData, company, value).find((item) => item.value === value);
  return option?.label || value || '-';
}

function roomLocationPath(masterData: MasterDataMap, room: MasterRecord) {
  const parts: string[] = [];
  let parentCode = room.parentCode;
  for (const type of ['zone', 'floor', 'building', 'site']) {
    if (!parentCode) break;
    const parent = masterRows(masterData, type, room.companyCode, { includeInactive: true })
      .find((row) => normalize(row.code) === normalize(parentCode));
    if (!parent) break;
    parts.unshift(parent.name || parent.code);
    parentCode = parent.parentCode;
  }
  return parts.join(' › ');
}

function facilityImages(asset?: FacilityAsset | null): FacilityImage[] {
  if (!asset) return [];
  if (Array.isArray(asset.images) && asset.images.length) return asset.images;
  const legacy = asset.image_url || (asset.has_image
    ? `/api/facility-assets/${encodeURIComponent(asset.id)}/image${asset.updated_at ? `?v=${new Date(asset.updated_at).getTime()}` : ''}`
    : '');
  return legacy ? [{ id: 0, url: legacy, mime: asset.asset_image_mime }] : [];
}

function facilityImageSource(asset?: FacilityAsset | null) {
  return facilityImages(asset)[0]?.url || '';
}


export default function FacilityAssetsPage({
  employees,
  companies,
  masterData,
  user,
  onManageRooms
}: {
  employees: Employee[];
  companies: any[];
  masterData: MasterDataMap;
  user: User;
  onManageRooms?: () => void;
}) {
  const [assets, setAssets] = useState<FacilityAsset[]>([]);
  const [issues, setIssues] = useState<FacilityIssue[]>([]);
  const [movements, setMovements] = useState<FacilityMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [assetModal, setAssetModal] = useState<{ mode: 'create' | 'edit'; row?: FacilityAsset } | null>(null);
  const [issueAsset, setIssueAsset] = useState<FacilityAsset | null>(null);
  const [receiveAsset, setReceiveAsset] = useState<FacilityAsset | null>(null);
  const [returnIssue, setReturnIssue] = useState<FacilityIssue | null>(null);
  const [detailAsset, setDetailAsset] = useState<FacilityAsset | null>(null);
  const [deletingAssetId, setDeletingAssetId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<'registry' | 'issued' | 'history'>('registry');
  const [selectedRoomKey, setSelectedRoomKey] = useState('');

  const hasManagementRole = ['ADMIN', 'SUPERVISOR'].includes(user.role);
  const userDepartment = user.role === 'HR' ? 'HR' : departmentCode(`${user.department || ''} ${user.position || ''}`);
  const canCreate = user.role === 'ADMIN' || (user.role === 'SUPERVISOR' && Boolean(userDepartment));
  const defaultResponsibleDepartment = user.role === 'ADMIN' ? 'GA' : (userDepartment || 'GA');
  const canManageRow = (row: FacilityAsset) => hasManagementRole && (user.role === 'ADMIN' || row.responsible_department === userDepartment);
  const companiesForForm = useMemo(() => companyOptions(companies, user), [companies, user]);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const [assetRows, issueRows, movementRows] = await Promise.all([
        api<FacilityAsset[]>('/api/facility-assets'),
        api<FacilityIssue[]>('/api/facility-issues'),
        api<FacilityMovement[]>('/api/facility-movements')
      ]);
      setAssets(assetRows);
      setIssues(issueRows);
      setMovements(movementRows);
    } catch (caught: any) {
      setError(caught.message || 'ไม่สามารถโหลดทรัพย์สินส่วนกลางได้');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const rooms = useMemo(() => masterRows(masterData, 'room'), [masterData]);
  const roomOptions = useMemo<SelectOption[]>(() => rooms.map((room) => {
    const owner = roomOwnerForLocation(masterData, room.companyCode, room.code);
    const path = roomLocationPath(masterData, room);
    return {
      value: `${room.companyCode}@@${room.code}`,
      label: `${room.code} · ${room.name}`,
      description: `${path || room.companyCode || 'ไม่ระบุเส้นทาง'} • ผู้ดูแล: ${owner?.name || 'ยังไม่กำหนด'}`,
      keywords: `${room.name} ${room.parentCode} ${room.companyCode} ${path} ${owner?.name || ''} ${owner?.department || ''}`
    };
  }), [rooms, masterData]);
  const selectedRoom = rooms.find((room) => `${room.companyCode}@@${room.code}` === selectedRoomKey);
  const visibleAssets = useMemo(() => selectedRoom
    ? assets.filter((asset) => normalize(asset.storage_location) === normalize(selectedRoom.code)
      && (!selectedRoom.companyCode || normalize(asset.company_code) === normalize(selectedRoom.companyCode)))
    : assets, [assets, selectedRoomKey, rooms]);
  const visibleAssetIds = useMemo(() => new Set(visibleAssets.map((asset) => Number(asset.id))), [visibleAssets]);
  const visibleIssues = issues.filter((issue) => visibleAssetIds.has(Number(issue.facility_asset_id)));
  const visibleMovements = movements.filter((movement) => visibleAssetIds.has(Number(movement.facility_asset_id)));
  const selectedRoomOwner = selectedRoom ? roomOwnerForLocation(masterData, selectedRoom.companyCode, selectedRoom.code) : null;
  const selectedRoomPath = selectedRoom ? roomLocationPath(masterData, selectedRoom) : '';

  const summary = useMemo(() => {
    const total = visibleAssets.reduce((sum, row) => sum + Number(row.total_quantity || 0), 0);
    const available = visibleAssets.reduce((sum, row) => sum + Number(row.available_quantity || 0), 0);
    const damaged = visibleAssets.reduce((sum, row) => sum + Number(row.damaged_quantity || 0), 0);
    return {
      records: visibleAssets.length,
      total,
      available,
      inUse: Math.max(0, total - available - damaged),
      damaged
    };
  }, [visibleAssets]);

  const activeIssues = visibleIssues.filter((row) => Number(row.quantity || 0) > Number(row.returned_quantity || 0) + Number(row.damaged_quantity || 0));

  async function removeFacilityAsset(row: FacilityAsset) {
    const inUse = Math.max(0, Number(row.total_quantity || 0) - Number(row.available_quantity || 0) - Number(row.damaged_quantity || 0));
    if (inUse > 0) {
      window.alert(`ยังลบไม่ได้ เพราะ ${row.name} มีทรัพย์สินกำลังถูกใช้งานอยู่ ${qtyText(inUse)} ${row.unit}`);
      return;
    }
    const confirmed = window.confirm(
      `ยืนยันลบทรัพย์สินส่วนกลาง\n${row.item_code} · ${row.name}\n\nรายการนี้จะถูกลบพร้อมรูปภาพและประวัติที่เชื่อมโยง กรุณาตรวจสอบให้แน่ใจก่อนดำเนินการ`
    );
    if (!confirmed) return;

    setDeletingAssetId(row.id);
    setError('');
    try {
      await del(`/api/facility-assets/${encodeURIComponent(row.id)}`);
      setAssets((current) => current.filter((item) => item.id !== row.id));
      setIssues((current) => current.filter((item) => item.facility_asset_id !== row.id));
      setMovements((current) => current.filter((item) => item.facility_asset_id !== row.id));
      if (detailAsset?.id === row.id) setDetailAsset(null);
    } catch (caught: any) {
      setError(caught.message || 'ลบทรัพย์สินส่วนกลางไม่สำเร็จ');
    } finally {
      setDeletingAssetId(null);
    }
  }

  function exportAssets() {
    const columns: ExcelColumn[] = [
      { key: 'item_code', header: 'รหัสกลุ่มทรัพย์สิน', width: 20 },
      { key: 'name', header: 'รายการ', width: 28 },
      { key: 'asset_type', header: 'ประเภท', width: 22, value: (row) => facilityTypeLabel(row.asset_type) },
      { key: 'responsible_department', header: 'หน่วยงานผู้ดูแล', width: 18 },
      { key: 'category', header: 'หมวดหมู่', width: 20 },
      { key: 'company_code', header: 'บริษัท', width: 14 },
      { key: 'total_quantity', header: 'จำนวนทั้งหมด', width: 14, type: 'number' },
      { key: 'available_quantity', header: 'พร้อมเบิก', width: 14, type: 'number' },
      { key: 'in_use', header: 'กำลังใช้งาน', width: 14, type: 'number', value: (row) => Math.max(0, Number(row.total_quantity) - Number(row.available_quantity) - Number(row.damaged_quantity)) },
      { key: 'damaged_quantity', header: 'ชำรุด', width: 12, type: 'number' },
      { key: 'unit', header: 'หน่วย', width: 12 },
      { key: 'room_owner', header: 'ผู้ดูแลห้อง', width: 24, value: (row) => roomOwnerForLocation(masterData, row.company_code, row.storage_location)?.name || 'ยังไม่กำหนด' },
      { key: 'custodian_name', header: 'ผู้ดูแลรายการ', width: 24 },
      { key: 'storage_location', header: 'สถานที่เก็บหลัก', width: 22 },
      { key: 'warehouse', header: 'คลัง', width: 16 },
      { key: 'note', header: 'หมายเหตุ', width: 30 }
    ];
    downloadXlsx(`facility-assets-${today()}.xlsx`, 'ทรัพย์สินส่วนกลาง', columns, visibleAssets);
  }

  return <>
    <PageHeader
      title="ทรัพย์สินส่วนกลาง"
      description="แยก Asset, Free Asset และ Non-Asset พร้อมระบุหน่วยงานเจ้าของ สถานที่ จำนวน และผู้ดูแลให้ชัดเจน"
      actionLabel="เพิ่มทรัพย์สินส่วนกลาง"
      onAction={canCreate ? () => setAssetModal({ mode: 'create' }) : undefined}
    >
      {visibleAssets.length > 0 && <button className="secondary" onClick={exportAssets}><Download size={16} />Export Excel</button>}
    </PageHeader>

    {error && <div className="alert error">{error}</div>}
    {user.role === 'SUPERVISOR' && !userDepartment && <div className="alert warning">ยังระบุทีมผู้ดูแลไม่ได้ กรุณากำหนดแผนกของบัญชีผู้ใช้ให้เป็น IT, GA หรือ HR ก่อนทำรายการ</div>}
    {loading && <div className="loading-card">กำลังโหลดข้อมูล...</div>}

    <section className="card facility-room-filter-card">
      <div className="facility-room-filter-head"><MapPin size={20} /><div><h3>ดูทรัพย์สินตามห้อง</h3><p>เลือกห้องเพื่อดูรายการทั้งหมดและผู้รับผิดชอบห้องนั้น</p></div></div>
      <div className="facility-room-filter-control">
        <span>ห้อง / พื้นที่</span>
        <CompactSelect searchable value={selectedRoomKey} options={roomOptions} placeholder="แสดงทุกห้อง" searchPlaceholder="ค้นหารหัส ชื่อห้อง หรือผู้ดูแล" maxMenuHeight={260} onChange={setSelectedRoomKey} />
      </div>
      {selectedRoom && <div className="room-owner-banner">
        <div className="room-owner-room"><small>ห้องที่เลือก</small><strong>{selectedRoom.code} · {selectedRoom.name}</strong><span>{selectedRoomPath || selectedRoom.companyCode || 'ไม่ระบุเส้นทางสถานที่'}</span></div>
        <div className={`room-owner-person ${selectedRoomOwner ? '' : 'is-unassigned'}`}><small>เจ้าของ / ผู้ดูแลห้อง</small><strong>{selectedRoomOwner?.name || 'ยังไม่กำหนด'}</strong><span>{selectedRoomOwner ? [selectedRoomOwner.department, selectedRoomOwner.employeeCode].filter(Boolean).join(' · ') : 'กรุณากำหนดใน Room Master'}</span></div>
        {onManageRooms && <button type="button" className="secondary room-owner-manage-button" onClick={onManageRooms}><Pencil size={15} />จัดการใน Room Master</button>}
      </div>}
    </section>

    <section className="metric-grid facility-metric-grid">
      <div className="metric-card"><span className="metric-icon"><Box size={18} /></span><span>รายการ</span><strong>{qtyText(summary.records)}</strong></div>
      <div className="metric-card"><span className="metric-icon"><Armchair size={18} /></span><span>จำนวนทั้งหมด</span><strong>{qtyText(summary.total)}</strong></div>
      <div className="metric-card"><span className="metric-icon"><PackageCheck size={18} /></span><span>พร้อมเบิก</span><strong>{qtyText(summary.available)}</strong></div>
      <div className="metric-card"><span className="metric-icon"><ArrowDownToLine size={18} /></span><span>กำลังใช้งาน</span><strong>{qtyText(summary.inUse)}</strong></div>
      <div className="metric-card"><span className="metric-icon"><RotateCcw size={18} /></span><span>ชำรุด/พักใช้</span><strong>{qtyText(summary.damaged)}</strong></div>
    </section>

    <SectionTabs
      value={activeTab}
      onChange={(value) => setActiveTab(value as 'registry' | 'issued' | 'history')}
      ariaLabel="ส่วนการใช้งานทรัพย์สินส่วนกลาง"
      items={[
        { value: 'registry', label: 'ทะเบียนทรัพย์สิน', count: visibleAssets.length },
        { value: 'issued', label: 'กำลังเบิกใช้งาน', count: activeIssues.length },
        { value: 'history', label: 'ประวัติความเคลื่อนไหว', count: visibleMovements.length }
      ]}
    />

    <div className="module-tab-panel" hidden={activeTab !== 'registry'} role="tabpanel">
    <section className="card facility-section-card">
      <div className="section-heading-row">
        <div><h3>ทะเบียนทรัพย์สินส่วนกลาง</h3><p className="muted">1 รายการสามารถแทนทรัพย์สินชนิดเดียวกันหลายชิ้น เช่น “เก้าอี้สำนักงาน 100 ตัว”</p></div>
      </div>
      <DataTable
        rows={visibleAssets}
        columns={[
          {
            key: 'image',
            label: 'รูป',
            filterable: false,
            render: (row) => {
              const images = facilityImages(row);
              const source = images[0]?.url || '';
              return <div className="facility-thumb-wrap">
                <div className="facility-thumb">
                  {source ? <AuthenticatedImage source={source} alt={row.name} /> : <ImageIcon size={20} />}
                </div>
                {images.length > 1 && <span className="facility-thumb-count">+{images.length - 1}</span>}
              </div>;
            }
          },
          { key: 'item_code', label: 'รหัส', filterable: false },
          { key: 'name', label: 'รายการ', filterable: false },
          { key: 'asset_type', label: 'ประเภท', filterLabel: (value) => facilityTypeLabel(String(value)), render: (row) => facilityTypeLabel(row.asset_type) },
          { key: 'responsible_department', label: 'หน่วยงานผู้ดูแล', render: (row) => <Badge value={row.responsible_department || 'GA'} /> },
          { key: 'category', label: 'หมวดหมู่' },
          { key: 'available_quantity', label: 'พร้อมเบิก', filterable: false, render: (row) => <strong>{qtyText(row.available_quantity)} {row.unit}</strong> },
          { key: 'in_use', label: 'ใช้งาน', filterable: false, render: (row) => `${qtyText(Math.max(0, Number(row.total_quantity) - Number(row.available_quantity) - Number(row.damaged_quantity)))} ${row.unit}` },
          { key: 'damaged_quantity', label: 'ชำรุด', filterable: false, render: (row) => `${qtyText(row.damaged_quantity)} ${row.unit}` },
          { key: 'room_owner', label: 'ผู้ดูแลห้อง', render: (row) => roomOwnerForLocation(masterData, row.company_code, row.storage_location)?.name || 'ยังไม่กำหนด' },
          { key: 'custodian_name', label: 'ผู้ดูแลรายการ', render: (row) => row.custodian_name || 'ยังไม่กำหนด' },
          { key: 'storage_location', label: 'สถานที่เก็บ', render: (row) => locationLabel(row.storage_location, masterData, row.company_code) },
          { key: 'status', label: 'สถานะ', filterValue: (row) => facilityStatus(row), render: (row) => <Badge value={facilityStatus(row)} /> }
        ]}
        actions={(row) => <>
          <button
            className="table-button"
            title="ดูรายละเอียดทรัพย์สินส่วนกลาง"
            onClick={() => setDetailAsset(row)}
          >
            <Eye size={15} />
            รายละเอียด
          </button>
          {canManageRow(row) && <button
            className="icon-btn"
            title={Number(row.available_quantity) <= 0 ? 'ไม่มีจำนวนพร้อมจ่าย' : row.asset_type === 'NON_ASSET' ? 'จ่ายออก (ไม่รับคืน)' : 'เบิกใช้'}
            aria-label={`${row.asset_type === 'NON_ASSET' ? 'จ่ายออก' : 'เบิกใช้'} ${row.name}`}
            onClick={() => setIssueAsset(row)}
            disabled={Number(row.available_quantity) <= 0}
          >
            <ArrowDownToLine size={16} />
          </button>}
          {canManageRow(row) && <button
            className="icon-btn"
            title="รับเพิ่ม"
            aria-label={`รับเพิ่ม ${row.name}`}
            onClick={() => setReceiveAsset(row)}
          >
            <PackageCheck size={16} />
          </button>}
          {canManageRow(row) && <button
            className="icon-btn"
            title="แก้ไข"
            aria-label={`แก้ไข ${row.name}`}
            onClick={() => setAssetModal({ mode: 'edit', row })}
          >
            <Pencil size={16} />
          </button>}
          {canManageRow(row) && <button
            className="icon-btn danger"
            title={deletingAssetId === row.id ? 'กำลังลบ...' : 'ลบ'}
            aria-label={`ลบ ${row.name}`}
            onClick={() => void removeFacilityAsset(row)}
            disabled={deletingAssetId === row.id}
          >
            <Trash2 size={16} />
          </button>}
        </>}
      />
    </section>
    </div>

    <div className="module-tab-panel" hidden={activeTab !== 'issued'} role="tabpanel">
    <section className="card facility-section-card">
      <div className="section-heading-row"><div><h3>รายการที่กำลังเบิกใช้งาน</h3><p className="muted">ติดตามว่าเบิกไปกี่ชิ้น อยู่ที่ใคร/พื้นที่ไหน และคืนแล้วเท่าไร</p></div></div>
      <DataTable
        rows={activeIssues}
        columns={[
          { key: 'issue_no', label: 'เลขที่เบิก', filterable: false },
          { key: 'asset_name', label: 'รายการ', filterable: false },
          { key: 'receiver_name', label: 'ผู้รับ/ผู้ใช้งาน', render: (row) => row.receiver_name || row.department || 'ส่วนกลาง' },
          { key: 'destination_location', label: 'พื้นที่ใช้งาน', render: (row) => locationLabel(row.destination_location, masterData, row.company_code) },
          { key: 'outstanding', label: 'ค้างใช้งาน', filterable: false, render: (row) => `${qtyText(Math.max(0, Number(row.quantity) - Number(row.returned_quantity) - Number(row.damaged_quantity)))} ${row.unit}` },
          { key: 'issue_date', label: 'วันที่เบิก', filterable: false, render: (row) => dateText(row.issue_date) },
          { key: 'status', label: 'สถานะ', render: (row) => <Badge value={row.status} /> }
        ]}
        actions={(row) => {
          const asset = assets.find((item) => Number(item.id) === Number(row.facility_asset_id));
          return asset && canManageRow(asset)
            ? <button className="table-button" onClick={() => setReturnIssue(row)}><RotateCcw size={15} />รับคืน</button>
            : null;
        }}
      />
    </section>
    </div>

    <div className="module-tab-panel" hidden={activeTab !== 'history'} role="tabpanel">
    <section className="card facility-section-card">
      <div className="section-heading-row"><div><h3>ประวัติความเคลื่อนไหว</h3><p className="muted">เก็บประวัติรับเข้า เบิกใช้ คืนพร้อมใช้ และคืนชำรุด เพื่อ Audit ย้อนหลัง</p></div></div>
      <DataTable
        rows={visibleMovements}
        columns={[
          { key: 'created_at', label: 'วัน-เวลา', filterable: false, render: (row) => new Date(row.created_at).toLocaleString('th-TH') },
          { key: 'item_code', label: 'รหัส', filterable: false },
          { key: 'asset_name', label: 'รายการ', filterable: false },
          { key: 'movement_type', label: 'รายการเคลื่อนไหว', filterLabel: (value) => movementLabel(String(value)), render: (row) => movementLabel(row.movement_type) },
          { key: 'quantity', label: 'จำนวน', filterable: false, render: (row) => qtyText(row.quantity) },
          { key: 'to_location', label: 'ปลายทาง', render: (row) => row.to_location ? locationLabel(row.to_location, masterData, row.company_code) : '-' },
          { key: 'employee_name', label: 'ผู้รับ/ผู้เกี่ยวข้อง', render: (row) => row.employee_name || '-' },
          { key: 'reference_no', label: 'อ้างอิง', filterable: false }
        ]}
      />
    </section>
    </div>

    <Modal
      open={Boolean(assetModal)}
      title={assetModal?.mode === 'edit' ? `แก้ไข ${assetModal.row?.item_code || ''}` : 'เพิ่มทรัพย์สินส่วนกลาง'}
      onClose={() => setAssetModal(null)}
      wide
    >
      {assetModal && <FacilityAssetForm
        row={assetModal.row}
        user={user}
        employees={employees}
        companies={companiesForForm}
        masterData={masterData}
        defaultResponsibleDepartment={defaultResponsibleDepartment}
        onCancel={() => setAssetModal(null)}
        onSave={async (values) => {
          if (assetModal.mode === 'edit' && assetModal.row) await put(`/api/facility-assets/${assetModal.row.id}`, values);
          else await post('/api/facility-assets', values);
          setAssetModal(null);
          await load();
        }}
      />}
    </Modal>

    <Modal open={Boolean(issueAsset)} title={`${issueAsset?.asset_type === 'NON_ASSET' ? 'จ่ายออก' : 'เบิกใช้'} ${issueAsset?.name || ''}`} onClose={() => setIssueAsset(null)} wide>
      {issueAsset && <IssueForm
        asset={issueAsset}
        employees={employees}
        masterData={masterData}
        onCancel={() => setIssueAsset(null)}
        onSave={async (values) => {
          await post(`/api/facility-assets/${issueAsset.id}/issues`, values);
          setIssueAsset(null);
          setActiveTab('issued');
          await load();
        }}
      />}
    </Modal>

    <Modal open={Boolean(receiveAsset)} title={`รับเพิ่ม ${receiveAsset?.name || ''}`} onClose={() => setReceiveAsset(null)}>
      {receiveAsset && <ReceiveForm
        asset={receiveAsset}
        onCancel={() => setReceiveAsset(null)}
        onSave={async (values) => {
          await post(`/api/facility-assets/${receiveAsset.id}/receive`, values);
          setReceiveAsset(null);
          await load();
        }}
      />}
    </Modal>

    <Modal open={Boolean(returnIssue)} title={`รับคืน ${returnIssue?.issue_no || ''}`} onClose={() => setReturnIssue(null)} wide>
      {returnIssue && <ReturnForm
        issue={returnIssue}
        masterData={masterData}
        onCancel={() => setReturnIssue(null)}
        onSave={async (values) => {
          await post(`/api/facility-issues/${returnIssue.id}/returns`, values);
          setReturnIssue(null);
          setActiveTab('history');
          await load();
        }}
      />}
    </Modal>

    <Modal open={Boolean(detailAsset)} title={`รายละเอียด ${detailAsset?.item_code || ''}`} onClose={() => setDetailAsset(null)} wide>
      {detailAsset && <FacilityDetail asset={detailAsset} issues={issues} movements={movements} masterData={masterData} />}
    </Modal>
  </>;
}

function FacilityAssetForm({
  row,
  user,
  employees,
  companies,
  masterData,
  defaultResponsibleDepartment,
  onCancel,
  onSave
}: {
  row?: FacilityAsset;
  user: User;
  employees: Employee[];
  companies: SelectOption[];
  masterData: MasterDataMap;
  defaultResponsibleDepartment: string;
  onCancel: () => void;
  onSave: (values: any) => Promise<void>;
}) {
  const [form, setForm] = useState({
    companyCode: row?.company_code || user.company,
    itemCode: row?.item_code || '',
    name: row?.name || '',
    assetType: row?.asset_type || 'ASSET',
    responsibleDepartment: row?.responsible_department || defaultResponsibleDepartment || 'GA',
    category: row?.category || '',
    unit: row?.unit || 'ชิ้น',
    totalQuantity: row?.total_quantity ?? 100,
    custodianEmployeeCode: row?.custodian_employee_code || '',
    storageLocation: row?.storage_location || '',
    warehouse: row?.warehouse || '',
    note: row?.note || ''
  });
  const [existingImages, setExistingImages] = useState<FacilityImage[]>(() => facilityImages(row));
  const [newImages, setNewImages] = useState<Array<{ key: string; name: string; data: string }>>([]);
  const [removedImageIds, setRemovedImageIds] = useState<number[]>([]);
  const [imageError, setImageError] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const company = form.companyCode || user.company;
  const categories = masterOptions(masterData, 'asset-category', company, { currentValue: form.category });
  const units = masterOptions(masterData, 'unit', company, { currentValue: form.unit });
  const locations = locationOptions(masterData, company, form.storageLocation);
  const selectedStorageRoom = roomRecordForLocation(masterData, company, form.storageLocation);
  const selectedStorageRoomOwner = roomOwnerForLocation(masterData, company, form.storageLocation);
  const warehouses = masterOptions(masterData, 'warehouse', company, { currentValue: form.warehouse });
  const custodianEmployees = employees.filter((employee) => {
    const employeeDepartment = departmentCode(`${employee.department || ''} ${employee.position || ''}`);
    return !employeeDepartment || employeeDepartment === form.responsibleDepartment;
  });
  const custodians = employeeOptions(custodianEmployees, company, form.custodianEmployeeCode);
  const inUseQuantity = row ? Math.max(0, Number(row.total_quantity || 0) - Number(row.available_quantity || 0) - Number(row.damaged_quantity || 0)) : 0;
  const minimumTotalQuantity = row ? inUseQuantity + Number(row.damaged_quantity || 0) : 0.01;
  const imageCount = existingImages.length + newImages.length;

  function readImage(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพได้'));
      reader.readAsDataURL(file);
    });
  }

  async function chooseImages(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files || []);
    input.value = '';
    if (!files.length) return;
    setImageError('');

    if (imageCount + files.length > 5) {
      setImageError(`เพิ่มรูปภาพได้สูงสุด 5 รูป (ขณะนี้มี ${imageCount} รูป)`);
      return;
    }
    const unsupported = files.find((file) => !ALLOWED_FACILITY_IMAGE_TYPES.includes(file.type));
    if (unsupported) {
      setImageError(`ไฟล์ ${unsupported.name} ไม่รองรับ กรุณาใช้ JPG, PNG หรือ WEBP`);
      return;
    }
    const oversized = files.find((file) => file.size > MAX_FACILITY_IMAGE_SIZE);
    if (oversized) {
      setImageError(`ไฟล์ ${oversized.name} มีขนาดเกิน 5 MB`);
      return;
    }

    try {
      const rows = await Promise.all(files.map(async (file, index) => ({
        key: `${Date.now()}-${index}-${file.name}`,
        name: file.name,
        data: await readImage(file)
      })));
      setNewImages((current) => [...current, ...rows]);
    } catch (caught: any) {
      setImageError(caught.message || 'ไม่สามารถอ่านไฟล์รูปภาพได้');
    }
  }

  function removeExistingImage(image: FacilityImage) {
    setExistingImages((current) => current.filter((item) => item.id !== image.id));
    if (image.id > 0) setRemovedImageIds((current) => current.includes(image.id) ? current : [...current, image.id]);
  }

  function removeNewImage(key: string) {
    setNewImages((current) => current.filter((item) => item.key !== key));
    setImageError('');
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave({
        ...form,
        imagesData: newImages.map((image) => image.data),
        removeImageIds: removedImageIds
      });
    } catch (caught: any) {
      setError(caught.message || 'บันทึกไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return <form className="entity-form" onSubmit={submit}>
    {error && <div className="alert error">{error}</div>}
    <div className="facility-form-note"><Armchair size={18} /><div><strong>เลือกประเภทก่อนกรอกข้อมูล</strong><span>Asset และ Free Asset ใช้ขั้นตอนเบิก–คืน ส่วน Non-Asset เป็นวัสดุจ่ายออกที่ไม่ต้องรับคืน</span></div></div>

    <section className="facility-image-editor facility-image-editor-multiple">
      <div className="facility-image-controls facility-image-controls-top">
        <div><strong>รูปภาพทรัพย์สิน ({imageCount}/5)</strong><span>เพิ่มได้สูงสุด 5 รูป รองรับ JPG, PNG และ WEBP รูปละไม่เกิน 5 MB</span></div>
        <div className="facility-image-actions">
          <label className={`secondary facility-image-picker ${imageCount >= 5 ? 'is-disabled' : ''}`}><ImagePlus size={16} />เพิ่มรูปภาพ<input type="file" multiple disabled={imageCount >= 5} accept="image/jpeg,image/png,image/webp" onChange={chooseImages} /></label>
        </div>
        {imageError && <div className="facility-image-error">{imageError}</div>}
      </div>

      {imageCount > 0 ? <div className="facility-image-gallery">
        {existingImages.map((image, index) => <article className="facility-image-tile" key={`existing-${image.id}-${index}`}>
          <AuthenticatedImage source={image.url} alt={`${row?.name || 'ทรัพย์สิน'} รูปที่ ${index + 1}`} />
          <span className="facility-image-order">{index + 1}</span>
          <button type="button" className="facility-image-tile-remove" onClick={() => removeExistingImage(image)} title="ลบรูปนี้"><X size={15} /></button>
        </article>)}
        {newImages.map((image, index) => <article className="facility-image-tile facility-image-tile-new" key={image.key}>
          <img src={image.data} alt={image.name} />
          <span className="facility-image-order">{existingImages.length + index + 1}</span>
          <span className="facility-image-new-badge">ใหม่</span>
          <button type="button" className="facility-image-tile-remove" onClick={() => removeNewImage(image.key)} title="ลบรูปนี้"><X size={15} /></button>
          <small>{image.name}</small>
        </article>)}
      </div> : <div className="facility-image-empty facility-image-empty-wide"><ImageIcon size={38} /><strong>ยังไม่มีรูปภาพ</strong><span>สามารถเลือกรูปโต๊ะ เก้าอี้ ตู้ หรืออุปกรณ์ส่วนกลางได้สูงสุด 5 รูป</span></div>}
    </section>

    <div className="form-grid">
      <label><span>บริษัท *</span><CompactSelect value={form.companyCode} options={companies} disabled={Boolean(row) || user.role !== 'ADMIN'} onChange={(value) => setForm((current) => ({ ...current, companyCode: value, custodianEmployeeCode: '', storageLocation: '', warehouse: '' }))} required /></label>
      <label><span>ประเภท *</span><CompactSelect value={form.assetType} options={facilityTypeOptions} onChange={(value) => setForm({ ...form, assetType: value })} required /></label>
      <label><span>หน่วยงานผู้ดูแลสถานที่/รายการ *</span><CompactSelect value={form.responsibleDepartment} options={responsibleDepartmentOptions} onChange={(value) => setForm({ ...form, responsibleDepartment: value, custodianEmployeeCode: '' })} required /></label>
      <label><span>รหัสทรัพย์สินส่วนกลาง</span><input value={form.itemCode} maxLength={80} placeholder="กรอกรหัสเอง หรือเว้นว่างให้ระบบสร้าง FAC อัตโนมัติ" onChange={(e) => setForm({ ...form, itemCode: e.target.value })} /></label>
      <label><span>ชื่อรายการ *</span><input value={form.name} placeholder="เช่น โต๊ะประชุม / เก้าอี้สำนักงาน" required onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <label><span>หมวดหมู่ *</span><CompactSelect value={form.category} options={categories} placeholder="เลือกหมวดหมู่" onChange={(value) => setForm({ ...form, category: value })} required /></label>
      <label><span>หน่วย *</span><CompactSelect value={form.unit} options={units.length ? units : [{ value: 'ชิ้น', label: 'ชิ้น' }, { value: 'ตัว', label: 'ตัว' }, { value: 'ชุด', label: 'ชุด' }]} placeholder="เลือกหน่วย" onChange={(value) => setForm({ ...form, unit: value })} required /></label>
      <label><span>{row ? 'จำนวนทั้งหมด' : 'จำนวนเริ่มต้น'} *</span><input type="number" min={minimumTotalQuantity} step="0.01" value={form.totalQuantity} required onChange={(e) => setForm({ ...form, totalQuantity: e.target.valueAsNumber })} />{row && <small className="field-help">แก้ได้ แต่ต้องไม่น้อยกว่ายอดที่กำลังใช้งานและชำรุดรวม {qtyText(minimumTotalQuantity)} {form.unit}</small>}</label>
      <label><span>ผู้ดูแลหลัก ({form.responsibleDepartment})</span><CompactSelect value={form.custodianEmployeeCode} options={custodians} placeholder={`ยังไม่กำหนดผู้ดูแล ${form.responsibleDepartment}`} onChange={(value) => setForm({ ...form, custodianEmployeeCode: value })} /></label>
      <label><span>สถานที่เก็บหลัก *</span><CompactSelect value={form.storageLocation} options={locations} placeholder="เลือกอาคาร/ชั้น/ห้อง/พื้นที่" onChange={(value) => setForm({ ...form, storageLocation: value })} required />
        {selectedStorageRoom && <small className="field-help location-owner-hint">ผู้ดูแลห้อง: {selectedStorageRoomOwner?.name || 'ยังไม่กำหนด'}{selectedStorageRoomOwner?.department ? ` (${selectedStorageRoomOwner.department})` : ''}</small>}
      </label>
      <label><span>คลัง (ถ้ามี)</span><CompactSelect value={form.warehouse} options={warehouses} placeholder="ไม่ระบุคลัง" onChange={(value) => setForm({ ...form, warehouse: value })} /></label>
      <label className="span-2"><span>หมายเหตุ</span><textarea value={form.note} placeholder="เช่น เก็บสำหรับห้องประชุมและกิจกรรมส่วนกลาง" onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={onCancel}>ยกเลิก</button><button className="primary" disabled={busy}>{busy ? 'กำลังบันทึก...' : row ? 'บันทึกการแก้ไข' : 'เพิ่มรายการ'}</button></footer>
  </form>;
}

function IssueForm({ asset, employees, masterData, onCancel, onSave }: { asset: FacilityAsset; employees: Employee[]; masterData: MasterDataMap; onCancel: () => void; onSave: (values: any) => Promise<void> }) {
  const [form, setForm] = useState({ quantity: 1, receiverEmployeeCode: '', destinationLocation: '', purpose: '', issueDate: today(), dueDate: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const receivers = employeeOptions(employees, asset.company_code);
  const locations = locationOptions(masterData, asset.company_code, form.destinationLocation);
  const selectedEmployee = employees.find((employee) => employee.id === form.receiverEmployeeCode);
  const isConsumable = asset.asset_type === 'NON_ASSET';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError('');
    try { await onSave({ ...form, department: selectedEmployee?.department || '' }); } catch (caught: any) { setError(caught.message || 'เบิกไม่สำเร็จ'); } finally { setBusy(false); }
  }

  return <form className="entity-form" onSubmit={submit}>
    {error && <div className="alert error">{error}</div>}
    <div className="facility-balance-banner"><PackageCheck size={18} /><span>{isConsumable ? 'พร้อมจ่ายขณะนี้' : 'พร้อมเบิกขณะนี้'}</span><strong>{qtyText(asset.available_quantity)} {asset.unit}</strong></div>
    {isConsumable && <div className="alert warning">Non-Asset เป็นวัสดุจ่ายออก ระบบจะตัดจำนวนคงเหลือทันทีและไม่มีขั้นตอนรับคืน</div>}
    <div className="form-grid">
      <label><span>{isConsumable ? 'จำนวนที่จ่ายออก' : 'จำนวนที่เบิก'} *</span><input type="number" min="0.01" max={Number(asset.available_quantity)} step="0.01" value={form.quantity} required onChange={(e) => setForm({ ...form, quantity: e.target.valueAsNumber })} /></label>
      <label><span>ผู้รับ/ผู้ใช้งาน</span><CompactSelect value={form.receiverEmployeeCode} options={receivers} placeholder="ส่วนกลาง / ไม่ระบุบุคคล" onChange={(value) => setForm({ ...form, receiverEmployeeCode: value })} /></label>
      <label><span>พื้นที่นำไปใช้งาน *</span><CompactSelect value={form.destinationLocation} options={locations} placeholder="เลือกอาคาร/ห้อง/พื้นที่" onChange={(value) => setForm({ ...form, destinationLocation: value })} required /></label>
      <label><span>วัตถุประสงค์ *</span><input value={form.purpose} placeholder="เช่น ใช้ในห้องประชุม A" required onChange={(e) => setForm({ ...form, purpose: e.target.value })} /></label>
      <label><span>วันที่เบิก *</span><DatePickerInput value={form.issueDate} required onChange={(value) => setForm({ ...form, issueDate: value })} /></label>
      {!isConsumable && <label><span>กำหนดคืน (ถ้ามี)</span><DatePickerInput value={form.dueDate} onChange={(value) => setForm({ ...form, dueDate: value })} /></label>}
      <label className="span-2"><span>หมายเหตุ</span><textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={onCancel}>ยกเลิก</button><button className="primary" disabled={busy}><ArrowDownToLine size={16} />{busy ? 'กำลังบันทึก...' : isConsumable ? 'ยืนยันจ่ายออก' : 'ยืนยันเบิกใช้'}</button></footer>
  </form>;
}

function ReceiveForm({ asset, onCancel, onSave }: { asset: FacilityAsset; onCancel: () => void; onSave: (values: any) => Promise<void> }) {
  const [form, setForm] = useState({ quantity: 1, receiveDate: today(), note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSave(form); } catch (caught: any) { setError(caught.message || 'รับเพิ่มไม่สำเร็จ'); } finally { setBusy(false); }
  }
  return <form className="entity-form" onSubmit={submit}>
    {error && <div className="alert error">{error}</div>}
    <div className="facility-balance-banner"><Armchair size={18} /><span>ยอดปัจจุบัน</span><strong>{qtyText(asset.total_quantity)} {asset.unit}</strong></div>
    <div className="form-grid">
      <label><span>จำนวนรับเพิ่ม *</span><input type="number" min="0.01" step="0.01" value={form.quantity} required onChange={(e) => setForm({ ...form, quantity: e.target.valueAsNumber })} /></label>
      <label><span>วันที่รับเข้า *</span><DatePickerInput value={form.receiveDate} required onChange={(value) => setForm({ ...form, receiveDate: value })} /></label>
      <label className="span-2"><span>หมายเหตุ / เอกสารอ้างอิง</span><textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={onCancel}>ยกเลิก</button><button className="primary" disabled={busy}><PackageCheck size={16} />{busy ? 'กำลังบันทึก...' : 'รับเข้าทรัพย์สิน'}</button></footer>
  </form>;
}

function ReturnForm({ issue, masterData, onCancel, onSave }: { issue: FacilityIssue; masterData: MasterDataMap; onCancel: () => void; onSave: (values: any) => Promise<void> }) {
  const outstanding = Math.max(0, Number(issue.quantity) - Number(issue.returned_quantity) - Number(issue.damaged_quantity));
  const [form, setForm] = useState({ goodQuantity: outstanding, damagedQuantity: 0, returnDate: today(), returnLocation: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locations = locationOptions(masterData, issue.company_code, form.returnLocation);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try { await onSave(form); } catch (caught: any) { setError(caught.message || 'รับคืนไม่สำเร็จ'); } finally { setBusy(false); }
  }
  return <form className="entity-form" onSubmit={submit}>
    {error && <div className="alert error">{error}</div>}
    <div className="facility-balance-banner"><RotateCcw size={18} /><span>จำนวนที่ยังไม่คืน</span><strong>{qtyText(outstanding)} {issue.unit}</strong></div>
    <div className="form-grid">
      <label><span>คืนพร้อมใช้ *</span><input type="number" min="0" max={outstanding} step="0.01" value={form.goodQuantity} onChange={(e) => setForm({ ...form, goodQuantity: e.target.valueAsNumber })} /></label>
      <label><span>คืนชำรุด *</span><input type="number" min="0" max={outstanding} step="0.01" value={form.damagedQuantity} onChange={(e) => setForm({ ...form, damagedQuantity: e.target.valueAsNumber })} /></label>
      <label><span>วันที่คืน *</span><DatePickerInput value={form.returnDate} required onChange={(value) => setForm({ ...form, returnDate: value })} /></label>
      <label><span>จุดรับคืน</span><CompactSelect value={form.returnLocation} options={locations} placeholder="ใช้สถานที่เก็บหลัก" onChange={(value) => setForm({ ...form, returnLocation: value })} /></label>
      <label className="span-2"><span>หมายเหตุ</span><textarea value={form.note} placeholder="หากชำรุดให้ระบุอาการ" onChange={(e) => setForm({ ...form, note: e.target.value })} /></label>
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={onCancel}>ยกเลิก</button><button className="primary" disabled={busy}>{busy ? 'กำลังรับคืน...' : 'ยืนยันรับคืน'}</button></footer>
  </form>;
}

function FacilityDetail({ asset, issues, movements, masterData }: { asset: FacilityAsset; issues: FacilityIssue[]; movements: FacilityMovement[]; masterData: MasterDataMap }) {
  const assetIssues = issues.filter((row) => Number(row.facility_asset_id) === Number(asset.id));
  const assetMovements = movements.filter((row) => Number(row.facility_asset_id) === Number(asset.id)).slice(0, 10);
  const inUse = Math.max(0, Number(asset.total_quantity) - Number(asset.available_quantity) - Number(asset.damaged_quantity));
  const images = facilityImages(asset);
  const roomOwner = roomOwnerForLocation(masterData, asset.company_code, asset.storage_location);
  return <div className="detail-grid facility-detail-grid">
    <section className="span-2 facility-detail-image-section"><h4><ImageIcon size={17} />รูปภาพทรัพย์สิน ({images.length}/5)</h4><ImageGallery images={images} name={asset.name || asset.item_code} /></section>
    <section><h4><Armchair size={17} />ข้อมูลรายการ</h4><dl>
      <dt>รหัส</dt><dd>{asset.item_code}</dd><dt>รายการ</dt><dd>{asset.name}</dd><dt>ประเภท</dt><dd>{facilityTypeLabel(asset.asset_type)}</dd><dt>หน่วยงานผู้ดูแล</dt><dd>{asset.responsible_department || 'GA'}</dd><dt>หมวดหมู่</dt><dd>{asset.category}</dd><dt>บริษัท</dt><dd>{asset.company_code}</dd><dt>หน่วย</dt><dd>{asset.unit}</dd><dt>หมายเหตุ</dt><dd>{asset.note || '-'}</dd>
    </dl></section>
    <section><h4><Warehouse size={17} />จำนวนและจุดเก็บ</h4><dl>
      <dt>จำนวนทั้งหมด</dt><dd>{qtyText(asset.total_quantity)} {asset.unit}</dd><dt>พร้อมเบิก</dt><dd>{qtyText(asset.available_quantity)} {asset.unit}</dd><dt>กำลังใช้งาน</dt><dd>{qtyText(inUse)} {asset.unit}</dd><dt>ชำรุด/พักใช้</dt><dd>{qtyText(asset.damaged_quantity)} {asset.unit}</dd><dt>สถานที่เก็บหลัก</dt><dd>{locationLabel(asset.storage_location, masterData, asset.company_code)}</dd><dt>ผู้ดูแลห้อง</dt><dd>{roomOwner?.name || 'ยังไม่กำหนด'}{roomOwner?.department ? ` (${roomOwner.department})` : ''}</dd><dt>คลัง</dt><dd>{asset.warehouse || '-'}</dd>
    </dl></section>
    <section><h4><UserCog size={17} />ผู้ดูแล</h4><dl><dt>รหัสพนักงาน</dt><dd>{asset.custodian_employee_code || '-'}</dd><dt>ผู้ดูแลหลัก</dt><dd>{asset.custodian_name || 'ยังไม่กำหนด'}</dd><dt>สถานะ</dt><dd><Badge value={facilityStatus(asset)} /></dd></dl></section>
    <section><h4><ArrowDownToLine size={17} />การเบิกใช้งาน</h4><ul className="history-list">{assetIssues.length ? assetIssues.slice(0, 6).map((row) => <li key={row.id}><strong>{row.issue_no}</strong><span>{row.receiver_name || row.department || 'ส่วนกลาง'} · {qtyText(row.quantity)} {row.unit}</span><small>{dateText(row.issue_date)} · {row.purpose || '-'}</small></li>) : <li><span>ยังไม่มีประวัติการเบิก</span></li>}</ul></section>
    <section className="span-2"><h4><RotateCcw size={17} />ความเคลื่อนไหวล่าสุด</h4><ul className="history-list">{assetMovements.length ? assetMovements.map((row) => <li key={row.id}><strong>{movementLabel(row.movement_type)} · {qtyText(row.quantity)}</strong><span>{row.reference_no || '-'}</span><small>{new Date(row.created_at).toLocaleString('th-TH')} {row.note ? `· ${row.note}` : ''}</small></li>) : <li><span>ยังไม่มีประวัติ</span></li>}</ul></section>
  </div>;
}
