import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { Employee, User } from '../types';
import { put } from '../api';
import type { UserRole } from '../roles';
import {
  Badge,
  CompactSelect,
  DataTable,
  Modal,
  PageHeader
} from '../ui';

type AccessFormState = {
  employeeId: string;
  role: UserRole;
  status: 'ACTIVE' | 'INACTIVE';
  password: string;
  confirmPassword: string;
};

const emptyAccessForm: AccessFormState = {
  employeeId: '',
  role: 'VIEW',
  status: 'ACTIVE',
  password: '',
  confirmPassword: ''
};

function employeePayload(
  employee: Employee,
  overrides: Partial<{
    role: UserRole;
    status: string;
    password: string;
    canLogin: boolean;
  }>
) {
  return {
    id: employee.id,
    employeeCode: employee.id,
    name: employee.name,
    fullName: employee.name,
    company: employee.company,
    department: employee.department,
    position: employee.position || '',
    email: employee.email || '',
    phone: employee.phone || '',
    location: employee.location || '',
    role: overrides.role ?? employee.role,
    status: overrides.status ?? employee.status,
    password: overrides.password ?? '',
    canLogin: overrides.canLogin ?? Boolean(employee.canLogin)
  };
}

function UserAccessForm({
  employee,
  availableEmployees,
  editing,
  onEmployeeChange,
  onSubmit,
  onCancel
}: {
  employee: Employee | null;
  availableEmployees: Employee[];
  editing: boolean;
  onEmployeeChange: (employeeId: string) => void;
  onSubmit: (value: AccessFormState) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<AccessFormState>(() => ({
    ...emptyAccessForm,
    employeeId: employee?.id || '',
    role: (employee?.role || 'VIEW') as UserRole,
    status: (employee?.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE') as 'ACTIVE' | 'INACTIVE'
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setForm({
      ...emptyAccessForm,
      employeeId: employee?.id || '',
      role: (employee?.role || 'VIEW') as UserRole,
      status: employee?.status === 'INACTIVE' ? 'INACTIVE' : 'ACTIVE'
    });
    setError('');
  }, [employee?.id, editing]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');

    if (!employee) {
      setError('กรุณาเลือกพนักงานจากข้อมูลพนักงาน');
      return;
    }
    if (!editing && form.password.length < 8) {
      setError('รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร');
      return;
    }
    if (editing && form.password && form.password.length < 8) {
      setError('รหัสผ่านใหม่ต้องมีอย่างน้อย 8 ตัวอักษร');
      return;
    }
    if (form.password !== form.confirmPassword) {
      setError('รหัสผ่านและยืนยันรหัสผ่านไม่ตรงกัน');
      return;
    }

    setBusy(true);
    try {
      await onSubmit(form);
    } catch (caught: any) {
      setError(caught?.message || 'เกิดข้อผิดพลาด');
    } finally {
      setBusy(false);
    }
  }

  const employeeOptions = availableEmployees.map((item) => ({
    value: item.id,
    label: `${item.id} · ${item.name} · ${item.department || '-'}`,
    keywords: [item.id, item.name, item.company, item.department, item.position, item.email]
      .filter(Boolean)
      .join(' ')
  }));

  // Keep the user-access selector intentionally explicit.
  // Do not derive this list from employee/master data or legacy roles.
  const roleOptions: Array<{ value: UserRole; label: string }> = [
    { value: 'ADMIN', label: 'ADMIN' },
    { value: 'SUPERVISOR', label: 'SUPERVISOR' },
    { value: 'HR', label: 'HR' },
    { value: 'ACCOUNTING', label: 'ACCOUNTING' },
    { value: 'VIEW', label: 'VIEW' }
  ];

  return (
    <form className="entity-form" onSubmit={submit}>
      {error && <div className="alert error">{error}</div>}

      {!editing && (
        <div className="alert info">
          เลือกพนักงานที่มีอยู่แล้วเพื่อเปิดสิทธิ์ Login ระบบจะไม่สร้างข้อมูลพนักงานซ้ำ
        </div>
      )}

      <div className="form-grid">
        <label className="span-2">
          <span>เลือกพนักงาน *</span>
          <CompactSelect
            value={form.employeeId}
            options={employeeOptions}
            disabled={editing}
            required
            searchable
            maxMenuHeight={220}
            placeholder="-- เลือกพนักงานจากข้อมูลพนักงาน --"
            searchPlaceholder="ค้นหารหัส ชื่อ บริษัท หรือแผนก"
            onChange={(employeeId) => {
              setForm((current) => ({ ...current, employeeId }));
              onEmployeeChange(employeeId);
            }}
          />
        </label>

        <label>
          <span>รหัสพนักงาน</span>
          <input value={employee?.id || ''} readOnly placeholder="เลือกพนักงานก่อน" />
        </label>
        <label>
          <span>ชื่อ-นามสกุล</span>
          <input value={employee?.name || ''} readOnly placeholder="เลือกพนักงานก่อน" />
        </label>
        <label>
          <span>บริษัท</span>
          <input value={employee?.company || ''} readOnly />
        </label>
        <label>
          <span>แผนก</span>
          <input value={employee?.department || ''} readOnly />
        </label>
        <label>
          <span>ตำแหน่ง</span>
          <input value={employee?.position || ''} readOnly />
        </label>
        <label>
          <span>Email</span>
          <input value={employee?.email || ''} readOnly />
        </label>

        <label>
          <span>สิทธิ์เข้าใช้งาน *</span>
          <CompactSelect
            value={form.role}
            options={roleOptions}
            required
            searchable={false}
            maxMenuHeight={210}
            onChange={(role) => setForm((current) => ({
              ...current,
              role: role as UserRole
            }))}
          />
        </label>

        <label>
          <span>สถานะบัญชี *</span>
          <CompactSelect
            value={form.status}
            options={[
              { value: 'ACTIVE', label: 'ACTIVE · เปิดใช้งาน' },
              { value: 'INACTIVE', label: 'INACTIVE · ปิดใช้งาน' }
            ]}
            required
            searchable={false}
            onChange={(status) => setForm((current) => ({
              ...current,
              status: status as 'ACTIVE' | 'INACTIVE'
            }))}
          />
        </label>

        <label>
          <span>{editing ? 'รหัสผ่านใหม่' : 'รหัสผ่าน'}{!editing && ' *'}</span>
          <input
            type="password"
            value={form.password}
            required={!editing}
            minLength={8}
            autoComplete="new-password"
            placeholder={editing ? 'เว้นว่างเพื่อคงรหัสเดิม' : 'อย่างน้อย 8 ตัวอักษร'}
            onChange={(event) => setForm((current) => ({
              ...current,
              password: event.target.value
            }))}
          />
        </label>

        <label>
          <span>{editing ? 'ยืนยันรหัสผ่านใหม่' : 'ยืนยันรหัสผ่าน'}{!editing && ' *'}</span>
          <input
            type="password"
            value={form.confirmPassword}
            required={!editing || Boolean(form.password)}
            minLength={form.password ? 8 : undefined}
            autoComplete="new-password"
            placeholder={editing ? 'กรอกเมื่อเปลี่ยนรหัสผ่าน' : 'กรอกรหัสผ่านซ้ำ'}
            onChange={(event) => setForm((current) => ({
              ...current,
              confirmPassword: event.target.value
            }))}
          />
        </label>
      </div>

      <div className="form-footer">
        <button type="button" className="secondary" onClick={onCancel} disabled={busy}>
          ยกเลิก
        </button>
        <button type="submit" className="primary" disabled={busy || !employee}>
          {busy ? 'กำลังบันทึก...' : editing ? 'บันทึกสิทธิ์' : 'เปิดสิทธิ์ผู้ใช้งาน'}
        </button>
      </div>
    </form>
  );
}

export default function UsersPage({
  employees,
  companies: _companies,
  onReload,
  user
}: {
  employees: Employee[];
  companies: any[];
  onReload: () => Promise<void>;
  user: User;
}) {
  const [editing, setEditing] = useState<Employee | null>(null);
  const [creating, setCreating] = useState(false);
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const canManageUsers = user.role === 'ADMIN';

  const rows = useMemo(() => employees
    .filter((employee) => employee.canLogin), [employees]);

  const availableEmployees = useMemo(() => employees
    .filter((employee) => !employee.canLogin)
    .filter((employee) => employee.status === 'ACTIVE')
    .sort((a, b) => `${a.company} ${a.department} ${a.name}`.localeCompare(
      `${b.company} ${b.department} ${b.name}`,
      'th'
    )), [employees]);

  const selectedEmployee = editing || employees.find((employee) => employee.id === selectedEmployeeId) || null;

  function closeModal() {
    setCreating(false);
    setEditing(null);
    setSelectedEmployeeId('');
  }

  async function saveAccess(values: AccessFormState) {
    if (!selectedEmployee) throw new Error('กรุณาเลือกพนักงาน');

    await put(
      `/api/employees/${encodeURIComponent(selectedEmployee.id)}`,
      employeePayload(selectedEmployee, {
        role: values.role,
        status: values.status,
        password: values.password,
        canLogin: true
      })
    );

    closeModal();
    await onReload();
  }

  async function revokeAccess(employee: Employee) {
    if (employee.id === user.id) {
      return window.alert('ไม่สามารถปิดสิทธิ์บัญชีที่กำลังใช้งานอยู่');
    }
    if (!confirm(
      `ปิดสิทธิ์ Login ของ ${employee.name} ใช่หรือไม่?\n\nข้อมูลพนักงานและประวัติทั้งหมดจะยังอยู่ในระบบ`
    )) return;

    await put(
      `/api/employees/${encodeURIComponent(employee.id)}`,
      employeePayload(employee, {
        role: 'VIEW',
        status: employee.status || 'ACTIVE',
        password: '',
        canLogin: false
      })
    );
    await onReload();
  }

  return (
    <>
      <PageHeader
        title="ผู้ใช้งานระบบ"
        description="เปิดสิทธิ์ Login ให้พนักงานที่มีอยู่แล้ว โดยไม่สร้างข้อมูลรายชื่อซ้ำ"
        actionLabel="เพิ่มสิทธิ์ผู้ใช้งาน"
        onAction={canManageUsers ? () => {
          setSelectedEmployeeId('');
          setCreating(true);
        } : undefined}
      />

      {!canManageUsers && (
        <div className="alert warning">
          เฉพาะ Admin เท่านั้นที่จัดการสิทธิ์ผู้ใช้งานได้
        </div>
      )}

      {canManageUsers && availableEmployees.length === 0 && (
        <div className="alert info">
          พนักงานที่ Active ทุกคนได้รับสิทธิ์ Login แล้ว หรือยังไม่มีข้อมูลพนักงานสำหรับเปิดสิทธิ์
        </div>
      )}

      <section className="card">
        <DataTable
          rows={rows}
          searchText={(row) => [row.id, row.name, row.company, row.department, row.position, row.role, row.roleName].join(' ')}
          columns={[
            { key: 'id', label: 'รหัสพนักงาน' },
            { key: 'name', label: 'ชื่อ-นามสกุล' },
            { key: 'company', label: 'บริษัท' },
            { key: 'department', label: 'แผนก' },
            { key: 'position', label: 'ตำแหน่ง' },
            { key: 'roleName', label: 'สิทธิ์เข้าใช้งาน' },
            { key: 'status', label: 'สถานะ', render: (row) => <Badge value={row.status} /> }
          ]}
          onEdit={canManageUsers ? (employee) => {
            setCreating(false);
            setSelectedEmployeeId(employee.id);
            setEditing(employee);
          } : undefined}
          onDelete={canManageUsers ? revokeAccess : undefined}
        />
      </section>

      <Modal
        open={creating || Boolean(editing)}
        title={editing ? 'แก้ไขสิทธิ์ผู้ใช้งาน' : 'เพิ่มสิทธิ์ผู้ใช้งาน'}
        onClose={closeModal}
        wide
      >
        <UserAccessForm
          key={`${editing?.id || 'new'}:${selectedEmployeeId}:${creating ? 'create' : 'edit'}`}
          employee={selectedEmployee}
          availableEmployees={editing ? [editing] : availableEmployees}
          editing={Boolean(editing)}
          onEmployeeChange={setSelectedEmployeeId}
          onSubmit={saveAccess}
          onCancel={closeModal}
        />
      </Modal>
    </>
  );
}
