export const seedData = {
  assets: [
    {
      id: 'IT-NTB-00042',
      name: 'Lenovo ThinkPad X1 Carbon Gen 11',
      category: 'Notebook',
      serial: 'PF4Z9A21',
      assignedTo: 'กมลชนก ศรีวัฒน์',
      department: 'บัญชี',
      location: 'ชั้น 12 อาคาร A',
      status: 'ใช้งานอยู่',
      purchaseDate: '2024-03-18',
      warrantyUntil: '2027-03-17',
      condition: 92,
      repairs: [
        { date: '2025-08-14', detail: 'เปลี่ยนแบตเตอรี่', cost: 4200, technician: 'ทีม Service Desk' },
        { date: '2026-02-03', detail: 'อัปเดต BIOS และตรวจสุขภาพ SSD', cost: 0, technician: 'ณัฐพล' }
      ]
    },
    {
      id: 'IT-MON-00109',
      name: 'Dell UltraSharp U2723QE',
      category: 'Monitor',
      serial: 'CN0D7K92',
      assignedTo: 'วรุตม์ ภักดี',
      department: 'Product',
      location: 'ชั้น 9 อาคาร B',
      status: 'ใช้งานอยู่',
      purchaseDate: '2023-11-02',
      warrantyUntil: '2026-11-01',
      condition: 88,
      repairs: [{ date: '2025-12-19', detail: 'เคลมสาย USB-C', cost: 0, technician: 'Dell Onsite' }]
    },
    {
      id: 'IT-MOB-00031',
      name: 'iPhone 15 Pro',
      category: 'Mobile',
      serial: 'F2L92THQ0',
      assignedTo: 'พรทิพย์ ใจดี',
      department: 'Sales',
      location: 'สาขาเชียงใหม่',
      status: 'ซ่อมบำรุง',
      purchaseDate: '2024-09-24',
      warrantyUntil: '2026-09-23',
      condition: 67,
      repairs: [{ date: '2026-05-18', detail: 'หน้าจอแตก รออะไหล่', cost: 9800, technician: 'Apple Authorized' }]
    },
    {
      id: 'IT-NTB-00058',
      name: 'MacBook Air M3 13"',
      category: 'Notebook',
      serial: 'C02YY771Q6L4',
      assignedTo: 'คลังกลาง',
      department: 'IT',
      location: 'คลัง IT ชั้น 4',
      status: 'อยู่ในสต็อก',
      purchaseDate: '2025-01-15',
      warrantyUntil: '2028-01-14',
      condition: 100,
      repairs: []
    }
  ],
  employees: [
    { id: 'EMP-1001', name: 'กมลชนก ศรีวัฒน์', department: 'บัญชี', position: 'Accounting Manager', email: 'kamonchanok@example.com', location: 'ชั้น 12 อาคาร A' },
    { id: 'EMP-1002', name: 'วรุตม์ ภักดี', department: 'Product', position: 'Product Manager', email: 'warut@example.com', location: 'ชั้น 9 อาคาร B' },
    { id: 'EMP-1003', name: 'พรทิพย์ ใจดี', department: 'Sales', position: 'Sales Executive', email: 'porntip@example.com', location: 'สาขาเชียงใหม่' },
    { id: 'EMP-IT-STOCK', name: 'คลังกลาง', department: 'IT', position: 'IT Stock', email: 'it-stock@example.com', location: 'คลัง IT ชั้น 4' }
  ],
  stock: [
    { name: 'USB-C Hub 8-in-1', sku: 'ACC-HUB-08', available: 4, min: 8, location: 'คลัง IT ชั้น 4' },
    { name: 'Logitech MX Master 3S', sku: 'ACC-MOU-3S', available: 13, min: 10, location: 'คลัง IT ชั้น 4' },
    { name: 'RAM DDR5 16GB', sku: 'SP-RAM-D5-16', available: 3, min: 6, location: 'ห้องซ่อม' },
    { name: 'สาย HDMI 2m', sku: 'CB-HDMI-02', available: 28, min: 12, location: 'คลัง IT ชั้น 4' }
  ]
};
