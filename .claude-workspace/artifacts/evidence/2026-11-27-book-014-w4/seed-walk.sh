#!/bin/sh
# BOOK-014 W4 AC-3: create (or reset the password of) the fake staff user walk-staff@example.test through the
# isolated local GoTrue, then run seed-walk.sql. $1 = env file (API_URL, SERVICE_ROLE_KEY), $2 = password file.
set -eu
. "$1"
PW=$(cat "$2")
DIR=$(cd "$(dirname "$0")" && pwd)
export PGPASSWORD=postgres
Q() { psql -X -h 127.0.0.1 -p 55622 -U postgres -d postgres -Atc "$1"; }
STAFF=$(Q "select id from auth.users where email='walk-staff@example.test'")
if [ -z "$STAFF" ]; then
  curl -s -o /dev/null -X POST "$API_URL/auth/v1/admin/users" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H 'content-type: application/json' --data "{\"email\":\"walk-staff@example.test\",\"password\":\"$PW\",\"email_confirm\":true,\"user_metadata\":{\"full_name\":\"Walk Staff\"}}"
  STAFF=$(Q "select id from auth.users where email='walk-staff@example.test'")
fi
[ -n "$STAFF" ] || { echo "no staff user"; exit 1; }
psql -X -h 127.0.0.1 -p 55622 -U postgres -d postgres -q -v staff_id="$STAFF" -f "$DIR/seed-walk.sql"
echo "seeded (staff $STAFF)"
