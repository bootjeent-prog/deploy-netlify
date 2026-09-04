@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ================================================
echo  Recover Admin Login
echo ================================================

where docker >nul 2>nul || (
  echo [ERROR] กรุณาเปิด Docker Desktop ก่อน
  pause
  exit /b 1
)

echo [1/4] Build Backend ใหม่โดยไม่ใช้ Cache...
docker compose build --no-cache backend
if errorlevel 1 goto :error

echo [2/4] เปิด MySQL และ Backend ใหม่...
docker compose up -d --force-recreate mysql backend
if errorlevel 1 goto :error

echo [3/4] รีเซ็ตบัญชี Admin...
timeout /t 3 /nobreak >nul
docker compose exec -T backend node src/resetAdmin.js
if errorlevel 1 goto :error

echo [4/4] เปิดระบบ...
docker compose up -d frontend
if errorlevel 1 goto :error

echo.
echo ================================================
echo [SUCCESS] Admin พร้อมใช้งาน
echo Username/Email: admin@company.local
echo Password      : admin123
echo Role          : ADMIN
echo ================================================
echo.
echo หากหน้า Login ยังขึ้นว่าถูกพัก 15 นาที ให้ Refresh หนึ่งครั้ง
start "IT Asset Management" "http://localhost:8081/?v=admin-recovered-20260813"
pause
exit /b 0

:error
echo.
echo [ERROR] กู้บัญชี Admin ไม่สำเร็จ กรุณาดูข้อความด้านบน
pause
exit /b 1
