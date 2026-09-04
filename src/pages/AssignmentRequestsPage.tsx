import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import {
  Banknote,
  Check,
  ClipboardCheck,
  Eye,
  FileText,
  Link2,
  Pencil,
  Plus,
  Save,
  Send,
  ShoppingCart,
  Trash2,
  Unlink,
  X
} from 'lucide-react';
import { api, del, post, put } from '../api';
import ReportExportButton from '../ReportExportButton';
import type { Asset, Employee, User } from '../types';
import { Badge, CompactSelect, DataTable, Modal, PageHeader, dateText, money, type SelectOption } from '../ui';
import { masterOptions, withFallback, type MasterDataMap } from '../masterData';
import { AssetPhotoButton } from '../AssetPhotoButton';
import { ProtectedFileButton } from '../protectedMedia';
import type { PageId } from '../navigation';

type PurchaseRequestDocument = {
  id: number;
  name: string;
  mime: string;
  url: string;
  createdAt: string;
};

type PurchaseRequestItem = {
  id: number;
  assetCategory: string;
  assetSubcategory: string;
  requestedQuantity: number;
  specification: string;
  estimatedUnitPrice: number;
  estimatedTotal: number;
  remarks: string;
};

type LinkedPurchaseAsset = {
  id: number;
  requestItemId: number;
  assetId: string;
  assetName: string;
  assetSerial: string;
  assetCategory: string;
  assetSubcategory: string;
  assetStatus: string;
  linkedBy: string;
  linkedAt: string;
};

type PurchaseRequest = {
  id: number;
  requestNo: string;
  companyCode: string;
  endUserEmployeeCode: string;
  endUserName: string;
  department: string;
  positionName: string;
  requiredDate: string;
  requestReason: string;
  preferredVendor: string;
  budgetAmount: number;
  status: string;
  requestedBy: string;
  requestedByName: string;
  submittedAt: string;
  reviewedBy: string;
  reviewedByName: string;
  reviewedAt: string;
  decisionNote: string;
  purchasedDate: string;
  actualAmount: number;
  procurementNote: string;
  createdAt: string;
  updatedAt: string;
  requestedCount: number;
  registeredCount: number;
  items: PurchaseRequestItem[];
  documents: PurchaseRequestDocument[];
  linkedAssets: LinkedPurchaseAsset[];
};

type DraftDocument = { name: string; data: string };

type RequestDraftItem = {
  id?: number;
  assetCategory: string;
  assetSubcategory: string;
  requestedQuantity: number;
  specification: string;
  estimatedUnitPrice: number;
  remarks: string;
};

type RequestDraft = {
  endUserEmployeeCode: string;
  endUserName: string;
  department: string;
  positionName: string;
  requiredDate: string;
  requestReason: string;
  preferredVendor: string;
  budgetAmount: number;
  items: RequestDraftItem[];
  documentsData: DraftDocument[];
  removeDocumentIds: number[];
};

const MAX_DOCUMENT_SIZE = 5 * 1024 * 1024;
const MAX_DOCUMENT_COUNT = 10;
const ALLOWED_DOCUMENT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];

const emptyItem = (): RequestDraftItem => ({
  assetCategory: '',
  assetSubcategory: '',
  requestedQuantity: 1,
  specification: '',
  estimatedUnitPrice: 0,
  remarks: ''
});

function requestToDraft(request: PurchaseRequest): RequestDraft {
  return {
    endUserEmployeeCode: request.endUserEmployeeCode,
    endUserName: request.endUserName,
    department: request.department,
    positionName: request.positionName,
    requiredDate: String(request.requiredDate || '').slice(0, 10),
    requestReason: request.requestReason,
    preferredVendor: request.preferredVendor,
    budgetAmount: Number(request.budgetAmount || 0),
    items: request.items.map((item) => ({
      id: item.id,
      assetCategory: item.assetCategory,
      assetSubcategory: item.assetSubcategory,
      requestedQuantity: item.requestedQuantity,
      specification: item.specification,
      estimatedUnitPrice: Number(item.estimatedUnitPrice || 0),
      remarks: item.remarks
    })),
    documentsData: [],
    removeDocumentIds: []
  };
}

function newDraft(): RequestDraft {
  return {
    endUserEmployeeCode: '',
    endUserName: '',
    department: '',
    positionName: '',
    requiredDate: new Date().toISOString().slice(0, 10),
    requestReason: '',
    preferredVendor: '',
    budgetAmount: 0,
    items: [emptyItem()],
    documentsData: [],
    removeDocumentIds: []
  };
}

export default function AssignmentRequestsPage({
  assets,
  employees,
  masterData,
  user,
  onReload,
  onNavigate
}: {
  assets: Asset[];
  employees: Employee[];
  masterData: MasterDataMap;
  user: User;
  onReload: () => Promise<void>;
  onNavigate?: (page: PageId) => void;
}) {
  const [rows, setRows] = useState<PurchaseRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('ALL');
  const [editing, setEditing] = useState<PurchaseRequest | 'NEW' | null>(null);
  const [selected, setSelected] = useState<PurchaseRequest | null>(null);

  const canCreate = ['ADMIN', 'SUPERVISOR', 'HR'].includes(user.role);
  const canManage = ['ADMIN', 'SUPERVISOR'].includes(user.role);
  const canAdmin = user.role === 'ADMIN';

  async function load(preferredId?: number) {
    setLoading(true);
    setError('');
    try {
      const result = await api<PurchaseRequest[]>('/api/purchase-requests');
      setRows(result);
      if (preferredId != null) {
        setSelected(result.find((row) => row.id === preferredId) || null);
      } else if (selected) {
        setSelected(result.find((row) => row.id === selected.id) || null);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ไม่สามารถโหลดคำขอจัดซื้อทรัพย์สินได้');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filtered = useMemo(
    () => rows.filter((row) => status === 'ALL' || row.status === status),
    [rows, status]
  );

  const summary = useMemo(() => ({
    all: rows.length,
    approval: rows.filter((row) => row.status === 'PENDING_APPROVAL').length,
    purchasing: rows.filter((row) => ['APPROVED', 'PURCHASING', 'PURCHASED'].includes(row.status)).length,
    registered: rows.filter((row) => row.status === 'REGISTERED').length
  }), [rows]);

  async function saveDraft(value: RequestDraft) {
    if (editing === 'NEW') {
      const created = await post<PurchaseRequest>('/api/purchase-requests', value);
      setEditing(null);
      await load(created.id);
      setSelected(created);
      return;
    }
    if (editing) {
      const updated = await put<PurchaseRequest>(`/api/purchase-requests/${editing.id}`, value);
      setEditing(null);
      await load(updated.id);
      setSelected(updated);
    }
  }

  async function runAction(path: string, body: Record<string, unknown> = {}, reloadBootstrap = false) {
    if (!selected) return;
    const updated = await post<PurchaseRequest>(`/api/purchase-requests/${selected.id}/${path}`, body);
    setSelected(updated);
    await load(updated.id);
    if (reloadBootstrap) await onReload();
  }

  async function unlinkAsset(linkId: number) {
    if (!selected) return;
    const updated = await del<PurchaseRequest>(`/api/purchase-requests/${selected.id}/linked-assets/${linkId}`);
    setSelected(updated);
    await load(updated.id);
  }

  async function removeRequest(row: PurchaseRequest) {
    if (!confirm(`ลบคำขอจัดซื้อ ${row.requestNo} ใช่หรือไม่?`)) return;
    await del(`/api/purchase-requests/${row.id}`);
    if (selected?.id === row.id) setSelected(null);
    await load();
  }

  return (
    <>
      <PageHeader
        title="คำขอจัดซื้อทรัพย์สิน"
        description="HR / Company Admin จัดทำคำขอและงบประมาณ ส่งเข้า Approval Workflow จากนั้นฝ่ายทรัพย์สินดำเนินการซื้อและเชื่อม Asset ที่ลงทะเบียนแล้ว"
        actionLabel="สร้างคำขอซื้อ"
        onAction={canCreate ? () => setEditing('NEW') : undefined}
      >
        <ReportExportButton kind="purchase-requests" filename="asset-purchase-requests" />
        <CompactSelect
          className="compact-select-filter"
          value={status}
          onChange={setStatus}
          placeholder="ทุกสถานะ"
          options={[
            { value: 'ALL', label: 'ทุกสถานะ' },
            { value: 'DRAFT', label: 'ฉบับร่าง' },
            { value: 'PENDING_APPROVAL', label: 'รออนุมัติงบ' },
            { value: 'APPROVED', label: 'อนุมัติงบแล้ว' },
            { value: 'PURCHASING', label: 'กำลังจัดซื้อ' },
            { value: 'PURCHASED', label: 'จัดซื้อแล้ว / รอลงทะเบียน' },
            { value: 'REGISTERED', label: 'ลงทะเบียน Asset ครบแล้ว' },
            { value: 'REJECTED', label: 'ไม่อนุมัติ' },
            { value: 'CANCELLED', label: 'ยกเลิก' }
          ]}
        />
      </PageHeader>

      <div className="assignment-summary-grid">
        <section className="assignment-summary-card"><span>คำขอทั้งหมด</span><strong>{summary.all}</strong></section>
        <section className="assignment-summary-card"><span>รออนุมัติงบ</span><strong>{summary.approval}</strong></section>
        <section className="assignment-summary-card"><span>อยู่ระหว่างจัดซื้อ/ลงทะเบียน</span><strong>{summary.purchasing}</strong></section>
        <section className="assignment-summary-card"><span>ลงทะเบียนครบแล้ว</span><strong>{summary.registered}</strong></section>
      </div>

      {error && <div className="alert error">{error}</div>}
      {loading && <div className="loading-card">กำลังโหลดคำขอจัดซื้อ...</div>}
      {!loading && (
        <section className="card">
          <DataTable
            rows={filtered}
            searchText={(row) => [
              row.requestNo,
              row.requestedByName,
              row.endUserName,
              row.endUserEmployeeCode,
              row.department,
              row.preferredVendor,
              row.status
            ].join(' ')}
            columns={[
              { key: 'requestNo', label: 'เลขคำขอซื้อ' },
              { key: 'requestedByName', label: 'ผู้ขอ / HR' },
              { key: 'endUserName', label: 'ผู้ใช้งานปลายทาง', render: (row) => <div><strong>{row.endUserName || 'ส่วนกลาง / ยังไม่ระบุ'}</strong>{row.endUserEmployeeCode && <small className="table-subtext">{row.endUserEmployeeCode}</small>}</div> },
              { key: 'department', label: 'แผนก' },
              { key: 'requestedCount', label: 'จำนวน', render: (row) => `${row.requestedCount} ชิ้น` },
              { key: 'budgetAmount', label: 'งบประมาณ', render: (row) => money(row.budgetAmount) },
              { key: 'requiredDate', label: 'วันที่ต้องการ', render: (row) => dateText(row.requiredDate) },
              { key: 'status', label: 'สถานะ', render: (row) => <Badge value={row.status} /> }
            ]}
            actions={(row) => (
              <>
                <button className="table-button" onClick={() => setSelected(row)}><Eye size={15} />รายละเอียด</button>
                {canCreate && row.status === 'DRAFT' && (
                  <button className="icon-btn" title="แก้ไขคำขอ" onClick={() => setEditing(row)}><Pencil size={16} /></button>
                )}
                {canAdmin && (
                  <button className="icon-btn danger" title="ลบคำขอ" onClick={() => void removeRequest(row)}><Trash2 size={16} /></button>
                )}
              </>
            )}
            empty="ยังไม่มีคำขอจัดซื้อทรัพย์สิน"
          />
        </section>
      )}

      <Modal
        open={editing !== null}
        title={editing === 'NEW' ? 'สร้างคำขอจัดซื้อทรัพย์สิน' : `แก้ไข ${editing?.requestNo || ''}`}
        onClose={() => setEditing(null)}
        wide
      >
        <RequestEditor
          initial={editing === 'NEW' || !editing ? newDraft() : requestToDraft(editing)}
          existingDocuments={editing === 'NEW' || !editing ? [] : editing.documents}
          employees={employees}
          assets={assets}
          masterData={masterData}
          user={user}
          onCancel={() => setEditing(null)}
          onSubmit={saveDraft}
        />
      </Modal>

      <Modal
        open={selected !== null}
        title={selected ? `${selected.requestNo} · คำขอจัดซื้อ` : 'รายละเอียดคำขอจัดซื้อ'}
        onClose={() => setSelected(null)}
        wide
      >
        {selected && (
          <RequestDetail
            request={selected}
            assets={assets}
            user={user}
            canCreate={canCreate}
            canManage={canManage}
            onEdit={() => setEditing(selected)}
            onAction={runAction}
            onUnlink={unlinkAsset}
            onNavigate={onNavigate}
          />
        )}
      </Modal>
    </>
  );
}

function RequestEditor({
  initial,
  existingDocuments,
  employees,
  assets,
  masterData,
  user,
  onSubmit,
  onCancel
}: {
  initial: RequestDraft;
  existingDocuments: PurchaseRequestDocument[];
  employees: Employee[];
  assets: Asset[];
  masterData: MasterDataMap;
  user: User;
  onSubmit: (value: RequestDraft) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<RequestDraft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [documentError, setDocumentError] = useState('');

  const selectedEmployee = employees.find((employee) => employee.id === form.endUserEmployeeCode);
  const company = selectedEmployee?.company || user.company || '';
  const estimatedTotal = form.items.reduce(
    (sum, item) => sum + Math.max(0, Number(item.estimatedUnitPrice || 0)) * Math.max(1, Number(item.requestedQuantity || 1)),
    0
  );

  const assetFallbackOptions = (values: string[]): SelectOption[] => Array.from(new Set(values.filter(Boolean)))
    .sort((left, right) => left.localeCompare(right, 'th'))
    .map((value) => ({ value, label: value }));

  const categoryOptions = withFallback(
    masterOptions(masterData, 'asset-category', company),
    assetFallbackOptions(assets.filter((asset) => !company || asset.company === company).map((asset) => asset.category))
  );

  function selectEmployee(employeeCode: string) {
    const employee = employees.find((row) => row.id === employeeCode);
    setForm({
      ...form,
      endUserEmployeeCode: employeeCode,
      endUserName: employee?.name || '',
      department: employee?.department || form.department,
      positionName: employee?.position || form.positionName
    });
  }

  function updateItem(index: number, patch: Partial<RequestDraftItem>) {
    setForm({ ...form, items: form.items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item) });
  }

  async function chooseDocuments(event: ChangeEvent<HTMLInputElement>) {
    const input = event.currentTarget;
    const files = Array.from(input.files || []);
    if (!files.length) return;
    setDocumentError('');

    const invalid = files.find((file) => !ALLOWED_DOCUMENT_TYPES.includes(file.type));
    if (invalid) {
      setDocumentError(`ไฟล์ ${invalid.name} ไม่รองรับ รองรับเฉพาะ PDF, JPG และ PNG`);
      input.value = '';
      return;
    }
    const oversized = files.find((file) => file.size > MAX_DOCUMENT_SIZE);
    if (oversized) {
      setDocumentError(`ไฟล์ ${oversized.name} มีขนาดเกิน 5 MB`);
      input.value = '';
      return;
    }

    const removed = new Set(form.removeDocumentIds);
    const existingCount = existingDocuments.filter((document) => !removed.has(document.id)).length;
    if (existingCount + form.documentsData.length + files.length > MAX_DOCUMENT_COUNT) {
      setDocumentError(`แนบเอกสารได้สูงสุด ${MAX_DOCUMENT_COUNT} ไฟล์ต่อคำขอ`);
      input.value = '';
      return;
    }

    try {
      const documents = await Promise.all(files.map((file) => new Promise<DraftDocument>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve({ name: file.name, data: String(reader.result || '') });
        reader.onerror = () => reject(new Error(file.name));
        reader.readAsDataURL(file);
      })));
      setForm((current) => ({ ...current, documentsData: [...current.documentsData, ...documents] }));
    } catch {
      setDocumentError('ไม่สามารถอ่านไฟล์เอกสารบางรายการได้');
    } finally {
      input.value = '';
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (!form.requestReason.trim()) throw new Error('กรุณาระบุเหตุผลการขอจัดซื้อ');
      if (!form.items.length) throw new Error('กรุณาเพิ่มรายการที่ต้องการจัดซื้อ');
      if (form.items.some((item) => !item.assetCategory || Number(item.requestedQuantity) < 1)) {
        throw new Error('กรุณาระบุหมวดและจำนวนของทรัพย์สินให้ครบ');
      }
      const budgetAmount = Number(form.budgetAmount || estimatedTotal);
      if (budgetAmount <= 0) throw new Error('กรุณาระบุราคาประมาณต่อรายการหรืองบประมาณรวม');
      await onSubmit({ ...form, budgetAmount });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'บันทึกคำขอไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="entity-form" onSubmit={submit}>
      {error && <div className="alert error">{error}</div>}
      <div className="assignment-flow-note">
        <ClipboardCheck size={20} />
        <div><strong>HR / Company Admin จัดทำคำขอซื้อและงบประมาณ</strong><span>เมื่อส่งคำขอ ระบบจะสร้างรายการใน Approval Workflow เพื่อพิจารณางบก่อนเริ่มจัดซื้อ</span></div>
      </div>

      <div className="form-grid">
        <label>
          <span>ผู้ใช้งานปลายทาง</span>
          <CompactSelect
            searchable
            value={form.endUserEmployeeCode}
            onChange={selectEmployee}
            placeholder="-- ส่วนกลาง / ยังไม่ระบุพนักงาน --"
            searchPlaceholder="ค้นหาชื่อ รหัส หรือแผนก"
            options={employees
              .filter((employee) => employee.status === 'ACTIVE' && (!company || employee.company === company))
              .map((employee) => ({
                value: employee.id,
                label: `${employee.id} · ${employee.name} · ${employee.department || '-'}`,
                keywords: employee.position || ''
              }))}
          />
        </label>
        <label><span>วันที่ต้องการใช้งาน</span><input type="date" value={form.requiredDate} onChange={(event) => setForm({ ...form, requiredDate: event.target.value })} /></label>
        <label><span>แผนก</span><input value={form.department} onChange={(event) => setForm({ ...form, department: event.target.value })} placeholder="เช่น IT, Marketing" /></label>
        <label><span>ตำแหน่งผู้ใช้งาน</span><input value={form.positionName} onChange={(event) => setForm({ ...form, positionName: event.target.value })} /></label>
        <label><span>Vendor ที่ต้องการ / เสนอราคา</span><input value={form.preferredVendor} onChange={(event) => setForm({ ...form, preferredVendor: event.target.value })} placeholder="ถ้ามี" /></label>
        <label><span>งบประมาณรวมโดยประมาณ *</span><input type="number" min="0" step="0.01" value={form.budgetAmount || ''} onChange={(event) => setForm({ ...form, budgetAmount: Math.max(0, event.target.valueAsNumber || 0) })} placeholder={estimatedTotal > 0 ? `ประมาณ ${money(estimatedTotal)}` : '0'} /></label>
        <label className="span-2"><span>เหตุผลการขอจัดซื้อ *</span><textarea required value={form.requestReason} onChange={(event) => setForm({ ...form, requestReason: event.target.value })} placeholder="เช่น พนักงานใหม่ อุปกรณ์เดิมไม่เพียงพอ หรือทดแทนเครื่องชำรุด" /></label>
      </div>

      <section className="request-items-editor">
        <header>
          <div><h4>รายการที่ต้องการจัดซื้อ</h4><p>ระบุประเภท จำนวน คุณสมบัติ และราคาประมาณ เพื่อใช้ประกอบการอนุมัติงบ</p></div>
          <button type="button" className="secondary" onClick={() => setForm({ ...form, items: [...form.items, emptyItem()] })}><Plus size={16} />เพิ่มรายการ</button>
        </header>
        <div className="request-item-list">
          {form.items.map((item, index) => {
            const subcategoryOptions = withFallback(
              masterOptions(masterData, 'asset-subcategory', company, {
                parentCode: item.assetCategory,
                currentValue: item.assetSubcategory
              }),
              assetFallbackOptions(
                assets
                  .filter((asset) => (!company || asset.company === company) && asset.category === item.assetCategory)
                  .map((asset) => asset.subcategory)
              )
            );
            return (
              <div className="request-item-row purchase-request-item-row" key={`${item.id || 'new'}-${index}`}>
                <label>
                  <span>หมวดทรัพย์สิน *</span>
                  <CompactSelect
                    required
                    searchable
                    value={item.assetCategory}
                    onChange={(value) => updateItem(index, { assetCategory: value, assetSubcategory: '' })}
                    placeholder="-- เลือกหมวด --"
                    options={categoryOptions}
                  />
                </label>
                <label>
                  <span>หมวดย่อย</span>
                  <CompactSelect searchable value={item.assetSubcategory} onChange={(value) => updateItem(index, { assetSubcategory: value })} placeholder="-- เลือกหมวดย่อย --" options={subcategoryOptions} />
                </label>
                <label><span>จำนวน *</span><input type="number" min="1" max="1000" required value={item.requestedQuantity} onChange={(event) => updateItem(index, { requestedQuantity: Math.max(1, event.target.valueAsNumber || 1) })} /></label>
                <label><span>ราคาประมาณ/หน่วย</span><input type="number" min="0" step="0.01" value={item.estimatedUnitPrice || ''} onChange={(event) => updateItem(index, { estimatedUnitPrice: Math.max(0, event.target.valueAsNumber || 0) })} /></label>
                <label><span>คุณสมบัติที่ต้องการ</span><input value={item.specification} onChange={(event) => updateItem(index, { specification: event.target.value })} placeholder="RAM, CPU, ขนาดจอ..." /></label>
                <label><span>หมายเหตุ</span><input value={item.remarks} onChange={(event) => updateItem(index, { remarks: event.target.value })} /></label>
                <button type="button" className="icon-btn danger" title="ลบรายการ" disabled={form.items.length === 1} onClick={() => setForm({ ...form, items: form.items.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 size={16} /></button>
              </div>
            );
          })}
        </div>
        <div className="purchase-budget-total"><span>รวมราคาประมาณจากรายการ</span><strong>{money(estimatedTotal)}</strong></div>
      </section>

      <section className="request-items-editor purchase-documents-panel">
        <header>
          <div><h4>ใบเสนอราคา / เอกสารประกอบ</h4><p>รองรับ PDF, JPG และ PNG ไฟล์ละไม่เกิน 5 MB สูงสุด 10 ไฟล์</p></div>
          <label className="secondary file-picker-button"><FileText size={16} />เลือกเอกสาร<input type="file" multiple accept="application/pdf,image/jpeg,image/png" onChange={chooseDocuments} /></label>
        </header>
        {documentError && <div className="alert error">{documentError}</div>}
        <div className="purchase-document-list">
          {existingDocuments.map((document) => {
            const removed = form.removeDocumentIds.includes(document.id);
            return (
              <div className={`purchase-document-row ${removed ? 'removed' : ''}`} key={document.id}>
                <FileText size={16} /><span>{document.name}</span>
                {!removed && <ProtectedFileButton source={document.url} className="table-button">เปิด</ProtectedFileButton>}
                <button type="button" className={removed ? 'table-button' : 'icon-btn danger'} onClick={() => setForm((current) => ({
                  ...current,
                  removeDocumentIds: removed ? current.removeDocumentIds.filter((id) => id !== document.id) : [...current.removeDocumentIds, document.id]
                }))}>{removed ? 'ยกเลิกการลบ' : <Trash2 size={15} />}</button>
              </div>
            );
          })}
          {form.documentsData.map((document, index) => (
            <div className="purchase-document-row" key={`${document.name}-${index}`}>
              <FileText size={16} /><span>{document.name}</span><span className="muted">ไฟล์ใหม่</span>
              <button type="button" className="icon-btn danger" onClick={() => setForm((current) => ({ ...current, documentsData: current.documentsData.filter((_, currentIndex) => currentIndex !== index) }))}><Trash2 size={15} /></button>
            </div>
          ))}
          {!existingDocuments.length && !form.documentsData.length && <div className="allocation-empty">ยังไม่ได้แนบเอกสาร</div>}
        </div>
      </section>

      <footer className="form-footer">
        <button type="button" className="secondary" onClick={onCancel}>ยกเลิก</button>
        <button className="primary" disabled={busy}><Save size={17} />{busy ? 'กำลังบันทึก...' : 'บันทึกฉบับร่าง'}</button>
      </footer>
    </form>
  );
}

function RequestDetail({
  request,
  assets,
  user,
  canCreate,
  canManage,
  onEdit,
  onAction,
  onUnlink,
  onNavigate
}: {
  request: PurchaseRequest;
  assets: Asset[];
  user: User;
  canCreate: boolean;
  canManage: boolean;
  onEdit: () => void;
  onAction: (path: string, body?: Record<string, unknown>, reloadBootstrap?: boolean) => Promise<void>;
  onUnlink: (linkId: number) => Promise<void>;
  onNavigate?: (page: PageId) => void;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [procurement, setProcurement] = useState({
    purchasedDate: request.purchasedDate ? String(request.purchasedDate).slice(0, 10) : new Date().toISOString().slice(0, 10),
    actualAmount: Number(request.actualAmount || request.budgetAmount || 0),
    note: request.procurementNote || ''
  });
  const [assetChoice, setAssetChoice] = useState<Record<number, string>>({});

  const eligibleAssets = (item: PurchaseRequestItem) => assets.filter((asset) =>
    asset.company === request.companyCode &&
    asset.category === item.assetCategory &&
    (!item.assetSubcategory || asset.subcategory === item.assetSubcategory) &&
    !request.linkedAssets.some((link) => link.assetId === asset.id)
  );

  async function action(key: string, path: string, body: Record<string, unknown> = {}, reload = false) {
    setBusy(key);
    setError('');
    try {
      await onAction(path, body, reload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ดำเนินการไม่สำเร็จ');
    } finally {
      setBusy('');
    }
  }

  async function linkAsset(item: PurchaseRequestItem) {
    const assetId = assetChoice[item.id];
    if (!assetId) return setError('กรุณาเลือก Asset ที่ลงทะเบียนแล้ว');
    await action(`link-${item.id}`, 'link-assets', { requestItemId: item.id, assetId }, true);
    setAssetChoice((current) => ({ ...current, [item.id]: '' }));
  }

  async function unlink(linkId: number) {
    setBusy(`unlink-${linkId}`);
    setError('');
    try {
      await onUnlink(linkId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ยกเลิกการเชื่อม Asset ไม่สำเร็จ');
    } finally {
      setBusy('');
    }
  }

  const canCancel = ['DRAFT', 'PENDING_APPROVAL'].includes(request.status) && (user.role === 'ADMIN' || request.requestedBy === user.id);

  return (
    <div className="assignment-detail">
      {error && <div className="alert error">{error}</div>}
      <div className="assignment-status-line">
        <Badge value={request.status} />
        <span>ขอซื้อ {request.requestedCount} ชิ้น · ลงทะเบียนแล้ว {request.registeredCount} ชิ้น</span>
      </div>

      <section className="assignment-person-card purchase-request-overview">
        <div><small>ผู้จัดทำคำขอ / HR</small><strong>{request.requestedByName || request.requestedBy}</strong><span>{request.companyCode}</span></div>
        <div><small>ผู้ใช้งานปลายทาง</small><strong>{request.endUserName || 'ส่วนกลาง / ยังไม่ระบุ'}</strong><span>{request.endUserEmployeeCode || request.department || '-'}</span></div>
        <div><small>งบประมาณที่ขอ</small><strong>{money(request.budgetAmount)}</strong><span>Vendor: {request.preferredVendor || '-'}</span></div>
        <div><small>วันที่ต้องการใช้งาน</small><strong>{dateText(request.requiredDate)}</strong><span>สร้างเมื่อ {dateText(request.createdAt)}</span></div>
      </section>

      <section className="assignment-reason">
        <strong>เหตุผลการขอจัดซื้อ</strong>
        <p>{request.requestReason || '-'}</p>
        {request.decisionNote && <div className="inline-note"><strong>หมายเหตุการอนุมัติ:</strong> {request.decisionNote}</div>}
      </section>

      <section className="assignment-items-section">
        <h4>รายการที่ขอจัดซื้อ</h4>
        {request.items.map((item) => {
          const links = request.linkedAssets.filter((link) => link.requestItemId === item.id);
          const remaining = Math.max(0, item.requestedQuantity - links.length);
          return (
            <article className="assignment-item-card" key={item.id}>
              <header>
                <div><strong>{item.assetCategory}{item.assetSubcategory ? ` / ${item.assetSubcategory}` : ''}</strong><span>จำนวน {item.requestedQuantity} · ราคาประมาณ {money(item.estimatedUnitPrice)}/หน่วย · รวม {money(item.estimatedTotal)}</span></div>
                <span className="muted">ลงทะเบียน {links.length}/{item.requestedQuantity}</span>
              </header>
              {(item.specification || item.remarks) && <p>{item.specification}{item.specification && item.remarks ? ' · ' : ''}{item.remarks}</p>}

              {links.length > 0 && (
                <div className="allocation-list">
                  {links.map((link) => {
                    const linkedAsset = assets.find((asset) => asset.id === link.assetId);
                    return (
                    <div className="allocation-row" key={link.id}>
                      <div><Link2 size={17} /><span><strong>{link.assetId}{linkedAsset?.accountingAssetId ? ` · บัญชี ${linkedAsset.accountingAssetId}` : ''} · {link.assetName}</strong><small>{link.assetSerial || '-'} · ลงทะเบียนโดย {link.linkedBy || '-'}</small></span></div>
                      <Badge value={link.assetStatus} />
                      <AssetPhotoButton asset={linkedAsset} assetId={link.assetId} />
                      {canManage && (
                        <button className="icon-btn danger" title="ยกเลิกการเชื่อม" disabled={busy === `unlink-${link.id}`} onClick={() => void unlink(link.id)}><Unlink size={16} /></button>
                      )}
                    </div>
                    );
                  })}
                </div>
              )}

              {canManage && ['PURCHASED', 'REGISTERED'].includes(request.status) && remaining > 0 && (
                <div className="asset-reservation-form">
                  <CompactSelect
                    searchable
                    value={assetChoice[item.id] || ''}
                    onChange={(value) => setAssetChoice((current) => ({ ...current, [item.id]: value }))}
                    placeholder="-- เลือก Asset ที่ลงทะเบียนแล้ว --"
                    searchPlaceholder="ค้นหา Asset ID / Asset ID บัญชี / Serial / ชื่อ"
                    options={eligibleAssets(item).map((asset) => ({ value: asset.id, label: `${asset.id}${asset.accountingAssetId ? ` · บัญชี ${asset.accountingAssetId}` : ''} · ${asset.name}`, keywords: [asset.accountingAssetId, asset.serial].filter(Boolean).join(' ') }))}
                  />
                  <button className="secondary" disabled={busy === `link-${item.id}`} onClick={() => void linkAsset(item)}><Link2 size={16} />เชื่อม Asset</button>
                </div>
              )}
            </article>
          );
        })}
      </section>

      <section className="request-items-editor purchase-documents-panel">
        <header><div><h4>ใบเสนอราคา / เอกสารประกอบ</h4><p>เอกสารที่แนบมากับคำขอซื้อ</p></div></header>
        <div className="purchase-document-list">
          {request.documents.map((document) => (
            <div className="purchase-document-row" key={document.id}><FileText size={16} /><span>{document.name}</span><ProtectedFileButton source={document.url} className="table-button">เปิดเอกสาร</ProtectedFileButton></div>
          ))}
          {!request.documents.length && <div className="allocation-empty">ไม่มีเอกสารแนบ</div>}
        </div>
      </section>

      {request.status === 'PENDING_APPROVAL' && (
        <div className="handover-panel"><h4>รออนุมัติงบประมาณ</h4><p className="muted">รายการนี้ถูกส่งไปที่ Approval Workflow แล้ว ผู้อนุมัติสามารถเปิดดูรายละเอียดคำขอ งบประมาณ และรายการที่ต้องการซื้อก่อน Approve / Reject</p></div>
      )}

      {canManage && request.status === 'APPROVED' && (
        <div className="handover-panel"><h4>อนุมัติงบแล้ว</h4><p className="muted">สามารถเริ่มกระบวนการจัดซื้อกับ Vendor ได้</p><button className="primary" disabled={busy === 'start'} onClick={() => void action('start', 'start-purchase')}><ShoppingCart size={16} />เริ่มจัดซื้อ</button></div>
      )}

      {canManage && ['APPROVED', 'PURCHASING'].includes(request.status) && (
        <section className="handover-panel">
          <h4>บันทึกผลการจัดซื้อ</h4>
          <div className="form-grid">
            <label><span>วันที่ซื้อ *</span><input type="date" value={procurement.purchasedDate} onChange={(event) => setProcurement({ ...procurement, purchasedDate: event.target.value })} /></label>
            <label><span>มูลค่าจัดซื้อจริง *</span><input type="number" min="0" step="0.01" value={procurement.actualAmount || ''} onChange={(event) => setProcurement({ ...procurement, actualAmount: Math.max(0, event.target.valueAsNumber || 0) })} /></label>
            <label><span>หมายเหตุการจัดซื้อ</span><input value={procurement.note} onChange={(event) => setProcurement({ ...procurement, note: event.target.value })} /></label>
          </div>
          <div className="assignment-actions"><button className="primary" disabled={busy === 'purchased'} onClick={() => void action('purchased', 'mark-purchased', procurement)}><Check size={16} />บันทึกว่าจัดซื้อแล้ว</button></div>
        </section>
      )}

      {['PURCHASED', 'REGISTERED'].includes(request.status) && (
        <section className="handover-panel">
          <h4>ข้อมูลการจัดซื้อ</h4>
          <div className="assignment-person-card">
            <div><small>วันที่ซื้อ</small><strong>{dateText(request.purchasedDate)}</strong><span>บันทึกผลการจัดซื้อแล้ว</span></div>
            <div><small>มูลค่าจัดซื้อจริง</small><strong>{money(request.actualAmount)}</strong><span>งบประมาณ {money(request.budgetAmount)}</span></div>
            <div><small>ลงทะเบียน Asset</small><strong>{request.registeredCount}/{request.requestedCount} ชิ้น</strong><span>{request.status === 'REGISTERED' ? 'ครบแล้ว' : 'ยังไม่ครบ'}</span></div>
            <div><small>หมายเหตุ</small><strong>{request.procurementNote || '-'}</strong><span>หลังเพิ่ม Asset ให้กลับมาเชื่อมกับคำขอนี้</span></div>
          </div>
          {onNavigate && request.status !== 'REGISTERED' && <button className="secondary" onClick={() => onNavigate('assets')}><Plus size={16} />ไปทะเบียนทรัพย์สินเพื่อเพิ่ม Asset</button>}
        </section>
      )}

      <div className="assignment-actions">
        {canCreate && request.status === 'DRAFT' && <button className="secondary" onClick={onEdit}><Pencil size={16} />แก้ไข</button>}
        {canCreate && request.status === 'DRAFT' && <button className="primary" disabled={busy === 'submit'} onClick={() => void action('submit', 'submit')}><Send size={16} />ส่งอนุมัติงบ</button>}
        {canCancel && <button className="danger-button" disabled={busy === 'cancel'} onClick={() => void action('cancel', 'cancel', { note: 'ยกเลิกโดยผู้สร้างคำขอ' })}><X size={16} />ยกเลิกคำขอ</button>}
      </div>
    </div>
  );
}
