\set ON_ERROR_STOP 1
-- BOOK-013 r3 (spec decision 8): 095 without the check-in code / QR. Same checks as
-- r2 for everything kept (create, edit, cancel, edit_version, check-in, no-show,
-- stats, reminders, grants) plus section 10: no code or QR object exists.
BEGIN;
\i :migration
\echo '== 095 applied =='

INSERT INTO restaurants (id, name, slug, whatsapp_number) VALUES
  ('aaaaaaaa-0000-4000-8000-000000000001', 'A', 'a-095', '+85200000001'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'B', 'b-095', '+85200000002');
INSERT INTO members (id, restaurant_id, phone) VALUES ('cccccccc-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', '+85291234567');

CREATE TEMP TABLE results (n serial, label text, ok boolean, detail text);
CREATE OR REPLACE FUNCTION pg_temp.check(label text, ok boolean, detail text DEFAULT '') RETURNS void AS $$
  INSERT INTO results (label, ok, detail) VALUES (label, ok, detail);
$$ LANGUAGE sql;

-- 1. staff create: confirmed, staff, actor, notify, events row
SELECT pg_temp.check('create returns confirmed staff row',
  (SELECT b.status = 'confirmed' AND b.source = 'staff' AND b.created_by = '11111111-0000-4000-8000-000000000001'
          AND b.decided_by = b.created_by AND b.decided_at IS NOT NULL AND b.notify_diner AND b.edit_version = 0
     FROM public.staff_create_booking('aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000003',
       '+85291234567', 'Mr Lam', 6, '2026-12-01', '19:00', 'window', true, '11111111-0000-4000-8000-000000000001',
       now(), '[]'::jsonb) b));
SELECT pg_temp.check('create wrote one booking.staff_created event without brokenRules',
  (SELECT count(*) = 1 AND bool_and(NOT (data_json ? 'brokenRules')) FROM events WHERE type = 'booking.staff_created'));
SELECT pg_temp.check('override create (Notify off) returns its row',
  (SELECT count(*) = 1 FROM public.staff_create_booking('aaaaaaaa-0000-4000-8000-000000000001', NULL, '+85290000002', 'Two', 2,
     '2026-12-01', '19:30', NULL, false, '11111111-0000-4000-8000-000000000001', now(), '["slot_full"]'::jsonb) b
   WHERE NOT b.notify_diner));
SELECT pg_temp.check('override create records brokenRules',
  (SELECT count(*) = 1 FROM events WHERE type = 'booking.staff_created' AND data_json->'brokenRules' = '["slot_full"]'::jsonb));
SELECT count(*) FROM public.staff_create_booking('aaaaaaaa-0000-4000-8000-000000000001', NULL, '+85290000004', 'X', 2,
  '2026-12-01', '19:00', NULL, true, '11111111-0000-4000-8000-000000000001', now(), '[]'::jsonb) \gset second_
SELECT pg_temp.check('two staff bookings at one restaurant, same slot, both stored (no unique code to clash)',
  (SELECT :second_count = 1 AND count(*) = 2 FROM booking_requests WHERE restaurant_id = 'aaaaaaaa-0000-4000-8000-000000000001' AND booking_time = '19:00' AND source = 'staff'));

-- 2. constraints
DO $$ BEGIN
  UPDATE booking_requests SET cancelled_by = 'bogus' WHERE phone = '+85291234567';
  PERFORM pg_temp.check('cancelled_by vocabulary', false, 'accepted bogus');
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.check('cancelled_by rejects unknown value', true);
END $$;
DO $$ BEGIN
  UPDATE booking_requests SET source = 'bogus' WHERE phone = '+85291234567';
  PERFORM pg_temp.check('source vocabulary', false, 'accepted bogus');
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.check('source rejects unknown value', true);
END $$;
DO $$ BEGIN
  INSERT INTO booking_requests (restaurant_id, phone, party_size, booking_date, booking_time, status, decided_at, source, no_show_marked_at, checked_in_at)
  VALUES ('aaaaaaaa-0000-4000-8000-000000000001', '+85290000009', 2, '2026-11-01', '19:00', 'no_show', now(), 'staff', now(), now());
  PERFORM pg_temp.check('checked_in vs no_show', false, 'accepted both');
EXCEPTION WHEN check_violation THEN PERFORM pg_temp.check('checked_in and no_show exclude each other', true);
END $$;

-- 3. edit: stale edit_version -> no row, no event; loaded version -> row + event, reminder cleared
UPDATE booking_requests SET reminder_sent_at = now() WHERE phone = '+85291234567';
CREATE TEMP TABLE b1 AS SELECT id, edit_version FROM booking_requests WHERE phone = '+85291234567';
SELECT pg_temp.check('edit with a stale edit_version changes nothing',
  (SELECT count(*) = 0 FROM b1, public.staff_update_booking(b1.id, 'aaaaaaaa-0000-4000-8000-000000000001', 'confirmed',
     b1.edit_version + 1, NULL, '+85291234567', 'Mr Lam', 4, '2026-12-01', '19:30', NULL, true, true,
     '11111111-0000-4000-8000-000000000001', '["time"]'::jsonb, '[]'::jsonb)));
SELECT pg_temp.check('edit from another restaurant changes nothing',
  (SELECT count(*) = 0 FROM b1, public.staff_update_booking(b1.id, 'bbbbbbbb-0000-4000-8000-000000000002', 'confirmed',
     b1.edit_version, NULL, '+85291234567', 'Mr Lam', 4, '2026-12-01', '19:30', NULL, true, true,
     '22222222-0000-4000-8000-000000000002', '["time"]'::jsonb, '[]'::jsonb)));
SELECT pg_temp.check('no edit event after refused edits', (SELECT count(*) = 0 FROM events WHERE type = 'booking.staff_edited'));
SELECT pg_temp.check('fresh edit: values, updated_by, reminder cleared, status kept',
  (SELECT u.party_size = 4 AND u.booking_time = '19:30' AND u.reminder_sent_at IS NULL AND u.status = 'confirmed'
          AND u.source = 'staff' AND u.updated_by = '11111111-0000-4000-8000-000000000001' AND u.member_id IS NULL
     FROM b1, public.staff_update_booking(b1.id, 'aaaaaaaa-0000-4000-8000-000000000001', 'confirmed',
     b1.edit_version, NULL, '+85291234567', 'Mr Lam', 4, '2026-12-01', '19:30', NULL, true, true,
     '11111111-0000-4000-8000-000000000001', '["time","partySize"]'::jsonb, '[]'::jsonb) u));
SELECT pg_temp.check('edit event names fields only', (SELECT count(*) = 1 AND bool_and(data_json->'changed' = '["time","partySize"]'::jsonb) FROM events WHERE type = 'booking.staff_edited'));

-- 4. open change blocks edit/cancel
CREATE TEMP TABLE b2 AS SELECT id, edit_version FROM booking_requests WHERE phone = '+85290000002';
INSERT INTO booking_requests (restaurant_id, phone, party_size, booking_date, booking_time, status, source, replaces_booking_id)
  SELECT 'aaaaaaaa-0000-4000-8000-000000000001', '+85290000002', 3, '2026-12-02', '19:00', 'pending', 'agent', id FROM b2;
SELECT pg_temp.check('edit refused with open change',
  (SELECT count(*) = 0 FROM b2, public.staff_update_booking(b2.id, 'aaaaaaaa-0000-4000-8000-000000000001', 'confirmed',
     b2.edit_version, NULL, '+85290000002', 'Two', 2, '2026-12-01', '19:30', NULL, false, false,
     '11111111-0000-4000-8000-000000000001', '["notes"]'::jsonb, '[]'::jsonb)));
SELECT pg_temp.check('cancel refused with open change',
  (SELECT count(*) = 0 FROM b2, public.staff_cancel_booking(b2.id, 'aaaaaaaa-0000-4000-8000-000000000001', b2.edit_version, '11111111-0000-4000-8000-000000000001', now())));

-- 5. confirm_booking_change is 085's (4 arguments) and still works; original cancelled by change
SELECT pg_temp.check('confirm change (085, 4 args) confirms the change',
  (SELECT c.status = 'confirmed'
     FROM public.confirm_booking_change((SELECT id FROM booking_requests WHERE replaces_booking_id = (SELECT id FROM b2)),
       'aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', now()) c));
SELECT pg_temp.check('original cancelled by change', (SELECT status = 'cancelled' AND cancelled_by = 'change' FROM booking_requests WHERE id = (SELECT id FROM b2)));

-- 6. cancel: stale refused, fresh -> cancelled by staff
CREATE TEMP TABLE b3 AS SELECT id, edit_version FROM booking_requests WHERE phone = '+85291234567';
SELECT pg_temp.check('cancel stale refused', (SELECT count(*) = 0 FROM b3, public.staff_cancel_booking(b3.id, 'aaaaaaaa-0000-4000-8000-000000000001', b3.edit_version - 1, '11111111-0000-4000-8000-000000000001', now())));
SELECT pg_temp.check('cancel -> cancelled by staff + user + time',
  (SELECT c.status = 'cancelled' AND c.cancelled_by = 'staff' AND c.cancelled_by_user = '11111111-0000-4000-8000-000000000001' AND c.cancelled_at IS NOT NULL
     FROM b3, public.staff_cancel_booking(b3.id, 'aaaaaaaa-0000-4000-8000-000000000001', (SELECT edit_version FROM booking_requests WHERE id = b3.id), '11111111-0000-4000-8000-000000000001', now()) c));
SELECT pg_temp.check('cancel again -> nothing', (SELECT count(*) = 0 FROM b3, public.staff_cancel_booking(b3.id, 'aaaaaaaa-0000-4000-8000-000000000001', (SELECT edit_version FROM booking_requests WHERE id = b3.id), '11111111-0000-4000-8000-000000000001', now())));
SELECT pg_temp.check('one cancel event', (SELECT count(*) = 1 FROM events WHERE type = 'booking.staff_cancelled'));

-- 7. review R1: background writes keep edit_version; real changes move it.
CREATE TEMP TABLE r1 AS SELECT b.id FROM public.staff_create_booking('aaaaaaaa-0000-4000-8000-000000000001', NULL,
  '+85290000021', 'R1', 4, '2026-12-03', '19:00', NULL, true, '11111111-0000-4000-8000-000000000001', now(), '[]'::jsonb) b;
CREATE TEMP TABLE r1v AS SELECT b.edit_version AS v FROM booking_requests b, r1 WHERE b.id = r1.id;
SELECT pg_temp.check('a new booking starts at edit_version 0', (SELECT v = 0 FROM r1v));
UPDATE booking_requests SET reminder_sent_at = now() WHERE id = (SELECT id FROM r1) AND reminder_sent_at IS NULL;  -- claimBookingReminder
UPDATE booking_requests SET decision_message_status = 'not_delivered' WHERE id = (SELECT id FROM r1);            -- recordDecisionMessage
UPDATE booking_requests SET last_staff_message_at = now() WHERE id = (SELECT id FROM r1);                        -- claimStaffMessage
SELECT count(*) FROM r1, public.booking_check_in(r1.id, 'aaaaaaaa-0000-4000-8000-000000000001', '2026-12-03', '11111111-0000-4000-8000-000000000001', now()) \gset ci_
SELECT count(*) FROM r1, public.booking_check_in_undo(r1.id, 'aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001') \gset cu_
SELECT pg_temp.check('background writes landed and did not move edit_version',
  (SELECT b.edit_version = r1v.v AND b.reminder_sent_at IS NOT NULL
          AND b.decision_message_status = 'not_delivered' AND b.last_staff_message_at IS NOT NULL
          AND :ci_count = 1 AND :cu_count = 1
     FROM booking_requests b, r1, r1v WHERE b.id = r1.id),
  (SELECT format('version %s', edit_version) FROM booking_requests WHERE id = (SELECT id FROM r1)));
WITH x AS (UPDATE booking_requests SET edit_version = 99 WHERE id = (SELECT id FROM r1) RETURNING edit_version)
SELECT pg_temp.check('a writer cannot set edit_version directly', (SELECT count(*) = 1 FROM x WHERE x.edit_version = (SELECT v FROM r1v)));
SELECT pg_temp.check('after background writes, the loaded edit saves',
  (SELECT count(*) = 1 FROM r1, r1v, public.staff_update_booking(r1.id, 'aaaaaaaa-0000-4000-8000-000000000001', 'confirmed', r1v.v,
     NULL, '+85290000021', 'R1', 5, '2026-12-03', '19:00', NULL, true, false, '11111111-0000-4000-8000-000000000001', '["partySize"]'::jsonb, '[]'::jsonb)));
SELECT pg_temp.check('the staff edit moved edit_version by one', (SELECT b.edit_version = r1v.v + 1 FROM booking_requests b, r1, r1v WHERE b.id = r1.id));
UPDATE r1v SET v = (SELECT edit_version FROM booking_requests WHERE id = (SELECT id FROM r1));
UPDATE booking_requests SET reminder_sent_at = NULL WHERE id = (SELECT id FROM r1);
UPDATE booking_requests SET reminder_sent_at = now() WHERE id = (SELECT id FROM r1);
SELECT pg_temp.check('after background writes, the loaded cancel cancels',
  (SELECT c.status = 'cancelled' FROM r1, r1v, public.staff_cancel_booking(r1.id, 'aaaaaaaa-0000-4000-8000-000000000001', r1v.v, '11111111-0000-4000-8000-000000000001', now()) c));

CREATE TEMP TABLE r2 AS SELECT b.id FROM public.staff_create_booking('aaaaaaaa-0000-4000-8000-000000000001', NULL,
  '+85290000022', 'R2', 4, '2026-12-03', '19:30', NULL, true, '11111111-0000-4000-8000-000000000001', now(), '[]'::jsonb) b;
CREATE TEMP TABLE r2v AS SELECT edit_version AS v FROM booking_requests WHERE id = (SELECT id FROM r2);
CREATE TEMP TABLE r1events AS SELECT count(*) AS n FROM events WHERE type IN ('booking.staff_edited', 'booking.staff_cancelled');
UPDATE booking_requests SET party_size = 6 WHERE id = (SELECT id FROM r2);  -- another staff member / agent edits the party
SELECT pg_temp.check('a party change moves edit_version', (SELECT edit_version = (SELECT v FROM r2v) + 1 FROM booking_requests WHERE id = (SELECT id FROM r2)));
SELECT pg_temp.check('after a party change, the loaded edit is refused',
  (SELECT count(*) = 0 FROM r2, r2v, public.staff_update_booking(r2.id, 'aaaaaaaa-0000-4000-8000-000000000001', 'confirmed', r2v.v,
     NULL, '+85290000022', 'R2', 3, '2026-12-03', '19:30', NULL, true, false, '11111111-0000-4000-8000-000000000001', '["partySize"]'::jsonb, '[]'::jsonb)));
SELECT pg_temp.check('after a party change, the loaded cancel is refused',
  (SELECT count(*) = 0 FROM r2, r2v, public.staff_cancel_booking(r2.id, 'aaaaaaaa-0000-4000-8000-000000000001', r2v.v, '11111111-0000-4000-8000-000000000001', now())));
SELECT pg_temp.check('refused: party and status as the other writer left them', (SELECT party_size = 6 AND status = 'confirmed' FROM booking_requests WHERE id = (SELECT id FROM r2)));
UPDATE r2v SET v = (SELECT edit_version FROM booking_requests WHERE id = (SELECT id FROM r2));
UPDATE booking_requests SET status = 'cancelled', cancelled_by = 'diner_ai', cancelled_at = now() WHERE id = (SELECT id FROM r2);  -- diner AI cancels
SELECT pg_temp.check('a status change moves edit_version', (SELECT edit_version = (SELECT v FROM r2v) + 1 FROM booking_requests WHERE id = (SELECT id FROM r2)));
SELECT pg_temp.check('after the diner AI cancels, the loaded edit and cancel are refused',
  (SELECT count(*) = 0 FROM r2, r2v, public.staff_update_booking(r2.id, 'aaaaaaaa-0000-4000-8000-000000000001', 'confirmed', r2v.v,
     NULL, '+85290000022', 'R2', 3, '2026-12-03', '19:30', NULL, true, false, '11111111-0000-4000-8000-000000000001', '["partySize"]'::jsonb, '[]'::jsonb))
   AND (SELECT count(*) = 0 FROM r2, r2v, public.staff_cancel_booking(r2.id, 'aaaaaaaa-0000-4000-8000-000000000001', r2v.v, '11111111-0000-4000-8000-000000000001', now())));
SELECT pg_temp.check('refused writes wrote no events', (SELECT count(*) = (SELECT n FROM r1events) FROM events WHERE type IN ('booking.staff_edited', 'booking.staff_cancelled')));
CREATE TEMP TABLE r3 AS SELECT b.id FROM public.staff_create_booking('aaaaaaaa-0000-4000-8000-000000000001', NULL,
  '+85290000023', 'R3', 2, '2026-12-03', '20:00', NULL, true, '11111111-0000-4000-8000-000000000001', now(), '[]'::jsonb) b;
DO $$
DECLARE v_id uuid := (SELECT id FROM r3); v int; col text; ok boolean := true;
BEGIN
  FOREACH col IN ARRAY ARRAY['name = ''X''', 'phone = ''+85290000099''', 'notes = ''n''', 'notify_diner = false', 'booking_date = ''2026-12-05''', 'booking_time = ''20:30'''] LOOP
    SELECT edit_version INTO v FROM booking_requests WHERE id = v_id;
    EXECUTE format('UPDATE booking_requests SET %s WHERE id = %L', col, v_id);
    ok := ok AND (SELECT edit_version = v + 1 FROM booking_requests WHERE id = v_id);
  END LOOP;
  PERFORM pg_temp.check('each versioned column moves edit_version by one', ok);
END $$;

-- 8. check-in: only today + confirmed; no-show refused when checked in; undo clears
CREATE TEMP TABLE t AS SELECT b.id FROM public.staff_create_booking('aaaaaaaa-0000-4000-8000-000000000001', 'cccccccc-0000-4000-8000-000000000003',
  '+85291234567', 'Today', 2, '2026-11-26', '12:00', NULL, true, '11111111-0000-4000-8000-000000000001', now(), '[]'::jsonb) b;
SELECT pg_temp.check('check-in refused for another day', (SELECT count(*) = 0 FROM t, public.booking_check_in(t.id, 'aaaaaaaa-0000-4000-8000-000000000001', '2026-11-27', '11111111-0000-4000-8000-000000000001', now())));
SELECT pg_temp.check('check-in refused for another restaurant', (SELECT count(*) = 0 FROM t, public.booking_check_in(t.id, 'bbbbbbbb-0000-4000-8000-000000000002', '2026-11-26', '11111111-0000-4000-8000-000000000001', now())));
SELECT pg_temp.check('check-in today sets at/by, status stays confirmed',
  (SELECT c.checked_in_at IS NOT NULL AND c.checked_in_by = '11111111-0000-4000-8000-000000000001' AND c.status = 'confirmed'
     FROM t, public.booking_check_in(t.id, 'aaaaaaaa-0000-4000-8000-000000000001', '2026-11-26', '11111111-0000-4000-8000-000000000001', now()) c));
SELECT pg_temp.check('check-in twice -> nothing', (SELECT count(*) = 0 FROM t, public.booking_check_in(t.id, 'aaaaaaaa-0000-4000-8000-000000000001', '2026-11-26', '11111111-0000-4000-8000-000000000001', now())));
SELECT pg_temp.check('no-show refused when checked in',
  (SELECT count(*) = 0 FROM t, public.mark_booking_no_show(t.id, 'aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', now(), '2026-11-26', '23:59')));
SELECT pg_temp.check('member stats count arrived',
  (SELECT s.arrived = 1 FROM public.member_booking_stats('cccccccc-0000-4000-8000-000000000003', 'aaaaaaaa-0000-4000-8000-000000000001', '2026-11-26', '23:59') s));
SELECT pg_temp.check('undo clears checked_in only',
  (SELECT u.checked_in_at IS NULL AND u.checked_in_by IS NULL AND u.status = 'confirmed'
     FROM t, public.booking_check_in_undo(t.id, 'aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001') u));
SELECT pg_temp.check('no-show allowed after undo',
  (SELECT count(*) = 1 FROM t, public.mark_booking_no_show(t.id, 'aaaaaaaa-0000-4000-8000-000000000001', '11111111-0000-4000-8000-000000000001', now(), '2026-11-26', '23:59')));
SELECT pg_temp.check('check-in refused on no_show', (SELECT count(*) = 0 FROM t, public.booking_check_in(t.id, 'aaaaaaaa-0000-4000-8000-000000000001', '2026-11-26', '11111111-0000-4000-8000-000000000001', now())));
SELECT pg_temp.check('events: 1 checked_in, 1 undone', (SELECT count(*) FILTER (WHERE type = 'booking.checked_in') = 1 AND count(*) FILTER (WHERE type = 'booking.check_in_undone') = 1 FROM events WHERE data_json->>'bookingId' = (SELECT id FROM t)::text));

-- 9. reminder candidates skip notify_diner = false
INSERT INTO booking_requests (restaurant_id, phone, party_size, booking_date, booking_time, status, decided_at, source, notify_diner, created_at)
VALUES ('aaaaaaaa-0000-4000-8000-000000000001', '+85290000011', 2, '2026-11-27', '20:00', 'confirmed', now(), 'staff', true, '2026-11-20'),
       ('aaaaaaaa-0000-4000-8000-000000000001', '+85290000012', 2, '2026-11-27', '20:00', 'confirmed', now(), 'staff', false, '2026-11-20');
SELECT pg_temp.check('reminder candidates skip notify off',
  (SELECT array_agg(phone ORDER BY phone) = ARRAY['+85290000011'] FROM public.booking_reminder_candidates('2026-11-27T10:30:00Z', 3, 50)));

-- 10. decision 8: no check-in code or QR object anywhere
SELECT pg_temp.check('no checkin_code / checkin_qr_path column',
  (SELECT count(*) = 0 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'booking_requests' AND column_name IN ('checkin_code', 'checkin_qr_path')),
  (SELECT string_agg(column_name, ',') FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'booking_requests' AND column_name LIKE 'checkin_%'));
SELECT pg_temp.check('no code or QR index',
  (SELECT count(*) = 0 FROM pg_indexes WHERE tablename = 'booking_requests' AND (indexname LIKE '%checkin_code%' OR indexname LIKE '%qr%')));
SELECT pg_temp.check('no booking-checkin-qr bucket', (SELECT count(*) = 0 FROM storage.buckets WHERE id = 'booking-checkin-qr'));
SELECT pg_temp.check('no forget_checkin_qr_paths function', (SELECT count(*) = 0 FROM pg_proc WHERE proname = 'forget_checkin_qr_paths'));
SELECT pg_temp.check('confirm_booking_change has only 085''s 4-argument version',
  (SELECT count(*) = 1 AND bool_and(pronargs = 4) FROM pg_proc WHERE proname = 'confirm_booking_change'));
SELECT pg_temp.check('staff_create_booking takes no code list (12 arguments, no text[])',
  (SELECT count(*) = 1 AND bool_and(pronargs = 12 AND pg_get_function_identity_arguments(p.oid) NOT LIKE '%text[]%') FROM pg_proc p WHERE proname = 'staff_create_booking'),
  (SELECT string_agg(pg_get_function_identity_arguments(p.oid), ' | ') FROM pg_proc p WHERE proname = 'staff_create_booking'));

-- 11. grants
SELECT pg_temp.check('new RPCs not executable by anon or authenticated',
  (SELECT bool_and(NOT has_function_privilege('anon', p.oid, 'EXECUTE') AND NOT has_function_privilege('authenticated', p.oid, 'EXECUTE'))
     FROM pg_proc p WHERE p.proname IN ('staff_create_booking','staff_update_booking','staff_cancel_booking','booking_check_in','booking_check_in_undo','member_booking_stats')));
SELECT pg_temp.check('one staff_update_booking and one staff_cancel_booking (int version)',
  (SELECT count(*) = 2 AND bool_and(pg_get_function_identity_arguments(p.oid) LIKE '%p_expected_version integer%')
     FROM pg_proc p WHERE p.proname IN ('staff_update_booking', 'staff_cancel_booking')));

SELECT n, CASE WHEN ok THEN 'PASS' ELSE 'FAIL' END AS result, label, detail FROM results ORDER BY n;
SELECT count(*) FILTER (WHERE ok) AS passed, count(*) FILTER (WHERE NOT ok OR ok IS NULL) AS failed FROM results;
ROLLBACK;
