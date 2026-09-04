import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import { createPortal } from 'react-dom';
import {
  CalendarDays,
  Check,
  ChevronDown,
  Pencil,
  Plus,
  Save,
  Search,
  Trash2,
  X
} from 'lucide-react';

export type SelectOption = {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
  keywords?: string;
};

export type Field = {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'date' | 'select' | 'textarea' | 'email' | 'password';
  options?: SelectOption[];
  required?: boolean;
  placeholder?: string;
  step?: string;
  min?: number | string;
  max?: number | string;
  fullWidth?: boolean;
};

export function money(value: unknown) {
  return new Intl.NumberFormat('th-TH', {
    style: 'currency',
    currency: 'THB',
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

export function dateText(value: unknown) {
  if (!value) return '-';
  const d = new Date(
    String(value).length === 10
      ? `${value}T00:00:00`
      : String(value)
  );
  return Number.isNaN(d.getTime())
    ? String(value)
    : d.toLocaleDateString('th-TH');
}

export function statusLabel(value: string) {
  const map: Record<string, string> = {
    ACTIVE: 'ใช้งานอยู่',
    INACTIVE: 'ไม่ได้ใช้งาน',
    IN_REPAIR: 'กำลังซ่อม',
    IN_PROGRESS: 'กำลังดำเนินการ',
    BROKEN: 'เสีย',
    LOST: 'สูญหาย',
    IN_STOCK: 'พร้อมจัดสรร / ไม่มีผู้ถือครอง',
    BORROWED: 'ถูกยืม',
    RETURNED: 'คืนแล้ว',
    RETURN_REQUESTED: 'รอรับคืน',
    DISPOSED: 'ตัดจำหน่ายแล้ว',
    SOLD: 'ขายแล้ว',
    PENDING: 'รอดำเนินการ',
    PENDING_APPROVAL: 'รออนุมัติงบ',
    PURCHASING: 'กำลังจัดซื้อ',
    REGISTERED: 'ลงทะเบียน Asset ครบแล้ว',
    APPROVED: 'อนุมัติแล้ว',
    REJECTED: 'ไม่อนุมัติ',
    OPEN: 'รอตรวจสอบ',
    CLOSED: 'ปิดงาน',
    POSTED: 'บันทึกแล้ว',
    MATCH: 'ตรงกัน',
    DIFFERENCE: 'มีส่วนต่าง',
    NOT_COUNTED: 'ยังไม่ตรวจนับ',
    NOT_FOUND: 'ไม่พบ',
    GOOD: 'สภาพพร้อมใช้งาน',
    VARIANCE: 'มีส่วนต่าง',
    FOUND: 'พบ',
    MISLOCATED: 'ผิดตำแหน่ง',
    MISSING: 'ไม่พบ',
    SURPLUS: 'เกิน',
    DRAFT: 'ฉบับร่าง',
    SUBMITTED: 'ส่งให้ IT แล้ว',
    IT_REVIEW: 'IT กำลังตรวจสอบ',
    HANDED_OVER: 'ส่งมอบแล้ว',
    COMPLETED: 'เสร็จสมบูรณ์',
    RETURNED_FOR_EDIT: 'ส่งกลับผู้ร้องขอแก้ไข',
    CANCELLED: 'ยกเลิก',
    REQUESTED: 'รอเลือก Asset',
    PARTIAL: 'เลือกบางส่วน',
    ALLOCATED: 'เลือกครบแล้ว',
    RESERVED: 'จองแล้ว',
    ACCEPTED: 'ยืนยันรับแล้ว',
    AVAILABLE: 'พร้อมเบิก',
    IN_USE: 'มีการใช้งาน',
    ISSUED: 'กำลังใช้งาน',
    PARTIAL_RETURN: 'คืนบางส่วน',
    DAMAGED: 'มีชำรุด',
    CONSUMED: 'จ่ายออกแล้ว',
    IT: 'IT',
    GA: 'GA',
    HR: 'HR'
  };
  return map[value] || value || '-';
}

export function CompactSelect({
  value,
  options,
  onChange,
  placeholder = '-- เลือก --',
  searchPlaceholder = 'ค้นหา...',
  required = false,
  disabled = false,
  searchable,
  maxMenuHeight = 200,
  className = '',
  ariaLabel,
  name
}: {
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  required?: boolean;
  disabled?: boolean;
  searchable?: boolean;
  maxMenuHeight?: number;
  className?: string;
  ariaLabel?: string;
  name?: string;
}) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});

  const useSearch = searchable ?? options.length > 6;
  const selectedOption = options.find((option) => option.value === value);
  const selectedLabel = selectedOption?.label || placeholder;

  const filteredOptions = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase('th');
    if (!keyword) return options;

    return options.filter((option) =>
      [option.label, option.description, option.value, option.keywords]
        .filter(Boolean)
        .some((item) =>
          String(item).toLocaleLowerCase('th').includes(keyword)
        )
    );
  }, [options, query]);

  function updateMenuPosition() {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const estimatedHeight = Math.min(
      maxMenuHeight + (useSearch ? 54 : 10),
      window.innerHeight - 16
    );
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const spaceAbove = rect.top - 8;
    const openUpward = spaceBelow < Math.min(220, estimatedHeight) && spaceAbove > spaceBelow;
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - rect.width - 8));

    setMenuStyle({
      left,
      width: rect.width,
      top: openUpward ? undefined : rect.bottom + 6,
      bottom: openUpward ? window.innerHeight - rect.top + 6 : undefined
    });
  }

  useEffect(() => {
    if (!open) return;

    updateMenuPosition();
    const frame = window.requestAnimationFrame(() => {
      if (useSearch) searchRef.current?.focus();
    });

    function closeOnOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      if (
        !buttonRef.current?.contains(target) &&
        !menuRef.current?.contains(target)
      ) {
        setOpen(false);
      }
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    }

    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', updateMenuPosition);
    window.addEventListener('scroll', updateMenuPosition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', updateMenuPosition);
      window.removeEventListener('scroll', updateMenuPosition, true);
    };
  }, [open, maxMenuHeight, useSearch]);

  function choose(nextValue: string) {
    onChange(nextValue);
    setOpen(false);
    setQuery('');
    window.requestAnimationFrame(() => buttonRef.current?.focus());
  }

  function handleButtonKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
      event.preventDefault();
      if (!disabled) setOpen(true);
    }
  }

  const menu = open
    ? createPortal(
        <div
          ref={menuRef}
          className="compact-select-menu"
          style={menuStyle}
          role="listbox"
          aria-label={ariaLabel}
        >
          {useSearch && (
            <div className="compact-select-search-area">
              <div className="compact-select-search-box">
                <Search size={14} />
                <input
                  ref={searchRef}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={searchPlaceholder}
                />
              </div>
            </div>
          )}

          <div
            className="compact-select-options"
            style={{ maxHeight: maxMenuHeight }}
          >
            <button
              type="button"
              role="option"
              aria-selected={!value}
              className={`compact-select-option ${!value ? 'selected' : ''}`}
              onClick={() => choose('')}
            >
              <span title={placeholder}>{placeholder}</span>
              {!value && <Check size={14} />}
            </button>

            {filteredOptions.map((option) => {
              const selected = option.value === value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  disabled={option.disabled}
                  className={`compact-select-option ${selected ? 'selected' : ''}`}
                  onClick={() => choose(option.value)}
                  title={option.label}
                >
                  <span className="compact-select-option-copy">
                    <strong>{option.label}</strong>
                    {option.description && <small>{option.description}</small>}
                  </span>
                  {selected && <Check size={14} />}
                </button>
              );
            })}

            {filteredOptions.length === 0 && (
              <div className="compact-select-empty">
                ไม่พบข้อมูล
              </div>
            )}
          </div>
        </div>,
        document.body
      )
    : null;

  return (
    <div className={`compact-select-root ${className}`.trim()}>
      <button
        ref={buttonRef}
        type="button"
        className={`compact-select-control ${open ? 'open' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={handleButtonKeyDown}
      >
        <span
          className={`compact-select-value ${selectedOption ? '' : 'placeholder'}`}
          title={selectedLabel}
        >
          {selectedLabel}
        </span>
        <ChevronDown size={15} className="compact-select-chevron" />
      </button>

      <select
        className="compact-select-validation-proxy"
        tabIndex={-1}
        aria-hidden="true"
        name={name}
        value={value}
        required={required}
        disabled={disabled}
        onChange={() => undefined}
        onInvalid={(event) => {
          event.preventDefault();
          setOpen(true);
          buttonRef.current?.focus();
        }}
      >
        <option value="" />
        {options.map((option) => (
          <option key={`${option.value}-${option.label}`} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

      {menu}
    </div>
  );
}


function isoToDisplayDate(value: unknown): string {
  const text = String(value || '').slice(0, 10);
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '';
}

function displayToIsoDate(value: string): string {
  const match = value.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return '';
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (
    candidate.getUTCFullYear() !== year ||
    candidate.getUTCMonth() !== month - 1 ||
    candidate.getUTCDate() !== day
  ) return '';
  return `${match[3]}-${match[2]}-${match[1]}`;
}

function maskDisplayDate(value: string): string {
  const digits = value.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

/**
 * Shared date input for every module. Users can type DD/MM/YYYY or open the
 * browser's native calendar. The value exposed to forms remains YYYY-MM-DD.
 */
export function DatePickerInput({
  value,
  required = false,
  disabled = false,
  onChange,
  ariaLabel
}: {
  value: unknown;
  required?: boolean;
  disabled?: boolean;
  onChange: (value: string) => void;
  ariaLabel?: string;
}) {
  const [display, setDisplay] = useState(() => isoToDisplayDate(value));
  const pickerRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setDisplay(isoToDisplayDate(value));
  }, [value]);

  function openCalendar() {
    if (disabled) return;
    const picker = pickerRef.current;
    if (!picker) return;
    try {
      picker.showPicker?.();
    } catch {
      picker.click();
    }
  }

  return (
    <div className={`day-month-year-input ${disabled ? 'disabled' : ''}`.trim()}>
      <input
        type="text"
        inputMode="numeric"
        autoComplete="off"
        maxLength={10}
        placeholder="วว/ดด/ปปปป"
        aria-label={ariaLabel}
        value={display}
        required={required}
        disabled={disabled}
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
        disabled={disabled}
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
        disabled={disabled}
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

export function PageHeader({
  title,
  description,
  actionLabel,
  onAction,
  children
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="page-header">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      <div className="page-actions">
        {children}
        {onAction && (
          <button className="primary" onClick={onAction}>
            <Plus size={17} />
            {actionLabel || 'เพิ่มข้อมูล'}
          </button>
        )}
      </div>
    </div>
  );
}

export type SectionTabItem<T extends string = string> = {
  value: T;
  label: string;
  count?: number;
};

export function SectionTabs<T extends string>({
  items,
  value,
  onChange,
  ariaLabel = 'เลือกส่วนการใช้งาน',
  stickyOnMobile = true
}: {
  items: SectionTabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  stickyOnMobile?: boolean;
}) {
  return (
    <div className={`module-tabs-shell ${stickyOnMobile ? 'mobile-sticky' : ''}`}>
      <div className="module-tabs" role="tablist" aria-label={ariaLabel}>
        {items.map((item) => {
          const active = item.value === value;
          return (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={active}
              className={`module-tab-button ${active ? 'active' : ''}`}
              onClick={() => onChange(item.value)}
            >
              <span>{item.label}</span>
              {typeof item.count === 'number' && (
                <span className="module-tab-count">{new Intl.NumberFormat('th-TH').format(item.count)}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

const MODAL_EXIT_MS = 190;

export function Modal({
  open,
  title,
  onClose,
  children,
  wide = false,
  fullScreen = false,
  contentClassName = '',
  popup = false
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
  fullScreen?: boolean;
  contentClassName?: string;
  popup?: boolean;
}) {
  // Keep the shared modal mounted briefly while closing so every module gets
  // a smooth exit animation instead of disappearing immediately.
  const [present, setPresent] = useState(open);
  const lastTitleRef = useRef(title);
  const lastChildrenRef = useRef(children);

  // Parent pages often clear selected data as soon as onClose runs. Preserve
  // the last visible content until the exit animation finishes to avoid a
  // blank flash/flicker.
  if (open) {
    lastTitleRef.current = title;
    lastChildrenRef.current = children;
  }

  useEffect(() => {
    if (open) {
      setPresent(true);
      return;
    }
    if (!present) return;

    const timer = window.setTimeout(() => setPresent(false), MODAL_EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open, present]);

  useEffect(() => {
    if (!present) return;

    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && open) onClose();
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', close);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', close);
    };
  }, [present, open, onClose]);

  if (!present) return null;

  const motionClass = open ? 'modal-motion-enter' : 'modal-motion-exit';
  const visibleTitle = open ? title : lastTitleRef.current;
  const visibleChildren = open ? children : lastChildrenRef.current;

  // Render every modal at document.body level. Some workflows open an asset-detail
  // modal from inside another modal (for example Approval / TRF detail). Without
  // a portal the second fixed modal becomes visually nested inside the first
  // modal's card, which causes the content width/padding to be offset. Portaling
  // keeps nested dialogs aligned to the viewport and makes close -> return to the
  // parent dialog behave consistently across modules.
  return createPortal(
    <div
      className={`modal-backdrop modal-workspace-backdrop ${popup ? 'modal-popup-backdrop' : ''} ${motionClass}`.trim()}
      data-modal-state={open ? 'open' : 'closing'}
    >
      <section
        className={`modal modal-workspace ${wide ? 'wide' : ''} ${fullScreen ? 'full-screen' : ''} ${popup ? 'modal-popup' : ''}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-label={visibleTitle}
      >
        <header className="modal-workspace-header">
          <h3>{visibleTitle}</h3>
          <button type="button" className="icon-btn modal-close-button" onClick={onClose} aria-label="ปิดหน้าต่าง">
            <X size={20} />
          </button>
        </header>

        <div className="modal-workspace-body">
          <div className={`modal-workspace-card ${contentClassName}`.trim()}>
            {visibleChildren}
          </div>
        </div>
      </section>
    </div>,
    document.body
  );
}

export function EntityForm({
  fields,
  initial = {},
  onSubmit,
  onCancel,
  submitLabel = 'บันทึก',
  beforeFields,
  fieldAddon
}: {
  fields: Field[];
  initial?: any;
  onSubmit: (value: any) => Promise<void> | void;
  onCancel: () => void;
  submitLabel?: string;
  beforeFields?: React.ReactNode;
  fieldAddon?: (field: Field, value: any, form: any, setField: (key: string, value: any) => void) => React.ReactNode;
}) {
  const [form, setForm] = useState<any>({ ...initial });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit(form);
    } catch (caught: any) {
      setError(caught.message || 'เกิดข้อผิดพลาด');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="entity-form" onSubmit={submit}>
      {error && <div className="alert error">{error}</div>}
      {beforeFields}
      <div className="form-grid">
        {fields.map((field) => (
          <React.Fragment key={field.key}>
            <label className={field.type === 'textarea' || field.fullWidth ? 'span-2' : ''}>
              <span>
                {field.label}
                {field.required && ' *'}
              </span>

              {field.type === 'select' ? (
                <CompactSelect
                  value={String(form[field.key] ?? '')}
                  required={field.required}
                  options={field.options || []}
                  placeholder={field.placeholder || '-- เลือก --'}
                  searchPlaceholder={`ค้นหา${field.label ? ` ${field.label}` : ''}`}
                  onChange={(value) =>
                    setForm({ ...form, [field.key]: value })
                  }
                />
              ) : field.type === 'textarea' ? (
                <textarea
                  value={form[field.key] ?? ''}
                  required={field.required}
                  placeholder={field.placeholder}
                  onChange={(event) =>
                    setForm({ ...form, [field.key]: event.target.value })
                  }
                />
              ) : field.type === 'date' ? (
                <DatePickerInput
                  value={form[field.key] ?? ''}
                  required={field.required}
                  ariaLabel={field.label}
                  onChange={(value) => setForm({ ...form, [field.key]: value })}
                />
              ) : (
                <input
                  type={field.type || 'text'}
                  step={field.step}
                  min={field.min}
                  max={field.max}
                  value={form[field.key] ?? ''}
                  required={field.required}
                  placeholder={field.placeholder}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      [field.key]: field.type === 'number'
                        ? event.target.value === ''
                          ? ''
                          : event.target.valueAsNumber
                        : event.target.value
                    })
                  }
                />
              )}
            </label>
            {fieldAddon?.(field, form[field.key], form, (key, value) => setForm((current: any) => ({ ...current, [key]: value })))}
          </React.Fragment>
        ))}
      </div>

      <footer className="form-footer">
        <button type="button" className="secondary" onClick={onCancel}>
          ยกเลิก
        </button>
        <button className="primary" disabled={busy}>
          <Save size={17} />
          {busy ? 'กำลังบันทึก...' : submitLabel}
        </button>
      </footer>
    </form>
  );
}

export type Column = {
  key: string;
  label: string;
  render?: (row: any) => React.ReactNode;
  /**
   * DataTable uses smart filters by default and only offers business-friendly,
   * categorical columns. Set this when a page needs to explicitly include or
   * exclude a column from the filter dropdown.
   */
  filterable?: boolean;
  /** Return the raw value used for filtering when it differs from row[key]. */
  filterValue?: (row: any) => unknown;
  /** Convert a raw filter value to the user-facing option label. */
  filterLabel?: (value: unknown, row?: any) => string;
};

function normalizeMobileColumn(column: Column) {
  return `${column.key} ${column.label}`.toLocaleLowerCase('th');
}

const EMPTY_FILTER_VALUE = '__TABLE_FILTER_EMPTY__';
const SKIP_FILTER_VALUE = '__TABLE_FILTER_SKIP__';

function normalizeFilterValue(value: unknown) {
  if (value == null || value === '') return EMPTY_FILTER_VALUE;
  if (Array.isArray(value) || typeof value === 'object') return SKIP_FILTER_VALUE;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const normalized = String(value).trim();
  return normalized || EMPTY_FILTER_VALUE;
}

function isBusinessFilterColumn(column: Column) {
  if (column.filterable !== undefined) return column.filterable;
  const text = normalizeMobileColumn(column);

  // Never expose technical/internal values (URL, file paths, record IDs, IP,
  // serial numbers, free-text notes, dates and amounts) as dropdown options.
  if (/รูป|image|photo|logo|url|path|ไฟล์|file|attachment|เอกสารแนบ|ip(?:_|\b)|serial/.test(text)) return false;

  // Offer filters only for values that users naturally think of as categories.
  return /บริษัท|company|สถานะ|status|ผู้ถือครอง|ผู้รับผิดชอบ|custodian|assigned|assignee|owner|แผนก|department|ตำแหน่ง|position|location|site|room|พื้นที่|ประเภท|type|หมวด|category|subcategory|role|สิทธิ์|permission|โมดูล|module|การกระทำ|action|วิธี|method|ช่าง|technician|ผู้ยืม|borrower|ผู้ขอ|requester|requested_by|ผู้อนุมัติ|approver|approved_by|ผู้รับคืน|received_by|ผู้ทำรายการ|actor|ผู้เดิม|ผู้ใหม่|from_assignee|to_assignee|ต้นทาง|ปลายทาง|from_location|to_location|ยี่ห้อ|brand|canlogin|login/.test(text);
}

function friendlyFilterLabel(column: Column, rawValue: unknown, normalizedValue: string, row?: any) {
  if (column.filterLabel) return column.filterLabel(rawValue, row);
  const text = normalizeMobileColumn(column);

  if (normalizedValue === EMPTY_FILTER_VALUE) {
    if (/ผู้ถือครอง|ผู้รับผิดชอบ|custodian|assigned|assignee|owner|ผู้เดิม|ผู้ใหม่/.test(text)) {
      return 'ไม่มีผู้ถือครอง';
    }
    return 'ไม่ระบุ';
  }

  if (/สถานะ|status/.test(text)) return statusLabel(String(rawValue));
  if (/รูป|image|photo/.test(text)) {
    return normalizedValue === 'true' || normalizedValue === '1' ? 'มีรูปภาพ' : 'ไม่มีรูปภาพ';
  }
  if (/canlogin|สิทธิ์ login|login access/.test(text)) {
    return normalizedValue === 'true' || normalizedValue === '1' ? 'เปิดใช้งาน' : 'ไม่ได้เปิดใช้งาน';
  }

  if (/โมดูล|module/.test(text)) {
    const moduleLabels: Record<string, string> = {
      AUTH: 'การเข้าสู่ระบบ', ASSET: 'ทรัพย์สิน', APPROVAL: 'การอนุมัติ',
      BORROW: 'ยืม-คืน', TRANSFER: 'โอนย้าย', MAINTENANCE: 'ซ่อมบำรุง',
      DISPOSAL: 'ตัดจำหน่าย', EMPLOYEE: 'พนักงาน', USER: 'ผู้ใช้งาน',
      MASTER_DATA: 'Master Data'
    };
    const key = String(rawValue).toUpperCase();
    return moduleLabels[key] ? `${moduleLabels[key]} (${key})` : String(rawValue);
  }

  if (/การกระทำ|action/.test(text)) {
    const actionLabels: Record<string, string> = {
      LOGIN: 'เข้าสู่ระบบ', LOGOUT: 'ออกจากระบบ', CREATE: 'เพิ่มข้อมูล',
      UPDATE: 'แก้ไขข้อมูล', DELETE: 'ลบข้อมูล', REQUEST: 'สร้างคำขอ',
      APPROVED: 'อนุมัติ', REJECTED: 'ปฏิเสธ', ASSIGNMENT: 'กำหนดผู้ถือครอง',
      RETURN: 'รับคืน', CANCEL: 'ยกเลิก'
    };
    const key = String(rawValue).toUpperCase();
    return actionLabels[key] ? `${actionLabels[key]} (${key})` : String(rawValue);
  }

  return String(rawValue);
}

function mobileTitleScore(column: Column, index: number) {
  const text = normalizeMobileColumn(column);
  if (/รูป|image|photo|logo/.test(text)) return -1000;
  if (/สถานะ|status|ผล$/.test(text)) return -900;
  if (/ชื่อทรัพย์สิน|ทรัพย์สิน$|asset name|employee name|ชื่อพนักงาน|พนักงาน|ผู้รับทรัพย์สิน|ผู้ใช้งาน|name/.test(text)) return 120 - index;
  if (/request_no|request no|เลขที่คำขอ|ticket|เลขที่รายการ/.test(text)) return 110 - index;
  if (/asset[_ ]?id|asset id|รหัสทรัพย์สิน/.test(text)) return 100 - index;
  if (/รหัส|code|เลขที่|เลข/.test(text)) return 80 - index;
  return 30 - index;
}

function mobileMetaScore(column: Column, index: number) {
  const text = normalizeMobileColumn(column);
  if (/ผู้ถือครอง|ผู้รับผิดชอบ|ผู้ยืม|ผู้ขอ|requester|borrower|owner|assigned/.test(text)) return 120 - index;
  if (/ตำแหน่ง|location|site|room|พื้นที่/.test(text)) return 115 - index;
  if (/แผนก|department|หน่วยงาน/.test(text)) return 110 - index;
  if (/ประเภท|type|หมวด|category/.test(text)) return 105 - index;
  if (/วันที่|date|เวลา|time/.test(text)) return 100 - index;
  if (/สภาพ|condition|จำนวน|qty|quantity|มูลค่า|ราคา|cost|amount/.test(text)) return 95 - index;
  if (/บริษัท|company|ยี่ห้อ|brand|รุ่น|model|serial/.test(text)) return 90 - index;
  return 40 - index;
}

type DataTableSelection = {
  selectedKeys: string[];
  onChange: (keys: string[]) => void;
  getKey?: (row: any, index: number) => string;
};

function SelectionCheckbox({
  checked,
  indeterminate = false,
  onChange,
  label
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);
  return (
    <input
      ref={ref}
      className="selection-checkbox"
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      aria-label={label}
    />
  );
}

export function DataTable({
  rows,
  columns,
  onEdit,
  onDelete,
  actions,
  empty = 'ยังไม่มีข้อมูล',
  searchText,
  selection,
  toolbarActions
}: {
  rows: any[];
  columns: Column[];
  onEdit?: (row: any) => void;
  onDelete?: (row: any) => void;
  actions?: (row: any) => React.ReactNode;
  empty?: string;
  searchText?: (row: any) => string;
  selection?: DataTableSelection;
  toolbarActions?: React.ReactNode;
}) {
  const [tableQuery, setTableQuery] = useState('');
  const [filterColumn, setFilterColumn] = useState('');
  const [filterValue, setFilterValue] = useState('');
  const [expandedMobileRows, setExpandedMobileRows] = useState<Record<string, boolean>>({});

  const searchableValue = (row: any, column: Column) => {
    const value = row?.[column.key];
    if (value == null) return '';
    if (Array.isArray(value)) return value.map((item) => typeof item === 'object' ? JSON.stringify(item) : String(item)).join(' ');
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  };

  const filterableColumns = useMemo(() =>
    columns.filter((column) => {
      if (!isBusinessFilterColumn(column)) return false;
      // Do not show dead filters. At least one row must have a real value;
      // blank values remain available as an option when mixed with real values.
      return rows.some((row) => {
        const raw = column.filterValue ? column.filterValue(row) : row?.[column.key];
        const normalized = normalizeFilterValue(raw);
        return normalized !== SKIP_FILTER_VALUE && normalized !== EMPTY_FILTER_VALUE;
      });
    }),
  [columns, rows]);

  const filterColumnOptions = useMemo<SelectOption[]>(() =>
    filterableColumns.map((column) => ({ value: column.key, label: column.label })),
  [filterableColumns]);

  const filterValueOptions = useMemo<SelectOption[]>(() => {
    if (!filterColumn) return [];
    const column = filterableColumns.find((item) => item.key === filterColumn);
    if (!column) return [];

    const optionMap = new Map<string, string>();
    for (const row of rows) {
      const raw = column.filterValue ? column.filterValue(row) : row?.[column.key];
      const normalized = normalizeFilterValue(raw);
      if (normalized === SKIP_FILTER_VALUE) continue;
      optionMap.set(normalized, friendlyFilterLabel(column, raw, normalized, row));
    }

    return Array.from(optionMap, ([value, label]) => ({ value, label }))
      .sort((left, right) => left.label.localeCompare(right.label, 'th'))
      .slice(0, 250);
  }, [rows, filterableColumns, filterColumn]);

  useEffect(() => {
    if (filterColumn && !filterColumnOptions.some((option) => option.value === filterColumn)) {
      setFilterColumn('');
      setFilterValue('');
      return;
    }
    if (filterValue && !filterValueOptions.some((option) => option.value === filterValue)) {
      setFilterValue('');
    }
  }, [filterColumn, filterColumnOptions, filterValue, filterValueOptions]);

  const visibleRows = useMemo(() => {
    const keyword = tableQuery.trim().toLocaleLowerCase('th');
    const activeColumn = filterableColumns.find((column) => column.key === filterColumn);
    return rows.filter((row) => {
      const extraSearchText = searchText ? String(searchText(row) || '').toLocaleLowerCase('th') : '';
      const matchesSearch = !keyword || columns.some((column) =>
        searchableValue(row, column).toLocaleLowerCase('th').includes(keyword)
      ) || extraSearchText.includes(keyword);
      if (!matchesSearch) return false;
      if (!activeColumn || !filterValue) return true;
      const raw = activeColumn.filterValue ? activeColumn.filterValue(row) : row?.[activeColumn.key];
      return normalizeFilterValue(raw) === filterValue;
    });
  }, [rows, columns, filterableColumns, tableQuery, filterColumn, filterValue, searchText]);

  const mobileColumns = useMemo(() => {
    const indexed = columns.map((column, index) => ({ column, index, text: normalizeMobileColumn(column) }));
    const image = indexed.find(({ text }) => /รูป|image|photo|logo/.test(text))?.column;
    const status = indexed.find(({ text }) => /สถานะ|status|ผล$/.test(text))?.column;

    const content = indexed.filter(({ column }) => column !== image && column !== status);
    const title = [...content]
      .sort((a, b) => mobileTitleScore(b.column, b.index) - mobileTitleScore(a.column, a.index))[0]?.column;

    const subtitle = [...content]
      .filter(({ column }) => column !== title)
      .sort((a, b) => {
        const aText = normalizeMobileColumn(a.column);
        const bText = normalizeMobileColumn(b.column);
        const aId = /asset[_ ]?id|asset id|รหัส|code|เลขที่|ticket|request_no/.test(aText) ? 1 : 0;
        const bId = /asset[_ ]?id|asset id|รหัส|code|เลขที่|ticket|request_no/.test(bText) ? 1 : 0;
        return bId - aId || mobileTitleScore(b.column, b.index) - mobileTitleScore(a.column, a.index);
      })[0]?.column;

    const meta = [...content]
      .filter(({ column }) => column !== title && column !== subtitle)
      .sort((a, b) => mobileMetaScore(b.column, b.index) - mobileMetaScore(a.column, a.index))
      .slice(0, 3)
      .map(({ column }) => column);

    const shown = new Set([image, status, title, subtitle, ...meta].filter(Boolean));
    const hidden = columns.filter((column) => !shown.has(column));
    return { image, status, title, subtitle, meta, hidden };
  }, [columns]);

  const renderCell = (column: Column | undefined, row: any) => {
    if (!column) return null;
    return column.render ? column.render(row) : String(row[column.key] ?? '-');
  };

  const mobileRowKey = (row: any, index: number) =>
    String(row.id ?? row.asset_id ?? row.sku ?? row.request_no ?? row.ticket_no ?? index);

  const selectionKey = (row: any, index: number) =>
    selection?.getKey ? String(selection.getKey(row, index)) : mobileRowKey(row, index);
  const selectedKeySet = new Set(selection?.selectedKeys || []);
  const visibleSelectionKeys = selection ? visibleRows.map((row, index) => selectionKey(row, index)) : [];
  const selectedVisibleCount = visibleSelectionKeys.filter((key) => selectedKeySet.has(key)).length;
  const allVisibleSelected = Boolean(selection && visibleSelectionKeys.length && selectedVisibleCount === visibleSelectionKeys.length);
  const someVisibleSelected = Boolean(selection && selectedVisibleCount > 0 && selectedVisibleCount < visibleSelectionKeys.length);

  const toggleSelected = (key: string, checked: boolean) => {
    if (!selection) return;
    const next = new Set(selection.selectedKeys);
    if (checked) next.add(key); else next.delete(key);
    selection.onChange(Array.from(next));
  };

  const toggleAllVisible = (checked: boolean) => {
    if (!selection) return;
    const next = new Set(selection.selectedKeys);
    for (const key of visibleSelectionKeys) {
      if (checked) next.add(key); else next.delete(key);
    }
    selection.onChange(Array.from(next));
  };

  return (
    <>
      <div className="table-toolbar">
        <SearchBox
          value={tableQuery}
          onChange={setTableQuery}
          placeholder="ค้นหาในรายการนี้..."
        />
        <CompactSelect
          className="compact-select-filter"
          value={filterColumn}
          onChange={(value) => { setFilterColumn(value); setFilterValue(''); }}
          options={filterColumnOptions}
          placeholder="กรองตามคอลัมน์"
          searchable={false}
        />
        <CompactSelect
          className="compact-select-filter table-filter-value"
          value={filterValue}
          onChange={setFilterValue}
          options={filterValueOptions}
          placeholder={filterColumn ? 'เลือกค่าที่ต้องการกรอง' : 'เลือกคอลัมน์ก่อน'}
          disabled={!filterColumn}
          searchable
        />
        {(tableQuery || filterColumn || filterValue) && (
          <button
            type="button"
            className="secondary table-filter-clear"
            onClick={() => { setTableQuery(''); setFilterColumn(''); setFilterValue(''); }}
          >
            <X size={15} />ล้างตัวกรอง
          </button>
        )}
        {toolbarActions && <div className="table-toolbar-actions">{toolbarActions}</div>}
      </div>
      <div className="table-wrap desktop-data-table">
        <table>
          <thead>
            <tr>
              {selection && (
                <th className="table-selection-col">
                  <div className="table-select-all">
                    <SelectionCheckbox
                      checked={allVisibleSelected}
                      indeterminate={someVisibleSelected}
                      onChange={toggleAllVisible}
                      label="เลือกหรือยกเลิกรายการทั้งหมดที่แสดง"
                    />
                    <span>เลือก</span>
                  </div>
                </th>
              )}
              {columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
              {(onEdit || onDelete || actions) && <th>จัดการ</th>}
            </tr>
          </thead>
          <tbody>
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={columns.length + (selection ? 1 : 0) + ((onEdit || onDelete || actions) ? 1 : 0)} className="empty-row">
                  {rows.length && (tableQuery || filterValue) ? 'ไม่พบข้อมูลที่ตรงกับ Search / Filter' : empty}
                </td>
              </tr>
            ) : (
              visibleRows.map((row, index) => {
                const rowSelectionKey = selectionKey(row, index);
                const selected = selectedKeySet.has(rowSelectionKey);
                return (
                <tr key={row.id ?? row.asset_id ?? row.sku ?? row.request_no ?? index} className={selected ? 'is-selected' : ''}>
                  {selection && (
                    <td className="table-selection-col">
                      <SelectionCheckbox
                        checked={selected}
                        onChange={(checked) => toggleSelected(rowSelectionKey, checked)}
                        label={`เลือกรายการ ${rowSelectionKey}`}
                      />
                    </td>
                  )}
                  {columns.map((column) => (
                    <td key={column.key}>
                      {column.render
                        ? column.render(row)
                        : String(row[column.key] ?? '-')}
                    </td>
                  ))}
                  {(onEdit || onDelete || actions) && (
                    <td>
                      <div className="row-actions">
                        {actions?.(row)}
                        {onEdit && (
                          <button
                            className="icon-btn"
                            title="แก้ไข"
                            onClick={() => onEdit(row)}
                          >
                            <Pencil size={16} />
                          </button>
                        )}
                        {onDelete && (
                          <button
                            className="icon-btn danger"
                            title="ลบ"
                            onClick={() => onDelete(row)}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="mobile-data-list" aria-live="polite">
        {visibleRows.length === 0 ? (
          <div className="mobile-data-empty">
            {rows.length && (tableQuery || filterValue) ? 'ไม่พบข้อมูลที่ตรงกับ Search / Filter' : empty}
          </div>
        ) : (
          visibleRows.map((row, index) => {
            const rowKey = mobileRowKey(row, index);
            const rowSelectionKey = selectionKey(row, index);
            const selected = selectedKeySet.has(rowSelectionKey);
            const expanded = Boolean(expandedMobileRows[rowKey]);
            const hasHidden = mobileColumns.hidden.length > 0;

            return (
              <article
                className={`mobile-data-card mobile-data-card-compact ${expanded ? 'expanded' : ''} ${selected ? 'is-selected' : ''}`}
                key={`mobile-${rowKey}`}
              >
                <div className="mobile-data-summary">
                  {selection && (
                    <div className="mobile-data-select">
                      <SelectionCheckbox
                        checked={selected}
                        onChange={(checked) => toggleSelected(rowSelectionKey, checked)}
                        label={`เลือกรายการ ${rowSelectionKey}`}
                      />
                    </div>
                  )}
                  {mobileColumns.image && (
                    <div className="mobile-data-thumb">
                      {renderCell(mobileColumns.image, row)}
                    </div>
                  )}

                  <div className="mobile-data-heading">
                    <div className="mobile-data-title-line">
                      <strong className="mobile-data-title">
                        {renderCell(mobileColumns.title, row) || '-'}
                      </strong>
                      {mobileColumns.status && (
                        <div className="mobile-data-status">
                          {renderCell(mobileColumns.status, row)}
                        </div>
                      )}
                    </div>
                    {mobileColumns.subtitle && (
                      <div className="mobile-data-subtitle">
                        <span>{mobileColumns.subtitle.label}</span>
                        <b>{renderCell(mobileColumns.subtitle, row)}</b>
                      </div>
                    )}
                  </div>
                </div>

                {mobileColumns.meta.length > 0 && (
                  <div className="mobile-data-meta">
                    {mobileColumns.meta.map((column) => (
                      <div className="mobile-data-meta-item" key={column.key}>
                        <span>{column.label}</span>
                        <div>{renderCell(column, row)}</div>
                      </div>
                    ))}
                  </div>
                )}

                {expanded && hasHidden && (
                  <div className="mobile-data-extra">
                    {mobileColumns.hidden.map((column) => (
                      <div className="mobile-data-extra-item" key={column.key}>
                        <span>{column.label}</span>
                        <div>{renderCell(column, row)}</div>
                      </div>
                    ))}
                  </div>
                )}

                {(hasHidden || onEdit || onDelete || actions) && (
                  <footer className="mobile-data-actions mobile-data-actions-compact">
                    {hasHidden ? (
                      <button
                        type="button"
                        className={`mobile-more-button ${expanded ? 'open' : ''}`}
                        onClick={() => setExpandedMobileRows((current) => ({ ...current, [rowKey]: !expanded }))}
                        aria-expanded={expanded}
                      >
                        {expanded ? 'ย่อข้อมูล' : 'เพิ่มเติม'}
                        <ChevronDown size={15} />
                      </button>
                    ) : <span />}

                    {(onEdit || onDelete || actions) && (
                      <div className="row-actions">
                        {actions?.(row)}
                        {onEdit && (
                          <button
                            className="icon-btn"
                            title="แก้ไข"
                            aria-label="แก้ไข"
                            onClick={() => onEdit(row)}
                          >
                            <Pencil size={16} />
                          </button>
                        )}
                        {onDelete && (
                          <button
                            className="icon-btn danger"
                            title="ลบ"
                            aria-label="ลบ"
                            onClick={() => onDelete(row)}
                          >
                            <Trash2 size={16} />
                          </button>
                        )}
                      </div>
                    )}
                  </footer>
                )}
              </article>
            );
          })
        )}
      </div>

    </>
  );
}

export function SearchBox({
  value,
  onChange,
  placeholder = 'ค้นหา...'
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="search-box">
      <Search size={17} />
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

export function Badge({ value }: { value: string }) {
  return (
    <span className={`badge ${String(value).toLowerCase()}`}>
      {statusLabel(value)}
    </span>
  );
}
