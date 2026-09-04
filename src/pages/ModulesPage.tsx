import { Fragment, useEffect, useState } from 'react';
import { ArrowLeftRight, Camera, Check, Download, Eye, ImageIcon, RotateCcw, Trash2, X } from 'lucide-react';
import type { Asset, Employee, User } from '../types';
import { api, del, downloadXlsx, post, put, type ExcelColumn } from '../api';
import { Badge, CompactSelect, DataTable, DatePickerInput, EntityForm, Field, Modal, PageHeader, SectionTabs, dateText, money, type SelectOption } from '../ui';
import { locationOptions, masterOptions, withFallback, type MasterDataMap } from '../masterData';
import type { PageId } from '../navigation';
import ReportExportButton from '../ReportExportButton';
import { AssetPhotoButton, AssetSelectField, AssetSelectionPreview, ProtectedPhotoButton } from '../AssetPhotoButton';
import { AuthenticatedImage } from '../protectedMedia';

function useList(path:string){const [rows,setRows]=useState<any[]>([]);const [error,setError]=useState('');const [loading,setLoading]=useState(true);async function load(){setLoading(true);setError('');try{setRows(await api(path))}catch(e:any){setError(e.message)}finally{setLoading(false)}}useEffect(()=>{load()},[path]);return{rows,setRows,error,loading,load}}
function ModuleState({error,loading}:{error:string;loading:boolean}){return <>{error&&<div className="alert error">{error}</div>}{loading&&<div className="loading-card">กำลังโหลดข้อมูล...</div>}</>}

function bangkokToday(date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).format(date);
}

function operationsDepartment(value: unknown): string {
  const raw = String(value || '').trim();
  const upper = raw.toUpperCase();
  if (['IT', 'GA', 'HR'].includes(upper)) return upper;
  const normalized = raw.toLowerCase();
  if (/(^|[^a-z])it([^a-z]|$)|information\s*technology|help\s*desk|ไอที|สารสนเทศ/.test(normalized)) return 'IT';
  if (/(^|[^a-z])ga([^a-z]|$)|general\s*affairs?|facilit(?:y|ies)|ธุรการ|อาคาร|สถานที่|บริหารทั่วไป/.test(normalized)) return 'GA';
  if (/(^|[^a-z])hr([^a-z]|$)|human\s*resources?|บุคคล|ทรัพยากรบุคคล/.test(normalized)) return 'HR';
  return '';
}

export default function ModulesPage({
  page,
  assets,
  employees,
  companies,
  masterData,
  onReload,
  user
}: {
  page: PageId;
  assets: Asset[];
  employees: Employee[];
  companies: any[];
  masterData: MasterDataMap;
  onReload: () => Promise<void>;
  user: User;
}) {
  const userDepartment = user.role === 'HR' ? 'HR' : operationsDepartment(`${user.department || ''} ${user.position || ''}`);
  const hrManager = user.role === 'ADMIN' || userDepartment === 'HR';
  const itManager = user.role === 'ADMIN' || userDepartment === 'IT';
  const maintenanceManager = user.role === 'ADMIN' || ['IT', 'GA'].includes(userDepartment);

  switch (page) {
    case 'asset-assignment':
      return <AssignmentPage assets={assets} employees={employees} masterData={masterData} onReload={onReload} user={user} canTransfer={hrManager} canAdmin={user.role === 'ADMIN'} canExport={user.role !== 'VIEW'} />;
    case 'asset-borrow-return':
      return <BorrowPage assets={assets} employees={employees} masterData={masterData} onReload={onReload} user={user} canCreate={itManager} canReturn={itManager} canEdit={itManager} canDelete={user.role === 'ADMIN'} canExport={user.role !== 'VIEW'} />;
    case 'asset-maintenance':
      return <MaintenancePage assets={assets} employees={employees} masterData={masterData} onReload={onReload} user={user} canManage={maintenanceManager} canEdit={maintenanceManager} canDelete={user.role === 'ADMIN'} canExport={user.role !== 'VIEW'} />;
    case 'asset-depreciation':
      return <DepreciationPage assets={assets} />;
    case 'asset-disposal':
      return <DisposalPage assets={assets} canEdit={['ADMIN', 'SUPERVISOR'].includes(user.role)} canDelete={user.role === 'ADMIN'} />;
    case 'approval-workflow':
      return <ApprovalPage assets={assets} onReload={onReload} user={user} canAdmin={user.role === 'ADMIN'} />;
    case 'audit-log':
      return <AuditPage canDelete={user.role === 'ADMIN'} />;
    default:
      return null;
  }
}

function valueOptions(values: Array<string | null | undefined>, currentValue = ''): SelectOption[] {
  const normalized = Array.from(new Set(values.map((value) => String(value || '').trim()).filter(Boolean)))
    .sort((left, right) => left.localeCompare(right, 'th'))
    .map((value) => ({ value, label: value }));
  const current = String(currentValue || '').trim();
  if (current && !normalized.some((option) => option.value === current)) {
    normalized.unshift({ value: current, label: `${current} · ข้อมูลเดิม` });
  }
  return normalized;
}

function masterOrValues(
  masterData: MasterDataMap,
  type: string,
  company: string,
  values: Array<string | null | undefined>,
  currentValue = '',
  parentCode = ''
) {
  return withFallback(
    masterOptions(masterData, type, company, { currentValue, parentCode: parentCode || undefined }),
    valueOptions(values, currentValue)
  );
}

function accountingAssetIdFor(assets: Asset[], assetId: unknown): string {
  const id = String(assetId || '');
  return assets.find((asset) => asset.id === id)?.accountingAssetId || '';
}

function accountingAssetColumn(assets: Asset[]) {
  return {
    key: 'accounting_asset_id',
    label: 'Asset ID บัญชี',
    filterValue: (row: any) => accountingAssetIdFor(assets, row.asset_id),
    render: (row: any) => accountingAssetIdFor(assets, row.asset_id) || '-'
  };
}

function accountingAssetSearchText(assets: Asset[], row: any): string {
  return accountingAssetIdFor(assets, row.asset_id);
}

function assetOptionLabel(asset: Asset): string {
  return `${asset.id}${asset.accountingAssetId ? ` · บัญชี ${asset.accountingAssetId}` : ''} · ${asset.name} · ${asset.location || '-'}`;
}

function assetOptionKeywords(asset: Asset): string {
  return [asset.accountingAssetId, asset.serial, asset.brand, asset.model, asset.location].filter(Boolean).join(' ');
}

function AssignmentPage({
  assets,
  employees,
  masterData,
  onReload,
  user,
  canTransfer,
  canAdmin,
  canExport
}: {
  assets: Asset[];
  employees: Employee[];
  masterData: MasterDataMap;
  onReload: () => Promise<void>;
  user: User;
  canTransfer: boolean;
  canAdmin: boolean;
  canExport: boolean;
}) {
  const transferState = useList('/api/transfers');
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [editingTransfer, setEditingTransfer] = useState<any>(null);
  const [returningAsset, setReturningAsset] = useState<Asset | null>(null);
  const [activeTab, setActiveTab] = useState<'current' | 'history' | 'returns'>('current');

  const returnHistoryRows = assets.flatMap((asset) => (asset.returns || []).map((record: any, index: number) => ({
    ...record,
    id: `${asset.id}-return-${index}`,
    asset_id: asset.id,
    accounting_asset_id: asset.accountingAssetId || '',
    asset_name: asset.name,
    company_code: asset.company
  })));

  const pendingAssetIds = new Set(
    transferState.rows
      .filter((row) => String(row.status || '').toUpperCase() === 'PENDING')
      .map((row) => String(row.asset_id || ''))
  );

  async function saveTransfer(values: any) {
    if (editingTransfer) await put(`/api/transfers/${editingTransfer.id}`, values);
    else await post('/api/transfers', values);
    setSelectedAsset(null);
    setEditingTransfer(null);
    setActiveTab('history');
    await Promise.all([transferState.load(), onReload()]);
  }


  async function saveReturn(values: any) {
    if (!returningAsset) return;
    await post(`/api/assets/${encodeURIComponent(returningAsset.id)}/returns`, values);
    setReturningAsset(null);
    setActiveTab('returns');
    await Promise.all([transferState.load(), onReload()]);
  }

  async function removeTransfer(row: any) {
    if (!confirm(`ลบรายการโอน ${row.request_no} ใช่หรือไม่?`)) return;
    await del(`/api/transfers/${row.id}`);
    await transferState.load();
  }

  function openTransfer(asset: Asset) {
    setEditingTransfer(null);
    setSelectedAsset(asset);
  }

  function openEditTransfer(row: any) {
    setEditingTransfer(row);
    setSelectedAsset(assets.find((asset) => asset.id === row.asset_id) || null);
  }

  function closeTransfer() {
    setSelectedAsset(null);
    setEditingTransfer(null);
  }

  return <>
    <PageHeader
      title="ผู้ครอบครองปัจจุบัน"
      description="HR ดูแลการโอนย้าย เปลี่ยนผู้ครอบครอง และรับคืนทรัพย์สิน โดยระบบเก็บประวัติและส่งอนุมัติตาม Workflow"
    >
      {canExport && <ReportExportButton kind="transfers" filename="asset-transfers" />}
    </PageHeader>
    <ModuleState error={transferState.error} loading={transferState.loading} />
    <SectionTabs
      value={activeTab}
      onChange={(value) => setActiveTab(value as 'current' | 'history' | 'returns')}
      ariaLabel="ส่วนการใช้งานผู้ครอบครอง การโอนย้าย และการคืน"
      items={[
        { value: 'current', label: 'ผู้ครอบครองปัจจุบัน', count: assets.length },
        { value: 'history', label: 'ประวัติการโอนย้าย', count: transferState.rows.length },
        { value: 'returns', label: 'ประวัติการคืน', count: returnHistoryRows.length }
      ]}
    />
    <div className="module-tab-panel" hidden={activeTab !== 'current'} role="tabpanel">
    <section className="card">
      <DataTable
        rows={assets}
        columns={[
          { key: 'id', label: 'Asset ID' },
          { key: 'accountingAssetId', label: 'Asset ID บัญชี', render: (row) => row.accountingAssetId || '-' },
          { key: 'name', label: 'ทรัพย์สิน' },
          { key: 'assignedTo', label: 'ผู้รับผิดชอบ', render: (row) => row.assignedTo || 'ไม่มีผู้ถือครอง' },
          { key: 'department', label: 'แผนก', render: (row) => row.department || '-' },
          { key: 'location', label: 'ตำแหน่ง' },
          { key: 'status', label: 'สถานะ', render: (row) => <Badge value={row.status} /> },
          {
            key: 'transfer_status',
            label: 'การโอนย้าย',
            render: (row) => pendingAssetIds.has(row.id)
              ? <Badge value="PENDING" />
              : <span className="muted">-</span>
          }
        ]}
        actions={(row) => <>
          <AssetPhotoButton asset={row} />
          {canTransfer && <button
            className="table-button"
            onClick={() => openTransfer(row)}
            disabled={pendingAssetIds.has(row.id)}
            title={pendingAssetIds.has(row.id) ? 'มีคำขอโอนย้ายที่รออนุมัติอยู่แล้ว' : 'โอนย้าย / เปลี่ยนผู้ครอบครอง'}
          ><ArrowLeftRight size={15} />โอนย้าย</button>}
          {canTransfer && (row.custodianType !== 'UNASSIGNED' || row.status === 'ACTIVE') && <button
            className="table-button"
            onClick={() => setReturningAsset(row)}
            disabled={pendingAssetIds.has(row.id) || !['ACTIVE', 'IN_STOCK'].includes(row.status)}
            title={pendingAssetIds.has(row.id) ? 'มีคำขอโอนย้ายที่รออนุมัติอยู่ กรุณาจัดการก่อนคืน' : 'คืนทรัพย์สินเข้าคลัง / เปลี่ยนเครื่อง / คืนเพราะชำรุด'}
          ><RotateCcw size={15} />คืน</button>}
        </>}
      />
    </section>
    </div>

    <div className="module-tab-panel" hidden={activeTab !== 'history'} role="tabpanel">
    <section className="card">
      <div className="section-heading-row">
        <div>
          <h3>ประวัติการโอนย้าย</h3>
          <p className="muted">ติดตามคำขอโอนย้าย ต้นทาง ปลายทาง และสถานะการอนุมัติจากหน้าเดียว</p>
        </div>
      </div>
      <DataTable
        rows={transferState.rows}
        columns={[
          { key: 'request_no', label: 'เลขที่ใบโอน' },
          { key: 'asset_id', label: 'Asset ID' },
          accountingAssetColumn(assets),
          { key: 'from_assignee', label: 'ผู้เดิม', render: (row) => row.from_assignee || 'ไม่มีผู้ถือครอง' },
          { key: 'to_assignee', label: 'ผู้ใหม่', render: (row) => row.to_assignee || 'ไม่มีผู้ถือครอง' },
          { key: 'from_location', label: 'ต้นทาง', render: (row) => row.from_location || '-' },
          { key: 'to_location', label: 'ปลายทาง', render: (row) => row.to_location || '-' },
          { key: 'status', label: 'สถานะ', render: (row) => <Badge value={row.status} /> },
          { key: 'transfer_date', label: 'วันที่', render: (row) => dateText(row.transfer_date) }
        ]}
        searchText={(row) => accountingAssetSearchText(assets, row)}
        actions={(row) => <AssetPhotoButton asset={assets.find((asset) => asset.id === row.asset_id)} assetId={row.asset_id} />}
        onEdit={canTransfer ? (row) => {
          if (String(row.status || '').toUpperCase() !== 'PENDING') {
            alert('แก้ไขได้เฉพาะรายการที่รออนุมัติ');
            return;
          }
          openEditTransfer(row);
        } : undefined}
        onDelete={canAdmin ? removeTransfer : undefined}
      />
    </section>
    </div>

    <div className="module-tab-panel" hidden={activeTab !== 'returns'} role="tabpanel">
      <section className="card">
        <div className="section-heading-row">
          <div><h3>ประวัติการคืนทรัพย์สิน</h3><p className="muted">เก็บชื่อผู้ถือครองเดิม เหตุผล สภาพ และสถานที่รับคืน เพื่อค้นย้อนหลังได้</p></div>
        </div>
        <DataTable
          rows={returnHistoryRows}
          columns={[
            { key: 'date', label: 'วันที่คืน', render: (row) => dateText(row.date) },
            { key: 'asset_id', label: 'Asset ID' },
            { key: 'accounting_asset_id', label: 'Asset ID บัญชี', render: (row) => row.accounting_asset_id || '-' },
            { key: 'asset_name', label: 'ทรัพย์สิน' },
            { key: 'returnedBy', label: 'ผู้ใช้เดิม / ผู้คืน', render: (row) => row.returnedBy || row.previousAssignee || '-' },
            { key: 'reason', label: 'เหตุผล', render: (row) => assetReturnReasonLabel(row.reason) },
            { key: 'location', label: 'สถานที่รับคืน' },
            { key: 'condition', label: 'สภาพ', render: (row) => `${Number(row.condition || 0)}%` },
            { key: 'receivedBy', label: 'ผู้รับคืน' }
          ]}
          actions={(row) => <AssetPhotoButton asset={assets.find((asset) => asset.id === row.asset_id)} assetId={row.asset_id} />}
        />
      </section>
    </div>

    <Modal
      open={Boolean(selectedAsset || editingTransfer)}
      title={editingTransfer
        ? `แก้ไขคำขอโอนย้าย ${editingTransfer.request_no || ''}`
        : `โอนย้าย / เปลี่ยนผู้ครอบครอง ${selectedAsset?.id || ''}`}
      onClose={closeTransfer}
    >
      {(selectedAsset || editingTransfer) && <TransferForm
        assets={assets}
        employees={employees}
        masterData={masterData}
        editing={editingTransfer}
        fixedAsset={selectedAsset}
        onSubmit={saveTransfer}
        onCancel={closeTransfer}
      />}
    </Modal>

    <Modal
      open={Boolean(returningAsset)}
      title={`คืนทรัพย์สิน ${returningAsset?.id || ''}`}
      onClose={() => setReturningAsset(null)}
      wide
    >
      {returningAsset && <GeneralAssetReturnForm
        asset={returningAsset}
        employees={employees}
        masterData={masterData}
        defaultReceiver={user.name}
        onSubmit={saveReturn}
        onCancel={() => setReturningAsset(null)}
      />}
    </Modal>
  </>;
}

function assetReturnReasonLabel(value: unknown): string {
  const labels: Record<string, string> = {
    RETURN_TO_POOL: 'คืนเข้าคลัง / คืนส่วนกลาง',
    REPLACEMENT: 'เปลี่ยนเครื่อง / ได้เครื่องใหม่',
    EMPLOYEE_CHANGE: 'เปลี่ยนหน้าที่ / เปลี่ยนผู้ใช้งาน',
    DAMAGED: 'ชำรุด / ต้องตรวจซ่อม',
    END_OF_USE: 'สิ้นสุดการใช้งาน',
    RESIGNED: 'พนักงานลาออก',
    OTHER: 'อื่นๆ'
  };
  const key = String(value || 'RETURN_TO_POOL').toUpperCase();
  return labels[key] || key;
}

function GeneralAssetReturnForm({
  asset,
  employees,
  masterData,
  defaultReceiver,
  onSubmit,
  onCancel
}: {
  asset: Asset;
  employees: Employee[];
  masterData: MasterDataMap;
  defaultReceiver: string;
  onSubmit: (values: any) => Promise<void>;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(bangkokToday());
  const [receivedBy, setReceivedBy] = useState(defaultReceiver);
  const [location, setLocation] = useState(asset.location || '');
  const [condition, setCondition] = useState(Number(asset.condition || 100));
  const [reason, setReason] = useState('RETURN_TO_POOL');
  const [note, setNote] = useState('');
  const requiredItems = (asset.items || []).filter((item: any) => item.required !== false);
  const [returnedItemNames, setReturnedItemNames] = useState<string[]>(requiredItems.map((item: any) => String(item.name)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const receiverOptions = withFallback(
    employees.filter((employee) => employee.status === 'ACTIVE' && employee.company === asset.company)
      .map((employee) => ({ value: employee.name, label: `${employee.name} · ${employee.department || '-'} (${employee.id})` })),
    [{ value: defaultReceiver, label: defaultReceiver }]
  );
  const locations = withFallback(locationOptions(masterData, asset.company, location), valueOptions([asset.location], location));
  const reasonOptions: SelectOption[] = [
    { value: 'RETURN_TO_POOL', label: 'คืนเข้าคลัง / คืนส่วนกลาง' },
    { value: 'REPLACEMENT', label: 'เปลี่ยนเครื่อง / ได้เครื่องใหม่' },
    { value: 'EMPLOYEE_CHANGE', label: 'เปลี่ยนหน้าที่ / เปลี่ยนผู้ใช้งาน' },
    { value: 'DAMAGED', label: 'ชำรุด / ต้องตรวจซ่อม' },
    { value: 'END_OF_USE', label: 'สิ้นสุดการใช้งาน' },
    { value: 'RESIGNED', label: 'พนักงานลาออก' },
    { value: 'OTHER', label: 'อื่นๆ' }
  ];

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!date || !receivedBy || !location) return;
    const missingItems = requiredItems.map((item: any) => String(item.name)).filter((name: string) => !returnedItemNames.includes(name));
    setBusy(true); setError('');
    try {
      await onSubmit({
        date,
        returnedBy: asset.assignedTo || 'ไม่มีผู้ถือครอง',
        receivedBy,
        location,
        condition,
        reason,
        note,
        returnedItems: returnedItemNames,
        missingItems
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'คืนทรัพย์สินไม่สำเร็จ');
    } finally { setBusy(false); }
  }

  return <form className="entity-form asset-return-form" onSubmit={submit}>
    {error && <div className="alert error">{error}</div>}

    <div className="form-grid asset-return-form-grid">
      <AssetSelectionPreview asset={asset} />

      <section className="asset-return-section span-2">
        <header className="asset-return-section-head">
          <div>
            <strong>ข้อมูลผู้ครอบครองปัจจุบัน</strong>
            <span>ตรวจสอบข้อมูลเดิมก่อนรับทรัพย์สินกลับ</span>
          </div>
        </header>
        <div className="asset-current-snapshot">
          <div><span>ผู้ถือครองเดิม</span><strong>{asset.assignedTo || 'ไม่มีผู้ถือครอง'}</strong></div>
          <div><span>แผนกเดิม</span><strong>{asset.department || '-'}</strong></div>
          <div><span>ตำแหน่งเดิม</span><strong>{asset.location || '-'}</strong></div>
          <div><span>สถานะเดิม</span><strong>{asset.status}</strong></div>
        </div>
      </section>

      <section className="asset-return-section span-2">
        <header className="asset-return-section-head">
          <div>
            <strong>ข้อมูลการรับคืน</strong>
            <span>ระบุเหตุผล สถานที่ และสภาพทรัพย์สิน ณ วันที่รับคืน</span>
          </div>
        </header>
        <div className="asset-return-fields-grid">
          <label><span>วันที่คืน *</span><DatePickerInput required value={date} onChange={setDate} /></label>
          <label><span>เหตุผลการคืน *</span><CompactSelect value={reason} onChange={setReason} options={reasonOptions} /></label>
          <label><span>ผู้รับคืน *</span><CompactSelect searchable required value={receivedBy} onChange={setReceivedBy} options={receiverOptions} /></label>
          <label><span>สถานที่รับคืน *</span><CompactSelect searchable required value={location} onChange={setLocation} options={locations} /></label>
          <label className="asset-return-condition-field"><span>สภาพหลังคืน (%) *</span><input type="number" min={0} max={100} required value={condition} onChange={(event) => setCondition(Number(event.target.value))} /></label>
          <label className="span-2"><span>หมายเหตุ</span><textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="เช่น เปลี่ยนเป็นเครื่องรุ่นใหม่ / พบอาการผิดปกติ / ส่งคืนเข้าคลัง" /></label>
        </div>
      </section>

      {requiredItems.length > 0 && <section className="asset-return-section asset-return-boxset span-2">
        <header className="asset-return-section-head">
          <div>
            <strong>ตรวจรายการย่อย / Box set ที่ต้องคืน</strong>
            <span>ติ๊กเฉพาะอุปกรณ์ที่ได้รับคืนจริง</span>
          </div>
          <span className="asset-return-count">{returnedItemNames.length}/{requiredItems.length} รายการ</span>
        </header>
        <div className="asset-return-items-grid">
          {requiredItems.map((item: any) => {
            const name = String(item.name);
            const checked = returnedItemNames.includes(name);
            return <label key={name} className={`asset-return-item-check${checked ? ' checked' : ''}`}><input type="checkbox" checked={checked} onChange={(event) => setReturnedItemNames((current) => event.target.checked ? [...new Set([...current, name])] : current.filter((value) => value !== name))} /><span><strong>{name}</strong><small>จำนวน {item.quantity || 1}</small></span></label>;
          })}
        </div>
        <div className="asset-return-boxset-note">ถ้ารายการบังคับคืนไม่ครบ ระบบจะสร้าง Ticket ซ่อม/ตรวจสอบและตั้ง Asset เป็น IN_REPAIR อัตโนมัติ</div>
      </section>}

      {(reason === 'DAMAGED' || condition < 70) && <div className="alert warning span-2 asset-return-warning">รายการนี้จะถูกส่งเข้า Maintenance อัตโนมัติหลังรับคืน</div>}
    </div>

    <footer className="form-footer"><button type="button" className="secondary" onClick={onCancel}>ยกเลิก</button><button className="primary" disabled={busy}><RotateCcw size={17}/>{busy ? 'กำลังคืน...' : 'ยืนยันรับคืนทรัพย์สิน'}</button></footer>
  </form>;
}

function TransferForm({
  assets,
  employees,
  masterData,
  editing,
  fixedAsset,
  onSubmit,
  onCancel
}: {
  assets: Asset[];
  employees: Employee[];
  masterData: MasterDataMap;
  editing: any;
  fixedAsset?: Asset | null;
  onSubmit: (values: any) => Promise<void>;
  onCancel: () => void;
}) {
  const [assetId, setAssetId] = useState(fixedAsset?.id || editing?.asset_id || '');
  const asset = fixedAsset || assets.find((row) => row.id === assetId) || assets.find((row) => row.id === editing?.asset_id);
  const company = asset?.company || editing?.company_code || '';
  const editingAssignee = String(editing?.to_assignee || '');
  const sourceAssignee = String(editing?.from_assignee ?? asset?.assignedTo ?? '');
  const editingEmployee = employees.find((employee) => employee.company === company && employee.name === editingAssignee);
  const sourceEmployee = employees.find((employee) => employee.company === company && employee.name === asset?.assignedTo);
  const initialAssignee = editing
    ? (editingAssignee === 'ทรัพย์สินส่วนกลาง' ? '__SHARED__' : editingEmployee?.id || (editingAssignee ? '__CURRENT__' : '__UNASSIGNED__'))
    : (asset?.custodianType === 'SHARED' || asset?.assignedTo === 'ทรัพย์สินส่วนกลาง'
      ? '__SHARED__'
      : sourceEmployee?.id || (asset?.assignedTo ? '__CURRENT__' : '__UNASSIGNED__'));
  const [toLocation, setToLocation] = useState(editing?.to_location || asset?.location || '');
  const [toDepartment, setToDepartment] = useState(editing?.to_department || asset?.department || '');
  const [assigneeChoice, setAssigneeChoice] = useState(initialAssignee);
  const [legacyAssignee, setLegacyAssignee] = useState(editingAssignee || asset?.assignedTo || '');
  const [transferDate, setTransferDate] = useState(String(editing?.transfer_date || bangkokToday()).slice(0, 10));
  const [note, setNote] = useState(editing?.note || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const activeEmployees = employees.filter((employee) => employee.status === 'ACTIVE' && (!company || employee.company === company));
  const locationChoices = withFallback(
    locationOptions(masterData, company, toLocation),
    valueOptions(assets.filter((row) => !company || row.company === company).map((row) => row.location), toLocation)
  );
  const departmentChoices = masterOrValues(masterData, 'department', company, activeEmployees.map((employee) => employee.department), toDepartment);
  const assigneeChoices: SelectOption[] = [
    { value: '__UNASSIGNED__', label: 'ไม่มีผู้ถือครอง — ย้ายเข้าคลัง / รอจัดสรร' },
    { value: '__SHARED__', label: 'ทรัพย์สินส่วนกลาง' },
    ...(assigneeChoice === '__CURRENT__' && legacyAssignee ? [{ value: '__CURRENT__', label: `ผู้ถือครองปัจจุบัน: ${legacyAssignee}` }] : []),
    ...activeEmployees.map((employee) => ({
      value: employee.id,
      label: `${employee.name} · ${employee.department || '-'} (${employee.id})`,
      keywords: [employee.position, employee.location].filter(Boolean).join(' ')
    }))
  ];

  function applyAsset(next: Asset) {
    setToLocation(next.location || '');
    setToDepartment(next.department || '');
    setLegacyAssignee(next.assignedTo || '');
    const employee = employees.find((item) => item.company === next.company && item.name === next.assignedTo);
    const nextChoice = next.custodianType === 'SHARED' || next.assignedTo === 'ทรัพย์สินส่วนกลาง'
      ? '__SHARED__'
      : employee?.id || (next.assignedTo ? '__CURRENT__' : '__UNASSIGNED__');
    setAssigneeChoice(nextChoice);
  }

  function changeAssignee(value: string) {
    setAssigneeChoice(value);
    const employee = activeEmployees.find((row) => row.id === value);
    if (employee) {
      setToDepartment(employee.department || '');
      if (employee.location) setToLocation(employee.location);
    } else if (value === '__UNASSIGNED__') {
      setToDepartment('');
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (!editing && !assetId) throw new Error('กรุณาเลือกทรัพย์สิน');
      if (!toLocation.trim()) throw new Error('กรุณาระบุตำแหน่งปลายทาง');
      if (!note.trim()) throw new Error('กรุณาระบุเหตุผลการโอนย้าย');
      if (assigneeChoice === '__SHARED__' && !toDepartment.trim()) throw new Error('ทรัพย์สินส่วนกลางต้องระบุแผนกผู้ดูแล');
      const employee = activeEmployees.find((row) => row.id === assigneeChoice);
      const nextAssignee = assigneeChoice === '__UNASSIGNED__'
        ? ''
        : assigneeChoice === '__SHARED__'
          ? 'ทรัพย์สินส่วนกลาง'
          : assigneeChoice === '__CURRENT__'
            ? legacyAssignee
            : employee?.name || '';
      const nextDepartment = assigneeChoice === '__UNASSIGNED__' ? '' : employee?.department || toDepartment;

      if (!editing && asset) {
        const sameLocation = String(asset.location || '') === toLocation;
        const sameDepartment = String(asset.department || '') === nextDepartment;
        const sameAssignee = String(asset.assignedTo || '') === nextAssignee;
        if (sameLocation && sameDepartment && sameAssignee) {
          throw new Error('กรุณาเปลี่ยนผู้ครอบครอง แผนก หรือตำแหน่งอย่างน้อย 1 รายการ');
        }
      }

      await onSubmit({
        ...(editing ? {} : { assetId }),
        toLocation,
        toDepartment: nextDepartment,
        toAssignee: nextAssignee,
        transferDate,
        note
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'บันทึกคำขอโอนไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return <form className="entity-form" onSubmit={submit}>
    {error && <div className="alert error">{error}</div>}
    <div className="form-grid">
      {!editing && !fixedAsset ? <AssetSelectField
        assets={assets.filter((row) => ['ACTIVE', 'IN_STOCK'].includes(row.status))}
        value={assetId}
        label="เลือกทรัพย์สิน"
        onChange={(value) => {
          setAssetId(value);
          const next = assets.find((row) => row.id === value);
          if (next) applyAsset(next);
        }}
      /> : <AssetSelectionPreview asset={asset || null} />}

      <div className="span-2 transfer-source-summary">
        <div><span>ผู้ครอบครองปัจจุบัน</span><strong>{sourceAssignee || 'ไม่มีผู้ถือครอง'}</strong></div>
        <div><span>แผนกปัจจุบัน</span><strong>{editing?.from_department || asset?.department || '-'}</strong></div>
        <div><span>ตำแหน่งปัจจุบัน</span><strong>{editing?.from_location || asset?.location || '-'}</strong></div>
      </div>

      <label><span>ผู้รับผิดชอบปลายทาง</span><CompactSelect searchable value={assigneeChoice} onChange={changeAssignee} options={assigneeChoices} searchPlaceholder="ค้นหาชื่อ รหัส หรือแผนก" /></label>
      <label><span>แผนกปลายทาง{assigneeChoice === '__SHARED__' ? ' *' : ''}</span><CompactSelect searchable value={toDepartment} onChange={setToDepartment} options={departmentChoices} disabled={Boolean(activeEmployees.find((employee) => employee.id === assigneeChoice)) || assigneeChoice === '__UNASSIGNED__'} /></label>
      <label><span>ตำแหน่งปลายทาง *</span><CompactSelect required searchable value={toLocation} onChange={setToLocation} options={locationChoices} searchPlaceholder="ค้นหา Site อาคาร ห้อง หรือคลัง" /></label>
      <label><span>วันที่โอน *</span><DatePickerInput required value={transferDate} onChange={setTransferDate} /></label>
      <label className="span-2"><span>เหตุผล / หมายเหตุ *</span><textarea required value={note} onChange={(event) => setNote(event.target.value)} /></label>
    </div>
    <footer className="form-footer">
      <button type="button" className="secondary" onClick={onCancel}>ยกเลิก</button>
      <button className="primary" disabled={busy}><Check size={17} />{busy ? 'กำลังบันทึก...' : editing ? 'บันทึกการแก้ไข' : 'ส่งคำขอโอนย้าย'}</button>
    </footer>
  </form>;
}

function BorrowPage({
  assets,
  employees,
  masterData,
  onReload,
  user,
  canCreate,
  canReturn,
  canEdit,
  canDelete,
  canExport
}: {
  assets: Asset[];
  employees: Employee[];
  masterData: MasterDataMap;
  onReload: () => Promise<void>;
  user: User;
  canCreate: boolean;
  canReturn: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExport: boolean;
}) {
  const state = useList('/api/borrow-records');
  const borrowable = useList('/api/assets/borrowable');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [returning, setReturning] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'active' | 'history'>('active');

  const borrowHistoryStatuses = new Set(['RETURNED', 'REJECTED', 'CANCELLED']);
  const activeBorrowRows = state.rows.filter((row) => !borrowHistoryStatuses.has(String(row.status || '').toUpperCase()));
  const borrowHistoryRows = state.rows.filter((row) => borrowHistoryStatuses.has(String(row.status || '').toUpperCase()));
  const visibleBorrowRows = activeTab === 'active' ? activeBorrowRows : borrowHistoryRows;

  const availableAssets = borrowable.rows.length ? borrowable.rows : assets.filter((asset) =>
    (asset.responsibleDepartment || 'IT') === 'IT'
      && (asset.status === 'IN_STOCK' || (asset.status === 'ACTIVE' && asset.custodianType === 'SHARED'))
  );
  const employeeChoices = employees
    .filter((employee) => employee.status === 'ACTIVE' && (user.role === 'ADMIN' || employee.company === user.company))
    .filter((employee) => user.role !== 'VIEW' || employee.id === user.id)
    .map((employee) => ({ value: employee.name, label: `${employee.name} · ${employee.department || '-'} (${employee.id})`, keywords: employee.position || '' }));
  const fields: Field[] = [
    { key: 'assetId', label: 'เลือกทรัพย์สิน', type: 'select', required: true, fullWidth: true, options: availableAssets.map((asset: any) => ({ value: asset.id, label: assetOptionLabel(asset), keywords: assetOptionKeywords(asset) })) },
    { key: 'borrower', label: 'ผู้ยืม', type: 'select', required: true, options: employeeChoices },
    { key: 'borrowDate', label: 'วันที่ยืม', type: 'date', required: true },
    { key: 'dueDate', label: 'กำหนดคืน', type: 'date', required: true },
    { key: 'conditionOut', label: 'สภาพก่อนยืม (%)', type: 'number', min: 0, max: 100 },
    { key: 'note', label: 'วัตถุประสงค์', type: 'textarea', required: true }
  ];

  async function save(values: any) {
    if (editing) await put(`/api/borrow-records/${editing.id}`, values);
    else await post('/api/borrow-records', values);
    setOpen(false);
    setEditing(null);
    await state.load();
  }
  async function remove(row: any) {
    if (!confirm(`ลบรายการยืม ${row.request_no} และคืนสถานะทรัพย์สินใช่หรือไม่?`)) return;
    await del(`/api/borrow-records/${row.id}`);
    await Promise.all([state.load(), onReload()]);
  }
  async function confirmReturnRequest(row: any) {
    if (!confirm(`ยืนยันว่าต้องการคืน ${row.request_no} ใช่หรือไม่?`)) return;
    await post(`/api/borrow-records/${row.id}/confirm-return`, { returnDate: bangkokToday() });
    await state.load();
  }
  async function returnAsset(values: any) {
    await post(`/api/borrow-records/${returning.id}/return`, values);
    setReturning(null);
    await Promise.all([state.load(), onReload()]);
  }

  const initial = editing ? {
    borrower: editing.borrower,
    borrowDate: editing.borrow_date,
    dueDate: editing.due_date,
    conditionOut: editing.condition_out,
    note: editing.note
  } : { borrower: user.role === 'VIEW' ? user.name : '', borrowDate: bangkokToday(), conditionOut: 100 };
  const returningAsset = assets.find((asset) => asset.id === returning?.asset_id);
  const returnLocationChoices = withFallback(
    locationOptions(masterData, returningAsset?.company || returning?.company_code || '', returning?.original_location || ''),
    valueOptions(assets.filter((asset) => !returningAsset || asset.company === returningAsset.company).map((asset) => asset.location), returning?.original_location || '')
  );
  const receiverChoices = employees.filter((employee) => employee.status === 'ACTIVE' && (!returningAsset || employee.company === returningAsset.company)).map((employee) => ({ value: employee.name, label: `${employee.name} · ${employee.department || '-'} (${employee.id})` }));

  return <>
    <PageHeader title="ยืม-คืนอุปกรณ์ IT" description="รายการในหน้านี้มาจากทรัพย์สินที่กำหนดหน่วยงานเจ้าของเป็น IT เท่านั้น และ IT เป็นผู้ดำเนินการยืม–รับคืน" actionLabel="สร้างคำขอยืม" onAction={canCreate ? () => setOpen(true) : undefined}>
      {canExport && <ReportExportButton kind="borrow" filename="asset-borrow-return" />}
    </PageHeader>
    {!canCreate && <div className="alert warning">หน้านี้ดำเนินการโดย IT คุณสามารถดูประวัติได้ แต่ไม่สามารถสร้างหรือรับคืนรายการ</div>}
    <ModuleState error={state.error || borrowable.error} loading={state.loading || borrowable.loading} />
    <SectionTabs
      value={activeTab}
      onChange={(value) => setActiveTab(value as 'active' | 'history')}
      ariaLabel="สถานะรายการยืมคืน"
      items={[
        { value: 'active', label: 'กำลังดำเนินการ', count: activeBorrowRows.length },
        { value: 'history', label: 'ประวัติที่จบแล้ว', count: borrowHistoryRows.length }
      ]}
    />
    <section className="card">
      <DataTable
        rows={visibleBorrowRows}
        columns={[
          { key: 'request_no', label: 'เลขที่ใบยืม' },
          { key: 'asset_id', label: 'Asset ID' },
          accountingAssetColumn(assets),
          { key: 'borrower', label: 'ผู้ยืม' },
          { key: 'borrow_date', label: 'วันที่ยืม', render: (row) => dateText(row.borrow_date) },
          { key: 'due_date', label: 'กำหนดคืน', render: (row) => dateText(row.due_date) },
          { key: 'return_date', label: 'คืนจริง', render: (row) => dateText(row.return_date) },
          { key: 'return_location', label: 'ตำแหน่งรับคืน' },
          { key: 'received_by', label: 'ผู้รับคืน' },
          { key: 'status', label: 'สถานะ', render: (row) => <Badge value={row.status} /> }
        ]}
        searchText={(row) => accountingAssetSearchText(assets, row)}
        actions={(row) => {
          const ownBorrow = String(row.borrower || '') === user.name || String(row.borrower || '') === user.id;
          const asset = assets.find((item) => item.id === row.asset_id);
          return <div className="photo-action-group">
            <AssetPhotoButton asset={asset} assetId={row.asset_id} />
            {row.has_return_image && <ProtectedPhotoButton source={row.return_image_url || `/api/borrow-records/${row.id}/return-image`} title={`รูปคืนทรัพย์สิน ${row.request_no}`} label="รูปตอนคืน" compact={false} />}
            {user.role === 'VIEW' && ownBorrow && row.status === 'APPROVED' && <button className="table-button" onClick={() => void confirmReturnRequest(row)}><RotateCcw size={15} />ยืนยันคืน</button>}
            {canReturn && ['APPROVED', 'RETURN_REQUESTED'].includes(row.status) && <button className="table-button" onClick={() => setReturning(row)}><RotateCcw size={15} />รับคืน</button>}
          </div>;
        }}
        onEdit={canEdit ? (row) => { setEditing(row); setOpen(true); } : undefined}
        onDelete={canDelete ? remove : undefined}
      />
    </section>
    <Modal open={open} title={editing ? 'แก้ไขรายการยืม' : 'สร้างคำขอยืม'} onClose={() => { setOpen(false); setEditing(null); }}>
      <EntityForm
        fields={editing ? fields.filter((field) => field.key !== 'assetId') : fields}
        initial={initial}
        beforeFields={editing ? <AssetSelectionPreview asset={assets.find((asset) => asset.id === editing.asset_id) || null} /> : undefined}
        fieldAddon={(field, value) => field.key === 'assetId'
          ? <AssetSelectionPreview asset={assets.find((asset) => asset.id === String(value || '')) || null} />
          : null}
        onSubmit={save}
        onCancel={() => { setOpen(false); setEditing(null); }}
      />
    </Modal>
    <Modal open={Boolean(returning)} title={`รับคืน ${returning?.request_no || ''}`} onClose={() => setReturning(null)}>
      {returning && <ReturnAssetForm
        record={returning}
        asset={returningAsset}
        receiverChoices={receiverChoices}
        returnLocationChoices={returnLocationChoices}
        defaultReceiver={user.name}
        onSubmit={returnAsset}
        onCancel={() => setReturning(null)}
      />}
    </Modal>
  </>;
}
function ReturnAssetForm({
  record,
  asset,
  receiverChoices,
  returnLocationChoices,
  defaultReceiver,
  onSubmit,
  onCancel
}: {
  record: any;
  asset?: Asset;
  receiverChoices: SelectOption[];
  returnLocationChoices: SelectOption[];
  defaultReceiver: string;
  onSubmit: (values: any) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<any>({
    returnDate: bangkokToday(),
    conditionIn: 100,
    receivedBy: defaultReceiver,
    returnLocation: record?.original_location || asset?.location || '',
    nextStatus: 'IN_STOCK',
    note: ''
  });
  const requiredReturnItems = (asset?.items || []).filter((item: any) => item.required);
  const [returnedItemNames, setReturnedItemNames] = useState<string[]>(() => requiredReturnItems.map((item: any) => String(item.name)));
  const missingItemNames = requiredReturnItems.map((item: any) => String(item.name)).filter((name: string) => !returnedItemNames.includes(name));
  const effectiveNextStatus = missingItemNames.length > 0 || Number(form.conditionIn || 0) < 70 ? 'IN_REPAIR' : form.nextStatus;
  const [returnImageData, setReturnImageData] = useState('');
  const [returnImageName, setReturnImageName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function setField(key: string, value: any) {
    setForm((current: any) => ({ ...current, [key]: value }));
  }

  function chooseReturnImage(file?: File) {
    setError('');
    if (!file) return;
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('รูปตอนคืนต้องเป็นไฟล์ JPG, PNG หรือ WEBP เท่านั้น');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('ขนาดรูปตอนคืนต้องไม่เกิน 5 MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setReturnImageData(String(reader.result || ''));
      setReturnImageName(file.name || `return-${record?.asset_id || 'asset'}.jpg`);
    };
    reader.onerror = () => setError('ไม่สามารถอ่านไฟล์รูปตอนคืนได้');
    reader.readAsDataURL(file);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (!returnImageData) throw new Error('กรุณาถ่ายรูปหรือเลือกรูปทรัพย์สินตอนคืนก่อนบันทึกรับคืน');
      if (!form.returnDate) throw new Error('กรุณาเลือกวันที่คืน');
      if (!String(form.receivedBy || '').trim()) throw new Error('กรุณาระบุผู้รับคืน');
      if (!String(form.returnLocation || '').trim()) throw new Error('กรุณาระบุตำแหน่งรับคืน');
      await onSubmit({
        ...form,
        nextStatus: effectiveNextStatus,
        returnedItems: returnedItemNames,
        missingItems: missingItemNames,
        returnImageData,
        returnImageName
      });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'บันทึกรับคืนไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return <form className="entity-form" onSubmit={submit}>
    {error && <div className="alert error">{error}</div>}
    <AssetSelectionPreview asset={asset || null} emptyMessage="ไม่พบข้อมูลทรัพย์สินของรายการรับคืนนี้" />
    <div className="form-grid">
      <label><span>วันที่คืน *</span><DatePickerInput required value={form.returnDate} onChange={(value) => setField('returnDate', value)} /></label>
      <label><span>สภาพเมื่อคืน (%) *</span><input required type="number" min="0" max="100" value={form.conditionIn} onChange={(event) => setField('conditionIn', event.target.value === '' ? '' : event.target.valueAsNumber)} /></label>
      <label><span>ผู้รับคืน *</span>{receiverChoices.length ? <CompactSelect required searchable value={form.receivedBy} onChange={(value) => setField('receivedBy', value)} options={receiverChoices} searchPlaceholder="ค้นหาผู้รับคืน" /> : <input required value={form.receivedBy} onChange={(event) => setField('receivedBy', event.target.value)} />}</label>
      <label><span>ตำแหน่งรับคืน *</span>{returnLocationChoices.length ? <CompactSelect required searchable value={form.returnLocation} onChange={(value) => setField('returnLocation', value)} options={returnLocationChoices} searchPlaceholder="ค้นหาตำแหน่งรับคืน" /> : <input required value={form.returnLocation} onChange={(event) => setField('returnLocation', event.target.value)} />}</label>
      <label><span>สถานะหลังรับคืน *</span><CompactSelect required value={effectiveNextStatus} onChange={(value) => setField('nextStatus', value)} searchable={false} options={[
        { value: 'IN_STOCK', label: 'เก็บเข้าคลัง / รอจัดสรร' },
        { value: 'ACTIVE', label: 'คืนให้ผู้รับผิดชอบเดิม' },
        { value: 'IN_REPAIR', label: 'ส่งซ่อม' }
      ]} /></label>
      {requiredReturnItems.length > 0 && <div className="span-2">
        <strong>ตรวจรายการย่อย / Box set ที่ต้องคืน</strong>
        <div className="return-items-checklist">
          {requiredReturnItems.map((item: any) => {
            const name = String(item.name || '');
            const checked = returnedItemNames.includes(name);
            return <label key={`${item.id || name}`} className="return-item-check">
              <input type="checkbox" checked={checked} onChange={() => setReturnedItemNames((current) => checked ? current.filter((value) => value !== name) : [...current, name])} />
              <span><strong>{name}</strong>{item.brand ? ` · ${item.brand}` : ''}{item.quantity ? ` × ${item.quantity}` : ''}</span>
            </label>;
          })}
        </div>
        {missingItemNames.length > 0 && <div className="alert warning">ของในชุดคืนไม่ครบ: {missingItemNames.join(', ')} · ระบบจะส่ง Asset เข้า Maintenance อัตโนมัติ</div>}
      </div>}
      {Number(form.conditionIn || 0) < 70 && <div className="alert warning span-2">สภาพเมื่อคืนต่ำกว่า 70% ระบบจะส่ง Asset เข้า Maintenance อัตโนมัติ</div>}
      <div className="return-photo-upload">
        <div className="return-photo-upload-header">
          <div><strong>รูปทรัพย์สินตอนคืน *</strong><span>ต้องแนบรูปทุกครั้งที่รับคืน รองรับ JPG, PNG, WEBP ไม่เกิน 5 MB</span></div>
          {returnImageData && <button type="button" className="secondary" onClick={() => { setReturnImageData(''); setReturnImageName(''); }}><X size={15} />เลือกรูปใหม่</button>}
        </div>
        <input id={`return-photo-${record?.id || 'new'}`} className="return-photo-input" type="file" accept="image/jpeg,image/png,image/webp" capture="environment" onChange={(event) => chooseReturnImage(event.target.files?.[0])} />
        <label className="return-photo-picker" htmlFor={`return-photo-${record?.id || 'new'}`}><Camera size={17} />ถ่ายรูป / เลือกรูปจากเครื่อง</label>
        <div className="return-photo-preview">
          {returnImageData ? <img src={returnImageData} alt="รูปทรัพย์สินตอนคืน" /> : <div className="return-photo-preview-empty"><Camera size={34} /><strong>ยังไม่ได้ถ่ายรูปตอนคืน</strong><span>บนโทรศัพท์สามารถกดปุ่มด้านบนเพื่อเปิดกล้องได้</span></div>}
        </div>
        {returnImageName && <div className="return-photo-file-name">ไฟล์: {returnImageName}</div>}
      </div>
      <label className="span-2"><span>หมายเหตุ / ความเสียหาย</span><textarea value={form.note} onChange={(event) => setField('note', event.target.value)} /></label>
    </div>
    <footer className="form-footer"><button type="button" className="secondary" onClick={onCancel}>ยกเลิก</button><button className="primary" disabled={busy}><Check size={17} />{busy ? 'กำลังบันทึก...' : 'บันทึกรับคืนพร้อมรูป'}</button></footer>
  </form>;
}

function isMaintenanceEmployee(employee: Employee, department: string) {
  return operationsDepartment(`${employee.department || ''} ${employee.position || ''}`) === department;
}

function maintenancePriorityLabel(value: string) {
  const labels: Record<string, string> = { LOW: 'ต่ำ', NORMAL: 'ปกติ', HIGH: 'สูง', URGENT: 'เร่งด่วน' };
  return labels[String(value || '').toUpperCase()] || value || '-';
}

function MaintenanceTicketForm({
  initial,
  editing,
  assets,
  employees,
  masterData,
  user,
  onSubmit,
  onCancel
}: {
  initial: any;
  editing: any;
  assets: Asset[];
  employees: Employee[];
  masterData: MasterDataMap;
  user: User;
  onSubmit: (values: any) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<any>({
    assetId: '', serviceDepartment: 'IT', issue: '', priority: 'NORMAL', technician: '', estimatedCost: '',
    diagnosis: '', repairMethod: '', repairMethodOther: '', vendor: '', vendorOther: '',
    openedDate: bangkokToday(), note: '',
    ...initial
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const availableAssets = assets.filter((asset) => !['DISPOSED', 'SOLD', 'LOST', 'BORROWED', 'IN_REPAIR'].includes(asset.status));
  const selectedAsset = assets.find((asset) => asset.id === (form.assetId || editing?.asset_id));
  const serviceDepartment = ['IT', 'GA'].includes(String(form.serviceDepartment || '').toUpperCase())
    ? String(form.serviceDepartment).toUpperCase()
    : 'IT';
  const vendorMasterOptions = masterOptions(masterData, 'vendor', selectedAsset?.company || '', {
    valueMode: 'name',
    currentValue: form.vendor === '__OTHER__' ? '' : form.vendor
  });
  const vendorOptions = vendorMasterOptions.length
    ? [...vendorMasterOptions, { value: '__OTHER__', label: 'อื่นๆ / ไม่พบในรายชื่อ' }]
    : [];
  const technicianOptions = employees
    .filter((employee) => employee.status === 'ACTIVE' && isMaintenanceEmployee(employee, serviceDepartment) && (!selectedAsset || employee.company === selectedAsset.company))
    .map((employee) => ({
      value: employee.name,
      label: `${employee.name} · ${employee.department || serviceDepartment} (${employee.id})`,
      keywords: [employee.position, employee.email].filter(Boolean).join(' ')
    }));
  const currentTechnician = String(form.technician || '').trim();
  if (currentTechnician && !technicianOptions.some((option) => option.value === currentTechnician)) {
    technicianOptions.unshift({ value: currentTechnician, label: `${currentTechnician} · ข้อมูลเดิม`, keywords: '' });
  }

  function setField(key: string, value: any) {
    setForm((current: any) => {
      if (key === 'assetId') {
        const asset = assets.find((row) => row.id === value);
        const owner = ['IT', 'GA'].includes(String(asset?.responsibleDepartment || '').toUpperCase())
          ? String(asset?.responsibleDepartment).toUpperCase()
          : 'IT';
        return { ...current, assetId: value, serviceDepartment: owner, technician: '', vendor: '', vendorOther: '' };
      }
      const next = { ...current, [key]: value };
      if (key === 'serviceDepartment') next.technician = '';
      if (key === 'repairMethod' && value !== 'OTHER') next.repairMethodOther = '';
      if (key === 'vendor' && value !== '__OTHER__') next.vendorOther = '';
      return next;
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (!editing && !form.assetId) throw new Error('กรุณาเลือกทรัพย์สิน');
      if (!String(form.issue || '').trim()) throw new Error('กรุณาระบุอาการหรือปัญหา');
      if (editing && String(form.repairMethod || '').toUpperCase() === 'OTHER' && !String(form.repairMethodOther || '').trim()) {
        throw new Error('กรุณาระบุวิธีดำเนินการอื่นๆ');
      }
      const payload = { ...form };
      if (payload.vendor === '__OTHER__') {
        if (!String(payload.vendorOther || '').trim()) throw new Error('กรุณาระบุ Vendor / ศูนย์บริการ');
        payload.vendor = String(payload.vendorOther).trim();
      }
      delete payload.vendorOther;
      await onSubmit(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'บันทึก Ticket ซ่อมไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  const manager = ['ADMIN', 'SUPERVISOR'].includes(user.role);
  const singleTechnician = technicianOptions.length === 1 ? technicianOptions[0] : null;
  return <form className="entity-form" onSubmit={submit}>
    {error && <div className="alert error">{error}</div>}
    {!editing && <div className="maintenance-flow-note">
      <strong>แจ้งปัญหาก่อน — ยังไม่ต้องทราบราคาซ่อม</strong>
      <span>{singleTechnician ? `ระบบจะมอบหมายให้ ${singleTechnician.label} อัตโนมัติ` : `หลังเปิด Ticket ทีม ${serviceDepartment} จะรับงานและมอบหมายผู้รับผิดชอบ`}</span>
      <span>เลือก IT สำหรับคอมพิวเตอร์/ระบบ หรือ GA สำหรับอาคาร สถานที่ และอุปกรณ์สำนักงาน</span>
    </div>}
    <div className="form-grid">
      {!editing ? <AssetSelectField assets={availableAssets} value={form.assetId || ''} label="เลือกทรัพย์สิน" onChange={(value) => setField('assetId', value)} /> : <AssetSelectionPreview asset={selectedAsset || null} />}
      <label><span>ส่งงานให้ *</span><CompactSelect required disabled={Boolean(editing) && user.role !== 'ADMIN'} value={serviceDepartment} searchable={false} options={[{value:'IT',label:'IT · คอมพิวเตอร์ ระบบ และเครือข่าย'},{value:'GA',label:'GA · อาคาร สถานที่ และอุปกรณ์สำนักงาน'}]} onChange={(value) => setField('serviceDepartment', value)} />{editing && user.role !== 'ADMIN' && <small className="field-help">ทีมผู้รับผิดชอบถูกกำหนดตอนเปิด Ticket หากต้องเปลี่ยนทีมให้ Admin ดำเนินการ</small>}</label>
      <label className="span-2"><span>อาการ / รายละเอียด *</span><textarea required value={form.issue || ''} onChange={(event) => setField('issue', event.target.value)} placeholder="อธิบายอาการที่พบ เช่น เปิดไม่ติด หน้าจอกะพริบ หรือใช้งานช้าผิดปกติ" /></label>
      <label><span>ระดับความเร่งด่วน *</span><CompactSelect value={form.priority || 'NORMAL'} options={[{value:'LOW',label:'ต่ำ'},{value:'NORMAL',label:'ปกติ'},{value:'HIGH',label:'สูง'},{value:'URGENT',label:'เร่งด่วน'}]} onChange={(value) => setField('priority', value || 'NORMAL')} /></label>
      <label><span>{editing ? 'วันที่เปิดงาน' : 'วันที่แจ้ง'} *</span><DatePickerInput required value={form.openedDate || ''} onChange={(value) => setField('openedDate', value)} /></label>

      {manager && editing && <>
        <label><span>ผู้รับผิดชอบ ({serviceDepartment})</span>{singleTechnician && !currentTechnician
          ? <div className="maintenance-readonly-value">{singleTechnician.label}<small>ระบบจะมอบหมายอัตโนมัติเมื่อบันทึก</small></div>
          : technicianOptions.length
            ? <CompactSelect searchable value={form.technician || ''} options={technicianOptions} onChange={(value) => setField('technician', value)} searchPlaceholder={`ค้นหาผู้รับผิดชอบ ${serviceDepartment}`} />
            : <div className="maintenance-readonly-value warning">ยังไม่พบพนักงาน {serviceDepartment} ที่ Active ในบริษัทนี้</div>}</label>
        <label><span>ค่าใช้จ่ายประมาณการ</span><input type="number" min="0" step="0.01" placeholder="ยังไม่ประเมิน" value={form.estimatedCost ?? ''} onChange={(event) => setField('estimatedCost', event.target.value === '' ? '' : event.target.valueAsNumber)} /></label>
        <label className="span-2"><span>ผลตรวจสอบ / สาเหตุ</span><textarea value={form.diagnosis || ''} onChange={(event) => setField('diagnosis', event.target.value)} placeholder={`บันทึกผลการตรวจสอบของ ${serviceDepartment}`} /></label>
        <label><span>วิธีดำเนินการ</span><CompactSelect value={form.repairMethod || ''} placeholder="-- ยังไม่ระบุ --" options={[{value:'INTERNAL',label:`ดำเนินการภายในโดย ${serviceDepartment}`},{value:'VENDOR',label:'ส่ง Vendor / ศูนย์บริการ'},{value:'WARRANTY',label:'เคลมประกัน'},{value:'REPLACE',label:'เปลี่ยนอุปกรณ์ / ทดแทน'},{value:'OTHER',label:'อื่นๆ'}]} onChange={(value) => setField('repairMethod', value)} /></label>
        {form.repairMethod === 'OTHER' && <label><span>ระบุวิธีดำเนินการอื่นๆ *</span><input required value={form.repairMethodOther || ''} onChange={(event) => setField('repairMethodOther', event.target.value)} placeholder="ระบุวิธีดำเนินการ" /></label>}
        {['VENDOR','WARRANTY'].includes(form.repairMethod) && <label><span>Vendor / ศูนย์บริการ</span>{vendorOptions.length
          ? <CompactSelect searchable value={form.vendor || ''} options={vendorOptions} onChange={(value) => setField('vendor', value)} searchPlaceholder="ค้นหา Vendor / ศูนย์บริการ" />
          : <input value={form.vendor || ''} onChange={(event) => setField('vendor', event.target.value)} placeholder="ชื่อบริษัทหรือศูนย์บริการ" />}</label>}
        {['VENDOR','WARRANTY'].includes(form.repairMethod) && form.vendor === '__OTHER__' && <label><span>ระบุ Vendor / ศูนย์บริการ *</span><input required value={form.vendorOther || ''} onChange={(event) => setField('vendorOther', event.target.value)} placeholder="ชื่อบริษัทหรือศูนย์บริการ" /></label>}
      </>}
      <label className="span-2"><span>{editing ? 'หมายเหตุ / การดำเนินงาน' : 'หมายเหตุเพิ่มเติม'}</span><textarea value={form.note || ''} onChange={(event) => setField('note', event.target.value)} /></label>
    </div>
    <footer className="form-footer"><button type="button" className="secondary" disabled={busy} onClick={onCancel}>ยกเลิก</button><button className="primary" disabled={busy}>{busy ? 'กำลังบันทึก...' : editing ? 'บันทึกการประเมิน' : 'ส่งแจ้งซ่อม'}</button></footer>
  </form>;
}

function MaintenancePage({assets,employees,masterData,onReload,user,canManage,canEdit,canDelete,canExport}:{assets:Asset[];employees:Employee[];masterData:MasterDataMap;onReload:()=>Promise<void>;user:User;canManage:boolean;canEdit:boolean;canDelete:boolean;canExport:boolean}) {
  const state = useList('/api/maintenance');
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [closing, setClosing] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<'open'|'closed'>('open');
  const currentDepartment = user.role === 'ADMIN' ? '' : operationsDepartment(`${user.department || ''} ${user.position || ''}`);
  const openMaintenanceRows = state.rows.filter((row) => String(row.status || '').toUpperCase() !== 'CLOSED');
  const closedMaintenanceRows = state.rows.filter((row) => String(row.status || '').toUpperCase() === 'CLOSED');
  const visibleMaintenanceRows = activeTab === 'open' ? openMaintenanceRows : closedMaintenanceRows;
  const canManageTicket = (row: any) => canManage && canEdit && (user.role === 'ADMIN' || (row.service_department || 'IT') === currentDepartment);

  async function save(values: any) {
    if (editing) await put(`/api/maintenance/${editing.id}`, values);
    else await post('/api/maintenance', values);
    setOpen(false);
    setEditing(null);
    await Promise.all([state.load(), onReload()]);
  }
  async function removeTicket(row: any) {
    if (!confirm(`ลบ Ticket ${row.ticket_no} ใช่หรือไม่?`)) return;
    await del(`/api/maintenance/${row.id}`);
    await Promise.all([state.load(), onReload()]);
  }
  async function close(values: any) {
    await post(`/api/maintenance/${closing.id}/close`, values);
    setClosing(null);
    await Promise.all([state.load(), onReload()]);
  }

  const closingDepartment = closing?.service_department || 'IT';
  const closingTechnicians = employees
    .filter((employee) => employee.status === 'ACTIVE' && isMaintenanceEmployee(employee, closingDepartment) && (!closing?.company_code || employee.company === closing.company_code))
    .map((employee) => ({ value: employee.name, label: `${employee.name} · ${employee.department || closingDepartment} (${employee.id})` }));
  if (closing?.technician && !closingTechnicians.some((option) => option.value === closing.technician)) {
    closingTechnicians.unshift({ value: closing.technician, label: `${closing.technician} · ข้อมูลเดิม` });
  }
  const defaultClosingTechnician = closing?.technician || ((closingTechnicians.length === 1 && !closingTechnicians[0].label.includes('ข้อมูลเดิม')) ? closingTechnicians[0].value : '');
  const defaultNewDepartment = ['IT', 'GA'].includes(currentDepartment) ? currentDepartment : 'IT';
  const formInitial = editing ? {
    assetId: editing.asset_id,
    serviceDepartment: editing.service_department || 'IT',
    issue: editing.issue,
    priority: editing.priority || 'NORMAL',
    technician: editing.technician,
    estimatedCost: editing.estimated_cost ?? '',
    diagnosis: editing.diagnosis || '',
    repairMethod: editing.repair_method || '',
    repairMethodOther: editing.repair_method_other || '',
    vendor: editing.vendor || '',
    openedDate: editing.opened_date,
    note: editing.note
  } : { openedDate: bangkokToday(), priority: 'NORMAL', serviceDepartment: defaultNewDepartment };

  return <>
    <PageHeader
      title="แจ้งซ่อมและติดตามงาน"
      description="เลือกส่งงานให้ IT หรือ GA ให้ตรงประเภทปัญหา ระบบจะแสดงงานแก่หน่วยงานผู้รับผิดชอบตั้งแต่รับเรื่องจนปิด Ticket"
      actionLabel="แจ้งทรัพย์สินเสีย"
      onAction={() => { setEditing(null); setOpen(true); }}
    >
      {canExport && <ReportExportButton kind="maintenance" filename="asset-maintenance" />}
    </PageHeader>
    <ModuleState error={state.error} loading={state.loading} />
    <SectionTabs value={activeTab} onChange={(value) => setActiveTab(value as 'open' | 'closed')} ariaLabel="สถานะงานซ่อมบำรุง" items={[{value:'open',label:'งานที่กำลังดำเนินการ',count:openMaintenanceRows.length},{value:'closed',label:'งานที่ปิดแล้ว',count:closedMaintenanceRows.length}]} />
    <section className="card">
      <DataTable
        rows={visibleMaintenanceRows}
        searchText={(row) => `${accountingAssetSearchText(assets, row)} ${row.service_department || 'IT'}`}
        columns={[
          {key:'ticket_no',label:'Ticket'},
          {key:'asset_id',label:'Asset ID'},
          accountingAssetColumn(assets),
          {key:'service_department',label:'ส่งให้',render:(row) => <Badge value={row.service_department || 'IT'} />},
          {key:'issue',label:'อาการ / ปัญหา'},
          {key:'priority',label:'ความเร่งด่วน',render:(row) => maintenancePriorityLabel(row.priority)},
          {key:'technician',label:'ผู้รับผิดชอบ',render:(row) => row.technician || 'ยังไม่มอบหมาย'},
          {key:'estimated_cost',label:'ประมาณการ',render:(row) => row.estimated_cost == null ? 'ยังไม่ประเมิน' : money(row.estimated_cost)},
          {key:'cost',label:'ค่าใช้จ่ายจริง',render:(row) => row.status === 'CLOSED' ? money(row.cost) : '-'},
          {key:'status',label:'สถานะ',render:(row) => <Badge value={row.status} />},
          {key:'opened_date',label:'วันที่แจ้ง',render:(row) => dateText(row.opened_date)},
          {key:'closed_date',label:'วันที่ปิด',render:(row) => dateText(row.closed_date)}
        ]}
        actions={(row) => <>
          <AssetPhotoButton asset={assets.find((asset) => asset.id === row.asset_id)} assetId={row.asset_id} />
          {canManageTicket(row) && row.status !== 'CLOSED' && <button className="table-button" onClick={() => { setEditing(row); setOpen(true); }}>รับงาน / ประเมิน</button>}
          {canManageTicket(row) && row.status !== 'CLOSED' && <button className="table-button" onClick={() => setClosing(row)}><Check size={15} />ปิดงาน</button>}
        </>}
        onDelete={canDelete ? removeTicket : undefined}
      />
    </section>
    <Modal open={open} title={editing ? 'รับงาน / ประเมิน Ticket ซ่อม' : 'เปิด Ticket ซ่อม'} onClose={() => { setOpen(false); setEditing(null); }} wide>
      <MaintenanceTicketForm key={editing?.id || 'new'} initial={formInitial} editing={editing} assets={assets} employees={employees} masterData={masterData} user={user} onSubmit={save} onCancel={() => { setOpen(false); setEditing(null); }} />
    </Modal>
    <Modal open={Boolean(closing)} title={`ปิดงาน ${closing?.ticket_no || ''}`} onClose={() => setClosing(null)}>
      <EntityForm
        beforeFields={<AssetSelectionPreview asset={assets.find((asset) => asset.id === closing?.asset_id) || null} />}
        fields={[
          {key:'technician',label:`ผู้ดำเนินการ (${closingDepartment})`,type:closingTechnicians.length?'select':'text',options:closingTechnicians,required:true},
          {key:'closedDate',label:'วันที่ปิดงาน',type:'date',required:true},
          {key:'cost',label:'ค่าใช้จ่ายจริง',type:'number',min:0},
          {key:'note',label:'ผลการซ่อม / หมายเหตุ',type:'textarea'}
        ]}
        initial={{technician:defaultClosingTechnician,closedDate:bangkokToday(),cost:closing?.estimated_cost??closing?.cost??'',note:closing?.note}}
        onSubmit={close}
        onCancel={() => setClosing(null)}
      />
    </Modal>
  </>;
}

function DepreciationPage({assets}:{assets:Asset[]}){
  const state=useList('/api/depreciation');
  const exportColumns:ExcelColumn[]=[
    {key:'asset_id',header:'Asset ID',width:20},
    {key:'accounting_asset_id',header:'Asset ID สำหรับบัญชี',width:22},
    {key:'name',header:'ชื่อทรัพย์สิน',width:28},
    {key:'company_code',header:'บริษัท',width:16},
    {key:'purchase_date',header:'วันที่ซื้อ',width:15,type:'date'},
    {key:'purchase_price',header:'ราคาซื้อ',width:17,type:'currency'},
    {key:'useful_life_years',header:'อายุใช้งาน (ปี)',width:16,type:'number'},
    {key:'annual_depreciation',header:'ค่าเสื่อมราคา / ปี',width:19,type:'currency'},
    {key:'accumulated_depreciation',header:'ค่าเสื่อมสะสม',width:19,type:'currency'},
    {key:'book_value',header:'มูลค่าคงเหลือ',width:19,type:'currency'},
    {key:'as_of',header:'คำนวณ ณ วันที่',width:16,type:'date'}
  ];
  function exportExcel(){
    downloadXlsx(`asset-depreciation-${bangkokToday()}.xlsx`,'ค่าเสื่อมราคา',exportColumns,state.rows);
  }
  return <><PageHeader title="ค่าเสื่อมราคา" description="คำนวณแบบเส้นตรงจากราคาซื้อ อายุใช้งาน และมูลค่าซาก"><button className="secondary" onClick={exportExcel}><Download size={16}/>Export Excel</button></PageHeader><ModuleState error={state.error} loading={state.loading}/><section className="card"><DataTable rows={state.rows} columns={[{key:'asset_id',label:'Asset ID'},{key:'accounting_asset_id',label:'Asset ID บัญชี',render:r=>r.accounting_asset_id||'-'},{key:'name',label:'ทรัพย์สิน'},{key:'company_code',label:'บริษัท'},{key:'purchase_date',label:'วันที่ซื้อ',render:r=>dateText(r.purchase_date)},{key:'purchase_price',label:'ราคาซื้อ',render:r=>money(r.purchase_price)},{key:'useful_life_years',label:'อายุใช้งาน (ปี)'},{key:'annual_depreciation',label:'ค่าเสื่อม/ปี',render:r=>money(r.annual_depreciation)},{key:'accumulated_depreciation',label:'ค่าเสื่อมสะสม',render:r=>money(r.accumulated_depreciation)},{key:'book_value',label:'มูลค่าคงเหลือ',render:r=>money(r.book_value)}]} actions={r=><AssetPhotoButton asset={assets.find((asset)=>asset.id===r.asset_id)} assetId={r.asset_id}/>} /></section></>
}

function DisposalPage({assets,canEdit,canDelete}:{assets:Asset[];canEdit:boolean;canDelete:boolean}){
  const state=useList('/api/disposals');
  const [open,setOpen]=useState(false);
  const [editing,setEditing]=useState<any>(null);
  const [activeTab,setActiveTab]=useState<'pending'|'history'>('pending');
  const pendingDisposalRows=state.rows.filter((row)=>String(row.status||'').toUpperCase()==='PENDING');
  const disposalHistoryRows=state.rows.filter((row)=>String(row.status||'').toUpperCase()!=='PENDING');
  const visibleDisposalRows=activeTab==='pending'?pendingDisposalRows:disposalHistoryRows;
  const eligibleAssets=assets.filter((asset)=>!['DISPOSED','SOLD','BORROWED','IN_REPAIR'].includes(asset.status));
  const fields:Field[]=[
    {key:'assetId',label:'เลือกทรัพย์สิน',type:'select',required:true,fullWidth:true,options:eligibleAssets.map((asset)=>({value:asset.id,label:assetOptionLabel(asset),keywords:assetOptionKeywords(asset)}))},
    {key:'reason',label:'เหตุผล',type:'textarea',required:true},
    {key:'disposalMethod',label:'วิธีตัดจำหน่าย',type:'select',options:[{value:'SCRAP',label:'ทำลาย / Scrap'},{value:'SELL',label:'ขาย'},{value:'DONATE',label:'บริจาค'},{value:'RETURN_VENDOR',label:'คืนผู้ขาย'},{value:'OTHER',label:'อื่นๆ'}]},
    {key:'estimatedValue',label:'มูลค่าประมาณ',type:'number',min:0},
    {key:'disposalDate',label:'วันที่เสนอ',type:'date',required:true},
    {key:'note',label:'หมายเหตุ',type:'textarea'}
  ];
  async function save(v:any){if(String(v.disposalMethod||'').toUpperCase()==='OTHER'&&!String(v.disposalMethodOther||'').trim())throw new Error('กรุณาระบุวิธีตัดจำหน่ายอื่นๆ');if(editing)await put(`/api/disposals/${editing.id}`,v);else await post('/api/disposals',v);setOpen(false);setEditing(null);await state.load()}
  async function remove(r:any){if(!confirm(`ลบคำขอ ${r.request_no} ใช่หรือไม่?`))return;await del(`/api/disposals/${r.id}`);await state.load()}
  const initial=editing?{reason:editing.reason,disposalMethod:editing.disposal_method,disposalMethodOther:editing.disposal_method_other||'',estimatedValue:editing.estimated_value,disposalDate:editing.disposal_date,note:editing.note}:{disposalMethod:'SCRAP',disposalMethodOther:'',disposalDate:bangkokToday(),estimatedValue:0};
  const editingAsset=assets.find((asset)=>asset.id===editing?.asset_id)||null;
  return <>
    <PageHeader title="ตัดจำหน่ายทรัพย์สิน" description="สร้าง แก้ไข ลบ และอนุมัติรายการตัดจำหน่าย" actionLabel="ขอตัดจำหน่าย" onAction={()=>setOpen(true)}/>
    <ModuleState error={state.error} loading={state.loading}/>
    <SectionTabs value={activeTab} onChange={(value)=>setActiveTab(value as 'pending'|'history')} ariaLabel="สถานะการตัดจำหน่าย" items={[{value:'pending',label:'รอดำเนินการ',count:pendingDisposalRows.length},{value:'history',label:'ดำเนินการแล้ว',count:disposalHistoryRows.length}]}/>
    <section className="card"><DataTable rows={visibleDisposalRows} searchText={(row)=>accountingAssetSearchText(assets,row)} columns={[{key:'request_no',label:'เลขที่คำขอ'},{key:'asset_id',label:'Asset ID'},accountingAssetColumn(assets),{key:'reason',label:'เหตุผล'},{key:'disposal_method',label:'วิธีดำเนินการ',render:r=>String(r.disposal_method||'').toUpperCase()==='OTHER'&&r.disposal_method_other?`อื่นๆ · ${r.disposal_method_other}`:r.disposal_method},{key:'estimated_value',label:'มูลค่าประมาณ',render:r=>money(r.estimated_value)},{key:'requested_by',label:'ผู้ขอ'},{key:'approved_by',label:'ผู้อนุมัติ'},{key:'status',label:'สถานะ',render:r=><Badge value={r.status}/>},{key:'disposal_date',label:'วันที่',render:r=>dateText(r.disposal_date)}]} actions={r=><AssetPhotoButton asset={assets.find((asset)=>asset.id===r.asset_id)} assetId={r.asset_id}/>} onEdit={canEdit?r=>{setEditing(r);setOpen(true)}:undefined} onDelete={canDelete?remove:undefined}/></section>
    <Modal open={open} title={editing?'แก้ไขคำขอตัดจำหน่าย':'สร้างคำขอตัดจำหน่าย'} onClose={()=>{setOpen(false);setEditing(null)}}>
      <EntityForm
        fields={editing?fields.filter((field)=>field.key!=='assetId'):fields}
        initial={initial}
        beforeFields={editing?<AssetSelectionPreview asset={editingAsset}/>:undefined}
        fieldAddon={(field,value,form,setField)=>field.key==='assetId'?<AssetSelectionPreview asset={eligibleAssets.find((asset)=>asset.id===String(value||''))||null}/>:field.key==='disposalMethod'&&String(value||'').toUpperCase()==='OTHER'?<label><span>ระบุวิธีตัดจำหน่ายอื่นๆ *</span><input required value={form.disposalMethodOther||''} onChange={(event)=>setField('disposalMethodOther',event.target.value)} placeholder="ระบุวิธีตัดจำหน่าย" /></label>:null}
        onSubmit={save}
        onCancel={()=>{setOpen(false);setEditing(null)}}
      />
    </Modal>
  </>
}

function ApprovalPage({assets,onReload,user,canAdmin}:{assets:Asset[];onReload:()=>Promise<void>;user:User;canAdmin:boolean}){
  const state=useList('/api/approvals');
  const [selected,setSelected]=useState<any>(null);
  const [detail,setDetail]=useState<any>(null);
  const [detailLoading,setDetailLoading]=useState(false);
  const [error,setError]=useState('');
  const [activeTab,setActiveTab]=useState<'pending'|'history'>('pending');
  const pendingApprovalRows=state.rows.filter((row)=>String(row.status||'').toUpperCase()==='PENDING');
  const approvalHistoryRows=state.rows.filter((row)=>String(row.status||'').toUpperCase()!=='PENDING');
  const visibleApprovalRows=activeTab==='pending'?pendingApprovalRows:approvalHistoryRows;
  async function openDetail(row:any){
    setSelected(row);setDetail(null);setDetailLoading(true);setError('');
    try{setDetail(await api(`/api/approvals/${row.id}/detail`))}
    catch(caught){setError(caught instanceof Error?caught.message:'โหลดรายละเอียดไม่สำเร็จ')}
    finally{setDetailLoading(false)}
  }
  function closeDetail(){setSelected(null);setDetail(null);setDetailLoading(false)}
  async function decide(decision:string,note=''){setError('');try{await post(`/api/approvals/${selected.id}/decision`,{decision,note});closeDetail();await Promise.all([state.load(),onReload()])}catch(caught){setError(caught instanceof Error?caught.message:'พิจารณารายการไม่สำเร็จ');throw caught}}
  function isOwnRequest(row:any){return (row.requester_employee_code&&row.requester_employee_code===user.id)||row.requester===user.name}
  function canDecide(row:any){return row?.status==='PENDING'&&(!isOwnRequest(row)||user.role==='ADMIN')}
  async function cancelApproval(row:any){if(!confirm(`ยกเลิก Workflow ${row.request_no} ใช่หรือไม่? รายการต้นทางจะเปลี่ยนเป็น CANCELLED`))return;setError('');try{await del(`/api/approvals/${row.id}`);await Promise.all([state.load(),onReload()])}catch(caught){setError(caught instanceof Error?caught.message:'ยกเลิก Workflow ไม่สำเร็จ')}}
  return <><PageHeader title="Approval Workflow" description="เปิดดูข้อมูลคำขอและทรัพย์สินให้ครบก่อน Approve / Reject"/><ModuleState error={state.error} loading={state.loading}/>{error&&<div className="alert error">{error}</div>}<SectionTabs value={activeTab} onChange={(value) => setActiveTab(value as 'pending' | 'history')} ariaLabel="สถานะ Approval Workflow" items={[{value:'pending',label:'รออนุมัติ',count:pendingApprovalRows.length},{value:'history',label:'ดำเนินการแล้ว',count:approvalHistoryRows.length}]}/><section className="card"><DataTable rows={visibleApprovalRows} columns={[{key:'request_no',label:'เลขที่คำขอ'},{key:'request_type',label:'ประเภท'},{key:'asset_id',label:'Asset ID',render:row=>row.asset_id||'-'},{key:'accounting_asset_id',label:'Asset ID บัญชี',render:row=>row.accounting_asset_id||'-'},{key:'requester',label:'ผู้ขอ'},{key:'approver',label:'ผู้อนุมัติ'},{key:'status',label:'สถานะ',render:row=><Badge value={row.status}/>},{key:'requested_at',label:'วันที่ขอ',render:row=>dateText(row.requested_at)},{key:'decided_at',label:'วันที่พิจารณา',render:row=>dateText(row.decided_at)}]} actions={row=><><button className="table-button" onClick={()=>void openDetail(row)}><Eye size={15}/>ดูรายละเอียด</button>{row.status==='PENDING'&&isOwnRequest(row)&&user.role!=='ADMIN'?<span className="muted">รายการของคุณ</span>:null}{canAdmin&&row.status==='PENDING'&&<button className="table-button danger" onClick={()=>void cancelApproval(row)}><X size={15}/>ยกเลิก</button>}</>} /></section><Modal open={!!selected} title={`รายละเอียด ${selected?.request_no||''}`} onClose={closeDetail} wide contentClassName="approval-modal-card">{detailLoading?<div className="loading-card">กำลังโหลดรายละเอียดคำขอ...</div>:detail?<ApprovalDetail detail={detail} assets={assets}/>:<div className="loading-card">ไม่พบรายละเอียดคำขอ</div>}{selected&&canDecide(selected)&&detail&&!detailLoading&&<DecisionForm onDecision={decide}/>}</Modal></>
}

function ApprovalDetail({detail,assets}:{detail:any;assets:Asset[]}){
  const approval=detail.approval||{};const request=detail.request||{};const asset=detail.asset||null;
  const fullAsset=asset?(assets.find((item)=>item.id===asset.id)||asset):null;
  const assetImageSource=fullAsset?.imageUrl||(fullAsset?.hasImage&&fullAsset?.id?`/api/assets/${encodeURIComponent(fullAsset.id)}/image`:'');
  const requestLabels:Record<string,string>={
    request_no:'เลขที่รายการ',asset_id:'Asset ID',from_location:'ตำแหน่งต้นทาง',to_location:'ตำแหน่งปลายทาง',from_department:'แผนกต้นทาง',to_department:'แผนกปลายทาง',from_assignee:'ผู้ถือครองเดิม',to_assignee:'ผู้ถือครองใหม่',requested_by:'ผู้ร้องขอ',transfer_date:'วันที่โอน',borrower:'ผู้ยืม',borrow_date:'วันที่ยืม',due_date:'กำหนดคืน',purpose:'วัตถุประสงค์',reason:'เหตุผล',disposal_method:'วิธีตัดจำหน่าย',disposal_method_other:'รายละเอียดวิธีตัดจำหน่ายอื่นๆ',estimated_value:'มูลค่าประมาณ',disposal_date:'วันที่เสนอ',note:'หมายเหตุ',status:'สถานะรายการ'
  };
  const requestEntries=Object.entries(request).filter(([key,value])=>requestLabels[key]&&value!==null&&value!==undefined&&String(value)!=='');
  return <div className="approval-detail">
    {fullAsset&&<section className="approval-asset-photo-section span-2">
      <div className="approval-asset-photo-stage">
        <AuthenticatedImage
          source={assetImageSource}
          className="approval-asset-photo-image"
          alt={fullAsset.name||fullAsset.id||'รูปทรัพย์สิน'}
          fallback={<div className="approval-asset-photo-empty"><ImageIcon size={40}/><strong>ยังไม่มีรูปทรัพย์สิน</strong></div>}
        />
      </div>
      <div className="approval-asset-photo-summary">
        <div><span>Asset ID</span><strong>{fullAsset.id||'-'}</strong></div>
        <div><span>Asset ID บัญชี</span><strong>{fullAsset.accountingAssetId||'-'}</strong></div>
        <div><span>ชื่อทรัพย์สิน</span><strong>{fullAsset.name||'-'}</strong></div>
        <div><span>สถานะ</span><strong><Badge value={fullAsset.status||''}/></strong></div>
      </div>
    </section>}
    <section><h4>ข้อมูลการอนุมัติ</h4><dl><dt>เลขที่คำขอ</dt><dd>{approval.request_no||'-'}</dd><dt>ประเภท</dt><dd>{approval.request_type||'-'}</dd><dt>ผู้ร้องขอ</dt><dd>{approval.requester||'-'}{approval.requester_employee_code?` (${approval.requester_employee_code})`:''}</dd><dt>บริษัท</dt><dd>{approval.company_code||'-'}</dd><dt>วันที่ร้องขอ</dt><dd>{dateText(approval.requested_at)}</dd><dt>สถานะ</dt><dd><Badge value={approval.status||''}/></dd>{approval.approver&&<><dt>ผู้พิจารณา</dt><dd>{approval.approver}</dd></>}{approval.decided_at&&<><dt>วันที่พิจารณา</dt><dd>{dateText(approval.decided_at)}</dd></>}{approval.note&&<><dt>หมายเหตุการพิจารณา</dt><dd>{approval.note}</dd></>}</dl></section>
    {asset&&<section><div className="approval-asset-heading"><h4>ข้อมูลทรัพย์สิน</h4><AssetPhotoButton asset={fullAsset} assetId={asset.id} compact={false}/></div><dl><dt>Asset ID</dt><dd>{asset.id}</dd><dt>Asset ID บัญชี</dt><dd>{fullAsset?.accountingAssetId||asset.accountingAssetId||'-'}</dd><dt>ชื่อทรัพย์สิน</dt><dd>{asset.name}</dd><dt>Serial</dt><dd>{asset.serial||'-'}</dd><dt>หมวด</dt><dd>{[asset.category,asset.subcategory].filter(Boolean).join(' / ')||'-'}</dd><dt>ผู้ถือครองปัจจุบัน</dt><dd>{asset.assignedTo||'ไม่มีผู้ถือครอง'}</dd><dt>แผนก</dt><dd>{asset.department||'-'}</dd><dt>ตำแหน่งปัจจุบัน</dt><dd>{asset.location||'-'}</dd><dt>สถานะ Asset</dt><dd><Badge value={asset.status||''}/></dd></dl></section>}
    <section className="span-2"><h4>รายละเอียดรายการที่ขอ</h4>{requestEntries.length?<dl className="approval-request-grid">{requestEntries.map(([key,value])=><Fragment key={key}><dt>{requestLabels[key]}</dt><dd>{key.includes('date')?dateText(value):key==='status'?<Badge value={String(value)}/>:['estimated_value'].includes(key)?money(value):String(value)}</dd></Fragment>)}</dl>:<p className="muted">ไม่พบรายละเอียดรายการต้นทาง</p>}</section>
  </div>
}

function DecisionForm({onDecision}:{onDecision:(d:string,n:string)=>Promise<void>}){
  const [note,setNote]=useState('');const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  async function go(d:string){setBusy(true);setError('');try{await onDecision(d,note)}catch(err:any){setError(err.message||'ดำเนินการไม่สำเร็จ')}finally{setBusy(false)}}
  return <div className="decision-form approval-decision">{error&&<div className="alert error">{error}</div>}<label><span>หมายเหตุการพิจารณา</span><textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="ระบุเหตุผลหรือเงื่อนไขก่อนอนุมัติ / ไม่อนุมัติ"/></label><div className="decision-actions"><button className="danger-button" disabled={busy} onClick={()=>go('REJECTED')}><X size={17}/>Reject</button><button className="primary" disabled={busy} onClick={()=>go('APPROVED')}><Check size={17}/>Approve</button></div></div>
}


function AuditPage({canDelete}:{canDelete:boolean}){
  const state=useList('/api/audit-logs?limit=1000');
  const [selectedIds,setSelectedIds]=useState<string[]>([]);
  const [deleting,setDeleting]=useState(false);
  const [actionError,setActionError]=useState('');

  async function remove(r:any){
    if(!confirm('ลบ Audit Log รายการนี้ใช่หรือไม่?'))return;
    setActionError('');
    try{
      await del(`/api/audit-logs/${r.id}`);
      const deletedId=String(r.id);
      // Update the table immediately after the server confirms deletion.
      // Avoid a full /api/audit-logs reload here because that made the UI
      // look frozen while waiting for another large query to complete.
      state.setRows(current=>current.filter(item=>String(item.id)!==deletedId));
      setSelectedIds(current=>current.filter(id=>id!==deletedId));
    }catch(err:any){setActionError(err.message||'ลบ Audit Log ไม่สำเร็จ')}
  }

  async function removeSelected(){
    if(!selectedIds.length)return;
    if(!confirm(`ต้องการลบ Audit Log ที่เลือก ${selectedIds.length} รายการใช่หรือไม่?\nการลบไม่สามารถย้อนกลับได้`))return;
    setDeleting(true);setActionError('');
    const idsToDelete=selectedIds.map(id=>Number(id)).filter(Number.isInteger);
    const idSet=new Set(idsToDelete.map(String));
    try{
      const result=await post<{deleted:number}>('/api/audit-logs/bulk-delete',{ids:idsToDelete});
      state.setRows(current=>current.filter(item=>!idSet.has(String(item.id))));
      setSelectedIds([]);
      if(Number(result?.deleted||0)!==idsToDelete.length){
        setActionError(`ลบสำเร็จ ${Number(result?.deleted||0)} จาก ${idsToDelete.length} รายการ บางรายการอาจถูกลบไปก่อนแล้ว`);
      }
    }catch(err:any){setActionError(err.message||'ลบ Audit Log ที่เลือกไม่สำเร็จ')}
    finally{setDeleting(false)}
  }

  return <>
    <PageHeader title="Audit Log" description="บันทึกทุกการ Login, เพิ่ม, แก้ไข, ลบ, อนุมัติ และการเปลี่ยนแปลงข้อมูลสำคัญ"/>
    <ModuleState error={actionError||state.error} loading={state.loading}/>
    <section className="card">
      <DataTable
        rows={state.rows}
        columns={[
          {key:'created_at',label:'วันที่-เวลา',render:r=>new Date(r.created_at).toLocaleString('th-TH')},
          {key:'employee_code',label:'ผู้ทำรายการ'},
          {key:'company_code',label:'บริษัท'},
          {key:'module',label:'โมดูล'},
          {key:'action',label:'การกระทำ'},
          {key:'entity_id',label:'รายการ'},
          {key:'ip_address',label:'IP'}
        ]}
        onDelete={canDelete?remove:undefined}
        selection={canDelete?{selectedKeys:selectedIds,onChange:setSelectedIds,getKey:r=>String(r.id)}:undefined}
        toolbarActions={canDelete?(
          <>
            <span className="audit-selected-count">เลือกแล้ว {selectedIds.length} รายการ</span>
            {selectedIds.length>0&&(<button type="button" className="secondary audit-clear-selection" onClick={()=>setSelectedIds([])} disabled={deleting}>ยกเลิกการเลือก</button>)}
            <button type="button" className="danger-button audit-bulk-delete" onClick={removeSelected} disabled={deleting||selectedIds.length===0}>
              <Trash2 size={16}/>{deleting?'กำลังลบ...':`ลบรายการที่เลือก (${selectedIds.length})`}
            </button>
          </>
        ):undefined}
      />
    </section>
  </>
}
