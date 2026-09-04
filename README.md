# IT Asset & Inventory Management — Production CRUD

ระบบจัดการทรัพย์สินและสต็อกแบบ Full-stack โดยคงโครงสร้างหน้าจอและเมนูเดิม

- Frontend: React + TypeScript
- Backend: Node.js + Express REST API
- Database: MySQL 8.4
- Reverse proxy: Nginx
- Runtime: Docker Compose

## หลักการของเวอร์ชันนี้

1. ไม่มีการสร้างข้อมูล Demo อัตโนมัติ
2. ไม่มีการตรวจ Prefix เช่น `DEMO` เพื่อบังคับพฤติกรรมข้อมูล
3. รายการเดิมทั้งหมดใน MySQL รวมถึงรายการที่ชื่อหรือรหัสมีคำว่า `DEMO` จะถูกมองเป็นข้อมูลธุรกิจปกติ
4. ผู้มีสิทธิ์สามารถเพิ่ม แก้ไข และลบข้อมูลผ่านหน้าเว็บและ REST API
5. รายการที่มีข้อมูลอ้างอิงใช้ Cascade Delete แบบยืนยัน เพื่อรักษาความสัมพันธ์ของฐานข้อมูล
6. ใช้ MySQL volume เดิมและ Migration แบบเพิ่ม/ปรับโครงสร้าง ไม่ล้างข้อมูลเดิม

รหัสหลัก เช่น Asset ID, Employee ID, Company Code และรหัส Master Data ไม่อนุญาตให้เปลี่ยนหลังสร้าง เพราะเป็น Primary/Reference Key ในหลายโมดูล หากลงรหัสผิด ให้สร้างรายการใหม่และย้ายข้อมูลอ้างอิงก่อนลบรายการเดิม ซึ่งเป็นแนวทางเดียวกับระบบ Production ทั่วไป

## โมดูลที่รองรับ CRUD

- บริษัทและ Master Data
- ข้อมูลพนักงานและบัญชีผู้ใช้งาน
- ทะเบียนทรัพย์สิน รูปภาพ เอกสารซื้อ และรายการอุปกรณ์ประกอบ
- คำขอจัดสรรทรัพย์สินจาก HR และการส่งมอบ
- ตำแหน่งและผู้รับผิดชอบ
- โอนย้าย ยืม–คืน ซ่อมบำรุง และตัดจำหน่าย
- Stock แยกตามคลัง และ Stock Movement
- Approval Workflow
- ประวัติ Asset Event และ Audit Log ตามสิทธิ์

ค่าเสื่อมราคาและรายงานเป็นข้อมูลคำนวณจากข้อมูลต้นทาง จึงแก้ที่ทะเบียนทรัพย์สิน/รายการธุรกรรม ไม่แก้ตัวเลขผลลัพธ์โดยตรง

## อัปเดตระบบเดิมโดยไม่ล้าง Database

1. เปิด Docker Desktop
2. ดับเบิลคลิก `backup-db.bat`
3. ตรวจว่าไฟล์ `.sql` ในโฟลเดอร์ `backup` มีขนาดมากกว่า 0 KB
4. คัดลอกไฟล์เวอร์ชันนี้ทับโฟลเดอร์ระบบเดิม
5. ดับเบิลคลิก `start.bat`
6. เปิด `http://localhost:8081` และกด `Ctrl + F5`

ห้ามใช้:

```bash
docker compose down -v
```

เพราะ `-v` จะลบ MySQL volume และข้อมูลทั้งหมด

## การตั้งค่าเริ่มต้น

กำหนดในไฟล์ `.env`:

```env
INITIAL_COMPANY_CODE=EVES
INITIAL_COMPANY_NAME=EVES
DEFAULT_LOGIN_PASSWORD=admin123
SESSION_TTL_HOURS=12
```

`INITIAL_COMPANY_*` ใช้เฉพาะเมื่อฐานข้อมูลยังไม่มีบริษัทเลย ไม่ใช่ข้อมูล Demo และสามารถเปลี่ยนให้ตรงกับองค์กรก่อนเริ่มระบบครั้งแรกได้

ถ้าฐานข้อมูลยังไม่มีบัญชีที่ Login ได้ ระบบจะสร้าง `ADMIN-001` เพียงครั้งเดียวและบังคับเปลี่ยนรหัสผ่านหลังเข้าสู่ระบบ

## คำสั่งตรวจระบบ

```bash
npm run typecheck
npm run build
npm test
```

ดูสถานะ Container:

```bash
docker compose ps
```

ดู Log:

```bash
docker compose logs -f mysql backend frontend
```

ตรวจ API:

```text
http://localhost:4100/api/health
```

## QR Code ผ่านโทรศัพท์

โทรศัพท์และคอมพิวเตอร์ต้องอยู่เครือข่ายเดียวกัน เปิดระบบจาก IP ของคอมพิวเตอร์ก่อน เช่น:

```text
http://192.168.1.20:8081
```

จากนั้นสร้าง QR ใหม่ ระบบจะใช้ URL ที่เปิดอยู่ในการสร้างลิงก์

รายละเอียดการเปลี่ยนแปลงและตารางสิทธิ์อยู่ใน `PRODUCTION_FULL_CRUD_TH.md`
