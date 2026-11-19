#!/bin/sh
# CAMP-016 local-stack seed (synthetic data only). Re-runnable: deletes its own restaurant first.
set -eu
S=$(cd "$(dirname "$0")" && pwd)
set -a; . $S/sb.env; set +a
R=c0160000-0000-4000-8000-000000000016
mk_user() { # email -> id (creates or finds)
  PW=$(openssl rand -hex 16)
  OUT=$(curl -sS -X POST "$API_URL/auth/v1/admin/users" -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
    -H 'Content-Type: application/json' -d "{\"email\":\"$1\",\"password\":\"$PW\",\"email_confirm\":true}")
  ID=$(printf '%s' "$OUT" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("id",""))')
  printf '%s\n' "$1|$PW|$ID"
}
: > $S/login.env; chmod 600 $S/login.env
A=$(mk_user camp016-admin@example.test); ST=$(mk_user camp016-staff@example.test)
printf 'ADMIN=%s\nSTAFF=%s\n' "$A" "$ST" >> $S/login.env
AID=$(printf '%s' "$A" | cut -d'|' -f3); SID=$(printf '%s' "$ST" | cut -d'|' -f3)
/opt/homebrew/bin/psql "$DB_URL" -v ON_ERROR_STOP=1 -q <<SQL
delete from restaurants where id = '$R';
insert into restaurants (id, name, slug, whatsapp_number, status) values ('$R', 'Cafe Poppy (CAMP-016 local)', 'camp016-local', '+85200000016', 'active');
insert into user_tenants (user_id, restaurant_id, role) values ('$AID', '$R', 'admin'), ('$SID', '$R', 'staff');
insert into tags (id, restaurant_id, name) values
  ('c0160000-0000-4000-8000-0000000000a1', '$R', 'VIP'),
  ('c0160000-0000-4000-8000-0000000000a2', '$R', 'Lunch regulars');
-- 120 members: g 1..90 green, 91..100 yellow, 101..103 red (rate), 104..106 unreachable, 107..120 no data.
-- last visit: odd g 40+ days ago (lapsed at 30), even g 5 days ago, every 10th never visited.
insert into members (id, restaurant_id, phone, name, status, last_visit_at, unreachable_at)
select ('c0161000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, '$R', '+8529016' || lpad(g::text, 4, '0'), 'Member ' || g, 'active',
       case when g % 10 = 0 then null when g % 2 = 1 then now() - interval '45 days' else now() - interval '5 days' end,
       case when g between 104 and 106 then now() else null end
from generate_series(1, 120) g;
insert into member_tags (member_id, tag_id, restaurant_id)
select ('c0161000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'c0160000-0000-4000-8000-0000000000a1', '$R' from generate_series(1, 120) g where g % 3 = 0;
insert into member_tags (member_id, tag_id, restaurant_id)
select ('c0161000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 'c0160000-0000-4000-8000-0000000000a2', '$R' from generate_series(1, 120) g where g % 4 = 0;
-- messages in the window: green 10/10, yellow 7 delivered + 3 failed, red 2 delivered + 8 failed, unreachable 5 delivered
insert into whatsapp_messages (restaurant_id, member_id, phone_e164, direction, category, message_type, status, queued_at)
select '$R', ('c0161000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, '+8529016' || lpad(g::text, 4, '0'), 'outbound', 'marketing', 'template',
       case
         when g <= 90 then 'delivered'
         when g <= 100 then (case when n <= 7 then 'read' else 'failed' end)
         when g <= 103 then (case when n <= 2 then 'delivered' else 'failed' end)
         else 'delivered' end,
       now() - interval '3 days'
from generate_series(1, 106) g, generate_series(1, 10) n where not (g > 103 and n > 5);
select count(*) as members from members where restaurant_id = '$R';
SQL
