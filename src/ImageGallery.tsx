import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Image as ImageIcon, X } from 'lucide-react';
import { createPortal } from 'react-dom';
import { AuthenticatedImage } from './protectedMedia';

export type GalleryImage = {
  id?: number | string;
  url: string;
  mime?: string;
};

function clampIndex(index: number, length: number) {
  if (length <= 0) return 0;
  return ((index % length) + length) % length;
}

export function ImageGallery({
  images,
  name,
  compact = false
}: {
  images: GalleryImage[];
  name: string;
  compact?: boolean;
}) {
  const rows = useMemo(
    () => (Array.isArray(images) ? images : []).filter((image) => String(image?.url || '').trim()).slice(0, 5),
    [images]
  );
  const [selected, setSelected] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  useEffect(() => {
    setSelected((current) => clampIndex(current, rows.length));
  }, [rows.length]);

  function previous() {
    setSelected((current) => clampIndex(current - 1, rows.length));
  }

  function next() {
    setSelected((current) => clampIndex(current + 1, rows.length));
  }

  if (!rows.length) {
    return (
      <div className={`click-gallery-empty ${compact ? 'compact' : ''}`.trim()}>
        <ImageIcon size={compact ? 28 : 42} />
        <strong>ยังไม่มีรูปภาพ</strong>
        <span>เพิ่มรูปภาพได้สูงสุด 5 รูป</span>
      </div>
    );
  }

  const active = rows[clampIndex(selected, rows.length)];

  return (
    <>
      <div className={`click-gallery ${compact ? 'compact' : ''}`.trim()}>
        <div className="click-gallery-main-wrap">
          <button
            type="button"
            className="click-gallery-main"
            onClick={() => setLightboxOpen(true)}
            aria-label={`เปิดรูปภาพ ${name} รูปที่ ${selected + 1}`}
            title="กดเพื่อดูรูปขนาดใหญ่"
          >
            <AuthenticatedImage
              source={active.url}
              alt={`${name} รูปที่ ${selected + 1}`}
              fallback={<div className="click-gallery-load-fallback"><ImageIcon size={34} /><span>ไม่สามารถโหลดรูปภาพได้</span></div>}
            />
          </button>

          {rows.length > 1 && (
            <>
              <button type="button" className="click-gallery-nav prev" onClick={previous} aria-label="รูปก่อนหน้า"><ChevronLeft size={22} /></button>
              <button type="button" className="click-gallery-nav next" onClick={next} aria-label="รูปถัดไป"><ChevronRight size={22} /></button>
            </>
          )}
          <span className="click-gallery-counter">{selected + 1}/{rows.length}</span>
        </div>

        {rows.length > 1 && (
          <div className="click-gallery-thumbs" role="list" aria-label="รูปภาพทั้งหมด">
            {rows.map((image, index) => (
              <button
                type="button"
                role="listitem"
                key={`${String(image.id ?? index)}-${index}`}
                className={`click-gallery-thumb ${index === selected ? 'active' : ''}`.trim()}
                onClick={() => setSelected(index)}
                aria-label={`เลือกรูปที่ ${index + 1}`}
              >
                <AuthenticatedImage source={image.url} alt={`${name} thumbnail ${index + 1}`} />
              </button>
            ))}
          </div>
        )}
      </div>

      {lightboxOpen && typeof document !== 'undefined' && createPortal(
        <ImageLightbox
          images={rows}
          name={name}
          selected={selected}
          onSelected={setSelected}
          onClose={() => setLightboxOpen(false)}
        />,
        document.body
      )}
    </>
  );
}

function ImageLightbox({
  images,
  name,
  selected,
  onSelected,
  onClose
}: {
  images: GalleryImage[];
  name: string;
  selected: number;
  onSelected: (index: number) => void;
  onClose: () => void;
}) {
  const index = clampIndex(selected, images.length);
  const active = images[index];

  function previous() {
    onSelected(clampIndex(index - 1, images.length));
  }

  function next() {
    onSelected(clampIndex(index + 1, images.length));
  }

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft' && images.length > 1) previous();
      if (event.key === 'ArrowRight' && images.length > 1) next();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [index, images.length, onClose]);

  return (
    <div className="image-lightbox-backdrop" role="dialog" aria-modal="true" aria-label={`รูปภาพ ${name}`} onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="image-lightbox-panel">
        <header className="image-lightbox-header">
          <div>
            <strong>{name}</strong>
            <span>รูปที่ {index + 1} จาก {images.length}</span>
          </div>
          <button type="button" className="image-lightbox-close" onClick={onClose} aria-label="ปิดรูปภาพ"><X size={24} /></button>
        </header>

        <div className="image-lightbox-stage">
          <AuthenticatedImage
            source={active.url}
            alt={`${name} รูปที่ ${index + 1}`}
            fallback={<div className="image-lightbox-fallback"><ImageIcon size={48} /><span>ไม่สามารถโหลดรูปภาพได้</span></div>}
          />
          {images.length > 1 && (
            <>
              <button type="button" className="image-lightbox-nav prev" onClick={previous} aria-label="รูปก่อนหน้า"><ChevronLeft size={32} /></button>
              <button type="button" className="image-lightbox-nav next" onClick={next} aria-label="รูปถัดไป"><ChevronRight size={32} /></button>
            </>
          )}
        </div>

        {images.length > 1 && (
          <div className="image-lightbox-thumbs">
            {images.map((image, thumbIndex) => (
              <button
                type="button"
                key={`${String(image.id ?? thumbIndex)}-${thumbIndex}`}
                className={thumbIndex === index ? 'active' : ''}
                onClick={() => onSelected(thumbIndex)}
                aria-label={`เลือกรูปที่ ${thumbIndex + 1}`}
              >
                <AuthenticatedImage source={image.url} alt={`${name} thumbnail ${thumbIndex + 1}`} />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
