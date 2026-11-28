#!/bin/sh
# BOOK-013 decision 9 r2 walk (AC-26 manual link): create (or reset the password of) the fake admin
# walk-admin@example.test through local GoTrue, then seed (seed-walk.sql, r3's, unchanged).
# $1 = env file with API_URL and SERVICE_ROLE_KEY (from `supabase status -o env`), $2 = password file.
set -eu
. "$1"
PW=$(cat "$2")
DIR=$(dirname "$0")/../2026-11-27-book-013-phone-optional
Q="PGPASSWORD=postgres psql -h 127.0.0.1 -p "${PGPORT:-55422}" -U postgres -d postgres -Atc"
ADMIN=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p "${PGPORT:-55422}" -U postgres -d postgres -Atc "select id from auth.users where email='walk-admin@example.test'")
if [ -z "$ADMIN" ]; then
  curl -s -o /dev/null -X POST "$API_URL/auth/v1/admin/users" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H 'content-type: application/json' --data "{\"email\":\"walk-admin@example.test\",\"password\":\"$PW\",\"email_confirm\":true,\"user_metadata\":{\"full_name\":\"walk-admin\"}}"
  ADMIN=$(PGPASSWORD=postgres psql -h 127.0.0.1 -p "${PGPORT:-55422}" -U postgres -d postgres -Atc "select id from auth.users where email='walk-admin@example.test'")
else
  curl -s -o /dev/null -X PUT "$API_URL/auth/v1/admin/users/$ADMIN" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H 'content-type: application/json' --data "{\"password\":\"$PW\"}"
fi
[ -n "$ADMIN" ] || { echo "no admin user"; exit 1; }
PGPASSWORD=postgres psql -h 127.0.0.1 -p "${PGPORT:-55422}" -U postgres -d postgres -q -v admin_id="$ADMIN" -f "$DIR/seed-walk.sql"
echo "seeded (admin $ADMIN)"
# r2: one phone-less staff booking today (AC-26), unlinked, notify off.
PGPASSWORD=postgres psql -h 127.0.0.1 -p "${PGPORT:-55422}" -U postgres -d postgres -q -c "INSERT INTO booking_requests (restaurant_id, phone, name, party_size, booking_date, booking_time, status, decided_at, source, created_by, notify_diner) VALUES ('11111111-1111-4111-8111-111111111111', NULL, 'Walk-in Ho', 3, (now() AT TIME ZONE 'Asia/Hong_Kong')::date, '18:30', 'confirmed', now(), 'staff', '$ADMIN', false)"
echo "r2: phone-less Walk-in Ho added"
