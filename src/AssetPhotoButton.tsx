import { useEffect, useState } from 'react';
import {
  Banknote,
  Boxes,
  Eye,
  FileText,
  Hash,
  ImageIcon,
  LoaderCircle,
  MapPin,
  Paperclip,
  RotateCcw,
  History,
  Wrench
} from 'lucide-react';
import { api } from './api';
import { AuthenticatedImage, ProtectedFileButton } from './protectedMedia';
import { ImageGallery, type GalleryImage } from './ImageGallery';
import type { Asset } from './types';
import { Badge, CompactSelect, Modal, dateText, money, type SelectOption } from './ui';

function documentTypeText(value?: string, other?: string): string {
  if (String(value || '').toUpperCase() === 'OTHER' && String(other || '').trim()) return `เอกสารอื่น · ${String(other).trim()}`;
  const labels: Record<string, string> = {
    TAX_INVOICE: 'ใบกำกับภาษี',
    INVOICE: 'Invoice / ใบแจ้งหนี้',
    RECEIPT: 'ใบเสร็จรับเงิน',
    OTHER: 'เอกสารอื่น'
  };
  return value ? labels[value] || value : '-';
}

function ownershipTypeText(value?: string, other?: string): string {
  if (String(value || '').toUpperCase() === 'OTHER' && String(other || '').trim()) return `อื่นๆ · ${String(other).trim()}`;
  return value || '-';
}


function returnReasonText(value?: string): string {
  const labels: Record<string, string> = {
    RETURN_TO_POOL: 'คืนเข้าคลัง / คืนส่วนกลาง',
    REPLACEMENT: 'เปลี่ยนเครื่อง / ได้เครื่องใหม่',
    EMPLOYEE_CHANGE: 'เปลี่ยนหน้าที่ / เปลี่ยนผู้ใช้งาน',
    DAMAGED: 'ชำรุด / ต้องตรวจซ่อม',
    END_OF_USE: 'สิ้นสุดการใช้งาน',
    RESIGNED: 'พนักงานลาออก',
    BORROW_RETURN: 'คืนจากการยืม',
    OTHER: 'อื่นๆ'
  };
  const key = String(value || 'RETURN_TO_POOL').toUpperCase();
  return labels[key] || key;
}

function assetEventText(value?: string): string {
  const labels: Record<string, string> = {
    REGISTERED: 'ลงทะเบียนทรัพย์สิน',
    ASSET_UPDATED: 'แก้ไขข้อมูลทรัพย์สิน',
    ASSIGNMENT: 'จัดสรรผู้ครอบครอง',
    TRANSFER: 'โอนย้ายทรัพย์สิน',
    BORROW: 'ยืมทรัพย์สิน',
    BORROW_RETURN: 'รับคืนจากการยืม',
    RETURN_TO_ASSET_POOL: 'คืนทรัพย์สินเข้าคลัง',
    MAINTENANCE_OPENED: 'เปิดงานซ่อม',
    MAINTENANCE_CLOSED: 'ปิดงานซ่อม',
    DISPOSAL: 'ตัดจำหน่าย'
  };
  const key = String(value || '').toUpperCase();
  return labels[key] || key || 'เปลี่ยนแปลงข้อมูล';
}

function assetImagesFor(asset: Asset): GalleryImage[] {
  if (Array.isArray(asset.images) && asset.images.length) return asset.images;
  const legacy = asset.imageUrl || (asset.hasImage ? `/api/assets/${encodeURIComponent(asset.id)}/image` : '');
  return legacy ? [{ id: 0, url: legacy, mime: asset.imageMime }] : [];
}

function imageSourceFor(asset: Asset): string {
  return assetImagesFor(asset)[0]?.url || '';
}

/** Shared full asset-detail layout used by the registry and every asset-related module. */
export function AssetDetailContent({ asset }: { asset: Asset }) {
  const categoryText = [asset.category, asset.subcategory].filter(Boolean).join(' / ') || '-';
  const brandModelText = [asset.brand, asset.model].filter(Boolean).join(' ') || '-';

  return (
    <div className="asset-detail-panel">
      <section className="asset-detail-gallery-section">
        <h4><ImageIcon size={16} />รูปภาพทรัพย์สิน ({assetImagesFor(asset).length}/5)</h4>
        <div className="asset-detail-gallery-shell">
          <ImageGallery images={assetImagesFor(asset)} name={asset.name || asset.id} />
        </div>
      </section>

      <section className="asset-detail-summary asset-detail-summary-no-photo">
        <div className="asset-detail-summary-info">
          <div className="asset-detail-summary-top">
            <span className="asset-detail-id-tag"><Hash size={11} />{asset.id}</span>
            <Badge value={asset.status || ''} />
          </div>
          <h3 className="asset-detail-title">{asset.name || '-'}</h3>
          <p className="asset-detail-subtitle">{asset.company || '-'} · {categoryText}</p>

          <div className="asset-detail-quickfacts">
            <div><span>Brand / Model</span><strong>{brandModelText}</strong></div>
            <div><span>Serial Number</span><strong>{asset.serial || '-'}</strong></div>
            <div><span>สภาพทรัพย์สิน</span><strong>{Number.isFinite(Number(asset.condition)) ? `${Number(asset.condition)}%` : '-'}</strong></div>
          </div>
        </div>
      </section>

      <div className="asset-detail-cards">
        <section className="asset-detail-card">
          <h4><MapPin size={16} />การครอบครอง</h4>
          <div className="asset-detail-fields">
            <div><span>ผู้รับผิดชอบ</span><strong>{asset.assignedTo || '-'}</strong></div>
            <div><span>แผนก</span><strong>{asset.department || '-'}</strong></div>
            <div><span>ตำแหน่ง</span><strong>{asset.location || '-'}</strong></div>
            <div><span>ประเภทการถือครอง</span><strong>{ownershipTypeText(asset.ownershipType, asset.ownershipTypeOther)}</strong></div>
          </div>
        </section>

        <section className="asset-detail-card">
          <h4><Boxes size={16} />รายการย่อย / Box set</h4>
          {asset.items?.length ? (
            <ul className="asset-detail-timeline">
              {asset.items.map((item: any, index: number) => (
                <li key={index}>
                  <div className="asset-detail-timeline-head">
                    <strong>{item.name} × {item.quantity || 1}</strong>
                    <span className={`asset-detail-pill ${item.required !== false ? 'required' : 'optional'}`}>
                      {item.required !== false ? 'ต้องคืนพร้อมชุด' : 'ไม่บังคับคืน'}
                    </span>
                  </div>
                  <p>{[item.brand, item.model, item.serial].filter(Boolean).join(' / ') || '-'}</p>
                  {item.note && <small>{item.note}</small>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="asset-detail-empty"><Boxes size={22} /><span>ยังไม่มีรายการย่อย</span></div>
          )}
        </section>

        <section className="asset-detail-card asset-detail-card-wide">
          <h4><Banknote size={16} />บัญชีและประกัน</h4>
          <div className="asset-detail-fields asset-detail-accounting-grid">
            <div><span>Asset ID สำหรับบัญชี</span><strong>{asset.accountingAssetId || '-'}</strong></div>
            <div><span>วันที่ซื้อ</span><strong>{dateText(asset.purchaseDate)}</strong></div>
            <div><span>ประกันถึง</span><strong>{dateText(asset.warrantyUntil)}</strong></div>
            <div><span>ราคาซื้อ</span><strong className="asset-detail-highlight">{money(asset.purchasePrice)}</strong></div>
            <div><span>อายุใช้งาน</span><strong>{asset.usefulLifeYears || '-'}{asset.usefulLifeYears ? ' ปี' : ''}</strong></div>
            <div><span>Vendor / ผู้ขาย</span><strong>{asset.vendor || '-'}</strong></div>
            <div><span>ประเภทเอกสาร</span><strong>{documentTypeText(asset.purchaseDocumentType, asset.purchaseDocumentTypeOther)}</strong></div>
            <div><span>เลขที่เอกสาร / เลขที่บิล</span><strong>{asset.purchaseDocumentNo || '-'}</strong></div>
            <div><span>วันที่เอกสาร</span><strong>{dateText(asset.purchaseDocumentDate || '')}</strong></div>
            <div><span>เลขที่ใบกำกับภาษี</span><strong>{asset.taxInvoiceNo || '-'}</strong></div>
          </div>

          {asset.accountingNote && <p className="asset-detail-note"><FileText size={13} />{asset.accountingNote}</p>}

          {asset.purchaseDocuments?.length ? (
            <div className="asset-detail-attachments">
              {asset.purchaseDocuments.map((document) => (
                <ProtectedFileButton key={document.id} source={document.url} className="asset-detail-attachment">
                  <Paperclip size={13} />{document.name || 'เอกสารการซื้อ'}
                </ProtectedFileButton>
              ))}
            </div>
          ) : null}
        </section>

        <section className="asset-detail-card asset-detail-card-wide">
          <h4><Wrench size={16} />ประวัติซ่อม</h4>
          {asset.repairs?.length ? (
            <ul className="asset-detail-timeline">
              {asset.repairs.map((repair: any, index: number) => (
                <li key={index}>
                  <div className="asset-detail-timeline-head">
                    <strong>{dateText(repair.date)}{repair.ticketNo ? ` · ${repair.ticketNo}` : ''}</strong>
                    <span className="asset-detail-cost">{money(repair.cost)}</span>
                  </div>
                  <p>{repair.issue || repair.detail || '-'}</p>
                  {repair.diagnosis && <small>วิเคราะห์: {repair.diagnosis}</small>}
                  {repair.repairMethod && <small>วิธีดำเนินการ: {repair.repairMethod}{repair.vendor ? ` · ${repair.vendor}` : ''}</small>}
                  <small>ช่างซ่อม: {repair.technician || '-'}</small>
                  {repair.detail && repair.detail !== repair.issue && <small>ผลการซ่อม: {repair.detail}</small>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="asset-detail-empty"><Wrench size={22} /><span>ยังไม่มีประวัติซ่อม</span></div>
          )}
        </section>

        <section className="asset-detail-card asset-detail-card-wide">
          <h4><RotateCcw size={16} />ประวัติการคืน / เปลี่ยนสถานะ</h4>
          {asset.returns?.length ? (
            <ul className="asset-detail-timeline">
              {asset.returns.map((record: any, index: number) => {
                const returnedItems = Array.isArray(record.returnedItems) ? record.returnedItems : [];
                const missingItems = Array.isArray(record.missingItems) ? record.missingItems : [];
                return (
                  <li key={`${record.date || 'return'}-${index}`}>
                    <div className="asset-detail-timeline-head">
                      <strong>{dateText(record.date)}</strong>
                      <span className={`asset-detail-pill ${missingItems.length ? 'required' : 'optional'}`}>
                        {missingItems.length ? `ของไม่ครบ ${missingItems.length} รายการ` : 'คืนครบ'}
                      </span>
                    </div>
                    <p>เหตุผล: {returnReasonText(record.reason)} · สถานที่รับคืน: {record.location || '-'}</p>
                    <small>ผู้ใช้เดิม / ผู้คืน: {record.previousAssignee || record.returnedBy || '-'} · ผู้รับคืน: {record.receivedBy || '-'}</small>
                    {(record.previousDepartment || record.previousLocation) && <small>ก่อนคืน: {[record.previousDepartment, record.previousLocation].filter(Boolean).join(' · ')}</small>}
                    <small>สภาพหลังคืน: {Number.isFinite(Number(record.condition)) ? `${Number(record.condition)}%` : '-'}</small>
                    {record.note && <small>หมายเหตุ: {record.note}</small>}
                    {returnedItems.length ? <small>รายการที่คืน: {returnedItems.join(', ')}</small> : null}
                    {missingItems.length ? <small className="asset-detail-return-missing">รายการที่ขาด: {missingItems.join(', ')}</small> : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="asset-detail-empty"><History size={22} /><span>ยังไม่มีประวัติการคืน</span></div>
          )}
        </section>

        <section className="asset-detail-card asset-detail-card-wide">
          <h4><History size={16} />ประวัติความเคลื่อนไหวของทรัพย์สิน</h4>
          {asset.events?.length ? (
            <ul className="asset-detail-timeline">
              {asset.events.map((event: any) => (
                <li key={event.id || `${event.type}-${event.createdAt}`}>
                  <div className="asset-detail-timeline-head">
                    <strong>{assetEventText(event.type)}</strong>
                    <span>{event.createdAt ? new Date(event.createdAt).toLocaleString('th-TH') : '-'}</span>
                  </div>
                  {(event.oldValue || event.newValue) && <p>{event.oldValue || '-'} → {event.newValue || '-'}</p>}
                  <small>ผู้ดำเนินการ: {event.actor || '-'}</small>
                  {event.note && <small>หมายเหตุ: {event.note}</small>}
                </li>
              ))}
            </ul>
          ) : (
            <div className="asset-detail-empty"><History size={22} /><span>ยังไม่มีประวัติความเคลื่อนไหว</span></div>
          )}
        </section>
      </div>
    </div>
  );
}

/** Backward-compatible action button used throughout asset-related modules. */
export function AssetPhotoButton({
  asset,
  assetId,
  compact = false,
  label = 'รายละเอียด'
}: {
  asset?: Asset | null;
  assetId?: string;
  compact?: boolean;
  label?: string;
}) {
  const id = String(asset?.id || assetId || '').trim();
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState<Asset | null>(asset || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (asset) setLoaded(asset);
  }, [asset]);

  async function show() {
    setOpen(true);
    setError('');
    // Always fetch a fresh complete record. Workflow modules can change status/history after
    // bootstrap, so reusing a list row here can show stale maintenance/return/custodian data.
    if (!id) return;
    setLoading(true);
    try {
      setLoaded(await api<Asset>(`/api/assets/${encodeURIComponent(id)}`));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'ไม่สามารถโหลดข้อมูลทรัพย์สินได้');
    } finally {
      setLoading(false);
    }
  }

  const current = loaded || asset || null;

  return (
    <>
      <button
        type="button"
        className={compact ? 'icon-btn' : 'table-button'}
        title="ดูรายละเอียดทรัพย์สิน"
        disabled={!id}
        onClick={() => void show()}
      >
        <Eye size={compact ? 16 : 15} />
        {!compact && label}
      </button>

      <Modal open={open} title={`รายละเอียดทรัพย์สิน ${id || ''}`} onClose={() => setOpen(false)} wide contentClassName="asset-detail-modal-card">
        {loading ? (
          <div className="asset-detail-loading"><LoaderCircle className="spin" size={28} /><strong>กำลังโหลดข้อมูลทรัพย์สิน...</strong></div>
        ) : error ? (
          <div className="alert error asset-detail-load-error">{error}</div>
        ) : current ? (
          <AssetDetailContent asset={current} />
        ) : (
          <div className="asset-detail-loading"><ImageIcon size={30} /><strong>ไม่พบข้อมูลทรัพย์สิน</strong></div>
        )}
      </Modal>
    </>
  );
}

export function ProtectedPhotoButton({
  source,
  title,
  label = 'ดูรูป',
  compact = true,
  emptyMessage = 'ไม่พบรูปภาพ'
}: {
  source?: string;
  title: string;
  label?: string;
  compact?: boolean;
  emptyMessage?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={compact ? 'icon-btn' : 'table-button'}
        title={label}
        disabled={!source}
        onClick={() => setOpen(true)}
      >
        <ImageIcon size={compact ? 16 : 15} />
        {!compact && label}
      </button>
      <Modal open={open} title={title} onClose={() => setOpen(false)}>
        <div className="asset-photo-viewer">
          <div className="asset-photo-stage return-photo-stage">
            <AuthenticatedImage
              source={source}
              className="asset-photo-large"
              alt={title}
              fallback={<div className="asset-photo-empty"><ImageIcon size={46} /><strong>{emptyMessage}</strong></div>}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}

export function AssetSelectionPreview({
  asset,
  emptyMessage = 'เลือกทรัพย์สินเพื่อดูรูปและข้อมูลสำคัญ',
  showDetail = true
}: {
  asset?: Asset | null;
  emptyMessage?: string;
  showDetail?: boolean;
}) {
  if (!asset) {
    return (
      <div className="asset-selection-preview asset-selection-preview-empty span-2">
        <div className="asset-selection-thumb empty"><ImageIcon size={28} /></div>
        <div className="asset-selection-copy">
          <strong>ยังไม่ได้เลือกทรัพย์สิน</strong>
          <span>{emptyMessage}</span>
        </div>
      </div>
    );
  }

  const source = imageSourceFor(asset);
  return (
    <div className="asset-selection-preview span-2">
      <div className="asset-selection-thumb">
        <AuthenticatedImage
          source={source}
          className="asset-selection-image"
          alt={asset.name || asset.id}
          fallback={<div className="asset-selection-thumb-fallback"><ImageIcon size={28} /><span>ไม่มีรูป</span></div>}
        />
      </div>
      <div className="asset-selection-copy">
        <div className="asset-selection-title-row">
          <div>
            <span className="asset-selection-eyebrow">ทรัพย์สินที่เลือก</span>
            <strong>{asset.id} · {asset.name || '-'}</strong>
          </div>
          <Badge value={asset.status || ''} />
        </div>
        <div className="asset-selection-meta">
          <span><b>Asset ID บัญชี</b>{asset.accountingAssetId || '-'}</span>
          <span><b>Serial</b>{asset.serial || '-'}</span>
          <span><b>ยี่ห้อ / รุ่น</b>{[asset.brand, asset.model].filter(Boolean).join(' / ') || '-'}</span>
          <span><b>ผู้ครอบครอง</b>{asset.assignedTo || 'ไม่มีผู้ถือครอง'}</span>
          <span><b>ตำแหน่ง</b><MapPin size={13} />{asset.location || '-'}</span>
        </div>
        {showDetail && <div className="asset-selection-actions"><AssetPhotoButton asset={asset} compact={false} label="ดูรายละเอียดทรัพย์สิน" /></div>}
      </div>
    </div>
  );
}

export function AssetSelectField({
  assets,
  value,
  onChange,
  label = 'Asset',
  required = true,
  disabled = false,
  placeholder = '-- เลือกทรัพย์สิน --',
  searchPlaceholder = 'ค้นหา Asset ID, Asset ID บัญชี, ชื่อ, Serial หรือตำแหน่ง'
}: {
  assets: Asset[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
}) {
  const selected = assets.find((asset) => asset.id === value) || null;
  const options: SelectOption[] = assets.map((asset) => ({
    value: asset.id,
    label: `${asset.id}${asset.accountingAssetId ? ` · บัญชี ${asset.accountingAssetId}` : ''} · ${asset.name || '-'} · ${asset.location || '-'}`,
    keywords: [asset.accountingAssetId, asset.serial, asset.brand, asset.model, asset.company, asset.assignedTo].filter(Boolean).join(' ')
  }));

  return (
    <div className="asset-select-block span-2">
      <label>
        <span>{label}{required ? ' *' : ''}</span>
        <CompactSelect
          required={required}
          searchable
          disabled={disabled}
          value={value}
          onChange={onChange}
          options={options}
          placeholder={placeholder}
          searchPlaceholder={searchPlaceholder}
        />
      </label>
      <AssetSelectionPreview asset={selected} />
    </div>
  );
}
