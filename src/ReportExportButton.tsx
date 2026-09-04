import { useState } from 'react';
import { Download } from 'lucide-react';
import { api, downloadXlsx, type ExcelColumn } from './api';

type ReportConfig = {
  sheetName: string;
  columns: ExcelColumn[];
};

const REPORT_CONFIGS: Record<string, ReportConfig> = {
  assets: {
    sheetName: 'ทะเบียนทรัพย์สิน',
    columns: [
      { key: 'id', header: 'Asset ID', width: 20 },
      { key: 'accountingAssetId', header: 'Asset ID สำหรับบัญชี', width: 22 },
      { key: 'company', header: 'บริษัท', width: 16 },
      { key: 'name', header: 'ชื่อทรัพย์สิน', width: 28 },
      { key: 'category', header: 'หมวดหมู่', width: 20 },
      { key: 'subcategory', header: 'หมวดย่อย', width: 20 },
      { key: 'brand', header: 'ยี่ห้อ', width: 18 },
      { key: 'model', header: 'รุ่น', width: 22 },
      { key: 'serial', header: 'Serial Number', width: 22 },
      { key: 'assignedTo', header: 'ผู้ถือครอง', width: 24, value: (row) => row.assignedTo || 'ไม่มีผู้ถือครอง' },
      { key: 'department', header: 'แผนก', width: 20 },
      { key: 'location', header: 'ตำแหน่ง', width: 24 },
      { key: 'status', header: 'สถานะ', width: 16 },
      { key: 'condition', header: 'สภาพ (%)', width: 13, type: 'number' },
      { key: 'purchaseDate', header: 'วันที่ซื้อ', width: 15, type: 'date' },
      { key: 'purchasePrice', header: 'ราคาซื้อ', width: 16, type: 'currency' },
      { key: 'warrantyUntil', header: 'ประกันถึง', width: 15, type: 'date' },
      { key: 'ownershipType', header: 'ประเภทการถือครอง', width: 26, value: (row) => String(row.ownershipType || '').toUpperCase() === 'OTHER' && row.ownershipTypeOther ? `OTHER · ${row.ownershipTypeOther}` : row.ownershipType },
      { key: 'vendor', header: 'Vendor', width: 24 },
      { key: 'purchaseDocumentNo', header: 'เลขที่เอกสารซื้อ', width: 20 },
      { key: 'taxInvoiceNo', header: 'เลขที่ใบกำกับภาษี', width: 20 },
      { key: 'accountingNote', header: 'หมายเหตุบัญชี', width: 32 }
    ]
  },
  transfers: {
    sheetName: 'ประวัติการโอนย้าย',
    columns: [
      { key: 'request_no', header: 'เลขที่ใบโอน', width: 22 },
      { key: 'asset_id', header: 'Asset ID', width: 20 },
      { key: 'accounting_asset_id', header: 'Asset ID สำหรับบัญชี', width: 22 },
      { key: 'company_code', header: 'บริษัท', width: 15 },
      { key: 'from_assignee', header: 'ผู้ถือครองเดิม', width: 24, value: (row) => row.from_assignee || 'ไม่มีผู้ถือครอง' },
      { key: 'to_assignee', header: 'ผู้ถือครองใหม่', width: 24, value: (row) => row.to_assignee || 'ไม่มีผู้ถือครอง' },
      { key: 'from_department', header: 'แผนกเดิม', width: 20 },
      { key: 'to_department', header: 'แผนกใหม่', width: 20 },
      { key: 'from_location', header: 'ตำแหน่งเดิม', width: 24 },
      { key: 'to_location', header: 'ตำแหน่งใหม่', width: 24 },
      { key: 'transfer_date', header: 'วันที่โอน', width: 15, type: 'date' },
      { key: 'requested_by', header: 'ผู้ทำรายการ', width: 22 },
      { key: 'status', header: 'สถานะ', width: 15 },
      { key: 'note', header: 'เหตุผล / หมายเหตุ', width: 36 },
      { key: 'created_at', header: 'วันที่สร้างรายการ', width: 19, type: 'datetime' }
    ]
  },
  borrow: {
    sheetName: 'ยืม-คืนทรัพย์สิน',
    columns: [
      { key: 'request_no', header: 'เลขที่ใบยืม', width: 22 },
      { key: 'asset_id', header: 'Asset ID', width: 20 },
      { key: 'accounting_asset_id', header: 'Asset ID สำหรับบัญชี', width: 22 },
      { key: 'company_code', header: 'บริษัท', width: 15 },
      { key: 'borrower', header: 'ผู้ยืม', width: 24 },
      { key: 'borrow_date', header: 'วันที่ยืม', width: 15, type: 'date' },
      { key: 'due_date', header: 'กำหนดคืน', width: 15, type: 'date' },
      { key: 'return_date', header: 'วันที่คืนจริง', width: 15, type: 'date' },
      { key: 'return_location', header: 'ตำแหน่งรับคืน', width: 24 },
      { key: 'received_by', header: 'ผู้รับคืน', width: 22 },
      { key: 'condition_out', header: 'สภาพก่อนยืม (%)', width: 17, type: 'number' },
      { key: 'condition_in', header: 'สภาพตอนคืน (%)', width: 17, type: 'number' },
      { key: 'status', header: 'สถานะ', width: 16 },
      { key: 'note', header: 'วัตถุประสงค์ / หมายเหตุ', width: 38 }
    ]
  },
  maintenance: {
    sheetName: 'ประวัติซ่อมบำรุง',
    columns: [
      { key: 'ticket_no', header: 'Ticket', width: 20 },
      { key: 'asset_id', header: 'Asset ID', width: 20 },
      { key: 'accounting_asset_id', header: 'Asset ID สำหรับบัญชี', width: 22 },
      { key: 'company_code', header: 'บริษัท', width: 15 },
      { key: 'issue', header: 'อาการ / ปัญหา', width: 38 },
      { key: 'priority', header: 'ความเร่งด่วน', width: 16 },
      { key: 'technician', header: 'ช่าง IT ผู้รับผิดชอบ', width: 24 },
      { key: 'estimated_cost', header: 'ค่าใช้จ่ายประมาณการ', width: 18, type: 'currency' },
      { key: 'cost', header: 'ค่าใช้จ่ายจริง', width: 16, type: 'currency' },
      { key: 'repair_method', header: 'วิธีดำเนินการ', width: 28, value: (row) => String(row.repair_method || '').toUpperCase() === 'OTHER' && row.repair_method_other ? `OTHER · ${row.repair_method_other}` : row.repair_method },
      { key: 'vendor', header: 'Vendor / ศูนย์บริการ', width: 26 },
      { key: 'diagnosis', header: 'ผลตรวจสอบ / สาเหตุ', width: 38 },
      { key: 'status', header: 'สถานะ', width: 16 },
      { key: 'opened_date', header: 'วันที่เปิด', width: 15, type: 'date' },
      { key: 'closed_date', header: 'วันที่ปิด', width: 15, type: 'date' },
      { key: 'note', header: 'ผลการซ่อม / หมายเหตุ', width: 38 }
    ]
  },
  'assignment-requests': {
    sheetName: 'คำขอจัดสรรทรัพย์สิน',
    columns: [
      { key: 'request_no', header: 'เลขที่คำขอ', width: 22 },
      { key: 'company_code', header: 'บริษัท', width: 15 },
      { key: 'employee_code', header: 'รหัสพนักงาน', width: 18 },
      { key: 'employee_name', header: 'ชื่อพนักงาน', width: 24 },
      { key: 'department', header: 'แผนก', width: 20 },
      { key: 'position', header: 'ตำแหน่งงาน', width: 22 },
      { key: 'work_location', header: 'สถานที่ทำงาน', width: 24 },
      { key: 'required_date', header: 'วันที่ต้องการ', width: 15, type: 'date' },
      { key: 'status', header: 'สถานะ', width: 16 },
      { key: 'requested_count', header: 'จำนวนที่ขอ', width: 14, type: 'integer' },
      { key: 'allocated_count', header: 'จำนวนที่จัดสรร', width: 16, type: 'integer' },
      { key: 'completed_count', header: 'จำนวนที่ส่งมอบ', width: 16, type: 'integer' },
      { key: 'requested_by', header: 'ผู้ส่งคำขอ', width: 22 },
      { key: 'reviewed_by', header: 'ผู้พิจารณา', width: 22 },
      { key: 'decision_note', header: 'หมายเหตุการพิจารณา', width: 36 },
      { key: 'created_at', header: 'วันที่สร้าง', width: 19, type: 'datetime' },
      { key: 'updated_at', header: 'แก้ไขล่าสุด', width: 19, type: 'datetime' }
    ]
  }
};

function fallbackColumns(rows: any[]): ExcelColumn[] {
  const first = rows[0] || {};
  return Object.keys(first)
    .filter((key) => typeof first[key] !== 'object')
    .map((key) => ({ key, header: key.replaceAll('_', ' '), width: 22 }));
}

export default function ReportExportButton({
  kind,
  filename,
  label = 'Export Excel'
}: {
  kind: string;
  filename?: string;
  label?: string;
}) {
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    try {
      const result = await api<{ rows: any[] }>(`/api/reports/${kind}`);
      const config = REPORT_CONFIGS[kind];
      const datedName = `${filename || kind}-${new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date())}.xlsx`;
      downloadXlsx(
        datedName,
        config?.sheetName || 'Report',
        config?.columns || fallbackColumns(result.rows),
        result.rows
      );
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'สร้างรายงานไม่สำเร็จ';
      window.alert(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className="secondary" disabled={busy} onClick={() => void run()}>
      <Download size={16} />
      {busy ? 'กำลังสร้าง...' : label}
    </button>
  );
}
