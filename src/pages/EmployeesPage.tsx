import { useState, type FormEvent } from 'react';
import type { Employee, User } from '../types';
import type { MasterDataMap } from '../masterData';
import { locationOptions, masterOptions } from '../masterData';
import { del, post, put } from '../api';
import { Badge, CompactSelect, DataTable, Modal, PageHeader } from '../ui';

function EmployeeForm({
  initial,
  companies,
  masterData,
  user,
  onSubmit,
  onCancel
}: {
  initial: Partial<Employee>;
  companies: any[];
  masterData: MasterDataMap;
  user: User;
  onSubmit: (value: any) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<any>({
    id: '', name: '', company: user.company || companies[0]?.code || companies[0]?.id || '',
    department: '', position: '', email: '', phone: '', location: '', status: 'ACTIVE',
    ...initial
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const companyOptions = companies
    .filter((company) => company.status !== 'INACTIVE')
    .map((company) => ({
      value: company.code || company.id,
      label: `${company.code || company.id} · ${company.name || company.code || company.id}`
    }));
  const departmentOptions = masterOptions(masterData, 'department', form.company, {
    currentValue: form.department
  });
  const workLocationOptions = locationOptions(masterData, form.company, form.location);

  function setField(key: string, value: string) {
    setForm((current: any) => {
      if (key === 'company') {
        return { ...current, company: value, department: '', location: '' };
      }
      return { ...current, [key]: value };
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    setBusy(true);
    try {
      await onSubmit(form);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'บันทึกข้อมูลพนักงานไม่สำเร็จ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="entity-form" onSubmit={submit}>
      {error && <div className="alert error">{error}</div>}
      <div className="form-grid">
        <label><span>รหัสพนักงาน *</span><input required value={form.id || ''} onChange={(e) => setField('id', e.target.value)} /></label>
        <label><span>ชื่อ-นามสกุล *</span><input required value={form.name || ''} onChange={(e) => setField('name', e.target.value)} /></label>
        {['ADMIN', 'HR'].includes(user.role) && (
          <label><span>บริษัท *</span><CompactSelect required searchable value={form.company || ''} options={companyOptions} onChange={(value) => setField('company', value)} /></label>
        )}
        <label>
          <span>แผนก *</span>
          {departmentOptions.length ? (
            <CompactSelect required searchable value={form.department || ''} options={departmentOptions} searchPlaceholder="ค้นหารหัสหรือชื่อแผนก" onChange={(value) => setField('department', value)} />
          ) : (
            <input required value={form.department || ''} placeholder="ยังไม่มี Department Master — กรอกชื่อแผนก" onChange={(e) => setField('department', e.target.value)} />
          )}
        </label>
        <label><span>ตำแหน่ง</span><input value={form.position || ''} onChange={(e) => setField('position', e.target.value)} /></label>
        <label><span>Email</span><input type="email" value={form.email || ''} onChange={(e) => setField('email', e.target.value)} /></label>
        <label><span>โทรศัพท์</span><input value={form.phone || ''} onChange={(e) => setField('phone', e.target.value)} /></label>
        <label>
          <span>สถานที่ทำงาน</span>
          {workLocationOptions.length ? (
            <CompactSelect searchable value={form.location || ''} options={workLocationOptions} searchPlaceholder="ค้นหา Site อาคาร ห้อง หรือคลัง" onChange={(value) => setField('location', value)} />
          ) : (
            <input value={form.location || ''} placeholder="ยังไม่มี Location Master — กรอกสถานที่" onChange={(e) => setField('location', e.target.value)} />
          )}
        </label>
        <label><span>สถานะ *</span><CompactSelect required value={form.status || 'ACTIVE'} options={[{ value: 'ACTIVE', label: 'ACTIVE · ทำงานอยู่' }, { value: 'INACTIVE', label: 'INACTIVE · พ้นสภาพ/พักใช้งาน' }]} onChange={(value) => setField('status', value)} /></label>
      </div>
      <footer className="form-footer">
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>ยกเลิก</button>
        <button className="primary" disabled={busy}>{busy ? 'กำลังบันทึก...' : 'บันทึก'}</button>
      </footer>
    </form>
  );
}

export default function EmployeesPage({
  employees,
  companies,
  masterData,
  onReload,
  user
}: {
  employees: Employee[];
  companies: any[];
  masterData: MasterDataMap;
  onReload: () => Promise<void>;
  user: User;
}) {
  const [editing, setEditing] = useState<Employee | null>(null);
  const [creating, setCreating] = useState(false);
  const canManage = ['ADMIN', 'HR'].includes(user.role);

  async function save(values: any) {
    const payload = editing
      ? { ...values, originalEmployeeId: editing.id, canLogin: Boolean(editing.canLogin), role: editing.role || 'VIEW' }
      : { ...values, canLogin: false, role: 'VIEW' };
    if (editing) await put(`/api/employees/${encodeURIComponent(editing.id)}`, payload);
    else await post('/api/employees', payload);
    setEditing(null);
    setCreating(false);
    await onReload();
  }

  async function remove(employee: Employee) {
    if (!confirm(`ลบข้อมูลพนักงาน ${employee.name} พร้อมยกเลิกข้อมูลอ้างอิงที่เกี่ยวข้องใช่หรือไม่?`)) return;
    await del(`/api/employees/${encodeURIComponent(employee.id)}?cascade=1`);
    await onReload();
  }

  return (
    <>
      <PageHeader title="ข้อมูลพนักงาน" description="Employee Master สำหรับผู้ถือครอง ผู้ยืม ผู้รับโอน และผู้รับมอบทรัพย์สิน" actionLabel="เพิ่มพนักงาน" onAction={canManage ? () => setCreating(true) : undefined} />
      <div className="inline-note">บัญชี Login จัดการที่เมนู “ผู้ใช้งานระบบ” โดยเลือกจากข้อมูลพนักงานเดิม ระบบจะไม่สร้างรายชื่อซ้ำ</div>
      <section className="card">
        <DataTable
          rows={employees}
          columns={[
            { key: 'id', label: 'รหัสพนักงาน' },
            { key: 'name', label: 'ชื่อ-นามสกุล' },
            { key: 'company', label: 'บริษัท' },
            { key: 'department', label: 'แผนก' },
            { key: 'position', label: 'ตำแหน่ง' },
            { key: 'email', label: 'Email' },
            { key: 'canLogin', label: 'สิทธิ์ Login', render: (row) => row.canLogin ? 'เปิดใช้งาน' : '-' },
            { key: 'status', label: 'สถานะ', render: (row) => <Badge value={row.status} /> }
          ]}
          onEdit={canManage ? setEditing : undefined}
          onDelete={canManage ? remove : undefined}
        />
      </section>
      <Modal open={creating || Boolean(editing)} title={editing ? 'แก้ไขข้อมูลพนักงาน' : 'เพิ่มข้อมูลพนักงาน'} onClose={() => { setCreating(false); setEditing(null); }} wide>
        <EmployeeForm
          initial={editing || { company: user.company || companies[0]?.code || companies[0]?.id || '', status: 'ACTIVE' }}
          companies={companies}
          masterData={masterData}
          user={user}
          onSubmit={save}
          onCancel={() => { setCreating(false); setEditing(null); }}
        />
      </Modal>
    </>
  );
}
