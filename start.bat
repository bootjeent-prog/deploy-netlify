@echo off
setlocal
where docker >nul 2>nul || (echo Please install Docker Desktop and start it first. & pause & exit /b 1)
docker compose version >nul 2>nul || (echo Docker Compose is not available. Please update Docker Desktop. & pause & exit /b 1)

echo Building and starting IT Asset ^& Inventory Management...
docker compose up -d --build --remove-orphans
if errorlevel 1 (echo Start failed. Run: docker compose logs & pause & exit /b 1)

echo Waiting for services...
timeout /t 5 /nobreak >nul
docker compose ps

echo.
echo Local URL: http://localhost:8081
echo QR from phone: open http://YOUR-IPV4:8081 first, then generate a new QR.
start "IT Asset Management" http://localhost:8081
pause
