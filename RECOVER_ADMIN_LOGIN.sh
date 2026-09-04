#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
echo "[1/4] Build backend without cache"
docker compose build --no-cache backend
echo "[2/4] Start MySQL + backend"
docker compose up -d --force-recreate mysql backend
sleep 3
echo "[3/4] Reset Admin"
docker compose exec -T backend node src/resetAdmin.js
echo "[4/4] Start frontend"
docker compose up -d frontend
printf '\nAdmin login:\n  Email: admin@company.local\n  Password: admin123\n  Role: ADMIN\n'
