import { Fragment, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import QRCode from 'qrcode';
import {
  Banknote,
  Boxes,
  CalendarDays,
  Download,
  FileText,
  Hash,
  Image as ImageIcon,
  ImagePlus,
  MapPin,
  Paperclip,
  Plus,
  QrCode,
  Trash2,
  Wrench,
  X
} from 'lucide-react';
import type { Asset, Employee } from '../types';
import type { MasterDataMap } from '../masterData';
import { locationOptions, masterOptions, withFallback } from '../masterData';
import { api, del, post, put } from '../api';
import ReportExportButton from '../ReportExportButton';
import { AuthenticatedImage, ProtectedFileButton } from '../protectedMedia';
import { AssetPhotoButton } from '../AssetPhotoButton';
import {
  Badge,
  CompactSelect,
  DataTable,
  EntityForm,
  Field,
  Modal,
  PageHeader,
  dateText,
  money
} from '../ui';

const statuses = [
  'ACTIVE',
  'IN_STOCK',
  'INACTIVE',
  'BROKEN',
  'LOST'
];

const defaultAssetStatusLabels: Record<string, string> = {
  ACTIVE: 'ใช้งานอยู่',
  IN_STOCK: 'อยู่ในคลัง',
  INACTIVE: 'พักใช้งาน',
  BROKEN: 'ชำรุด',
  LOST: 'สูญหาย'
};

const itemTemplate = {
  name: '',
  brand: '',
  model: '',
  serial: '',
  quantity: 1,
  required: true,
  note: ''
};

const MAX_IMAGE_SIZE = 5 * 1024 * 1024;

const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp'
];

const MAX_PURCHASE_DOCUMENT_SIZE = 5 * 1024 * 1024;
const MAX_PURCHASE_DOCUMENT_COUNT = 10;

const ALLOWED_PURCHASE_DOCUMENT_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png'
];

const purchaseDocumentTypes = [
  { value: 'TAX_INVOICE', label: 'ใบกำกับภาษี' },
  { value: 'INVOICE', label: 'Invoice / ใบแจ้งหนี้' },
  { value: 'RECEIPT', label: 'ใบเสร็จรับเงิน' },
  { value: 'OTHER', label: 'เอกสารอื่น' }
];

function isoToDisplayDate(value: unknown): string {
  const raw = String(value || '').slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : raw;
}

function displayToIsoDate(value: string): string {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return '';

  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));

  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) {
    return '';
  }

  return `${match[3]}-${match[2]}-${match[1]}`;
}

function maskDisplayDate(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

function DayMonthYearInput({
  value,
  required,
  onChange
}: {
  value: unknown;
  required?: boolean;
  onChange: (value: string) => void;
}) {
  const [display, setDisplay] = useState(() => isoToDisplayDate(value));
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDisplay(isoToDisplayDate(value));
  }, [value]);

  function openCalendar() {
    const picker = pickerRef.current;
    if (!picker) return;

    // showPicker() เปิด native calendar โดยตรงใน browser ที่รองรับ
    // และ click() เป็น fallback สำหรับ browser รุ่นเก่า
    try {
      picker.showPicker?.();
    } catch {
      picker.click();
    }
  }

  return (
    <div className="day-month-year-input">
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={10}
        placeholder="วว/ดด/ปปปป"
        value={display}
        required={required}
        onChange={(event) => {
          const next = maskDisplayDate(event.target.value);
          setDisplay(next);
          if (!next) {
            onChange('');
            return;
          }
          const iso = displayToIsoDate(next);
          if (iso) onChange(iso);
        }}
        onBlur={() => {
          if (!display) {
            onChange('');
            return;
          }
          const iso = displayToIsoDate(display);
          if (iso) {
            setDisplay(isoToDisplayDate(iso));
            onChange(iso);
          } else {
            setDisplay(isoToDisplayDate(value));
          }
        }}
      />
      <button
        type="button"
        className="date-picker-button"
        aria-label="เลือกวันที่จากปฏิทิน"
        title="เลือกวันที่จากปฏิทิน"
        onClick={openCalendar}
      >
        <CalendarDays size={16} />
      </button>
      <input
        ref={pickerRef}
        className="native-date-picker-proxy"
        type="date"
        tabIndex={-1}
        aria-hidden="true"
        value={String(value || '').slice(0, 10)}
        onChange={(event) => {
          const iso = event.target.value;
          setDisplay(isoToDisplayDate(iso));
          onChange(iso);
        }}
      />
    </div>
  );
}

const fields: Field[] = [
  {
    key: 'company',
    label: 'บริษัท',
    type: 'select',
    required: true,
  },
  {
    key: 'name',
    label: 'ชื่อทรัพย์สิน',
    required: true
  },
  {
    key: 'accountingAssetId',
    label: 'Asset ID สำหรับบัญชี',
    placeholder: 'เช่น FA-000123 / รหัสทรัพย์สินจากระบบบัญชี'
  },
  {
    key: 'category',
    label: 'หมวดทรัพย์สิน',
    required: true
  },
  {
    key: 'subcategory',
    label: 'หมวดย่อย'
  },
  {
    key: 'brand',
    label: 'ยี่ห้อ'
  },
  {
    key: 'model',
    label: 'รุ่น'
  },
  {
    key: 'serial',
    label: 'Serial Number',
    required: true
  },
  {
    key: 'assignedEmployeeId',
    label: 'ผู้ถือครอง / ผู้รับผิดชอบ',
    type: 'select'
  },
  {
    key: 'responsibleDepartment',
    label: 'หน่วยงานเจ้าของทรัพย์สิน',
    type: 'select',
    required: true,
    options: [
      { value: 'IT', label: 'IT · อุปกรณ์และระบบสารสนเทศ' },
      { value: 'GA', label: 'GA · อาคาร สถานที่ และอุปกรณ์สำนักงาน' },
      { value: 'HR', label: 'HR · ทรัพย์สินที่ฝ่ายบุคคลดูแล' }
    ]
  },
  {
    key: 'department',
    label: 'แผนกของผู้ถือครอง'
  },
  {
    key: 'location',
    label: 'ตำแหน่งจัดเก็บ / สถานที่ใช้งาน',
    required: true,
    placeholder: 'เช่น IT-STORAGE, คลังกลาง, อาคาร A ชั้น 2'
  },
  {
    key: 'status',
    label: 'สถานะ',
    type: 'select',
    required: true,
    options: statuses.map((status) => ({
      value: status,
      label: status
    }))
  },
  {
    key: 'purchaseDate',
    label: 'วันที่ซื้อ',
    type: 'date'
  },
  {
    key: 'warrantyUntil',
    label: 'ประกันถึง',
    type: 'date'
  },
  {
    key: 'condition',
    label: 'สภาพ (%)',
    type: 'number',
    min: 0,
    max: 100
  },
  {
    key: 'purchasePrice',
    label: 'ราคาซื้อ',
    type: 'number',
    step: '0.01',
    min: 0
  },
  {
    key: 'usefulLifeYears',
    label: 'อายุใช้งาน (ปี)',
    type: 'number',
    step: '0.1',
    min: 0.1
  },
  {
    key: 'salvageValue',
    label: 'มูลค่าซาก',
    type: 'number',
    step: '0.01',
    min: 0
  },
  {
    key: 'criticality',
    label: 'ความสำคัญ',
    type: 'select',
    options: ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((value) => ({
      value,
      label: value
    }))
  },
  {
    key: 'ownershipType',
    label: 'การถือครอง',
    type: 'select',
    options: [
      'OWNED',
      'LEASED',
      'RENTED',
      'BORROWED',
      'CUSTOMER_OWNED',
      'CONSIGNMENT'
    ].map((value) => ({
      value,
      label: value
    }))
  },
  {
    key: 'vendor',
    label: 'Vendor'
  },
  {
    key: 'purchaseDocumentType',
    label: 'ประเภทเอกสารการซื้อ',
    type: 'select',
    options: purchaseDocumentTypes
  },
  {
    key: 'purchaseDocumentNo',
    label: 'เลขที่เอกสาร / เลขที่บิล'
  },
  {
    key: 'purchaseDocumentDate',
    label: 'วันที่เอกสาร',
    type: 'date'
  },
  {
    key: 'taxInvoiceNo',
    label: 'เลขที่ใบกำกับภาษี'
  },
  {
    key: 'accountingNote',
    label: 'หมายเหตุบัญชี',
    type: 'textarea'
  }
];

function bangkokDateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${String(value.year || '').slice(-2)}${value.month}${value.day}`;
}

function bangkokToday(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(date);
}

function assetCompanyCode(value: unknown): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFKD')
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function nextAssetIdPreview(assets: Asset[], companyValue: unknown): string {
  const companyCode = assetCompanyCode(companyValue) || 'ASSET';
  const dateKey = bangkokDateKey();
  const prefix = `${companyCode}-${dateKey}-`;
  // The date is part of the visible ID, but the running number is continuous for the
  // company across days. Example: EVES-260818-001 -> EVES-260819-002.
  const current = assets
    .filter((asset) => assetCompanyCode((asset as any).company) === companyCode)
    .map((asset) => String(asset.id || '').match(/-(\d+)$/)?.[1] || '')
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
  const next = (current.length ? Math.max(...current) : 0) + 1;
  return `${prefix}${String(next).padStart(3, '0')}`;
}

function assetImages(asset: any): Array<{ id: number; url: string; mime?: string }> {
  if (Array.isArray(asset?.images) && asset.images.length) return asset.images;
  const legacy = asset?.imageUrl || (asset?.hasImage && asset?.id ? `/api/assets/${encodeURIComponent(asset.id)}/image` : '');
  return legacy ? [{ id: 0, url: String(legacy), mime: asset?.imageMime || '' }] : [];
}

function getImageUrl(asset: any): string {
  return assetImages(asset)[0]?.url || '';
}

function documentTypeText(value?: string, other?: string): string {
  if (String(value || '').toUpperCase() === 'OTHER' && String(other || '').trim()) return `เอกสารอื่น · ${String(other).trim()}`;
  return purchaseDocumentTypes.find((item) => item.value === value)?.label || value || '-';
}

function ownershipTypeText(value?: string, other?: string): string {
  if (String(value || '').toUpperCase() === 'OTHER' && String(other || '').trim()) return `อื่นๆ · ${String(other).trim()}`;
  return value || '-';
}

export default function AssetsPage({
  assets,
  employees,
  companies,
  masterData,
  onReload,
  userRole,
  userCompany
}: {
  assets: Asset[];
  employees: Employee[];
  companies: any[];
  masterData: MasterDataMap;
  onReload: () => Promise<void>;
  userRole: string;
  userCompany: string;
}) {
  const canManage = ['ADMIN', 'SUPERVISOR'].includes(userRole);
  const canDelete = userRole === 'ADMIN';
  const canEditFinancial = ['ADMIN', 'SUPERVISOR', 'ACCOUNTING'].includes(userRole);

  const defaultCreateCompany = userCompany || companies[0]?.code || companies[0]?.id || '';
  const [editing, setEditing] = useState<Asset | null>(null);
  const [creating, setCreating] = useState(false);
  const [generatedIdPreview, setGeneratedIdPreview] = useState(() => nextAssetIdPreview(assets, defaultCreateCompany));
  const assetIdPreviewRequestRef = useRef(0);
  const [qrAsset, setQrAsset] = useState<Asset | null>(null);

  const [action, setAction] = useState<{
    type: string;
    asset: Asset;
  } | null>(null);

  useEffect(() => {
    if (!creating) setGeneratedIdPreview(nextAssetIdPreview(assets, defaultCreateCompany));
  }, [assets, creating, defaultCreateCompany]);

  async function refreshAssetIdPreview(companyValue: string) {
    const companyCode = assetCompanyCode(companyValue) || assetCompanyCode(defaultCreateCompany);
    const requestId = ++assetIdPreviewRequestRef.current;
    setGeneratedIdPreview(nextAssetIdPreview(assets, companyCode));

    try {
      const result = await api<{ id: string }>(`/api/assets/next-id?company=${encodeURIComponent(companyCode)}`);
      if (requestId === assetIdPreviewRequestRef.current && result?.id) {
        setGeneratedIdPreview(result.id);
      }
    } catch {
      // Keep the local preview as a fallback if the preview endpoint is temporarily unavailable.
    }
  }

  async function openCreateAsset() {
    setCreating(true);
    await refreshAssetIdPreview(String(defaultCreateCompany || ''));
  }

  async function save(values: any) {
    const payload = {
      ...values,

      salvageValue: Number.isFinite(values.salvageValue)
        ? values.salvageValue
        : 0,

      items: (values.items || []).filter((item: any) =>
        String(item.name || '').trim()
      )
    };

    if (editing) {
      await put(
        `/api/assets/${encodeURIComponent(editing.id)}`,
        payload
      );
    } else {
      await post('/api/assets', payload);
    }

    setEditing(null);
    setCreating(false);
    await onReload();
  }

  async function remove(asset: Asset) {
    if (!confirm(`ลบ ${asset.id} ใช่หรือไม่?`)) {
      return;
    }

    try {
      const result = await del<{ ok: boolean; deletedId: string }>(
        `/api/assets/${encodeURIComponent(asset.id)}?cascade=1`
      );

      if (!result?.ok) {
        throw new Error('Backend ไม่ยืนยันผลการลบ');
      }

      await onReload();
      window.alert(`ลบ ${result.deletedId || asset.id} สำเร็จ`);
    } catch (caught) {
      const message = caught instanceof Error
        ? caught.message
        : 'ลบทรัพย์สินไม่สำเร็จ';
      window.alert(`ลบ ${asset.id} ไม่สำเร็จ: ${message}`);
    }
  }

  async function actionSave(values: any) {
    if (!action) return;

    if (action.type === 'repairs') {
      await post('/api/maintenance', {
        assetId: action.asset.id,
        issue: values.detail,
        priority: values.priority || 'NORMAL',
        openedDate: values.date,
        note: values.note
      });
    } else if (action.type === 'assignment') {
      const employee = employees.find((row) => row.id === values.assignedEmployeeId);
      const shared = values.assignedEmployeeId === '__SHARED__';
      const unassigned = values.assignedEmployeeId === '__UNASSIGNED__';
      await post(`/api/assets/${encodeURIComponent(action.asset.id)}/assignment`, {
        assignedEmployeeId: values.assignedEmployeeId,
        assignedTo: shared ? 'ทรัพย์สินส่วนกลาง' : employee?.name || '',
        custodianType: shared ? 'SHARED' : unassigned ? 'UNASSIGNED' : 'EMPLOYEE',
        department: unassigned ? '' : employee?.department || values.department || '',
        location: values.location || action.asset.location,
        note: values.note
      });
    } else {
      await post(`/api/assets/${encodeURIComponent(action.asset.id)}/${action.type}`, values);
    }

    setAction(null);
    await onReload();
  }

  const actionLocationOptions = action
    ? locationOptions(masterData, action.asset.company, action.asset.location)
    : [];
  const actionDepartmentOptions = action
    ? masterOptions(masterData, 'department', action.asset.company, { currentValue: action.asset.department })
    : [];
  const actionFields: Record<string, Field[]> = {
    location: [
      actionLocationOptions.length
        ? { key: 'location', label: 'ตำแหน่งใหม่', type: 'select', required: true, options: actionLocationOptions }
        : { key: 'location', label: 'ตำแหน่งใหม่', required: true },
      { key: 'note', label: 'หมายเหตุ', type: 'textarea', required: true }
    ],
    assignment: [
      {
        key: 'assignedEmployeeId',
        label: 'ผู้ถือครอง / ผู้รับผิดชอบใหม่',
        type: 'select',
        required: true,
        options: [
          { value: '__UNASSIGNED__', label: 'ไม่มีผู้ถือครอง — เก็บในคลัง / รอจัดสรร' },
          { value: '__SHARED__', label: 'ทรัพย์สินส่วนกลาง — ระบุหน่วยงานผู้ดูแล' },
          ...employees
            .filter((employee) => employee.status === 'ACTIVE' && employee.company === action?.asset.company)
            .map((employee) => ({ value: employee.id, label: `${employee.name} · ${employee.department || '-'} (${employee.id})` }))
        ]
      },
      actionDepartmentOptions.length
        ? { key: 'department', label: 'แผนกผู้ดูแล (ใช้สำหรับทรัพย์สินส่วนกลาง)', type: 'select', options: actionDepartmentOptions }
        : { key: 'department', label: 'แผนกผู้ดูแล (ใช้สำหรับทรัพย์สินส่วนกลาง)' },
      actionLocationOptions.length
        ? { key: 'location', label: 'ตำแหน่งจัดเก็บ / สถานที่ใช้งาน', type: 'select', required: true, options: actionLocationOptions }
        : { key: 'location', label: 'ตำแหน่งจัดเก็บ / สถานที่ใช้งาน', required: true },
      { key: 'note', label: 'เหตุผลการเปลี่ยนผู้ถือครอง', type: 'textarea', required: true }
    ],
    repairs: [
      { key: 'date', label: 'วันที่แจ้งซ่อม', type: 'date', required: true },
      { key: 'detail', label: 'อาการ / รายละเอียด', type: 'textarea', required: true },
      { key: 'priority', label: 'ระดับความเร่งด่วน', type: 'select', required: true, options: [
        { value: 'LOW', label: 'ต่ำ' },
        { value: 'NORMAL', label: 'ปกติ' },
        { value: 'HIGH', label: 'สูง' },
        { value: 'URGENT', label: 'เร่งด่วน' }
      ] },
      { key: 'note', label: 'หมายเหตุเพิ่มเติม', type: 'textarea' }
    ]
  };


  return (
    <>
      <PageHeader
        title="ทะเบียนทรัพย์สิน"
        description="ขึ้นทะเบียน แก้ไข ค้นหา และติดตามทรัพย์สินเป็นรายชิ้น"
        actionLabel="เพิ่มทรัพย์สิน"
        onAction={
          canManage
            ? openCreateAsset
            : undefined
        }
      >
        {userRole !== 'VIEW' && <ReportExportButton kind="assets" filename="asset-register" />}
      </PageHeader>

      <section className="card">
        <DataTable
          rows={assets}
          searchText={(asset) => [
            asset.id,
            asset.accountingAssetId,
            asset.name,
            asset.serial,
            asset.assignedTo,
            asset.responsibleDepartment,
            asset.department,
            asset.location,
            asset.company,
            asset.purchaseDocumentNo,
            asset.taxInvoiceNo,
            asset.vendor
          ].join(' ')}
          columns={[
            {
              key: 'imageUrl',
              label: 'รูปภาพ',
              filterable: true,
              filterValue: (row) => Boolean(getImageUrl(row)),
              render: (row) => {
                const imageUrl = getImageUrl(row);

                const fallback = (
                  <span
                    title={imageUrl ? 'กำลังโหลดรูปภาพ หรือไม่สามารถเปิดรูปภาพได้' : 'ยังไม่มีรูปภาพ'}
                    style={{
                      width: 58,
                      height: 44,
                      display: 'grid',
                      placeItems: 'center',
                      borderRadius: 7,
                      border: '1px dashed #cbd5e1',
                      background: '#f8fafc',
                      color: '#94a3b8'
                    }}
                  >
                    <ImageIcon size={18} />
                  </span>
                );

                const count = assetImages(row).length;
                return imageUrl ? (
                  <span className="asset-thumb-stack" title={count > 1 ? `มีรูปภาพ ${count} รูป` : 'มีรูปภาพ 1 รูป'}>
                    <AuthenticatedImage
                      source={imageUrl}
                      alt={row.name}
                      loading="lazy"
                      fallback={fallback}
                    />
                    {count > 1 && <span className="asset-thumb-count">+{count - 1}</span>}
                  </span>
                ) : fallback;
              }
            },
            {
              key: 'id',
              label: 'Asset ID'
            },
            {
              key: 'accountingAssetId',
              label: 'Asset ID บัญชี',
              render: (row) => row.accountingAssetId || '-'
            },
            {
              key: 'name',
              label: 'ทรัพย์สิน'
            },
            {
              key: 'company',
              label: 'บริษัท'
            },
            {
              key: 'purchaseDocumentNo',
              label: 'เลขที่เอกสาร',
              render: (row) =>
                row.purchaseDocumentNo ||
                row.taxInvoiceNo ||
                '-'
            },
            {
              key: 'assignedTo',
              label: 'ผู้ถือครอง / ผู้รับผิดชอบ',
              render: (row) => row.assignedTo || 'ไม่มีผู้ถือครอง'
            },
            {
              key: 'responsibleDepartment',
              label: 'หน่วยงานเจ้าของ',
              render: (row) => row.responsibleDepartment || 'IT'
            },
            {
              key: 'location',
              label: 'ตำแหน่ง'
            },
            {
              key: 'status',
              label: 'สถานะ',
              render: (row) => (
                <Badge value={row.status} />
              )
            },
            {
              key: 'items',
              label: 'รายการย่อย',
              render: (row) =>
                `${row.items?.length || 0} รายการ`
            },
            {
              key: 'condition',
              label: 'สภาพ',
              render: (row) =>
                `${row.condition}%`
            }
          ]}
          onEdit={
            canManage
              ? setEditing
              : undefined
          }
          onDelete={canDelete ? remove : undefined}
          actions={(row) => (
            <>
              <AssetPhotoButton asset={row} />

              <button
                className="icon-btn"
                title="QR Code / ดาวน์โหลด Label"
                aria-label={`QR Code ${row.id}`}
                onClick={() => setQrAsset(row)}
              >
                <QrCode size={16} />
              </button>
            </>
          )}
        />
      </section>

      <Modal
        open={creating || Boolean(editing)}
        title={
          editing
            ? 'แก้ไขทรัพย์สิน'
            : 'เพิ่มทรัพย์สิน'
        }
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        wide
        fullScreen
      >
        <AssetForm
          initial={
            editing || {
              company: userCompany || companies[0]?.code || companies[0]?.id || '',
              assignedEmployeeId: '',
              assignedTo: '',
              responsibleDepartment: 'IT',
              department: '',
              status: 'IN_STOCK',
              condition: 100,
              usefulLifeYears: 5,
              salvageValue: 0,
              criticality: 'MEDIUM',
              ownershipType: 'OWNED',
              items: []
            }
          }
          onSubmit={save}
          isEditing={Boolean(editing)}
          canSelectCompany={userRole === 'ADMIN'}
          canEditFinancial={canEditFinancial}
          companyOptions={companies.map((company) => ({ value: company.code || company.id, label: `${company.code || company.id} · ${company.name || company.code || company.id}` }))}
          employees={employees}
          masterData={masterData}
          generatedIdPreview={generatedIdPreview}
          onCompanyPreviewChange={refreshAssetIdPreview}
          onCancel={() => {
            setCreating(false);
            setEditing(null);
          }}
        />
      </Modal>

      <Modal
        open={Boolean(action)}
        title={
          action?.type === 'location'
            ? 'เปลี่ยนตำแหน่ง'
            : action?.type === 'assignment'
              ? 'เปลี่ยนผู้รับผิดชอบ'
              : 'เปิด Ticket ซ่อม'
        }
        onClose={() => setAction(null)}
      >
        <EntityForm
          fields={
            action
              ? actionFields[action.type]
              : []
          }
          initial={
            action?.type === 'location'
              ? {
                  location: action.asset.location
                }
              : action?.type === 'assignment'
                ? {
                    assignedEmployeeId:
                      action.asset.custodianType === 'SHARED' || action.asset.assignedTo === 'ทรัพย์สินส่วนกลาง'
                        ? '__SHARED__'
                        : employees.find((employee) => employee.company === action.asset.company && employee.name === action.asset.assignedTo)?.id || '__UNASSIGNED__',
                    department: action.asset.department || '',
                    location: action.asset.location || '',
                    note: ''
                  }
                : {
                    date: bangkokToday(),
                    priority: 'NORMAL'
                  }
          }
          onSubmit={actionSave}
          onCancel={() => setAction(null)}
        />
      </Modal>

      <AssetQrModal
        asset={qrAsset}
        onClose={() => setQrAsset(null)}
        onReload={onReload}
      />
    </>
  );
}


function AssetQrModal({
  asset,
  onClose,
  onReload
}: {
  asset: Asset | null;
  onClose: () => void;
  onReload: () => Promise<void>;
}) {
  const [url, setUrl] = useState('');

  useEffect(() => {
    if (!asset) {
      setUrl('');
      return;
    }

    const base = String((window as any).__ASSET_PUBLIC_BASE_URL__ || location.origin).replace(/\/$/, '');
    QRCode.toDataURL(`${base}/?asset=${encodeURIComponent(asset.id)}`, {
      width: 520,
      margin: 1,
      color: { dark: '#101827', light: '#ffffff' }
    })
      .then(setUrl)
      .catch(() => setUrl(''));
  }, [asset]);

  async function markPrinted() {
    if (!asset) return;
    await post(`/api/assets/${encodeURIComponent(asset.id)}/qr-printed`, {});
    await onReload();
  }

  function drawFitText(
    ctx: CanvasRenderingContext2D,
    text: string,
    x: number,
    y: number,
    maxWidth: number,
    size: number,
    weight = '700'
  ) {
    let fontSize = size;
    do {
      ctx.font = `${weight} ${fontSize}px "Noto Sans Thai", Arial, sans-serif`;
    } while (ctx.measureText(text).width > maxWidth && --fontSize >= 8);
    ctx.fillText(text, x, y);
  }

  async function downloadLabel() {
    if (!asset || !url) return;

    await markPrinted();
    if (document.fonts) await document.fonts.ready;

    const canvas = document.createElement('canvas');
    canvas.width = 472;
    canvas.height = 236;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const qr = new Image();
    qr.onload = () => {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 472, 236);
      ctx.strokeStyle = '#cbd5e1';
      ctx.lineWidth = 4;
      ctx.strokeRect(2, 2, 468, 232);
      ctx.drawImage(qr, 24, 46, 144, 144);

      ctx.fillStyle = '#2855d9';
      drawFitText(ctx, 'COMPANY ASSET', 194, 58, 250, 24, '900');
      ctx.fillStyle = '#101827';
      drawFitText(ctx, asset.id, 194, 104, 250, 34, '900');
      drawFitText(ctx, asset.name, 194, 142, 250, 24, '900');
      ctx.fillStyle = '#475569';
      drawFitText(ctx, `Affiliation: ${asset.company}`, 194, 168, 250, 17, '700');
      drawFitText(
        ctx,
        `Brand/Model: ${[asset.brand, asset.model].filter(Boolean).join(' ') || '-'}`,
        194,
        190,
        250,
        17,
        '700'
      );
      drawFitText(ctx, `Serial: ${asset.serial || '-'}`, 194, 212, 250, 17, '700');

      const anchor = document.createElement('a');
      anchor.href = canvas.toDataURL('image/png');
      anchor.download = `asset-label-${asset.id.replace(/[^a-z0-9-]+/gi, '_')}-4x2cm.png`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    };
    qr.src = url;
  }

  return (
    <Modal
      open={Boolean(asset)}
      title={`QR Code / Label ${asset?.id || ''}`}
      onClose={onClose}
      popup
      contentClassName="qr-popup-card"
    >
      {asset && (
        <div className="qr-panel">
          <section className="asset-label-preview">
            {url ? (
              <img className="asset-label-preview-qr" src={url} alt={`QR Code ${asset.id}`} />
            ) : (
              <div className="asset-label-preview-qr" aria-label="กำลังสร้าง QR Code" />
            )}
            <div className="asset-label-preview-copy">
              <h3>COMPANY ASSET</h3>
              <strong>{asset.id}</strong>
              <h4>{asset.name}</h4>
              <p>Affiliation: {asset.company}</p>
              <p>Brand/Model: {[asset.brand, asset.model].filter(Boolean).join(' ') || '-'}</p>
              <p>Serial: {asset.serial || '-'}</p>
            </div>
          </section>
          <button className="primary" onClick={downloadLabel} disabled={!url}>
            <Download size={17} />
            Download PNG
          </button>
        </div>
      )}
    </Modal>
  );
}


function AssetForm({
  initial,
  onSubmit,
  onCancel,
  isEditing,
  canSelectCompany,
  canEditFinancial,
  companyOptions,
  employees,
  masterData,
  generatedIdPreview,
  onCompanyPreviewChange
}: {
  initial: any;
  onSubmit: (values: any) => Promise<void> | void;
  onCancel: () => void;
  isEditing: boolean;
  canSelectCompany: boolean;
  canEditFinancial: boolean;
  companyOptions: { value: string; label: string }[];
  employees: Employee[];
  masterData: MasterDataMap;
  generatedIdPreview: string;
  onCompanyPreviewChange?: (companyCode: string) => Promise<void> | void;
}) {
  const initialEmployee = employees.find((employee) =>
    employee.company === initial.company &&
    employee.name === initial.assignedTo
  );

  const initialCustodianType = String(
    initial.custodianType || (initial.assignedTo === 'ทรัพย์สินส่วนกลาง' ? 'SHARED' : initial.assignedTo ? 'EMPLOYEE' : 'UNASSIGNED')
  ).toUpperCase();

  const [form, setForm] = useState<any>({
    ...initial,
    responsibleDepartment: initial.responsibleDepartment || 'IT',
    custodianType: initialCustodianType,
    assignedEmployeeId:
      initial.assignedEmployeeId ??
      (initialCustodianType === 'SHARED'
        ? '__SHARED__'
        : initialEmployee?.id ?? (initial.assignedTo ? '__CURRENT__' : '__UNASSIGNED__')),

    // รูปใหม่หลายรูปส่งผ่าน imagesData (สูงสุด 5 รูป)
    imagesData: [],

    // รูปเดิมที่ผู้ใช้เลือกนำออก
    removeImageIds: [],

    // คง flag เดิมไว้เพื่อ backward compatibility เท่านั้น
    removeImage: false,

    // Backend จะรับเอกสารการซื้อหลายไฟล์จาก purchaseDocumentsData
    purchaseDocumentsData: [],

    // เก็บรหัสเอกสารเดิมที่ผู้ใช้เลือกนำออก
    removePurchaseDocumentIds: [],

    items: initial.items?.length
      ? initial.items
      : []
  });

  const [existingImages, setExistingImages] = useState(() => assetImages(initial));
  const [newImages, setNewImages] = useState<Array<{ key: string; name: string; data: string }>>([]);
  const [removedImageIds, setRemovedImageIds] = useState<number[]>([]);
  const [imageError, setImageError] = useState('');
  const imageCount = existingImages.length + newImages.length;

  const [purchaseDocumentError, setPurchaseDocumentError] =
    useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const selectableEmployees = useMemo(() => {
    const company = String(form.company || '');
    const currentName = String(form.assignedTo || '');

    return employees
      .filter((employee) =>
        employee.company === company &&
        (employee.status === 'ACTIVE' || employee.name === currentName)
      )
      .sort((left, right) =>
        left.name.localeCompare(right.name, 'th')
      );
  }, [employees, form.company, form.assignedTo]);

  useEffect(() => {
    if (['__UNASSIGNED__', '__SHARED__', '__CURRENT__', ''].includes(String(form.assignedEmployeeId || ''))) {
      return;
    }

    const stillAvailable = selectableEmployees.some(
      (employee) => employee.id === form.assignedEmployeeId
    );

    if (!stillAvailable) {
      setForm((current: any) => ({
        ...current,
        assignedEmployeeId: '__UNASSIGNED__',
        custodianType: 'UNASSIGNED',
        assignedTo: '',
        department: '',
        status: current.status === 'ACTIVE' ? 'IN_STOCK' : current.status
      }));
    }
  }, [form.assignedEmployeeId, selectableEmployees]);

  function setField(
    key: string,
    value: any
  ) {
    if (key === 'company') {
      setForm((current: any) => ({
        ...current,
        company: value,
        assignedEmployeeId: '__UNASSIGNED__',
        custodianType: 'UNASSIGNED',
        assignedTo: '',
        department: '',
        status: current.status === 'ACTIVE' ? 'IN_STOCK' : current.status
      }));
      if (!isEditing) void onCompanyPreviewChange?.(String(value || ''));
      return;
    }

    setForm((current: any) => {
      const next = { ...current, [key]: value };
      if (key === 'ownershipType' && value !== 'OTHER') next.ownershipTypeOther = '';
      if (key === 'purchaseDocumentType' && value !== 'OTHER') next.purchaseDocumentTypeOther = '';
      if (key === 'vendor' && value !== '__OTHER__') next.vendorOther = '';
      return next;
    });
  }

  function setAssignee(employeeId: string) {
    if (!employeeId || employeeId === '__UNASSIGNED__') {
      setForm((current: any) => ({
        ...current,
        assignedEmployeeId: '__UNASSIGNED__',
        custodianType: 'UNASSIGNED',
        assignedTo: '',
        department: '',
        status: current.status === 'ACTIVE' ? 'IN_STOCK' : current.status
      }));
      return;
    }

    if (employeeId === '__SHARED__') {
      setForm((current: any) => ({
        ...current,
        assignedEmployeeId: '__SHARED__',
        custodianType: 'SHARED',
        assignedTo: 'ทรัพย์สินส่วนกลาง',
        status: ['IN_STOCK', 'INACTIVE'].includes(current.status) ? 'ACTIVE' : current.status
      }));
      return;
    }

    if (employeeId === '__CURRENT__') {
      setForm((current: any) => ({ ...current, assignedEmployeeId: '__CURRENT__' }));
      return;
    }

    const employee = selectableEmployees.find((item) => item.id === employeeId);
    if (!employee) return;

    setForm((current: any) => ({
      ...current,
      assignedEmployeeId: employee.id,
      custodianType: 'EMPLOYEE',
      assignedTo: employee.name,
      department: employee.department || '',
      location: current.location || employee.location || '',
      status: ['IN_STOCK', 'INACTIVE'].includes(current.status) ? 'ACTIVE' : current.status
    }));
  }

  function updateItem(
    index: number,
    key: string,
    value: any
  ) {
    setForm((current: any) => ({
      ...current,
      items: current.items.map(
        (item: any, itemIndex: number) =>
          itemIndex === index
            ? {
                ...item,
                [key]: value
              }
            : item
      )
    }));
  }

  function addItem() {
    setForm((current: any) => ({
      ...current,
      items: [
        ...(current.items || []),
        {
          ...itemTemplate
        }
      ]
    }));
  }

  function removeItem(index: number) {
    setForm((current: any) => ({
      ...current,
      items: current.items.filter(
        (_item: any, itemIndex: number) =>
          itemIndex !== index
      )
    }));
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
    const invalidType = files.find((file) => !ALLOWED_IMAGE_TYPES.includes(file.type));
    if (invalidType) {
      setImageError(`ไฟล์ ${invalidType.name} ไม่รองรับ รองรับเฉพาะ JPG, PNG และ WEBP`);
      return;
    }
    const oversized = files.find((file) => file.size > MAX_IMAGE_SIZE);
    if (oversized) {
      setImageError(`ไฟล์ ${oversized.name} มีขนาดเกิน 5 MB`);
      return;
    }

    try {
      const rows = await Promise.all(files.map((file, index) => new Promise<{ key: string; name: string; data: string }>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ key: `${Date.now()}-${index}-${file.name}`, name: file.name, data: String(reader.result || '') });
        reader.onerror = () => reject(new Error(file.name));
        reader.readAsDataURL(file);
      })));
      setNewImages((current) => [...current, ...rows]);
    } catch {
      setImageError('ไม่สามารถอ่านไฟล์รูปภาพบางรายการได้');
    }
  }

  function removeExistingImage(image: { id: number; url: string }) {
    setExistingImages((current) => current.filter((item) => item.id !== image.id || item.url !== image.url));
    if (image.id > 0) {
      setRemovedImageIds((current) => current.includes(image.id) ? current : [...current, image.id]);
    } else {
      // รูป legacy ไม่มี id: ใช้ flag เดิมให้ Backend ลบ BLOB เก่า
      setForm((current: any) => ({ ...current, removeImage: true }));
    }
    setImageError('');
  }

  function removeNewImage(key: string) {
    setNewImages((current) => current.filter((item) => item.key !== key));
    setImageError('');
  }

  async function choosePurchaseDocuments(
    event: ChangeEvent<HTMLInputElement>
  ) {
    const input = event.currentTarget;
    const files = Array.from(input.files || []);

    if (!files.length) {
      return;
    }

    setPurchaseDocumentError('');

    const invalidType = files.find(
      (file) => !ALLOWED_PURCHASE_DOCUMENT_TYPES.includes(file.type)
    );
    if (invalidType) {
      setPurchaseDocumentError(
        `ไฟล์ ${invalidType.name} ไม่รองรับ รองรับเฉพาะ PDF, JPG และ PNG เท่านั้น`
      );
      input.value = '';
      return;
    }

    const oversized = files.find(
      (file) => file.size > MAX_PURCHASE_DOCUMENT_SIZE
    );
    if (oversized) {
      setPurchaseDocumentError(
        `ไฟล์ ${oversized.name} มีขนาดเกิน 5 MB`
      );
      input.value = '';
      return;
    }

    const removedIds = new Set(
      (form.removePurchaseDocumentIds || []).map((value: any) => Number(value))
    );
    const existingCount = (initial.purchaseDocuments || []).filter(
      (document: any) => !removedIds.has(Number(document.id))
    ).length;
    const pendingCount = (form.purchaseDocumentsData || []).length;

    if (existingCount + pendingCount + files.length > MAX_PURCHASE_DOCUMENT_COUNT) {
      setPurchaseDocumentError(
        `แนบเอกสารได้สูงสุด ${MAX_PURCHASE_DOCUMENT_COUNT} ไฟล์ต่อทรัพย์สิน`
      );
      input.value = '';
      return;
    }

    try {
      const documents = await Promise.all(
        files.map(
          (file) =>
            new Promise<{ name: string; data: string }>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () =>
                resolve({
                  name: file.name,
                  data: String(reader.result || '')
                });
              reader.onerror = () => reject(new Error(file.name));
              reader.readAsDataURL(file);
            })
        )
      );

      setForm((current: any) => ({
        ...current,
        purchaseDocumentsData: [
          ...(current.purchaseDocumentsData || []),
          ...documents
        ]
      }));
    } catch {
      setPurchaseDocumentError(
        'ไม่สามารถอ่านไฟล์เอกสารบางรายการได้'
      );
    } finally {
      input.value = '';
    }
  }

  function removeExistingPurchaseDocument(documentId: number) {
    setPurchaseDocumentError('');
    setForm((current: any) => ({
      ...current,
      removePurchaseDocumentIds: Array.from(
        new Set([
          ...(current.removePurchaseDocumentIds || []).map((value: any) => Number(value)),
          Number(documentId)
        ])
      )
    }));
  }

  function restoreExistingPurchaseDocument(documentId: number) {
    setForm((current: any) => ({
      ...current,
      removePurchaseDocumentIds: (current.removePurchaseDocumentIds || []).filter(
        (value: any) => Number(value) !== Number(documentId)
      )
    }));
  }

  function removePendingPurchaseDocument(index: number) {
    setPurchaseDocumentError('');
    setForm((current: any) => ({
      ...current,
      purchaseDocumentsData: (current.purchaseDocumentsData || []).filter(
        (_document: any, documentIndex: number) => documentIndex !== index
      )
    }));
  }

  const financialFieldKeys = new Set([
    'accountingAssetId', 'purchaseDate', 'warrantyUntil', 'purchasePrice', 'usefulLifeYears', 'salvageValue',
    'vendor', 'purchaseDocumentType', 'purchaseDocumentNo',
    'purchaseDocumentDate', 'taxInvoiceNo', 'accountingNote'
  ]);

  const companyCode = String(form.company || '');
  const statusOptionsFromMaster = masterOptions(
    masterData,
    'asset-status',
    companyCode,
    { currentValue: form.status }
  ).filter((option) => statuses.includes(option.value) || option.value === form.status);

  const statusMasterByValue = new Map(
    statusOptionsFromMaster.map((option) => [option.value, option])
  );

  // รวมสถานะที่เลือกเองได้ทั้ง 5 ค่าเสมอ
  // ถ้ามีใน Master Data จะใช้ชื่อจาก Master Data
  // ถ้ายังไม่มี จะใช้ชื่อมาตรฐานเพื่อไม่ให้ Dropdown เหลือเพียงบางรายการ
  const selectableStatusOptions = statuses.map((value) =>
    statusMasterByValue.get(value) || {
      value,
      label: `${value} · ${defaultAssetStatusLabels[value] || value}`
    }
  );

  // รักษาสถานะจาก Workflow เดิมไว้ตอนเปิดแก้ไข เช่น IN_REPAIR
  // แต่ไม่เพิ่มสถานะ Workflow อื่นให้เลือกเอง
  if (
    form.status &&
    !statuses.includes(form.status) &&
    statusMasterByValue.has(form.status)
  ) {
    selectableStatusOptions.unshift(statusMasterByValue.get(form.status)!);
  }

  const dynamicOptions: Record<string, { value: string; label: string; keywords?: string }[]> = {
    category: masterOptions(masterData, 'asset-category', companyCode, { currentValue: form.category }),
    subcategory: masterOptions(masterData, 'asset-subcategory', companyCode, {
      parentCode: form.category,
      currentValue: form.subcategory
    }),
    brand: masterOptions(masterData, 'brand', companyCode, { valueMode: 'name', currentValue: form.brand }),
    department: masterOptions(masterData, 'department', companyCode, { currentValue: form.department }),
    responsibleDepartment: [
      { value: 'IT', label: 'IT · อุปกรณ์และระบบสารสนเทศ' },
      { value: 'GA', label: 'GA · อาคาร สถานที่ และอุปกรณ์สำนักงาน' },
      { value: 'HR', label: 'HR · ทรัพย์สินที่ฝ่ายบุคคลดูแล' }
    ],
    location: locationOptions(masterData, companyCode, form.location),
    status: selectableStatusOptions,
    criticality: withFallback(
      masterOptions(masterData, 'criticality', companyCode, { currentValue: form.criticality }),
      ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((value) => ({ value, label: value }))
    ),
    ownershipType: (() => {
      const options = withFallback(
        masterOptions(masterData, 'ownership-type', companyCode, { currentValue: form.ownershipType }),
        ['OWNED', 'LEASED', 'RENTED', 'BORROWED', 'CUSTOMER_OWNED', 'CONSIGNMENT'].map((value) => ({ value, label: value }))
      );
      return options.some((option) => option.value === 'OTHER')
        ? options
        : [...options, { value: 'OTHER', label: 'OTHER · อื่นๆ' }];
    })(),
    vendor: (() => {
      const options = masterOptions(masterData, 'vendor', companyCode, { valueMode: 'name', currentValue: form.vendor === '__OTHER__' ? '' : form.vendor });
      return options.length ? [...options, { value: '__OTHER__', label: 'อื่นๆ / ไม่พบในรายชื่อ' }] : [];
    })()
  };

  async function submit(event: any) {
    event.preventDefault();

    setBusy(true);
    setError('');

    try {
      const payload = {
        ...form,
        imagesData: newImages.map((image) => image.data),
        removeImageIds: removedImageIds
      };
      if (String(payload.ownershipType || '').toUpperCase() === 'OTHER' && !String(payload.ownershipTypeOther || '').trim()) {
        throw new Error('กรุณาระบุประเภทการถือครองอื่นๆ');
      }
      if (String(payload.purchaseDocumentType || '').toUpperCase() === 'OTHER' && !String(payload.purchaseDocumentTypeOther || '').trim()) {
        throw new Error('กรุณาระบุประเภทเอกสารการซื้ออื่นๆ');
      }
      if (payload.vendor === '__OTHER__') {
        if (!String(payload.vendorOther || '').trim()) throw new Error('กรุณาระบุ Vendor / ผู้ขาย');
        payload.vendor = String(payload.vendorOther).trim();
      }
      delete payload.vendorOther;

      // __CURRENT__ ใช้เฉพาะกรณีข้อมูลเก่าไม่ตรง Employee Master
      // ไม่ส่งค่า sentinel ไป Backend เพื่อรักษาข้อมูลเดิมไว้จนกว่าจะเลือกใหม่
      if (payload.assignedEmployeeId === '__CURRENT__') {
        delete payload.assignedEmployeeId;
      }

      await onSubmit(payload);
    } catch (submitError: any) {
      setError(
        submitError.message ||
          'เกิดข้อผิดพลาด'
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="entity-form asset-entry-form"
      onSubmit={submit}
    >
      {error && (
        <div className="alert error">
          {error}
        </div>
      )}

      {!isEditing && (
        <div className="asset-id-running-card" aria-label={`Asset ID ${generatedIdPreview}`}>
          <span className="asset-id-running-icon"><QrCode size={18} /></span>
          <div className="asset-id-running-copy">
            <span>Asset ID · Running Number</span>
            <strong>{generatedIdPreview || 'กำลังโหลด...'}</strong>
          </div>
          <span className="asset-id-running-badge">สร้างอัตโนมัติ</span>
        </div>
      )}

      <section className="asset-image-editor-multiple">
        <div className="asset-image-editor-head">
          <div>
            <strong>รูปภาพทรัพย์สิน ({imageCount}/5)</strong>
            <span>เพิ่มได้สูงสุด 5 รูป รองรับ JPG, PNG และ WEBP รูปละไม่เกิน 5 MB</span>
          </div>
          <label className={`secondary asset-image-picker ${imageCount >= 5 ? 'is-disabled' : ''}`}>
            <ImagePlus size={16} />เพิ่มรูปภาพ
            <input
              type="file"
              multiple
              disabled={imageCount >= 5}
              accept="image/jpeg,image/png,image/webp"
              onChange={chooseImages}
            />
          </label>
        </div>

        {imageCount > 0 ? (
          <div className="asset-image-grid">
            {existingImages.map((image, index) => (
              <article className="asset-image-tile" key={`existing-${image.id}-${index}`}>
                <AuthenticatedImage source={image.url} alt={`${form.name || 'ทรัพย์สิน'} รูปที่ ${index + 1}`} />
                <span className="asset-image-order">{index + 1}</span>
                <button type="button" className="asset-image-remove" onClick={() => removeExistingImage(image)} title="ลบรูปนี้"><X size={15} /></button>
              </article>
            ))}
            {newImages.map((image, index) => (
              <article className="asset-image-tile" key={image.key}>
                <AuthenticatedImage source={image.data} alt={`${form.name || 'ทรัพย์สิน'} รูปใหม่ ${index + 1}`} />
                <span className="asset-image-order">{existingImages.length + index + 1}</span>
                <button type="button" className="asset-image-remove" onClick={() => removeNewImage(image.key)} title="ลบรูปนี้"><X size={15} /></button>
              </article>
            ))}
          </div>
        ) : (
          <div className="asset-image-empty-note">
            <ImageIcon size={38} />
            <strong>ยังไม่มีรูปภาพ</strong>
            <span>เลือกรูปจริงของทรัพย์สินเพื่อใช้ตรวจสอบและค้นหาได้ง่ายขึ้น</span>
          </div>
        )}

        {imageError && <div className="facility-image-error">{imageError}</div>}
      </section>

      <div className="form-grid">
        {fields.filter((field) => {
          if (isEditing && field.key === 'company') return false;
          if (!canSelectCompany && field.key === 'company') return false;
          if (!canEditFinancial && financialFieldKeys.has(field.key)) return false;
          return true;
        }).map((field) => {
          const baseField = field.key === 'company' ? { ...field, options: companyOptions } : field;
          const masterFieldOptions = dynamicOptions[field.key] || [];
          const activeField = masterFieldOptions.length
            ? { ...baseField, type: 'select' as const, options: masterFieldOptions }
            : baseField;
          const fieldRequired = Boolean(activeField.required || (activeField.key === 'department' && form.custodianType === 'SHARED'));
          return (
          <Fragment key={activeField.key}>
          <label
            className={
              activeField.type === 'textarea'
                ? 'span-2'
                : ''
            }
          >
            <span>
              {activeField.label}
              {fieldRequired && ' *'}
            </span>

            {activeField.key === 'assignedEmployeeId' ? (
              <CompactSelect
                value={String(form.assignedEmployeeId ?? '')}
                placeholder="ไม่มีผู้ถือครอง"
                searchPlaceholder="ค้นหาชื่อ รหัส แผนก หรือตำแหน่ง"
                searchable
                options={[
                  { value: '__UNASSIGNED__', label: 'ไม่มีผู้ถือครอง — เก็บในคลัง / รอจัดสรร' },
                  { value: '__SHARED__', label: 'ทรัพย์สินส่วนกลาง — ระบุหน่วยงานผู้ดูแล' },
                  ...(form.assignedEmployeeId === '__CURRENT__' && form.assignedTo
                    ? [{
                        value: '__CURRENT__',
                        label: `ข้อมูลเดิม: ${form.assignedTo}`
                      }]
                    : []),
                  ...selectableEmployees.map((employee) => ({
                    value: employee.id,
                    label: `${employee.name} · ${employee.department || '-'} (${employee.id})`,
                    keywords: [employee.position, employee.location].filter(Boolean).join(' ')
                  }))
                ]}
                onChange={setAssignee}
              />
            ) : activeField.type === 'select' ? (
              <CompactSelect
                value={String(form[activeField.key] ?? '')}
                required={fieldRequired}
                options={activeField.options || []}
                placeholder="-- เลือก --"
                searchPlaceholder={`ค้นหา ${activeField.label}`}
                onChange={(value) =>
                  setField(activeField.key, value)
                }
              />
            ) : activeField.type === 'date' ? (
              <DayMonthYearInput
                value={form[activeField.key] ?? ''}
                required={fieldRequired}
                onChange={(value) =>
                  setField(activeField.key, value)
                }
              />
            ) : activeField.type === 'textarea' ? (
              <textarea
                value={form[activeField.key] ?? ''}
                required={fieldRequired}
                placeholder={activeField.placeholder}
                onChange={(event) =>
                  setField(
                    activeField.key,
                    event.target.value
                  )
                }
              />
            ) : (
              <input
                type={activeField.type || 'text'}
                step={activeField.step}
                value={form[activeField.key] ?? ''}
                required={fieldRequired}
                readOnly={activeField.key === 'department' && !['', '__UNASSIGNED__', '__SHARED__', '__CURRENT__'].includes(String(form.assignedEmployeeId || ''))}
                placeholder={activeField.placeholder}
                onChange={(event) =>
                  setField(
                    activeField.key,
                    activeField.type === 'number'
                      ? event.target.valueAsNumber
                      : event.target.value
                  )
                }
              />
            )}
          </label>
          {activeField.key === 'ownershipType' && String(form.ownershipType || '').toUpperCase() === 'OTHER' && (
            <label>
              <span>ระบุประเภทการถือครองอื่นๆ *</span>
              <input required value={form.ownershipTypeOther || ''} placeholder="ระบุประเภทการถือครอง" onChange={(event) => setField('ownershipTypeOther', event.target.value)} />
            </label>
          )}
          {activeField.key === 'purchaseDocumentType' && String(form.purchaseDocumentType || '').toUpperCase() === 'OTHER' && (
            <label>
              <span>ระบุประเภทเอกสารอื่นๆ *</span>
              <input required value={form.purchaseDocumentTypeOther || ''} placeholder="ระบุชื่อประเภทเอกสาร" onChange={(event) => setField('purchaseDocumentTypeOther', event.target.value)} />
            </label>
          )}
          {activeField.key === 'vendor' && form.vendor === '__OTHER__' && (
            <label>
              <span>ระบุ Vendor / ผู้ขาย *</span>
              <input required value={form.vendorOther || ''} placeholder="ชื่อบริษัทหรือผู้ขาย" onChange={(event) => setField('vendorOther', event.target.value)} />
            </label>
          )}
          </Fragment>
          );
        })}
      </div>

      {canEditFinancial && (
      <section
        style={{
          marginTop: 20,
          marginBottom: 20,
          padding: 16,
          border: '1px solid #d8e0ec',
          borderRadius: 10,
          background: '#f8fafc'
        }}
      >
        <header
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap'
          }}
        >
          <div>
            <h4
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                margin: 0,
                color: '#172b48'
              }}
            >
              <FileText size={18} />
              เอกสารการซื้อ / เอกสารบัญชี
            </h4>

            <p
              style={{
                margin: '5px 0 0',
                color: '#64748b',
                fontSize: 12
              }}
            >
              อัปโหลดได้หลายไฟล์ รองรับ PDF, JPG และ PNG ไฟล์ละไม่เกิน 5 MB
            </p>
          </div>
        </header>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            marginTop: 14
          }}
        >
          <label
            className="secondary"
            style={{
              position: 'relative',
              overflow: 'hidden',
              cursor: 'pointer'
            }}
          >
            <FileText size={16} />
            เพิ่มเอกสาร

            <input
              type="file"
              multiple
              accept="application/pdf,image/jpeg,image/png"
              onChange={choosePurchaseDocuments}
              style={{
                position: 'absolute',
                inset: 0,
                width: '100%',
                height: '100%',
                opacity: 0,
                cursor: 'pointer'
              }}
            />
          </label>

          <span style={{ color: '#64748b', fontSize: 12 }}>
            สูงสุด {MAX_PURCHASE_DOCUMENT_COUNT} ไฟล์ต่อทรัพย์สิน
          </span>
        </div>

        {(
          (initial.purchaseDocuments || []).length > 0 ||
          (form.purchaseDocumentsData || []).length > 0
        ) && (
          <div
            style={{
              display: 'grid',
              gap: 8,
              marginTop: 12
            }}
          >
            {(initial.purchaseDocuments || []).map((document: any) => {
              const removed = (form.removePurchaseDocumentIds || []).some(
                (value: any) => Number(value) === Number(document.id)
              );

              return (
                <div
                  key={`existing-${document.id}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '9px 11px',
                    border: '1px solid #d8e0ec',
                    borderRadius: 8,
                    background: removed ? '#fff7f7' : '#ffffff',
                    opacity: removed ? 0.65 : 1
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      minWidth: 0
                    }}
                  >
                    <FileText size={16} />
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: removed ? '#991b1b' : '#334155'
                      }}
                    >
                      {document.name || 'เอกสารแนบ'}
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                    {!removed && document.url && (
                      <ProtectedFileButton
                        className="secondary"
                        source={document.url}
                      >
                        เปิด
                      </ProtectedFileButton>
                    )}

                    <button
                      type="button"
                      className="secondary"
                      onClick={() =>
                        removed
                          ? restoreExistingPurchaseDocument(Number(document.id))
                          : removeExistingPurchaseDocument(Number(document.id))
                      }
                      style={{
                        color: removed ? '#2563eb' : '#b91c1c',
                        borderColor: removed ? '#bfdbfe' : '#fecaca'
                      }}
                    >
                      {removed ? 'ยกเลิกการลบ' : 'ลบ'}
                    </button>
                  </div>
                </div>
              );
            })}

            {(form.purchaseDocumentsData || []).map(
              (document: any, index: number) => (
                <div
                  key={`pending-${index}-${document.name}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    padding: '9px 11px',
                    border: '1px solid #bfdbfe',
                    borderRadius: 8,
                    background: '#eff6ff'
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      minWidth: 0
                    }}
                  >
                    <FileText size={16} />
                    <span
                      style={{
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        color: '#1d4ed8'
                      }}
                    >
                      {document.name}
                    </span>
                    <small style={{ color: '#64748b' }}>ไฟล์ใหม่</small>
                  </div>

                  <button
                    type="button"
                    className="secondary"
                    onClick={() => removePendingPurchaseDocument(index)}
                    style={{
                      color: '#b91c1c',
                      borderColor: '#fecaca',
                      flexShrink: 0
                    }}
                  >
                    <X size={16} />
                    ลบ
                  </button>
                </div>
              )
            )}
          </div>
        )}

        {purchaseDocumentError && (
          <div
            style={{
              marginTop: 12,
              padding: '8px 10px',
              border: '1px solid #fecdd3',
              borderRadius: 7,
              background: '#fff1f2',
              color: '#b91c1c',
              fontSize: 12
            }}
          >
            {purchaseDocumentError}
          </div>
        )}
      </section>
      )}

      <section className="asset-items-editor">
        <header>
          <div>
            <h4>
              รายการย่อย / Box set
            </h4>

            <p>
              เช่น กระเป๋า, Adapter, Mouse,
              สายชาร์จ หรืออุปกรณ์ที่ต้องคืน
              พร้อมทรัพย์สินหลัก
            </p>
          </div>

          <button
            type="button"
            className="secondary"
            onClick={addItem}
          >
            <Plus size={16} />
            เพิ่มรายการย่อย
          </button>
        </header>

        {(form.items || []).length === 0 ? (
          <div className="asset-items-empty">
            ยังไม่มีรายการย่อย
          </div>
        ) : (
          <div className="asset-items-list">
            {form.items.map(
              (item: any, index: number) => (
                <div
                  className="asset-item-row"
                  key={index}
                >
                  <label>
                    <span>ชื่อรายการ *</span>

                    <input
                      value={item.name || ''}
                      required
                      onChange={(event) =>
                        updateItem(
                          index,
                          'name',
                          event.target.value
                        )
                      }
                      placeholder="เช่น กระเป๋า Notebook"
                    />
                  </label>

                  <label>
                    <span>ยี่ห้อ</span>

                    <input
                      value={item.brand || ''}
                      onChange={(event) =>
                        updateItem(
                          index,
                          'brand',
                          event.target.value
                        )
                      }
                    />
                  </label>

                  <label>
                    <span>รุ่น</span>

                    <input
                      value={item.model || ''}
                      onChange={(event) =>
                        updateItem(
                          index,
                          'model',
                          event.target.value
                        )
                      }
                    />
                  </label>

                  <label>
                    <span>Serial</span>

                    <input
                      value={item.serial || ''}
                      onChange={(event) =>
                        updateItem(
                          index,
                          'serial',
                          event.target.value
                        )
                      }
                    />
                  </label>

                  <label>
                    <span>จำนวน</span>

                    <input
                      type="number"
                      min="1"
                      value={item.quantity || 1}
                      onChange={(event) =>
                        updateItem(
                          index,
                          'quantity',
                          event.target.valueAsNumber || 1
                        )
                      }
                    />
                  </label>

                  <label className="asset-item-check">
                    <input
                      type="checkbox"
                      checked={
                        item.required !== false
                      }
                      onChange={(event) =>
                        updateItem(
                          index,
                          'required',
                          event.target.checked
                        )
                      }
                    />

                    <span>
                      ต้องคืนพร้อมชุด
                    </span>
                  </label>

                  <label className="asset-item-note">
                    <span>หมายเหตุ</span>

                    <input
                      value={item.note || ''}
                      onChange={(event) =>
                        updateItem(
                          index,
                          'note',
                          event.target.value
                        )
                      }
                    />
                  </label>

                  <button
                    type="button"
                    className="icon-btn danger"
                    title="ลบรายการย่อย"
                    onClick={() =>
                      removeItem(index)
                    }
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              )
            )}
          </div>
        )}
      </section>

      <footer className="form-footer">
        <button
          type="button"
          className="secondary"
          onClick={onCancel}
        >
          ยกเลิก
        </button>

        <button
          className="primary"
          disabled={busy}
        >
          {busy
            ? 'กำลังบันทึก...'
            : 'บันทึก'}
        </button>
      </footer>
    </form>
  );
}
