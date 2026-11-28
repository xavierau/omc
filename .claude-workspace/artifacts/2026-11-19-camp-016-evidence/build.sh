#!/bin/sh
# Rebuild postgres (copy of the image's initialised postgres db) + stubs + migrations with prefix <= $1
set -e
TREE=/Users/xavierau/Code/js/whatsapp-crm--camp-016
S=$(cd "$(dirname "$0")" && pwd)
export PGPASSWORD=postgres
P="rtk proxy psql -h 127.0.0.1 -p 15940 -U supabase_admin -v ON_ERROR_STOP=1 -q"
# uses the postgres db of the throwaway c16-db container (recreate the container to reset)
$P -d postgres -f "$S/stubs.sql"
for f in "$TREE"/supabase/migrations/*.sql; do
  n=$(basename "$f" | cut -c1-3)
  [ "$n" -le "$1" ] || continue
  $P -d postgres -f "$f" > /dev/null 2>>"$S/build-warn.log" || { echo "FAILED at $f"; exit 1; }
done
echo "built postgres through $1"
