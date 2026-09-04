@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ================================================
echo  Apply User Role Fix - Admin Supervisor HR Accounting View
echo ================================================

where docker >nul 2>nul || (
  echo [ERROR] กรุณาติดตั้งและเปิด Docker Desktop ก่อน
  pause
  exit /b 1
)

if not exist "docker-compose.yml" (
  echo [ERROR] ไม่พบ docker-compose.yml
  pause
  exit /b 1
)

echo [1/4] ปิด container เดิม...
docker compose down
if errorlevel 1 goto :error

echo [2/4] Build Frontend + Backend ใหม่โดยไม่ใช้ Cache...
docker compose build --no-cache frontend backend
if errorlevel 1 goto :error

echo [3/4] เปิดระบบใหม่...
docker compose up -d --force-recreate
if errorlevel 1 goto :error

echo [4/4] ตรวจสถานะ...
docker compose ps

echo.
echo [SUCCESS] อัปเดตสิทธิ์ผู้ใช้งานเรียบร้อย
echo สิทธิ์ที่แสดงต้องมีเพียง: Admin / Supervisor / HR / บัญชี / View
echo เปิด: http://localhost:8081/?v=roles5-20260813
start "IT Asset Management" "http://localhost:8081/?v=roles5-20260813"
echo หาก browser เปิดหน้าเก่า ให้กด Ctrl+F5 หนึ่งครั้ง
pause
exit /b 0

:error
echo.
echo [ERROR] การ rebuild ไม่สำเร็จ กรุณาดูข้อความด้านบน
pause
exit /b 1
