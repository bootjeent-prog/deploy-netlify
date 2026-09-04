import { useEffect, useMemo, useState } from 'react';
import {
  Boxes,
  CalendarDays,
  History,
  Info,
  MapPin,
  PackageCheck,
  RotateCcw,
  ShieldCheck,
  UserCog,
  Wrench
} from 'lucide-react';
import { api } from '../api';
import { Badge, dateText } from '../ui';
import { ImageGallery, type GalleryImage } from '../ImageGallery';

function ownershipTypeText(value?: string, other?: string) {
  if (String(value || '').toUpperCase() === 'OTHER' && String(other || '').trim()) {
    return `อื่นๆ · ${String(other).trim()}`;
  }
  const labels: Record<string, string> = {
    OWNED: 'ทรัพย์สินบริษัท',
    LEASED: 'เช่า / Lease',
    BORROWED: 'ยืม / Borrowed',
    OTHER: 'อื่นๆ'
  };
  return value ? labels[String(value).toUpperCase()] || value : '-';
}

function textOrDash(value: unknown) {
  const text = String(value ?? '').trim();
  return text || '-';
}

function publicImages(asset: any): GalleryImage[] {
  if (Array.isArray(asset?.images) && asset.images.length) return asset.images.slice(0, 5);
  return asset?.imageUrl ? [{ id: 0, url: asset.imageUrl, mime: asset.imageMime }] : [];
}

export default function PublicAssetPage({ assetId }: { assetId: string }) {
  const [asset, setAsset] = useState<any>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    setAsset(null);
    api(`/api/public/assets/${encodeURIComponent(assetId)}`)
      .then(setAsset)
      .catch((caught: Error) => setError(caught.message));
  }, [assetId]);

  const categoryText = useMemo(
    () => [asset?.category, asset?.subcategory].filter(Boolean).join(' / ') || '-',
    [asset?.category, asset?.subcategory]
  );
  const brandModelText = useMemo(
    () => [asset?.brand, asset?.model].filter(Boolean).join(' ') || '-',
    [asset?.brand, asset?.model]
  );

  return (
    <main className="public-page public-asset-page">
      <section className="public-card public-asset-card">
        <header>
          <div className="brand-mark"><Boxes size={24} /></div>
          <div><strong>Factory Asset</strong><span>ข้อมูลทรัพย์สินจาก QR Code</span></div>
        </header>

        {error
          ? <div className="alert error public-load-message">{error}</div>
          : !asset
            ? <div className="loading-card public-load-message">กำลังโหลดข้อมูลทรัพย์สิน...</div>
            : (
              <>
                <section className="public-asset-gallery">
                  <ImageGallery images={publicImages(asset)} name={asset.name || asset.id} compact />
                </section>

                <div className="public-title public-asset-title">
                  <span>{textOrDash(asset.company)}</span>
                  <h1>{textOrDash(asset.name)}</h1>
                  <code>{textOrDash(asset.id)}</code>
                  <Badge value={asset.status} />
                </div>

                <div className="public-grid public-asset-grid">
                  <section>
                    <h3><ShieldCheck size={18} />ข้อมูลยืนยันทรัพย์สิน</h3>
                    <dl>
                      <dt>Brand / Model</dt><dd>{brandModelText}</dd>
                      <dt>Serial</dt><dd>{textOrDash(asset.serial)}</dd>
                      <dt>หมวด</dt><dd>{categoryText}</dd>
                      <dt>สภาพ</dt><dd>{Number.isFinite(Number(asset.condition)) ? `${Number(asset.condition)}%` : '-'}</dd>
                      <dt>Criticality</dt><dd>{textOrDash(asset.criticality)}</dd>
                      <dt>ประเภทการถือครอง</dt><dd>{ownershipTypeText(asset.ownershipType, asset.ownershipTypeOther)}</dd>
                    </dl>
                  </section>

                  <section>
                    <h3><UserCog size={18} />ผู้ถือครอง / ผู้รับผิดชอบ</h3>
                    <dl>
                      <dt>ผู้ถือครอง</dt>
                      <dd>{asset.assignedTo || (asset.custodianType === 'SHARED' ? 'ทรัพย์สินส่วนกลาง' : 'ไม่มีผู้ถือครอง')}</dd>
                      <dt>แผนก / หน่วยงาน</dt><dd>{textOrDash(asset.department)}</dd>
                      <dt>สถานที่ปัจจุบัน</dt><dd>{textOrDash(asset.location)}</dd>
                    </dl>
                  </section>

                  <section>
                    <h3><CalendarDays size={18} />อายุการใช้งานและประกัน</h3>
                    <dl>
                      <dt>วันที่ซื้อ</dt><dd>{dateText(asset.purchaseDate)}</dd>
                      <dt>ประกันถึง</dt><dd>{dateText(asset.warrantyUntil)}</dd>
                      <dt>อายุใช้งาน</dt><dd>{asset.usefulLifeYears ? `${asset.usefulLifeYears} ปี` : '-'}</dd>
                      <dt>Vendor / ผู้ขาย</dt><dd>{textOrDash(asset.vendor)}</dd>
                      <dt>สร้างรายการ</dt><dd>{dateText(asset.createdAt)}</dd>
                      <dt>อัปเดตล่าสุด</dt><dd>{dateText(asset.updatedAt)}</dd>
                    </dl>
                  </section>

                  <section>
                    <h3><PackageCheck size={18} />รายการย่อย / Box set</h3>
                    {asset.items?.length ? (
                      <ul className="public-history-list public-boxset-list">
                        {asset.items.map((item: any, index: number) => (
                          <li key={`${item.id || item.name || 'item'}-${index}`}>
                            <strong>{textOrDash(item.name)} × {Number(item.quantity || 1)}</strong>
                            <span>{[item.brand, item.model, item.serial].filter(Boolean).join(' / ') || '-'}</span>
                            <small>{item.required !== false ? 'ต้องคืนพร้อมชุด' : 'ไม่บังคับคืน'}{item.note ? ` · ${item.note}` : ''}</small>
                          </li>
                        ))}
                      </ul>
                    ) : <div className="public-empty-state"><PackageCheck size={20} /><span>ไม่มีรายการย่อย</span></div>}
                  </section>

                  <section className="public-card-wide">
                    <h3><Wrench size={18} />ประวัติซ่อม</h3>
                    {asset.repairs?.length ? (
                      <ul className="public-history-list">
                        {asset.repairs.map((repair: any, index: number) => (
                          <li key={`${repair.date || 'repair'}-${index}`}>
                            <strong>{dateText(repair.date)}{repair.ticketNo ? ` · ${repair.ticketNo}` : ''}</strong>
                            <span>{textOrDash(repair.issue || repair.detail)}</span>
                            {repair.diagnosis && <small>วิเคราะห์: {repair.diagnosis}</small>}
                            {repair.repairMethod && <small>วิธีดำเนินการ: {repair.repairMethod}{repair.vendor ? ` · ${repair.vendor}` : ''}</small>}
                            <small>ผู้ดำเนินการ: {textOrDash(repair.technician)}</small>
                          </li>
                        ))}
                      </ul>
                    ) : <div className="public-empty-state"><Wrench size={20} /><span>ยังไม่มีประวัติซ่อม</span></div>}
                  </section>

                  <section className="public-card-wide">
                    <h3><RotateCcw size={18} />ประวัติการคืน / เปลี่ยนสถานะ</h3>
                    {asset.returns?.length ? (
                      <ul className="public-history-list">
                        {asset.returns.map((record: any, index: number) => (
                          <li key={`${record.date || 'return'}-${index}`}>
                            <strong>{dateText(record.date)}</strong>
                            <span>เหตุผล: {String(record.reason || 'RETURN_TO_POOL')} · สถานที่รับคืน: {textOrDash(record.location)}</span>
                            <small>สภาพหลังคืน: {Number.isFinite(Number(record.condition)) ? `${Number(record.condition)}%` : '-'}{record.note ? ` · ${record.note}` : ''}</small>
                          </li>
                        ))}
                      </ul>
                    ) : <div className="public-empty-state"><History size={20} /><span>ยังไม่มีประวัติการคืน</span></div>}
                  </section>
                </div>

                <div className="public-privacy-note">
                  <Info size={16} />
                  <span>หน้านี้แสดงข้อมูลสำหรับตรวจสอบทรัพย์สินจาก QR Code โดยซ่อนข้อมูลทางบัญชี เลขที่เอกสาร และไฟล์เอกสารภายในบริษัท</span>
                </div>
                <p className="public-note">
                  <MapPin size={16} />หากพบทรัพย์สินนี้ผิดตำแหน่ง กรุณาติดต่อผู้ดูแลทรัพย์สินของบริษัท
                </p>
              </>
            )}
      </section>
    </main>
  );
}
