@echo off
setlocal
where docker >nul 2>nul || (echo Please install and start Docker Desktop first. & pause & exit /b 1)
docker compose ps mysql >nul 2>nul || (echo MySQL service is not available. Start the system first. & pause & exit /b 1)

if not exist backup mkdir backup
for /f %%I in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd_HHmmss"') do set TS=%%I
set FILE=backup\it_asset_db_%TS%.sql

echo Backing up MySQL to %FILE% ...
docker compose exec -T mysql sh -c "mysqldump --single-transaction --routines --triggers -u${MYSQL_USER} -p${MYSQL_PASSWORD} ${MYSQL_DATABASE}" > "%FILE%"
if errorlevel 1 (
  echo Backup failed. Delete the incomplete file before retrying.
  del /q "%FILE%" >nul 2>nul
  pause
  exit /b 1
)

for %%A in ("%FILE%") do if %%~zA LEQ 0 (
  echo Backup file is empty. Please check Docker logs.
  del /q "%FILE%" >nul 2>nul
  pause
  exit /b 1
)

echo Backup completed: %FILE%
pause
