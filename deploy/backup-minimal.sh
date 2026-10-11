#!/usr/bin/env bash
# Hot backups only: no container/service restart, package updates or external service.
set -euo pipefail
umask 077
backup_root=${OFFERLY_BACKUP_ROOT:-/opt/offerly/backups/automatic}
db_container=${OFFERLY_DB_CONTAINER:-offerly-db-1}
db_user=${OFFERLY_DB_USER:-offerly}
db_name=${OFFERLY_DB_NAME:-offerly}
upload_volume=${OFFERLY_UPLOAD_VOLUME:-offerly_uploads}
env_file=${OFFERLY_ENV_FILE:-/opt/offerly/private/server.env}
if [[ ${1:-} == --latest ]]; then
  find "$backup_root" -maxdepth 1 -type f -name '????????T??????Z.tgz.sha256' -printf '%f\n' | sort | tail -1 | sed 's/\.sha256$//'
  exit
fi
[[ $EUID == 0 ]] || { echo 'Root is required to read private application backups'; exit 1; }
mkdir -p "$backup_root"
chmod 700 "$backup_root"
exec 9>/run/lock/offerly-backup.lock
flock -n 9 || exit 0
[[ $(df -Pk "$backup_root" | awk 'NR==2{print $4}') -gt 10485760 ]] || { echo 'Backup skipped: less than 10 GiB free'; exit 1; }
name=$(date -u +%Y%m%dT%H%M%SZ)
[[ ! -e $backup_root/$name.tgz ]] || { echo 'Backup name already exists'; exit 1; }
stage=$(mktemp -d "$backup_root/.partial.XXXXXXXX")
trap 'rm -rf -- "$stage"; rm -f -- "$backup_root/$name.tgz.partial"' EXIT
mkdir "$stage/uploads"
source_dir=$(docker volume inspect "$upload_volume" --format '{{.Mountpoint}}')
[[ $source_dir == /var/lib/docker/volumes/*/_data && -d $source_dir ]]
# Leave room for both staging and the archive, plus 10 GiB for normal site work.
database_bytes=$(docker exec "$db_container" psql -U "$db_user" -d "$db_name" -Atc 'SELECT pg_database_size(current_database())')
[[ $database_bytes =~ ^[0-9]+$ ]]
upload_kib=$(du -sk "$source_dir" | awk '{print $1}')
required_kib=$((2 * (database_bytes / 1024 + upload_kib) + 10485760))
[[ $(df -Pk "$backup_root" | awk 'NR==2{print $4}') -gt $required_kib ]] || { echo 'Backup skipped: insufficient disk reserve'; exit 1; }
[[ $(awk '/^MemAvailable:/{print $2}' /proc/meminfo) -gt 524288 ]] || { echo 'Backup skipped: less than 512 MiB memory available'; exit 1; }
# Keep the first copy while a second pass catches files created during pg_dump.
# Do not delete old files from the staged copy: the DB snapshot may reference them.
rsync -a "$source_dir/" "$stage/uploads/"
timeout 120 docker exec "$db_container" nice -n 19 pg_dump -U "$db_user" -d "$db_name" \
  --format=custom --compress=1 --no-owner --no-acl --lock-wait-timeout=5s > "$stage/database.dump"
rsync -a "$source_dir/" "$stage/uploads/"
docker exec -i "$db_container" pg_restore --list < "$stage/database.dump" > /dev/null
[[ -s $env_file ]]
cp "$env_file" "$stage/server.env"
cp /etc/caddy/Caddyfile "$stage/Caddyfile"
cp /opt/offerly/current/compose.yml "$stage/compose.yml"
cp /opt/offerly/current/deploy/compose.vps.yml "$stage/compose.vps.yml"
{
  printf 'created_utc=%s\n' "$name"
  printf 'release=%s\n' "$(readlink -f /opt/offerly/current)"
  docker inspect offerly-app-1 --format 'image={{.Config.Image}} digest={{.Image}}'
} > "$stage/metadata.txt"
(cd "$stage" && find uploads -type f -print0 | sort -z | xargs -0 -r sha256sum > uploads.sha256)
tar -C "$stage" -cf - . | gzip -1 > "$backup_root/$name.tgz.partial"
mv "$backup_root/$name.tgz.partial" "$backup_root/$name.tgz"
(cd "$backup_root" && sha256sum "$name.tgz" > "$name.tgz.sha256")
# Only files created by this script are rotated; historical manual backups stay intact.
find "$backup_root" -maxdepth 1 -type f -name '????????T??????Z.tgz' -printf '%f\n' |
  sort -r | tail -n +4 | while IFS= read -r old; do
    [[ $old =~ ^[0-9]{8}T[0-9]{6}Z\.tgz$ ]] || exit 1
    rm -f -- "$backup_root/$old" "$backup_root/$old.sha256"
  done
printf '%s backup complete: %s\n' "$(date -u +%FT%TZ)" "$name.tgz"
