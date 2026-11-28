#!/bin/sh
# BOOK-014 W6b: create the fake admin walk-admin@example.test in the isolated local GoTrue, then seed-w6b.sql.
# $1 = env file (API_URL, SERVICE_ROLE_KEY from `supabase status -o env`), $2 = password file.
set -eu
. "$1"
PW=$(cat "$2")
DIR=$(cd "$(dirname "$0")" && pwd)
export PGPASSWORD=postgres
Q() { psql -X -h 127.0.0.1 -p 55622 -U postgres -d postgres -Atc "$1"; }
ADMIN=$(Q "select id from auth.users where email='walk-admin@example.test'")
if [ -z "$ADMIN" ]; then
  curl -s -o /dev/null -X POST "$API_URL/auth/v1/admin/users" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H 'content-type: application/json' --data "{\"email\":\"walk-admin@example.test\",\"password\":\"$PW\",\"email_confirm\":true,\"user_metadata\":{\"full_name\":\"Walk Admin\"}}"
  ADMIN=$(Q "select id from auth.users where email='walk-admin@example.test'")
fi
[ -n "$ADMIN" ] || { echo "no admin user"; exit 1; }
psql -X -h 127.0.0.1 -p 55622 -U postgres -d postgres -q -v admin_id="$ADMIN" -f "$DIR/seed-w6b.sql"
echo "seeded (admin $ADMIN)"
