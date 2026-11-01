#!/usr/bin/env bash
# Proves a backup can be restored. Restores one encrypted copy into a THROWAWAY database and prints row
# counts from it next to the same counts from the live database, so you can see they agree.
#
#   SOURCE_DATABASE_URL=...  RESTORE_DATABASE_URL=...  BACKUP_PASSPHRASE=...  scripts/restore-check.sh file.dump.gpg
#
# RESTORE_DATABASE_URL is overwritten (pg_restore --clean). It must be a different database from the source;
# the script refuses to run if the two point at the same host and database name.
set -euo pipefail
: "${SOURCE_DATABASE_URL:?Set SOURCE_DATABASE_URL (the live database, read only here).}"
: "${RESTORE_DATABASE_URL:?Set RESTORE_DATABASE_URL (a throwaway database, it is overwritten).}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE.}"
file="${1:?Give the .dump.gpg file.}"

where() { sed -E 's#^[a-z]+://[^@]*@##; s#\?.*$##; s#-pooler##' <<<"$1"; }
if [ "$(where "$SOURCE_DATABASE_URL")" = "$(where "$RESTORE_DATABASE_URL")" ]; then
  echo "Refusing: the restore target is the same database as the source. Use a separate throwaway branch." >&2
  exit 1
fi

tmp="$(mktemp)"; trap 'rm -f "$tmp"' EXIT
gpg --batch --yes --pinentry-mode loopback --passphrase-fd 3 --decrypt --output "$tmp" "$file" 3<<<"$BACKUP_PASSPHRASE"

set +e
pg_restore --clean --if-exists --no-owner --no-privileges --dbname "${RESTORE_DATABASE_URL/-pooler/}" "$tmp"
status=$?
set -e
echo "pg_restore finished with exit code $status (warnings about objects that did not exist yet are normal)."

counts='SELECT '"'"'Facility'"'"' AS tbl, count(*) FROM "Facility" UNION ALL SELECT '"'"'UserProfile'"'"', count(*) FROM "UserProfile" UNION ALL SELECT '"'"'Staff'"'"', count(*) FROM "Staff" UNION ALL SELECT '"'"'Roster'"'"', count(*) FROM "Roster" UNION ALL SELECT '"'"'RosterAssignment'"'"', count(*) FROM "RosterAssignment" UNION ALL SELECT '"'"'AuditLog'"'"', count(*) FROM "AuditLog" ORDER BY 1'
a="$(psql -At -F ' ' "${SOURCE_DATABASE_URL/-pooler/}" -c "$counts")"
b="$(psql -At -F ' ' "${RESTORE_DATABASE_URL/-pooler/}" -c "$counts")"
echo
echo "Rows in the live database:"; echo "$a"
echo; echo "Rows in the restored copy:"; echo "$b"
echo
if [ "$a" = "$b" ]; then
  echo "RESULT: the restored copy matches the live database."
else
  echo "RESULT: the counts differ. A few new rows since the backup was taken is normal; large gaps are not."
fi
