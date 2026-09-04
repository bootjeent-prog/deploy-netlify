#!/usr/bin/env sh
set -eu
command -v docker >/dev/null 2>&1 || { echo "Docker is required."; exit 1; }
mkdir -p backup
file="backup/it_asset_db_$(date +%Y%m%d_%H%M%S).sql"
echo "Backing up MySQL to $file ..."
docker compose exec -T mysql sh -c 'mysqldump --single-transaction --routines --triggers -u"$MYSQL_USER" -p"$MYSQL_PASSWORD" "$MYSQL_DATABASE"' > "$file"
[ -s "$file" ] || { echo "Backup file is empty."; rm -f "$file"; exit 1; }
echo "Backup completed: $file"
