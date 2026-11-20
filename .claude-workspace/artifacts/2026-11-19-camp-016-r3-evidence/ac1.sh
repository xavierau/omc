#!/bin/sh
T=/Users/xavierau/Code/js/whatsapp-crm--camp-016
export PGPASSWORD=postgres
P() { /opt/homebrew/bin/psql -h 127.0.0.1 -p 15941 -U supabase_admin -d postgres -v ON_ERROR_STOP=1 "$@"; }
echo "== $(date -u +%FT%TZ) AC-1: scratch DB = migrations 001..085 (r3 build.sh 085, fresh container c16r3-db), then 086"
echo "-- pre-085 fixtures: an existing tenant (seeded by the 078 trigger) + an existing winback campaign"
P -tAc "INSERT INTO restaurants (id,name,slug,whatsapp_number) VALUES ('11111111-0000-0000-0000-0000000c0016','Pre085','pre085-c16','85290009901'); INSERT INTO campaigns (id,restaurant_id,type,template,target_audience) VALUES ('11111111-1111-0000-0000-0000000c0016','11111111-0000-0000-0000-0000000c0016','winback','hi','all');"
echo "-- tenant_campaign_settings rows: $(P -tAc 'select count(*) from tenant_campaign_settings'); restaurants: $(P -tAc 'select count(*) from restaurants'); campaigns: $(P -tAc 'select count(*) from campaigns')"
echo "-- apply 086"
P -f $T/supabase/migrations/086_campaign_audience_quality.sql 2>&1; echo "exit $?"
echo "-- apply 086 again (idempotent)"
P -q -f $T/supabase/migrations/086_campaign_audience_quality.sql 2>&1; echo "exit $?"
echo "-- existing tenant row (restaurant_id|skip_contact_quality|lapsed_after_days):"
P -tAc "select restaurant_id, skip_contact_quality, lapsed_after_days from tenant_campaign_settings where restaurant_id='11111111-0000-0000-0000-0000000c0016'"
echo "-- distinct (skip, lapsed) across ALL existing rows:"
P -tAc "select skip_contact_quality, lapsed_after_days, count(*) from tenant_campaign_settings group by 1,2"
echo "-- restaurants without a complete row (expect 0):"
P -tAc "select count(*) from restaurants r left join tenant_campaign_settings s on s.restaurant_id=r.id where s.id is null"
echo "-- existing campaigns (audience_skip_quality|audience_lapsed_days):"
P -tAc "select audience_skip_quality, coalesce(audience_lapsed_days::text,'NULL'), count(*) from campaigns group by 1,2"
echo "-- new tenant inserted after 085 (seeded by the 078 trigger):"
P -tAc "INSERT INTO restaurants (id,name,slug,whatsapp_number) VALUES ('22222222-0000-0000-0000-0000000c0016','Post085','post085-c16','85290009902')" >/dev/null
P -tAc "select restaurant_id, skip_contact_quality, lapsed_after_days, monthly_send_limit from tenant_campaign_settings where restaurant_id='22222222-0000-0000-0000-0000000c0016'"
echo "-- CHECKs reject bad values (expect 3 errors):"
P -tAc "update tenant_campaign_settings set skip_contact_quality='yellow' where restaurant_id='22222222-0000-0000-0000-0000000c0016'" 2>&1 | head -1
P -tAc "update tenant_campaign_settings set lapsed_after_days=366 where restaurant_id='22222222-0000-0000-0000-0000000c0016'" 2>&1 | head -1
P -tAc "update campaigns set audience_lapsed_days=0 where id='11111111-1111-0000-0000-0000000c0016'" 2>&1 | head -1
P -tAc "DELETE FROM restaurants WHERE id IN ('11111111-0000-0000-0000-0000000c0016','22222222-0000-0000-0000-0000000c0016')" >/dev/null
echo "-- campaign_audience_members signatures (expect exactly one, ending integer,uuid):"
P -tAc "select oid::regprocedure from pg_proc where proname='campaign_audience_members'"
