import type { SelectOption } from './ui';

export type MasterRecord = {
  id: number;
  masterType: string;
  code: string;
  name: string;
  parentCode: string;
  companyCode: string;
  status: string;
  data: Record<string, unknown>;
};

export type MasterDataMap = Record<string, MasterRecord[]>;

export type RoomOwnerInfo = {
  employeeCode: string;
  name: string;
  department: string;
};

function normalize(value: unknown) {
  return String(value ?? '').trim().toUpperCase();
}

function companyPriority(row: MasterRecord, company: string) {
  const target = normalize(company);
  const rowCompany = normalize(row.companyCode);
  if (target && rowCompany === target) return 0;
  if (!rowCompany) return 1;
  return 2;
}

export function masterRows(
  masterData: MasterDataMap | undefined,
  type: string,
  company = '',
  options: { includeInactive?: boolean; parentCode?: string } = {}
): MasterRecord[] {
  const companyCode = normalize(company);
  const parentCode = normalize(options.parentCode);

  return (masterData?.[type] || [])
    .filter((row) => options.includeInactive || normalize(row.status) === 'ACTIVE')
    .filter((row) => {
      const rowCompany = normalize(row.companyCode);
      return !companyCode || !rowCompany || rowCompany === companyCode;
    })
    .filter((row) => !parentCode || normalize(row.parentCode) === parentCode)
    .sort((left, right) => {
      const priority = companyPriority(left, company) - companyPriority(right, company);
      if (priority) return priority;
      return `${left.code} ${left.name}`.localeCompare(`${right.code} ${right.name}`, 'th');
    });
}

export function masterOptions(
  masterData: MasterDataMap | undefined,
  type: string,
  company = '',
  options: {
    includeInactive?: boolean;
    parentCode?: string;
    valueMode?: 'code' | 'name';
    currentValue?: string;
  } = {}
): SelectOption[] {
  const rows = masterRows(masterData, type, company, options);
  const seen = new Set<string>();
  const result: SelectOption[] = [];

  for (const row of rows) {
    const value = options.valueMode === 'name' ? row.name : row.code;
    const key = normalize(value);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    result.push({
      value,
      label: row.name && row.name !== row.code ? `${row.code} · ${row.name}` : row.code,
      keywords: [row.name, row.parentCode, row.companyCode, ...Object.values(row.data || {})]
        .filter(Boolean)
        .join(' ')
    });
  }

  const currentValue = String(options.currentValue || '').trim();
  if (currentValue && !result.some((option) => normalize(option.value) === normalize(currentValue))) {
    result.unshift({ value: currentValue, label: `${currentValue} · ข้อมูลเดิม` });
  }
  return result;
}

export function locationOptions(
  masterData: MasterDataMap | undefined,
  company = '',
  currentValue = ''
): SelectOption[] {
  const typeLabels: Record<string, string> = {
    site: 'Site',
    building: 'อาคาร',
    floor: 'ชั้น',
    zone: 'โซน',
    room: 'ห้อง/พื้นที่'
  };
  const types = ['room', 'zone', 'floor', 'building', 'site'];
  const options: SelectOption[] = types.flatMap((type) =>
    masterRows(masterData, type, company).map((row) => ({
      value: row.code,
      label: `${row.code} · ${row.name} (${typeLabels[type]})`,
      keywords: [row.name, row.parentCode, row.companyCode, typeLabels[type]].filter(Boolean).join(' ')
    }))
  );
  const seen = new Set<string>();
  const unique = options.filter((option) => {
    const key = normalize(option.value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const value = String(currentValue || '').trim();
  if (value && !unique.some((option) => normalize(option.value) === normalize(value))) {
    unique.unshift({ value, label: `${value} · ข้อมูลเดิม` });
  }
  return unique;
}

export function roomRecordForLocation(
  masterData: MasterDataMap | undefined,
  company: string,
  locationCode: string
): MasterRecord | undefined {
  const target = normalize(locationCode);
  if (!target) return undefined;
  return masterRows(masterData, 'room', company, { includeInactive: true })
    .find((row) => normalize(row.code) === target);
}

export function roomOwnerForLocation(
  masterData: MasterDataMap | undefined,
  company: string,
  locationCode: string
): RoomOwnerInfo | null {
  const room = roomRecordForLocation(masterData, company, locationCode);
  if (!room) return null;
  const employeeCode = String(room.data?.ownerEmployeeCode || room.data?.owner_employee_code || '').trim();
  const name = String(room.data?.ownerName || room.data?.owner_name || '').trim();
  const department = String(room.data?.ownerDepartment || room.data?.owner_department || '').trim();
  if (!employeeCode && !name && !department) return null;
  return { employeeCode, name, department };
}

export function withFallback(options: SelectOption[], fallback: SelectOption[]) {
  return options.length ? options : fallback;
}
