#!/usr/bin/env sh
set -e
command -v docker >/dev/null 2>&1 || { printf '%s\n' 'Please install Docker and start it first.'; exit 1; }
docker compose version >/dev/null 2>&1 || { printf '%s\n' 'Docker Compose is not available. Please update Docker.'; exit 1; }
printf '%s\n' 'Building and starting IT Asset & Inventory Management...'
docker compose up -d --build --remove-orphans
docker compose ps
printf '%s\n' 'Local URL: http://localhost:8081'
printf '%s\n' 'For phone QR: open http://YOUR-IPV4:8081 first, then generate a new QR.'
