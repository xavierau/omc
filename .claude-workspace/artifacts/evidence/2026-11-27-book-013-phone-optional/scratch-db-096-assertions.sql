\set ON_ERROR_STOP 1
-- BOOK-013 decision 9 (spec S8 AC-26..AC-29, threat R19/R20): migration 096.
-- Each risky call runs in its own DO block that records FAIL on an error, so
-- the red run (095 alone) lists every failing check instead of stopping.
BEGIN;
INSERT INTO restaurants (id, name, slug, whatsapp_number) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'A', 'a-096', '+85200000001');
INSERT INTO members (id, restaurant_id, phone) VALUES ('cccccccc-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', '+85291234567');

-- Rows that exist before 096 (one per source): they must come through untouched.
INSERT INTO booking_requests (id, restaurant_id, phone, name, party_size, booking_date, booking_time, status, decided_at, source, notify_diner, created_at)
VALUES ('00000000-0000-4000-8000-0000000000c1', 'aaaaaaaa-0000-4000-8000-000000000001', '+85290000001', 'Chat', 2, '2026-12-01', '19:00', 'confirmed', '2026-11-20', 'chat', true, '2026-11-20'),
       ('00000000-0000-4000-8000-0000000000a1', 'aaaaaaaa-0000-4000-8000-000000000001', '+85290000002', 'Agent', 2, '2026-12-01', '19:00', 'confirmed', '2026-11-20', 'agent', true, '2026-11-20'),
       ('00000000-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-000000000001', '+85290000003', 'Staff', 2, '2026-12-01', '19:30', 'confirmed', '2026-11-20', 'staff', true, '2026-11-20')
ON CONFLICT DO NOTHING;
CREATE TEMP TABLE before_rows AS SELECT * FROM booking_requests;

\i :migration
\echo '== migration applied =='

CREATE TEMP TABLE results (n serial, label text, ok boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp.check(label text, ok boolean, detail text DEFAULT '') RETURNS void AS $$
  INSERT INTO results (label, ok, detail) VALUES (label, ok, detail);
$$ LANGUAGE sql;

-- 1. schema
SELECT pg_temp.check('booking_requests.phone is nullable',
  (SELECT is_nullable = 'YES' FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'booking_requests' AND column_name = 'phone'));
SELECT pg_temp.check('CHECK phone IS NOT NULL OR source = staff exists',
  (SELECT count(*) = 1 FROM pg_constraint WHERE conrelid = 'booking_requests'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%phone IS NOT NULL%source%staff%'),
  (SELECT string_agg(conname, ',') FROM pg_constraint WHERE conrelid = 'booking_requests'::regclass AND contype = 'c' AND conname LIKE '%phone%'));
SELECT pg_temp.check('CHECK phone IS NOT NULL OR notify_diner = false exists',
  (SELECT count(*) = 1 FROM pg_constraint WHERE conrelid = 'booking_requests'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) ILIKE '%phone IS NOT NULL%notify_diner = false%'));

-- 2. existing rows untouched
SELECT pg_temp.check('existing rows unchanged (every column)',
  (SELECT count(*) = 0 FROM (SELECT * FROM before_rows EXCEPT SELECT * FROM booking_requests) d)
  AND (SELECT count(*) FROM booking_requests) = (SELECT count(*) FROM before_rows));

-- 3. AC-26 / R19: staff create without a phone, Notify asked on → stored off
DO $$ DECLARE r booking_requests; BEGIN
  SELECT * INTO r FROM public.staff_create_booking('aaaaaaaa-0000-4000-8000-000000000001', NULL, NULL, 'Walk-in Ho', 3,
    '2026-12-02', '19:00', NULL, true, '11111111-0000-4000-8000-000000000001', now(), '[]'::jsonb);
  PERFORM pg_temp.check('staff create with no phone: saved confirmed staff, no member, notify forced false',
    r.id IS NOT NULL AND r.phone IS NULL AND r.member_id IS NULL AND r.status = 'confirmed' AND r.source = 'staff' AND NOT r.notify_diner,
    format('phone=%s notify=%s', r.phone, r.notify_diner));
  PERFORM pg_temp.check('staff create with no phone wrote its staff_created event',
    (SELECT count(*) = 1 FROM events WHERE type = 'booking.staff_created' AND data_json->>'bookingId' = r.id::text));
EXCEPTION WHEN OTHERS THEN
  PERFORM pg_temp.check('staff create with no phone: saved confirmed staff, no member, notify forced false', false, SQLERRM);
END $$;
DO $$ DECLARE r booking_requests; BEGIN
  SELECT * INTO r FROM public.staff_create_booking('aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000003', '+85291234567', 'Chan', 2,
    '2026-12-02', '19:30', NULL, true, '11111111-0000-4000-8000-000000000001', now(), '[]'::jsonb);
  PERFORM pg_temp.check('staff create with a phone keeps Notify on', r.phone = '+85291234567' AND r.notify_diner);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.check('staff create with a phone keeps Notify on', false, SQLERRM);
END $$;

-- 4. AC-29: a phone-less row from any diner channel is refused; phone-less with Notify on is refused
DO $$ DECLARE src text; BEGIN
  FOREACH src IN ARRAY ARRAY['chat', 'campaign', 'agent'] LOOP
    BEGIN
      INSERT INTO booking_requests (restaurant_id, phone, name, party_size, booking_date, booking_time, status, source, notify_diner)
      VALUES ('aaaaaaaa-0000-4000-8000-000000000001', NULL, 'X', 2, '2026-12-03', '19:00', 'pending', src, false);
      PERFORM pg_temp.check(format('phone-less %s row refused', src), false, 'inserted');
    EXCEPTION WHEN check_violation THEN PERFORM pg_temp.check(format('phone-less %s row refused', src), true, SQLERRM);
              WHEN OTHERS THEN PERFORM pg_temp.check(format('phone-less %s row refused', src), false, SQLSTATE || ' ' || SQLERRM);
    END;
  END LOOP;
END $$;
DO $$ BEGIN
  INSERT INTO booking_requests (restaurant_id, phone, name, party_size, booking_date, booking_time, status, source, notify_diner)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001', NULL, 'X', 2, '2026-12-03', '19:00', 'pending', 'staff', true);
  PERFORM pg_temp.check('phone-less staff row with notify_diner true refused', false, 'inserted');
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.check('phone-less staff row with notify_diner true refused', true, SQLERRM);
          WHEN OTHERS THEN PERFORM pg_temp.check('phone-less staff row with notify_diner true refused', false, SQLSTATE || ' ' || SQLERRM);
END $$;
DO $$ BEGIN
  UPDATE booking_requests SET phone = NULL WHERE id = '00000000-0000-4000-8000-0000000000c1';
  PERFORM pg_temp.check('a raw UPDATE clearing a chat row''s phone is refused', false, 'updated');
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.check('a raw UPDATE clearing a chat row''s phone is refused', true, SQLERRM);
          WHEN OTHERS THEN PERFORM pg_temp.check('a raw UPDATE clearing a chat row''s phone is refused', false, SQLSTATE || ' ' || SQLERRM);
END $$;

-- 5. AC-28 / R20: staff_update_booking clears a staff phone (Notify forced off), never another source's
CREATE TEMP TABLE ev0 AS SELECT count(*) AS n FROM events WHERE type = 'booking.staff_edited';
DO $$ DECLARE r booking_requests; v int; BEGIN
  SELECT edit_version INTO v FROM booking_requests WHERE id = '00000000-0000-4000-8000-0000000000f1';
  SELECT * INTO r FROM public.staff_update_booking('00000000-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-000000000001', 'confirmed', v,
    NULL, NULL, 'Staff', 2, '2026-12-01', '19:30', NULL, true, false, '11111111-0000-4000-8000-000000000001', '["phone","notify"]'::jsonb, '[]'::jsonb);
  PERFORM pg_temp.check('clear phone on a staff row: phone null, member null, notify forced false, version moved',
    r.id IS NOT NULL AND r.phone IS NULL AND r.member_id IS NULL AND NOT r.notify_diner AND r.edit_version = v + 1,
    format('phone=%s notify=%s v=%s', r.phone, r.notify_diner, r.edit_version));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.check('clear phone on a staff row: phone null, member null, notify forced false, version moved', false, SQLERRM);
END $$;
DO $$ DECLARE n int; rid uuid; BEGIN
  FOREACH rid IN ARRAY ARRAY['00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000a1']::uuid[] LOOP
    SELECT count(*) INTO n FROM public.staff_update_booking(rid, 'aaaaaaaa-0000-4000-8000-000000000001', 'confirmed',
      (SELECT edit_version FROM booking_requests WHERE id = rid), NULL, NULL, 'X', 2, '2026-12-01', '19:00', NULL, false, false,
      '11111111-0000-4000-8000-000000000001', '["phone"]'::jsonb, '[]'::jsonb);
    PERFORM pg_temp.check(format('clear phone on a non-staff row (%s): no row changed', rid), n = 0, format('%s rows', n));
  END LOOP;
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.check('clear phone on a non-staff row: no row changed', false, SQLSTATE || ' ' || SQLERRM);
END $$;
SELECT pg_temp.check('non-staff rows still as before (phone, name, version)',
  (SELECT count(*) = 0 FROM (SELECT * FROM before_rows WHERE source <> 'staff' EXCEPT SELECT * FROM booking_requests) d));
SELECT pg_temp.check('the refused clears wrote no staff_edited event',
  (SELECT count(*) - (SELECT n FROM ev0) = 1 FROM events WHERE type = 'booking.staff_edited'));
DO $$ DECLARE r booking_requests; BEGIN
  SELECT * INTO r FROM public.staff_update_booking('00000000-0000-4000-8000-0000000000f1', 'aaaaaaaa-0000-4000-8000-000000000001', 'confirmed',
    (SELECT edit_version FROM booking_requests WHERE id = '00000000-0000-4000-8000-0000000000f1'),
    'cccccccc-0000-4000-8000-000000000003', '+85291234567', 'Staff', 2, '2026-12-01', '19:30', NULL, true, false,
    '11111111-0000-4000-8000-000000000001', '["phone","notify"]'::jsonb, '[]'::jsonb);
  PERFORM pg_temp.check('add a phone back: phone, member and Notify on stored', r.phone = '+85291234567' AND r.member_id IS NOT NULL AND r.notify_diner);
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.check('add a phone back: phone, member and Notify on stored', false, SQLERRM);
END $$;

-- 6. R19: a phone-less booking is never a reminder candidate
DO $$ BEGIN
  INSERT INTO booking_requests (restaurant_id, phone, name, party_size, booking_date, booking_time, status, decided_at, source, notify_diner, created_at)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001', NULL, 'NoPhone', 2, '2026-11-27', '20:00', 'confirmed', now(), 'staff', false, '2026-11-20'),
         ('aaaaaaaa-0000-4000-8000-000000000001', '+85290000011', 'Phone', 2, '2026-11-27', '20:00', 'confirmed', now(), 'staff', true, '2026-11-20');
  PERFORM pg_temp.check('reminder candidates: the phone-less booking is never selected',
    (SELECT array_agg(coalesce(phone, 'NULL') ORDER BY phone) = ARRAY['+85290000011']
       FROM public.booking_reminder_candidates('2026-11-27T10:30:00Z', 3, 50) WHERE booking_date = '2026-11-27'));
EXCEPTION WHEN OTHERS THEN PERFORM pg_temp.check('reminder candidates: the phone-less booking is never selected', false, SQLERRM);
END $$;

-- 7. grants and signatures unchanged
SELECT pg_temp.check('staff create/update: one each, 095 signatures',
  (SELECT count(*) = 2 FROM pg_proc p WHERE (p.proname = 'staff_create_booking' AND p.pronargs = 12) OR (p.proname = 'staff_update_booking' AND p.pronargs = 16))
  AND (SELECT count(*) = 2 FROM pg_proc WHERE proname IN ('staff_create_booking', 'staff_update_booking')));
SELECT pg_temp.check('staff create/update not executable by anon or authenticated; executable by service_role',
  (SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE')
                   AND has_function_privilege('service_role', p.oid, 'EXECUTE'))
     FROM pg_proc p WHERE p.proname IN ('staff_create_booking', 'staff_update_booking', 'staff_cancel_booking', 'booking_check_in', 'booking_check_in_undo')));
SELECT pg_temp.check('search_path still pinned on both',
  (SELECT bool_and(array_to_string(proconfig, ',') LIKE '%search_path=public, pg_temp%') FROM pg_proc WHERE proname IN ('staff_create_booking', 'staff_update_booking')));

SELECT n, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, label, detail FROM results ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS failed FROM results;
ROLLBACK;
