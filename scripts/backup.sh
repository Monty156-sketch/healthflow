#!/usr/bin/env bash
# Makes one encrypted copy of the database.
#
#   DATABASE_URL=...  BACKUP_PASSPHRASE=...  scripts/backup.sh [output-folder]
#
# Writes healthflow-YYYY-MM-DD.dump.gpg. The dump is in pg_dump's custom
# format, so it restores with pg_restore. Needs pg_dump (version 16 or
# newer) and gpg. Use Neon's direct connection string, not the pooled one.
# Restore check:  gpg -d file.dump.gpg | pg_restore --list   (prints the contents)
set -euo pipefail
: "${DATABASE_URL:?Set DATABASE_URL to the database to copy.}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE. Without it the copy cannot be read, so keep it somewhere safe.}"
out="${1:-.}"
file="$out/healthflow-$(date -u +%F).dump.gpg"
mkdir -p "$out"
pg_dump --format=custom --no-owner --no-privileges "${DATABASE_URL/-pooler/}" \
  | gpg --batch --yes --pinentry-mode loopback --symmetric --cipher-algo AES256 --passphrase-fd 3 --output "$file" 3<<<"$BACKUP_PASSPHRASE"
# A copy that cannot be listed is not a backup.
gpg --batch --pinentry-mode loopback --passphrase-fd 3 --decrypt "$file" 3<<<"$BACKUP_PASSPHRASE" | pg_restore --list > /dev/null
echo "$file ($(du -h "$file" | cut -f1))"
