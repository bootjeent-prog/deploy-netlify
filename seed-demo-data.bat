@echo off
setlocal
cd /d "%~dp0"
where docker >nul 2>nul || (echo Please install Docker Desktop and start it first. & pause & exit /b 1)
docker compose version >nul 2>nul || (echo Docker Compose is not available. Please update Docker Desktop. & pause & exit /b 1)

set DEMO_SEED_ENABLED=true
echo Building backend and inserting demo data into the existing MySQL database...
docker compose up -d --build backend
if errorlevel 1 (echo Demo seed failed. Run: docker compose logs backend & pause & exit /b 1)

echo Waiting for backend migration and demo seed...
timeout /t 8 /nobreak >nul
docker compose logs --tail=60 backend

echo.
echo Demo records use prefixes such as AST-DEMO, ASG-DEMO, TRF-DEMO and MNT-DEMO.
echo Existing business data is not deleted.
echo Open http://localhost:8081 and press Ctrl+F5.
pause
