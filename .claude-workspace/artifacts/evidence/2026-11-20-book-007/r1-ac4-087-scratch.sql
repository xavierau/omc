-- BOOK-007 r1 AC-4: migration 087 (with mark_booking_no_show) on a scratch DB
-- built from 001..086, inside a rolled-back transaction. Fake ids and data
-- only (repo is public). Mark calls go through the RPC exactly as
-- markBookingNoShow sends them (p_before = the app's Hong Kong now).
\set ON_ERROR_STOP on
\echo '== BEGIN (everything below is rolled back)'
BEGIN;
\i supabase/migrations/087_booking_no_show.sql
\echo '== 087 applied; re-applying it (idempotent)'
\i supabase/migrations/087_booking_no_show.sql

INSERT INTO restaurants (id, name, slug, whatsapp_number) VALUES
  ('b0070000-0000-4000-8000-00000000000a', 'Scratch A', 'scratch-a-087', '+85230000001'),
  ('b0070000-0000-4000-8000-00000000000b', 'Scratch B', 'scratch-b-087', '+85230000002');

-- Rows (restaurant A unless noted). The "now" passed in is 2026-11-20 11:00 HK.
-- o1: confirmed 2026-11-19, no change            -> mark accepted
-- o2: confirmed 2026-11-19, pending change ch2   -> refused (change_pending)
-- o3: confirmed 2026-11-19, declined change ch3  -> mark accepted
-- o4: confirmed 2026-11-19, a pending row in restaurant B pointing at it -> accepted (tenant-scoped)
-- o5: confirmed 2026-11-20 11:00 (not past at 11:00) -> refused
-- o6: confirmed 2026-11-20 10:59 (past)          -> accepted
INSERT INTO booking_requests (id, restaurant_id, phone, name, party_size, booking_date, booking_time, status, source, decided_at, replaces_booking_id)
VALUES
  ('b0070000-0000-4000-8000-0000000000e1', 'b0070000-0000-4000-8000-00000000000a', '+85290000001', 'Diner One', 2, '2026-11-19', '19:30', 'confirmed', 'chat', now(), NULL),
  ('b0070000-0000-4000-8000-0000000000e2', 'b0070000-0000-4000-8000-00000000000a', '+85290000002', 'Diner Two', 2, '2026-11-19', '19:30', 'confirmed', 'agent', now(), NULL),
  ('b0070000-0000-4000-8000-0000000000e3', 'b0070000-0000-4000-8000-00000000000a', '+85290000003', 'Diner Three', 2, '2026-11-19', '19:30', 'confirmed', 'agent', now(), NULL),
  ('b0070000-0000-4000-8000-0000000000e4', 'b0070000-0000-4000-8000-00000000000a', '+85290000004', 'Diner Four', 2, '2026-11-19', '19:30', 'confirmed', 'agent', now(), NULL),
  ('b0070000-0000-4000-8000-0000000000e5', 'b0070000-0000-4000-8000-00000000000a', '+85290000005', 'Diner Five', 2, '2026-11-20', '11:00', 'confirmed', 'chat', now(), NULL),
  ('b0070000-0000-4000-8000-0000000000e6', 'b0070000-0000-4000-8000-00000000000a', '+85290000006', 'Diner Six', 2, '2026-11-20', '10:59', 'confirmed', 'chat', now(), NULL);
INSERT INTO booking_requests (id, restaurant_id, phone, name, party_size, booking_date, booking_time, status, source, decided_at, replaces_booking_id)
VALUES
  ('b0070000-0000-4000-8000-0000000000f2', 'b0070000-0000-4000-8000-00000000000a', '+85290000002', 'Diner Two', 6, '2026-11-25', '20:00', 'pending', 'agent', NULL, 'b0070000-0000-4000-8000-0000000000e2'),
  ('b0070000-0000-4000-8000-0000000000f3', 'b0070000-0000-4000-8000-00000000000a', '+85290000003', 'Diner Three', 6, '2026-11-25', '20:00', 'declined', 'agent', now(), 'b0070000-0000-4000-8000-0000000000e3'),
  ('b0070000-0000-4000-8000-0000000000f4', 'b0070000-0000-4000-8000-00000000000b', '+85290000004', 'Diner Four', 6, '2026-11-25', '20:00', 'pending', 'agent', NULL, 'b0070000-0000-4000-8000-0000000000e4');

-- mark(id, restaurant): the RPC call markBookingNoShow makes; prints how many rows changed.
\set A '''b0070000-0000-4000-8000-00000000000a'''
\set B '''b0070000-0000-4000-8000-00000000000b'''
\set STAFF '''b0070000-0000-4000-8000-0000000000aa'''
\set NOW '''2026-11-20T03:00:00Z'''

\echo '== o1 no change: accepted'
SELECT id, status, no_show_marked_by IS NOT NULL AS has_by, no_show_marked_at = :NOW::timestamptz AS at_is_now
  FROM mark_booking_no_show('b0070000-0000-4000-8000-0000000000e1', :A, :STAFF, :NOW, '2026-11-20', '11:00');

\echo '== o2 pending change in the same restaurant: refused, 0 rows; o2 and its change unchanged'
SELECT count(*) AS changed_rows FROM mark_booking_no_show('b0070000-0000-4000-8000-0000000000e2', :A, :STAFF, :NOW, '2026-11-20', '11:00');
SELECT id, status, no_show_marked_at IS NULL AS no_marker FROM booking_requests
 WHERE id IN ('b0070000-0000-4000-8000-0000000000e2', 'b0070000-0000-4000-8000-0000000000f2') ORDER BY id;

\echo '== o2: the change is still decided the BOOK-006 way: confirm_booking_change confirms it and cancels o2 (no second confirmed booking)'
SELECT id, status FROM confirm_booking_change('b0070000-0000-4000-8000-0000000000f2', :A, :STAFF, now());
SELECT id, status, coalesce(cancelled_by, '-') AS cancelled_by FROM booking_requests WHERE id = 'b0070000-0000-4000-8000-0000000000e2';
\echo '== o2 after the change: a mark is refused (cancelled), 0 rows'
SELECT count(*) AS changed_rows FROM mark_booking_no_show('b0070000-0000-4000-8000-0000000000e2', :A, :STAFF, :NOW, '2026-11-20', '11:00');

\echo '== o3 declined change (not open): accepted'
SELECT id, status FROM mark_booking_no_show('b0070000-0000-4000-8000-0000000000e3', :A, :STAFF, :NOW, '2026-11-20', '11:00');

\echo '== o4 pending row of restaurant B pointing at it: accepted (the check is scoped to the caller restaurant)'
SELECT id, status FROM mark_booking_no_show('b0070000-0000-4000-8000-0000000000e4', :A, :STAFF, :NOW, '2026-11-20', '11:00');

\echo '== o5 today 11:00 at 11:00: not past, refused, 0 rows; o6 today 10:59: accepted'
SELECT count(*) AS changed_rows FROM mark_booking_no_show('b0070000-0000-4000-8000-0000000000e5', :A, :STAFF, :NOW, '2026-11-20', '11:00');
SELECT id, status FROM mark_booking_no_show('b0070000-0000-4000-8000-0000000000e6', :A, :STAFF, :NOW, '2026-11-20', '11:00');

\echo '== another restaurant id: 0 rows; already no_show: 0 rows'
SELECT count(*) AS other_tenant_rows FROM mark_booking_no_show('b0070000-0000-4000-8000-0000000000e5', :B, :STAFF, :NOW, '2026-11-21', '11:00');
SELECT count(*) AS already_no_show_rows FROM mark_booking_no_show('b0070000-0000-4000-8000-0000000000e1', :A, :STAFF, :NOW, '2026-11-20', '11:00');

\echo '== execute privilege: service_role yes; anon and authenticated no'
SELECT r AS role, has_function_privilege(r, 'public.mark_booking_no_show(uuid, uuid, uuid, timestamptz, date, time)', 'EXECUTE') AS can_execute
  FROM unnest(ARRAY['service_role', 'anon', 'authenticated']) AS r;
SAVEPOINT anon_try;
SET LOCAL ROLE authenticated;
DO $$
BEGIN
  PERFORM mark_booking_no_show('b0070000-0000-4000-8000-0000000000e5', 'b0070000-0000-4000-8000-00000000000a', 'b0070000-0000-4000-8000-0000000000aa', now(), '2026-11-21', '11:00');
  RAISE EXCEPTION 'NOT REFUSED: authenticated executed mark_booking_no_show';
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'refused OK for authenticated: %', SQLERRM;
END $$;
ROLLBACK TO SAVEPOINT anon_try;
RESET ROLE;

\echo '== undo (the repository undo UPDATE) still works on a marked row'
UPDATE booking_requests
   SET status = 'confirmed', no_show_marked_by = NULL, no_show_marked_at = NULL
 WHERE id = 'b0070000-0000-4000-8000-0000000000e1' AND restaurant_id = 'b0070000-0000-4000-8000-00000000000a' AND status = 'no_show'
RETURNING id, status, no_show_marked_at IS NULL AS at_cleared;

\echo '== the r0 CHECKs still hold: no_show without a marker is rejected'
DO $$
BEGIN
  UPDATE booking_requests SET status = 'no_show' WHERE id = 'b0070000-0000-4000-8000-0000000000e5';
  RAISE EXCEPTION 'NOT REJECTED: no_show without no_show_marked_at';
EXCEPTION WHEN check_violation THEN
  RAISE NOTICE 'rejected OK: %', SQLERRM;
END $$;

ROLLBACK;
\echo '== ROLLBACK done; 087 left nothing behind:'
SELECT count(*) AS no_show_columns_after_rollback FROM information_schema.columns
 WHERE table_name = 'booking_requests' AND column_name LIKE 'no_show%';
SELECT count(*) AS mark_fn_after_rollback FROM pg_proc WHERE proname = 'mark_booking_no_show';
