import { useEffect, useMemo, useState } from 'react';
import { Check, ClipboardCheck, Download, MapPin } from 'lucide-react';
import type { User } from '../types';
import { api, downloadXlsx, post, type ExcelColumn } from '../api';
import { locationOptions, type MasterDataMap } from '../masterData';
import { Badge, CompactSelect, DataTable, DatePickerInput, Modal, PageHeader, SectionTabs, dateText } from '../ui';

type AnnualInventoryRow = {
  id: number | string;
  count_id: number | null;
  count_no: string;
  inventory_key: string;
  inventory_type: 'ASSET' | 'FACILITY';
  record_id: string | number;
  item_code: string;
  item_name: string;
  category: string;
  unit: string;
  asset_type: string;
  responsible_department: string;
  company_code: string;
  expected_quantity: number;
  counted_quantity: number | null;
  difference: number | null;
  expected_location: string;
  actual_location: string;
  condition_status: string;
  result_status: string;
  count_date: string;
  counted_by_name: string;
  note: string;
};

const currentYear = Number(new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok', year: 'numeric'
}).format(new Date()));

function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date());
}

function defaultCountDate(year: number) {
  const current = today();
  const monthDay = current.slice(5);
  const candidate = `${year}-${monthDay}`;
  const parsed = new Date(`${candidate}T00:00:00Z`);
  return parsed.getUTCFullYear() === year && parsed.toISOString().slice(0, 10) === candidate
    ? candidate
    : `${year}-02-28`;
}

function qtyText(value: unknown) {
  const number = Number(value || 0);
  return new Intl.NumberFormat('th-TH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: Number.isInteger(number) ? 0 : 2
  }).format(number);
}

function assetTypeLabel(value: string) {
  const labels: Record<string, string> = {
    ASSET: 'Asset',
    FREE_ASSET: 'Free Asset',
    NON_ASSET: 'Non-Asset'
  };
  return labels[value] || value || '-';
}

function operationsDepartment(value: unknown) {
  const raw = String(value || '').trim();
  const upper = raw.toUpperCase();
  if (['IT', 'GA', 'HR'].includes(upper)) return upper;
  const normalized = raw.toLowerCase();
  if (/(^|[^a-z])it([^a-z]|$)|information\s*technology|ไอที|สารสนเทศ/.test(normalized)) return 'IT';
  if (/(^|[^a-z])ga([^a-z]|$)|general\s*affairs?|facilit(?:y|ies)|ธุรการ|อาคาร|สถานที่|บริหารทั่วไป/.test(normalized)) return 'GA';
  if (/(^|[^a-z])hr([^a-z]|$)|human\s*resources?|บุคคล|ทรัพยากรบุคคล/.test(normalized)) return 'HR';
  return '';
}

function locationLabel(value: string, masterData: MasterDataMap, company: string) {
  return locationOptions(masterData, company, value).find((option) => option.value === value)?.label || value || '-';
}

export default function AnnualInventoryPage({ user, masterData }: { user: User; masterData: MasterDataMap }) {
  const [year, setYear] = useState(currentYear);
  const [rows, setRows] = useState<AnnualInventoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'pending' | 'difference'>('all');
  const [counting, setCounting] = useState<AnnualInventoryRow | null>(null);
  const userDepartment = user.role === 'HR' ? 'HR' : operationsDepartment(`${user.department || ''} ${user.position || ''}`);

  async function load() {
    setLoading(true);
    setError('');
    try {
      setRows(await api<AnnualInventoryRow[]>(`/api/annual-inventory?year=${encodeURIComponent(year)}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ไม่สามารถโหลดรายการตรวจนับได้');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, [year]);

  const summary = useMemo(() => {
    const counted = rows.filter((row) => row.result_status !== 'NOT_COUNTED').length;
    const difference = rows.filter((row) => ['DIFFERENCE', 'NOT_FOUND'].includes(row.result_status)).length;
    return { total: rows.length, counted, pending: rows.length - counted, difference };
  }, [rows]);

  const visibleRows = useMemo(() => {
    if (activeTab === 'pending') return rows.filter((row) => row.result_status === 'NOT_COUNTED');
    if (activeTab === 'difference') return rows.filter((row) => ['DIFFERENCE', 'NOT_FOUND'].includes(row.result_status));
    return rows;
  }, [activeTab, rows]);

  function canCount(row: AnnualInventoryRow) {
    return user.role === 'ADMIN' || row.responsible_department === userDepartment;
  }

  function exportExcel() {
    const columns: ExcelColumn[] = [
      { key: 'item_code', header: 'รหัส', width: 22 },
      { key: 'item_name', header: 'รายการ', width: 30 },
      { key: 'asset_type', header: 'ประเภท', width: 18, value: (row) => assetTypeLabel(row.asset_type) },
      { key: 'responsible_department', header: 'หน่วยงานผู้ดูแล', width: 18 },
      { key: 'expected_quantity', header: 'จำนวนตามระบบ', width: 16, type: 'number' },
      { key: 'counted_quantity', header: 'จำนวนที่ตรวจพบ', width: 16, type: 'number' },
      { key: 'difference', header: 'ผลต่าง', width: 12, type: 'number' },
      { key: 'expected_location', header: 'สถานที่ตามระบบ', width: 26 },
      { key: 'actual_location', header: 'สถานที่ที่ตรวจพบ', width: 26 },
      { key: 'condition_status', header: 'สภาพ', width: 16 },
      { key: 'result_status', header: 'ผลตรวจนับ', width: 18 },
      { key: 'count_date', header: 'วันที่ตรวจนับ', width: 15, type: 'date' },
      { key: 'counted_by_name', header: 'ผู้ตรวจนับ', width: 22 },
      { key: 'note', header: 'หมายเหตุ', width: 30 }
    ];
    downloadXlsx(`annual-inventory-${year}.xlsx`, `ตรวจนับประจำปี ${year + 543}`, columns, rows);
  }

  return <>
    <PageHeader
      title="ตรวจนับทรัพย์สินประจำปี"
      description="รวมทรัพย์สินรายชิ้นและทรัพย์สินส่วนกลางไว้หน้าเดียว แยกผู้รับผิดชอบ IT, GA และ HR พร้อมแจ้งส่วนต่างทันที"
    >
      <label className="annual-year-picker"><span>ปีตรวจนับ</span><CompactSelect value={String(year)} searchable={false} options={[currentYear, currentYear - 1, currentYear - 2].map((value) => ({ value: String(value), label: `พ.ศ. ${value + 543}` }))} onChange={(value) => setYear(Number(value))} /></label>
      {rows.length > 0 && <button className="secondary" onClick={exportExcel}><Download size={16} />Export Excel</button>}
    </PageHeader>

    {error && <div className="alert error">{error}</div>}
    {loading && <div className="loading-card">กำลังโหลดรายการตรวจนับ...</div>}

    <section className="metric-grid annual-inventory-metrics">
      <div className="metric-card"><span className="metric-icon"><ClipboardCheck size={18} /></span><span>ต้องตรวจทั้งหมด</span><strong>{qtyText(summary.total)}</strong></div>
      <div className="metric-card"><span className="metric-icon"><Check size={18} /></span><span>ตรวจแล้ว</span><strong>{qtyText(summary.counted)}</strong></div>
      <div className="metric-card"><span className="metric-icon"><ClipboardCheck size={18} /></span><span>ยังไม่ตรวจ</span><strong>{qtyText(summary.pending)}</strong></div>
      <div className="metric-card"><span className="metric-icon"><MapPin size={18} /></span><span>มีส่วนต่าง</span><strong>{qtyText(summary.difference)}</strong></div>
    </section>

    <SectionTabs
      value={activeTab}
      onChange={(value) => setActiveTab(value as 'all' | 'pending' | 'difference')}
      ariaLabel="ตัวกรองผลตรวจนับ"
      items={[
        { value: 'all', label: 'ทั้งหมด', count: rows.length },
        { value: 'pending', label: 'ยังไม่ตรวจ', count: summary.pending },
        { value: 'difference', label: 'มีส่วนต่าง / ไม่พบ', count: summary.difference }
      ]}
    />

    <section className="card">
      <DataTable
        rows={visibleRows}
        searchText={(row) => `${row.item_code} ${row.item_name} ${row.category} ${row.responsible_department} ${row.expected_location} ${row.actual_location}`}
        columns={[
          { key: 'item_code', label: 'รหัส', filterable: false },
          { key: 'item_name', label: 'รายการ', filterable: false },
          { key: 'asset_type', label: 'ประเภท', filterLabel: (value) => assetTypeLabel(String(value)), render: (row) => assetTypeLabel(row.asset_type) },
          { key: 'responsible_department', label: 'ผู้ดูแล', render: (row) => <Badge value={row.responsible_department} /> },
          { key: 'expected_quantity', label: 'ตามระบบ', filterable: false, render: (row) => `${qtyText(row.expected_quantity)} ${row.unit}` },
          { key: 'counted_quantity', label: 'ตรวจพบ', filterable: false, render: (row) => row.counted_quantity == null ? '-' : `${qtyText(row.counted_quantity)} ${row.unit}` },
          { key: 'difference', label: 'ผลต่าง', filterable: false, render: (row) => row.difference == null ? '-' : qtyText(row.difference) },
          { key: 'expected_location', label: 'สถานที่ตามระบบ', render: (row) => locationLabel(row.expected_location, masterData, row.company_code) },
          { key: 'actual_location', label: 'สถานที่ที่พบ', render: (row) => row.actual_location ? locationLabel(row.actual_location, masterData, row.company_code) : '-' },
          { key: 'result_status', label: 'ผลตรวจนับ', render: (row) => <Badge value={row.result_status} /> },
          { key: 'count_date', label: 'วันที่ตรวจ', filterable: false, render: (row) => dateText(row.count_date) }
        ]}
        actions={(row) => canCount(row) ? <button className="table-button" onClick={() => setCounting(row)}><ClipboardCheck size={15} />{row.count_id ? 'แก้ผลตรวจนับ' : 'ตรวจนับ'}</button> : <span className="muted">{row.responsible_department} ดูแล</span>}
      />
    </section>

    <Modal open={Boolean(counting)} title={`ตรวจนับ ${counting?.item_code || ''}`} onClose={() => setCounting(null)} wide>
      {counting && <AnnualCountForm
        key={`${counting.inventory_key}-${counting.count_date}`}
        row={counting}
        year={year}
        masterData={masterData}
        onCancel={() => setCounting(null)}
        onSave={async (values) => {
          await post('/api/annual-inventory', values);
          setCounting(null);
          await load();
        }}
      />}
    </Modal>
  </>;
}

function AnnualCountForm({ row, year, masterData, onCancel, onSave }: { row: AnnualInventoryRow; year: number; masterData: MasterDataMap; onCancel: () => void; onSave: (values: any) => Promise<void> }) {
  const [form, setForm] = useState({
    countedQuantity: row.counted_quantity ?? row.expected_quantity,
    actualLocation: row.actual_location || row.expected_location,
    conditionStatus: row.condition_status || 'GOOD',
    countDate: row.count_date || defaultCountDate(year),
    note: row.note || ''
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const locations = locationOptions(masterData, row.company_code, form.actualLocation);
  const difference = Number(form.countedQuantity || 0) - Number(row.expected_quantity || 0);
  const locationMatches = !row.expected_location || !form.actualLocation || row.expected_location === form.actualLocation;
  const previewStatus = form.conditionStatus === 'NOT_FOUND'
    ? 'NOT_FOUND'
    : Math.abs(difference) <= 0.0001 && locationMatches && form.conditionStatus === 'GOOD'
      ? 'MATCH'
      : 'DIFFERENCE';

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSave({
        inventoryType: row.inventory_type,
        recordId: row.record_id,
        countYear: year,
        ...form,
        countedQuantity: form.conditionStatus === 'NOT_FOUND' ? 0 : form.countedQuantity,
        actualLocation: form.conditionStatus === 'NOT_FOUND' ? '' : form.actualLocation
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'บันทึกผลตรวจนับไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return <form className="entity-form" onSubmit={submit}>
    {error && <div className="alert error">{error}</div>}
    <div className="annual-count-summary">
      <div><span>รายการ</span><strong>{row.item_name}</strong><small>{row.item_code} · {assetTypeLabel(row.asset_type)}</small></div>
      <div><span>หน่วยงานผู้ดูแล</span><strong>{row.responsible_department}</strong><small>{locationLabel(row.expected_location, masterData, row.company_code)}</small></div>
      <div><span>จำนวนตามระบบ</span><strong>{qtyText(row.expected_quantity)} {row.unit}</strong><small>ตรวจปี พ.ศ. {year + 543}</small></div>
      <div><span>ผลที่กำลังบันทึก</span><strong><Badge value={previewStatus} /></strong><small>ผลต่าง {qtyText(form.conditionStatus === 'NOT_FOUND' ? -row.expected_quantity : difference)} {row.unit}</small></div>
    </div>
    <div className="form-grid">
      <label><span>สภาพที่ตรวจพบ *</span><CompactSelect required searchable={false} value={form.conditionStatus} options={[{value:'GOOD',label:'พบ · สภาพพร้อมใช้งาน'},{value:'DAMAGED',label:'พบ · ชำรุด/ต้องซ่อม'},{value:'NOT_FOUND',label:'ไม่พบทรัพย์สิน'}]} onChange={(value) => setForm((current) => ({ ...current, conditionStatus: value, countedQuantity: value === 'NOT_FOUND' ? 0 : (current.countedQuantity || row.expected_quantity), actualLocation: value === 'NOT_FOUND' ? '' : (current.actualLocation || row.expected_location) }))} /></label>
      <label><span>จำนวนที่ตรวจพบ *</span><input required type="number" min="0" max={row.inventory_type === 'ASSET' ? 1 : undefined} step={row.inventory_type === 'ASSET' ? 1 : 0.01} disabled={form.conditionStatus === 'NOT_FOUND'} value={form.conditionStatus === 'NOT_FOUND' ? 0 : form.countedQuantity} onChange={(event) => setForm({ ...form, countedQuantity: event.target.valueAsNumber })} /></label>
      <label><span>สถานที่ที่ตรวจพบ{form.conditionStatus !== 'NOT_FOUND' ? ' *' : ''}</span>{locations.length
        ? <CompactSelect required={form.conditionStatus !== 'NOT_FOUND'} searchable value={form.actualLocation} options={locations} placeholder="เลือกสถานที่จริง" searchPlaceholder="ค้นหาอาคาร ชั้น ห้อง หรือพื้นที่" disabled={form.conditionStatus === 'NOT_FOUND'} onChange={(value) => setForm({ ...form, actualLocation: value })} />
        : <input required={form.conditionStatus !== 'NOT_FOUND'} disabled={form.conditionStatus === 'NOT_FOUND'} value={form.actualLocation} placeholder="ระบุสถานที่จริง" onChange={(event) => setForm({ ...form, actualLocation: event.target.value })} />}</label>
      <label><span>วันที่ตรวจนับ (พ.ศ. {year + 543}) *</span><DatePickerInput required value={form.countDate} onChange={(value) => setForm({ ...form, countDate: value })} /></label>
      <label className="span-2"><span>หมายเหตุ / สาเหตุที่ต่าง</span><textarea value={form.note} placeholder="เช่น ย้ายห้องแล้วแต่ยังไม่ได้อัปเดต หรือพบจำนวนไม่ครบ" onChange={(event) => setForm({ ...form, note: event.target.value })} /></label>
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={onCancel}>ยกเลิก</button><button className="primary" disabled={busy}><Check size={16} />{busy ? 'กำลังบันทึก...' : 'บันทึกผลตรวจนับ'}</button></footer>
  </form>;
}
