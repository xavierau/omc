\set ON_ERROR_STOP 1
BEGIN;
\i /Users/xavierau/Code/js/whatsapp-crm--book-013/supabase/migrations/095_booking_staff_crud.sql
\echo '== 095 applied =='

INSERT INTO restaurants (id, name, slug, whatsapp_number) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'A', 'a-095', '+85200000001'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'B', 'b-095', '+85200000002');
INSERT INTO members (id, restaurant_id, phone) VALUES ('cccccccc-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', '+85291234567');

CREATE TEMP TABLE results (n serial, label text, ok boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp.check(label text, ok boolean, detail text DEFAULT '') RETURNS void AS $$
  INSERT INTO results (label, ok, detail) VALUES (label, ok, detail);
$$ LANGUAGE sql;

-- 1. staff create: confirmed, staff, actor, code, events row
SELECT pg_temp.check('create returns confirmed staff row with code',
  (SELECT b.status = 'confirmed' AND b.source = 'staff' AND b.created_by = '11111111-0000-4000-8000-000000000001'
          AND b.decided_by = b.created_by AND b.decided_at IS NOT NULL AND b.checkin_code = 'K7Q2MX' AND b.notify_diner
     FROM public.staff_create_booking('aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000003',
       '+85291234567', 'Mr Lam', 6, '2026-12-01', '19:00', 'window', true, '11111111-0000-4000-8000-000000000001',
       now(), ARRAY['K7Q2MX','P4MX8T'], '[]'::jsonb) b));
SELECT pg_temp.check('create wrote one booking.staff_created event without brokenRules',
  (SELECT count(*) = 1 AND bool_and(NOT (data_json ? 'brokenRules')) FROM events WHERE type = 'booking.staff_created'));

-- 2. R8: forced collision -> next code used
SELECT pg_temp.check('code clash retried with the next code',
  (SELECT b.checkin_code = 'P4MX8T'
     FROM public.staff_create_booking('aaaaaaaa-0000-4000-8000-000000000001', NULL, '+85290000002', 'Two', 2,
       '2026-12-01', '19:30', NULL, false, '11111111-0000-4000-8000-000000000001', now(),
       ARRAY['K7Q2MX','P4MX8T'], '["slot_full"]'::jsonb) b));
SELECT pg_temp.check('override create records brokenRules', (SELECT count(*) = 1 FROM events WHERE type = 'booking.staff_created' AND data_json->'brokenRules' = '["slot_full"]'::jsonb));
SELECT pg_temp.check('same code allowed at another restaurant',
  (SELECT b.checkin_code = 'K7Q2MX'
     FROM public.staff_create_booking('bbbbbbbb-0000-4000-8000-000000000002', NULL, '+85290000003', 'Other', 2,
       '2026-12-01', '19:00', NULL, true, '22222222-0000-4000-8000-000000000002', now(), ARRAY['K7Q2MX'], '[]'::jsonb) b));
DO $$ BEGIN
  PERFORM public.staff_create_booking('aaaaaaaa-0000-4000-8000-000000000001', NULL, '+85290000004', 'X', 2,
    '2026-12-01', '20:00', NULL, true, '11111111-0000-4000-8000-000000000001', now(), ARRAY['K7Q2MX','P4MX8T'], '[]'::jsonb);
  PERFORM pg_temp.check('all codes clash -> raises', false, 'did not raise');
EXCEPTION WHEN unique_violation THEN PERFORM pg_temp.check('all codes clash -> raises 23505', true);
END $$;

-- 3. constraints
DO $$ BEGIN
  UPDATE booking_requests SET checkin_code = 'O0O0O0' WHERE checkin_code = 'K7Q2MX' AND restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000001';
  PERFORM pg_temp.check('code alphabet check', false, 'accepted O/0');
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.check('code alphabet check rejects O/0', true);
END $$;
DO $$ BEGIN
  UPDATE booking_requests SET cancelled_by = 'bogus' WHERE checkin_code = 'K7Q2MX';
  PERFORM pg_temp.check('cancelled_by vocabulary', false, 'accepted bogus');
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.check('cancelled_by rejects unknown value', true);
END $$;
DO $$ BEGIN
  INSERT INTO booking_requests (restaurant_id, phone, party_size, booking_date, booking_time, status, decided_at, source, no_show_marked_at, checked_in_at)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001', '+85290000009', 2, '2026-11-01', '19:00', 'no_show', now(), 'staff', now(), now());
  PERFORM pg_temp.check('checked_in vs no_show', false, 'accepted both');
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.check('checked_in and no_show exclude each other', true);
END $$;
DO $$ BEGIN
  INSERT INTO booking_requests (restaurant_id, phone, party_size, booking_date, booking_time, status, source, checkin_qr_path)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001', '+85290000009', 2, '2026-11-01', '19:00', 'pending', 'chat', 'K7Q2MX.png');
  PERFORM pg_temp.check('qr path shape', false, 'accepted short path');
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.check('qr path must be >=22 random chars', true);
END $$;

-- 4. edit: stale updated_at -> no row, no event; fresh -> row + event, reminder cleared
UPDATE booking_requests SET reminder_sent_at = now() WHERE checkin_code = 'K7Q2MX' AND restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000001';
CREATE TEMP TABLE b1 AS SELECT id, updated_at FROM booking_requests WHERE checkin_code = 'K7Q2MX' AND restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000001';
SELECT pg_temp.check('edit with stale updated_at changes nothing',
  (SELECT count(*) = 0 FROM b1, public.staff_update_booking(b1.id, 'aaaaaaaa-0000-4000-8000-000000000001', 'confirmed',
     b1.updated_at - interval '1 second', NULL, '+85291234567', 'Mr Lam', 4, '2026-12-01', '19:30', NULL, true, true,
     '11111111-0000-4000-8000-000000000001', '["time"]'::jsonb, '[]'::jsonb)));
SELECT pg_temp.check('edit from another restaurant changes nothing',
  (SELECT count(*) = 0 FROM b1, public.staff_update_booking(b1.id, 'bbbbbbbb-0000-4000-8000-000000000002', 'confirmed',
     b1.updated_at, NULL, '+85291234567', 'Mr Lam', 4, '2026-12-01', '19:30', NULL, true, true,
     '22222222-0000-4000-8000-000000000002', '["time"]'::jsonb, '[]'::jsonb)));
SELECT pg_temp.check('no edit event after refused edits', (SELECT count(*) = 0 FROM events WHERE type = 'booking.staff_edited'));
SELECT pg_temp.check('fresh edit: values, updated_by, reminder cleared, status and code kept',
  (SELECT u.party_size = 4 AND u.booking_time = '19:30' AND u.reminder_sent_at IS NULL AND u.status = 'confirmed'
          AND u.checkin_code = 'K7Q2MX' AND u.updated_by = '11111111-0000-4000-8000-000000000001' AND u.member_id IS NULL
     FROM b1, public.staff_update_booking(b1.id, 'aaaaaaaa-0000-4000-8000-000000000001', 'confirmed',
     b1.updated_at, NULL, '+85291234567', 'Mr Lam', 4, '2026-12-01', '19:30', NULL, true, true,
     '11111111-0000-4000-8000-000000000001', '["time","partySize"]'::jsonb, '[]'::jsonb) u));
SELECT pg_temp.check('edit event names fields only', (SELECT count(*) = 1 AND bool_and(data_json->'changed' = '["time","partySize"]'::jsonb) FROM events WHERE type = 'booking.staff_edited'));

-- 5. open change blocks edit/cancel/check-in
CREATE TEMP TABLE b2 AS SELECT id, updated_at FROM booking_requests WHERE checkin_code = 'P4MX8T';
INSERT INTO booking_requests (restaurant_id, phone, party_size, booking_date, booking_time, status, source, replaces_booking_id)
  SELECT 'aaaaaaaa-0000-4000-8000-000000000001', '+85290000002', 3, '2026-12-02', '19:00', 'pending', 'agent', id FROM b2;
SELECT pg_temp.check('edit refused with open change',
  (SELECT count(*) = 0 FROM b2, public.staff_update_booking(b2.id, 'aaaaaaaa-0000-4000-8000-000000000001', 'confirmed',
     b2.updated_at, NULL, '+85290000002', 'Two', 2, '2026-12-01', '19:30', NULL, false, false,
     '11111111-0000-4000-8000-000000000001', '["notes"]'::jsonb, '[]'::jsonb)));
SELECT pg_temp.check('cancel refused with open change',
  (SELECT count(*) = 0 FROM b2, public.staff_cancel_booking(b2.id, 'aaaaaaaa-0000-4000-8000-000000000001', b2.updated_at, '11111111-0000-4000-8000-000000000001', now())));

-- 6. confirm_booking_change mints a code; original cancelled by change
SELECT pg_temp.check('confirm change mints code (clash retried)',
  (SELECT c.status = 'confirmed' AND c.checkin_code = 'T9DK2V'
     FROM public.confirm_booking_change((SELECT id FROM booking_requests WHERE replaces_booking_id = (SELECT id FROM b2)),
       'aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', now(), ARRAY['K7Q2MX','T9DK2V']) c));
SELECT pg_temp.check('original cancelled by change', (SELECT status = 'cancelled' AND cancelled_by = 'change' FROM booking_requests WHERE id = (SELECT id FROM b2)));
SELECT pg_temp.check('4-arg confirm_booking_change still exists',
  (SELECT count(*) = 2 FROM pg_proc WHERE proname = 'confirm_booking_change'));

-- 7. cancel: stale refused, fresh -> cancelled by staff
CREATE TEMP TABLE b3 AS SELECT id, updated_at FROM booking_requests WHERE checkin_code = 'K7Q2MX' AND restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000001';
SELECT pg_temp.check('cancel stale refused', (SELECT count(*) = 0 FROM b3, public.staff_cancel_booking(b3.id, 'aaaaaaaa-0000-4000-8000-000000000001', b3.updated_at - interval '1 ms', '11111111-0000-4000-8000-000000000001', now())));
SELECT pg_temp.check('cancel -> cancelled by staff + user + time',
  (SELECT c.status = 'cancelled' AND c.cancelled_by = 'staff' AND c.cancelled_by_user = '11111111-0000-4000-8000-000000000001' AND c.cancelled_at IS NOT NULL
     FROM b3, public.staff_cancel_booking(b3.id, 'aaaaaaaa-0000-4000-8000-000000000001', b3.updated_at, '11111111-0000-4000-8000-000000000001', now()) c));
SELECT pg_temp.check('cancel again -> nothing', (SELECT count(*) = 0 FROM b3, public.staff_cancel_booking(b3.id, 'aaaaaaaa-0000-4000-8000-000000000001', (SELECT updated_at FROM booking_requests WHERE id = b3.id), '11111111-0000-4000-8000-000000000001', now())));
SELECT pg_temp.check('one cancel event', (SELECT count(*) = 1 FROM events WHERE type = 'booking.staff_cancelled'));

-- 8. check-in: only today + confirmed; no-show refused when checked in; undo clears
CREATE TEMP TABLE t AS SELECT b.id FROM public.staff_create_booking('aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000003',
  '+85291234567', 'Today', 2, '2026-11-26', '12:00', NULL, true, '11111111-0000-4000-8000-000000000001', now(), ARRAY['H2RW9C'], '[]'::jsonb) b;
SELECT pg_temp.check('check-in refused for another day', (SELECT count(*) = 0 FROM t, public.booking_check_in(t.id, 'aaaaaaaa-0000-4000-8000-000000000001', '2026-11-27', '11111111-0000-4000-8000-000000000001', now())));
SELECT pg_temp.check('check-in refused for another restaurant', (SELECT count(*) = 0 FROM t, public.booking_check_in(t.id, 'bbbbbbbb-0000-4000-8000-000000000002', '2026-11-26', '11111111-0000-4000-8000-000000000001', now())));
SELECT pg_temp.check('check-in today sets at/by, status stays confirmed',
  (SELECT c.checked_in_at IS NOT NULL AND c.checked_in_by = '11111111-0000-4000-8000-000000000001' AND c.status = 'confirmed'
     FROM t, public.booking_check_in(t.id, 'aaaaaaaa-0000-4000-8000-000000000001', '2026-11-26', '11111111-0000-4000-8000-000000000001', now()) c));
SELECT pg_temp.check('check-in twice -> nothing', (SELECT count(*) = 0 FROM t, public.booking_check_in(t.id, 'aaaaaaaa-0000-4000-8000-000000000001', '2026-11-26', '11111111-0000-4000-8000-000000000001', now())));
SELECT pg_temp.check('no-show refused when checked in',
  (SELECT count(*) = 0 FROM t, public.mark_booking_no_show(t.id, 'aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', now(), '2026-11-26', '23:59')));
SELECT pg_temp.check('member stats count arrived',
  (SELECT s.arrived = 1 AND s.total = 1 FROM public.member_booking_stats('cccccccc-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', '2026-11-26', '23:59') s));
SELECT pg_temp.check('undo clears checked_in only',
  (SELECT u.checked_in_at IS NULL AND u.checked_in_by IS NULL AND u.status = 'confirmed'
     FROM t, public.booking_check_in_undo(t.id, 'aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001') u));
SELECT pg_temp.check('no-show allowed after undo',
  (SELECT count(*) = 1 FROM t, public.mark_booking_no_show(t.id, 'aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', now(), '2026-11-26', '23:59')));
SELECT pg_temp.check('check-in refused on no_show', (SELECT count(*) = 0 FROM t, public.booking_check_in(t.id, 'aaaaaaaa-0000-4000-8000-000000000001', '2026-11-26', '11111111-0000-4000-8000-000000000001', now())));
SELECT pg_temp.check('events: 1 checked_in, 1 undone', (SELECT count(*) FILTER (WHERE type = 'booking.checked_in') = 1 AND count(*) FILTER (WHERE type = 'booking.check_in_undone') = 1 FROM events));

-- 9. reminder candidates skip notify_diner = false
INSERT INTO booking_requests (restaurant_id, phone, party_size, booking_date, booking_time, status, decided_at, source, notify_diner, created_at)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', '+85290000011', 2, '2026-11-27', '20:00', 'confirmed', now(), 'staff', true, '2026-11-20'),
       ('aaaaaaaa-0000-4000-8000-000000000001', '+85290000012', 2, '2026-11-27', '20:00', 'confirmed', now(), 'staff', false, '2026-11-20');
SELECT pg_temp.check('reminder candidates skip notify off',
  (SELECT array_agg(phone ORDER BY phone) = ARRAY['+85290000011'] FROM public.booking_reminder_candidates('2026-11-27T10:30:00Z', 3, 50)));

-- 10. bucket + grants
SELECT pg_temp.check('qr bucket public png only', (SELECT public AND allowed_mime_types = ARRAY['image/png'] FROM storage.buckets WHERE id = 'booking-checkin-qr'));
SELECT pg_temp.check('no storage.objects policy for anon (no list)', (SELECT count(*) = 0 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects' AND 'anon' = ANY(roles)));
SELECT pg_temp.check('new RPCs not executable by anon',
  (SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE')) FROM pg_proc p WHERE p.proname IN
    ('staff_create_booking','staff_update_booking','staff_cancel_booking','booking_check_in','booking_check_in_undo','confirm_booking_change','member_booking_stats')));

SELECT n, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, label, detail FROM results ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS failed FROM results;
ROLLBACK;
