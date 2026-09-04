@echo off
setlocal
cd /d "%~dp0"

echo ====================================================
echo   Remove DEMO data from IT Asset Database
echo ====================================================
echo.
echo This keeps the existing MySQL volume, Master Data,
echo and ADMIN-001. It removes demo employees, assets,
echo transactions, stock examples and related logs.
echo.
set /p CONFIRM=Type DELETE-DEMO to continue: 
if /I not "%CONFIRM%"=="DELETE-DEMO" (
  echo Cancelled.
  pause
  exit /b 1
)

set DEMO_SEED_ENABLED=false

echo [1/3] Building backend with cleanup script...
docker compose build backend
if errorlevel 1 goto :error

echo [2/3] Starting MySQL and backend...
docker compose up -d mysql backend
if errorlevel 1 goto :error

echo [3/3] Removing demo records in one database transaction...
docker compose exec -T backend node src/removeDemoData.js
if errorlevel 1 goto :error

echo.
echo Demo cleanup completed.
echo Open the system and press Ctrl+F5, then click Refresh.
pause
exit /b 0

:error
echo.
echo Cleanup failed. No partial cleanup should be committed.
echo Review the error above.
pause
exit /b 1
