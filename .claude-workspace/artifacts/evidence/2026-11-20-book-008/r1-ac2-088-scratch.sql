-- BOOK-008 r1 AC-2: migration 088 (r1: F1 relink moves the open change, F2
-- stats count reservations, F3 member-insert trigger) on a scratch DB built
-- from 001..087, inside a rolled-back transaction. Fake ids and data only (the
-- repo is public). The first part is the AC-6 run unchanged (regression).
-- Checks: the R1 backfill links only member-less, non-unverified rows to a
-- same-restaurant phone match and is idempotent; relink_booking_member (R2/R4)
-- and member_booking_stats (R8) behave as the app expects; grants.
\set ON_ERROR_STOP on
\echo '== BEGIN (everything below is rolled back)'
BEGIN;

INSERT INTO restaurants (id, name, slug, whatsapp_number) VALUES
  ('b0080000-0000-4000-8000-00000000000a', 'Scratch A', 'scratch-a-088', '+85230000001'),
  ('b0080000-0000-4000-8000-00000000000b', 'Scratch B', 'scratch-b-088', '+85230000002');

-- Members: a1 (A, ...001), a2 (A, ...002), a3 (A, ...009), b1 (B, ...001: same phone as a1, other tenant).
INSERT INTO members (id, restaurant_id, phone, name) VALUES
  ('b0080000-0000-4000-8000-0000000000a1', 'b0080000-0000-4000-8000-00000000000a', '+85290000001', 'Member A1'),
  ('b0080000-0000-4000-8000-0000000000a2', 'b0080000-0000-4000-8000-00000000000a', '+85290000002', 'Member A2'),
  ('b0080000-0000-4000-8000-0000000000a3', 'b0080000-0000-4000-8000-00000000000a', '+85290000009', 'Member A3'),
  ('b0080000-0000-4000-8000-0000000000b1', 'b0080000-0000-4000-8000-00000000000b', '+85290000001', 'Member B1');

-- Bookings before 088 (restaurant A unless noted), member_id NULL unless noted:
-- k1 pending   ...001            -> a1
-- k2 confirmed ...002            -> a2
-- k3 unverified agent ...001     -> stays NULL (phone unproven)
-- k4 pending   ...003 (no member)-> stays NULL, no member created
-- k5 pending   ...001 in B       -> b1 (never a1)
-- k6 pending   ...001, already linked to a3 by staff -> stays a3
-- k7 no_show   ...002            -> a2
-- k8 cancelled ...001            -> a1
-- k9 declined  ...004 in B (no B member with it) -> stays NULL
INSERT INTO booking_requests (id, restaurant_id, member_id, phone, name, party_size, booking_date, booking_time, status, source,
                              decided_at, cancelled_at, cancelled_by, no_show_marked_at, confirm_code, verify_expires_at)
VALUES
  ('b0080000-0000-4000-8000-0000000000e1', 'b0080000-0000-4000-8000-00000000000a', NULL, '+85290000001', 'Diner', 2, '2026-11-25', '19:30', 'pending', 'chat', NULL, NULL, NULL, NULL, NULL, NULL),
  ('b0080000-0000-4000-8000-0000000000e2', 'b0080000-0000-4000-8000-00000000000a', NULL, '+85290000002', 'Diner', 2, '2026-11-18', '19:30', 'confirmed', 'chat', now(), NULL, NULL, NULL, NULL, NULL),
  ('b0080000-0000-4000-8000-0000000000e3', 'b0080000-0000-4000-8000-00000000000a', NULL, '+85290000001', 'Diner', 2, '2026-11-26', '19:30', 'unverified', 'agent', NULL, NULL, NULL, NULL, 'K7PX3M', now() + interval '30 minutes'),
  ('b0080000-0000-4000-8000-0000000000e4', 'b0080000-0000-4000-8000-00000000000a', NULL, '+85290000003', 'Diner', 2, '2026-11-25', '19:30', 'pending', 'chat', NULL, NULL, NULL, NULL, NULL, NULL),
  ('b0080000-0000-4000-8000-0000000000e5', 'b0080000-0000-4000-8000-00000000000b', NULL, '+85290000001', 'Diner', 2, '2026-11-25', '19:30', 'pending', 'chat', NULL, NULL, NULL, NULL, NULL, NULL),
  ('b0080000-0000-4000-8000-0000000000e6', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a3', '+85290000001', 'Diner', 2, '2026-11-27', '19:30', 'pending', 'chat', NULL, NULL, NULL, NULL, NULL, NULL),
  ('b0080000-0000-4000-8000-0000000000e7', 'b0080000-0000-4000-8000-00000000000a', NULL, '+85290000002', 'Diner', 2, '2026-11-10', '19:30', 'no_show', 'chat', now(), NULL, NULL, now(), NULL, NULL),
  ('b0080000-0000-4000-8000-0000000000e8', 'b0080000-0000-4000-8000-00000000000a', NULL, '+85290000001', 'Diner', 2, '2026-11-12', '19:30', 'cancelled', 'agent', NULL, now(), 'diner_ai', NULL, NULL, NULL),
  ('b0080000-0000-4000-8000-0000000000e9', 'b0080000-0000-4000-8000-00000000000b', NULL, '+85290000004', 'Diner', 2, '2026-11-12', '19:30', 'declined', 'chat', now(), NULL, NULL, NULL, NULL, NULL);

\echo '== members before'
SELECT count(*) AS members FROM members WHERE restaurant_id IN ('b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-00000000000b');

\echo '== apply 088'
\i supabase/migrations/088_booking_member_backfill.sql

\echo '== after first run: id suffix, status, member suffix (expect e1 a1, e2 a2, e3 NULL, e4 NULL, e5 b1, e6 a3, e7 a2, e8 a1, e9 NULL)'
SELECT right(id::text, 2) AS booking, status, right(member_id::text, 2) AS member
  FROM booking_requests WHERE id::text LIKE 'b0080000-%' ORDER BY id;
CREATE TEMP TABLE after_first AS SELECT id, member_id FROM booking_requests WHERE id::text LIKE 'b0080000-%';

\echo '== members after (expect the same count: no member created)'
SELECT count(*) AS members FROM members WHERE restaurant_id IN ('b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-00000000000b');
SELECT count(*) AS consent_rows FROM consent_records WHERE restaurant_id IN ('b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-00000000000b');

\echo '== apply 088 again (idempotent): rows changed by the second backfill (expect 0)'
\i supabase/migrations/088_booking_member_backfill.sql
SELECT count(*) AS changed_on_second_run
  FROM booking_requests b JOIN after_first f ON f.id = b.id
 WHERE b.member_id IS DISTINCT FROM f.member_id;

\echo '== relink_booking_member (R2, R4)'
\echo '-- link e4 (NULL -> a3): expect 1 row, member a3'
SELECT right(id::text, 2) AS booking, right(member_id::text, 2) AS member FROM relink_booking_member(
  'b0080000-0000-4000-8000-0000000000e4', 'b0080000-0000-4000-8000-00000000000a', NULL,
  'b0080000-0000-4000-8000-0000000000a3', 'b0080000-0000-4000-8000-0000000000f1');
\echo '-- relink e1 (a1 -> a2): expect 1 row'
SELECT right(id::text, 2) AS booking, right(member_id::text, 2) AS member FROM relink_booking_member(
  'b0080000-0000-4000-8000-0000000000e1', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a1',
  'b0080000-0000-4000-8000-0000000000a2', 'b0080000-0000-4000-8000-0000000000f1');
\echo '-- unlink e2 (a2 -> NULL): expect 1 row, member NULL'
SELECT right(id::text, 2) AS booking, member_id FROM relink_booking_member(
  'b0080000-0000-4000-8000-0000000000e2', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a2',
  NULL, 'b0080000-0000-4000-8000-0000000000f1');
\echo '-- refused, expect 0 rows each: other tenant member (b1), other tenant booking (e5 via A), stale from (e1 still a1?), unverified e3, no-op (e6 a3 -> a3)'
SELECT count(*) AS other_tenant_member FROM relink_booking_member(
  'b0080000-0000-4000-8000-0000000000e6', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a3',
  'b0080000-0000-4000-8000-0000000000b1', 'b0080000-0000-4000-8000-0000000000f1');
SELECT count(*) AS other_tenant_booking FROM relink_booking_member(
  'b0080000-0000-4000-8000-0000000000e5', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000b1',
  'b0080000-0000-4000-8000-0000000000a1', 'b0080000-0000-4000-8000-0000000000f1');
SELECT count(*) AS stale_from FROM relink_booking_member(
  'b0080000-0000-4000-8000-0000000000e1', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a1',
  'b0080000-0000-4000-8000-0000000000a3', 'b0080000-0000-4000-8000-0000000000f1');
SELECT count(*) AS unverified FROM relink_booking_member(
  'b0080000-0000-4000-8000-0000000000e3', 'b0080000-0000-4000-8000-00000000000a', NULL,
  'b0080000-0000-4000-8000-0000000000a1', 'b0080000-0000-4000-8000-0000000000f1');
SELECT count(*) AS no_op FROM relink_booking_member(
  'b0080000-0000-4000-8000-0000000000e6', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a3',
  'b0080000-0000-4000-8000-0000000000a3', 'b0080000-0000-4000-8000-0000000000f1');
\echo '-- events: expect exactly 3 booking.member_relinked rows (actor + ids only, member_id NULL)'
SELECT right(restaurant_id::text, 2) AS restaurant, member_id, type, right(actor_user_id::text, 2) AS actor, data_json
  FROM events WHERE type = 'booking.member_relinked' ORDER BY created_at, data_json->>'bookingId';
\echo '-- rows after the relinks (expect e1 a2, e2 NULL, e3 NULL, e4 a3, e5 b1, e6 a3)'
SELECT right(id::text, 2) AS booking, right(member_id::text, 2) AS member
  FROM booking_requests WHERE id::text LIKE 'b0080000-%' ORDER BY id;


\echo '== r1 F1: relink moves the booking''s OPEN change request (same statement, same CAS on the old member)'
-- e10 confirmed booking of a1 (...001, A); e11 its open change (pending, a1); e12 a declined earlier change (a1)
-- e13 confirmed booking of a1; e14 its open change that does NOT hold a1 (member NULL): the CAS leaves it alone
INSERT INTO booking_requests (id, restaurant_id, member_id, phone, name, party_size, booking_date, booking_time, status, source, decided_at, replaces_booking_id)
VALUES
  ('b0080000-0000-4000-8000-000000000010', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a1', '+85290000001', 'Diner', 2, '2026-11-28', '19:30', 'confirmed', 'agent', now(), NULL),
  ('b0080000-0000-4000-8000-000000000011', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a1', '+85290000001', 'Diner', 4, '2026-11-29', '20:00', 'pending', 'agent', NULL, 'b0080000-0000-4000-8000-000000000010'),
  ('b0080000-0000-4000-8000-000000000012', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a1', '+85290000001', 'Diner', 3, '2026-11-30', '20:00', 'declined', 'agent', now(), 'b0080000-0000-4000-8000-000000000010'),
  ('b0080000-0000-4000-8000-000000000013', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a1', '+85290000001', 'Diner', 2, '2026-12-01', '19:30', 'confirmed', 'agent', now(), NULL),
  ('b0080000-0000-4000-8000-000000000014', 'b0080000-0000-4000-8000-00000000000a', NULL, '+85290000001', 'Diner', 2, '2026-12-02', '19:30', 'pending', 'agent', NULL, 'b0080000-0000-4000-8000-000000000013');
\echo '-- relink e10 (a1 -> a2): expect 1 row (the booking only), member a2'
SELECT right(id::text, 2) AS booking, right(member_id::text, 2) AS member FROM relink_booking_member(
  'b0080000-0000-4000-8000-000000000010', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a1',
  'b0080000-0000-4000-8000-0000000000a2', 'b0080000-0000-4000-8000-0000000000f1');
\echo '-- rows (expect 10 a2, 11 a2 (moved, still pending), 12 a1 (declined: not open))'
SELECT right(id::text, 2) AS booking, status, right(member_id::text, 2) AS member
  FROM booking_requests WHERE id::text BETWEEN 'b0080000-0000-4000-8000-000000000010' AND 'b0080000-0000-4000-8000-000000000012' ORDER BY id;
\echo '-- its events row: bookingId e10 + changeIds [e11]; one row'
SELECT data_json FROM events WHERE type = 'booking.member_relinked' AND data_json->>'bookingId' = 'b0080000-0000-4000-8000-000000000010';
\echo '-- staff confirm the change (085 confirm_booking_change): e11 confirmed on a2, e10 cancelled by change'
SELECT right(id::text, 2) AS booking, status, right(member_id::text, 2) AS member FROM confirm_booking_change(
  'b0080000-0000-4000-8000-000000000011', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000f1', now());
\echo '-- a2''s list (listMemberBookings query): the live booking e11 confirmed is there'
SELECT right(id::text, 2) AS booking, booking_date, status FROM booking_requests
 WHERE restaurant_id = 'b0080000-0000-4000-8000-00000000000a' AND member_id = 'b0080000-0000-4000-8000-0000000000a2' AND status <> 'unverified'
   AND id::text BETWEEN 'b0080000-0000-4000-8000-000000000010' AND 'b0080000-0000-4000-8000-000000000012'
 ORDER BY booking_date DESC, booking_time DESC LIMIT 50;
\echo '-- relink e13 (a1 -> a3): e14 holds NULL, not a1, so it stays NULL; events row has no changeIds'
SELECT right(id::text, 2) AS booking, right(member_id::text, 2) AS member FROM relink_booking_member(
  'b0080000-0000-4000-8000-000000000013', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a1',
  'b0080000-0000-4000-8000-0000000000a3', 'b0080000-0000-4000-8000-0000000000f1');
SELECT right(id::text, 2) AS booking, right(member_id::text, 2) AS member FROM booking_requests
 WHERE id IN ('b0080000-0000-4000-8000-000000000013', 'b0080000-0000-4000-8000-000000000014') ORDER BY id;
SELECT data_json FROM events WHERE type = 'booking.member_relinked' AND data_json->>'bookingId' = 'b0080000-0000-4000-8000-000000000013';
\echo '-- a refused relink (stale from) moves nothing: e11 is not open any more, e10 now a2; relink e10 from a1 -> 0 rows, no new event'
SELECT count(*) AS stale_from FROM relink_booking_member(
  'b0080000-0000-4000-8000-000000000010', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a1',
  'b0080000-0000-4000-8000-0000000000a3', 'b0080000-0000-4000-8000-0000000000f1');
SELECT count(*) AS relink_events_total FROM events WHERE type = 'booking.member_relinked';
\echo '-- expect 5 (3 from the AC-6 part + e10 + e13)'
\echo '-- unlink with an open change: e15 booking of a3, e16 its open change of a3 -> both NULL'
INSERT INTO booking_requests (id, restaurant_id, member_id, phone, name, party_size, booking_date, booking_time, status, source, decided_at, replaces_booking_id)
VALUES
  ('b0080000-0000-4000-8000-000000000015', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a3', '+85290000009', 'Diner', 2, '2026-12-03', '19:30', 'pending', 'agent', NULL, NULL),
  ('b0080000-0000-4000-8000-000000000016', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a3', '+85290000009', 'Diner', 2, '2026-12-04', '19:30', 'pending', 'agent', NULL, 'b0080000-0000-4000-8000-000000000015');
SELECT right(id::text, 2) AS booking, member_id FROM relink_booking_member(
  'b0080000-0000-4000-8000-000000000015', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a3',
  NULL, 'b0080000-0000-4000-8000-0000000000f1');
SELECT right(id::text, 2) AS booking, member_id FROM booking_requests
 WHERE id IN ('b0080000-0000-4000-8000-000000000015', 'b0080000-0000-4000-8000-000000000016') ORDER BY id;

\echo '== member_booking_stats + the list query (R8): 60 bookings for member a1, now = 2026-11-20 11:00 HK'
UPDATE booking_requests SET member_id = NULL WHERE member_id = 'b0080000-0000-4000-8000-0000000000a1';
INSERT INTO booking_requests (restaurant_id, member_id, phone, name, party_size, booking_date, booking_time, status, source, decided_at, cancelled_at, cancelled_by, no_show_marked_at)
SELECT 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a1', '+85290000001', 'Diner', 2,
       DATE '2026-10-01' + i, CASE WHEN i % 2 = 0 THEN TIME '19:30' ELSE TIME '12:30' END,
       (ARRAY['confirmed','no_show','cancelled','declined','pending'])[1 + i % 5], 'chat',
       CASE WHEN i % 5 IN (0, 1, 3) THEN now() END,
       CASE WHEN i % 5 = 2 THEN now() END,
       CASE WHEN i % 5 = 2 THEN 'diner_ai' END,
       CASE WHEN i % 5 = 1 THEN now() END
  FROM generate_series(0, 59) AS i;
-- noise that must not count: another member, another tenant, unverified, all with booking dates in range
INSERT INTO booking_requests (restaurant_id, member_id, phone, name, party_size, booking_date, booking_time, status, source, decided_at, confirm_code, verify_expires_at)
VALUES
  ('b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a2', '+85290000002', 'Diner', 2, '2026-12-31', '19:30', 'confirmed', 'chat', now(), NULL, NULL),
  ('b0080000-0000-4000-8000-00000000000b', 'b0080000-0000-4000-8000-0000000000a1', '+85290000001', 'Diner', 2, '2026-12-31', '19:30', 'confirmed', 'chat', now(), NULL, NULL),
  ('b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a1', '+85290000001', 'Diner', 2, '2026-12-30', '19:30', 'unverified', 'agent', NULL, 'Q2W3E4', now() + interval '30 minutes');
\echo '-- stats: total 60, 12 each (no change rows; diner cancellations count), last = latest past confirmed/no_show date, next = earliest pending/confirmed on/after now'
SELECT * FROM member_booking_stats('b0080000-0000-4000-8000-0000000000a1', 'b0080000-0000-4000-8000-00000000000a', '2026-11-20', '11:00');
\echo '-- expected by hand: dates 2026-10-01..2026-11-29; i=50 is 2026-11-20 19:30 confirmed (not past at 11:00);'
\echo '--   r1 F2: last = 2026-11-16 (i=46 no_show; 47 cancelled, 48 declined, 49 pending do not count), next = 2026-11-20 (i=50, confirmed, 19:30 >= 11:00)'
\echo '-- list query as listMemberBookings sends it: 50 rows, newest first'
SELECT count(*) AS listed, max(booking_date) AS first_date, min(booking_date) AS last_date FROM (
  SELECT booking_date, booking_time FROM booking_requests
   WHERE restaurant_id = 'b0080000-0000-4000-8000-00000000000a' AND member_id = 'b0080000-0000-4000-8000-0000000000a1' AND status <> 'unverified'
   ORDER BY booking_date DESC, booking_time DESC LIMIT 50) t;
\echo '-- the list uses the new index'
SET LOCAL enable_seqscan = off;
EXPLAIN (COSTS OFF) SELECT id FROM booking_requests
 WHERE restaurant_id = 'b0080000-0000-4000-8000-00000000000a' AND member_id = 'b0080000-0000-4000-8000-0000000000a1' AND status <> 'unverified'
 ORDER BY booking_date DESC, booking_time DESC LIMIT 50;
\echo '-- empty member: one row of zeros and NULLs'
SELECT * FROM member_booking_stats('b0080000-0000-4000-8000-0000000000a3', 'b0080000-0000-4000-8000-00000000000b', '2026-11-20', '11:00');


\echo '== r1 F2: stats count reservations, not rows (now = 2026-11-20 11:00 HK)'
INSERT INTO members (id, restaurant_id, phone, name) VALUES
  ('b0080000-0000-4000-8000-0000000000a4', 'b0080000-0000-4000-8000-00000000000a', '+85290000014', 'Member A4'),
  ('b0080000-0000-4000-8000-0000000000a5', 'b0080000-0000-4000-8000-00000000000a', '+85290000015', 'Member A5'),
  ('b0080000-0000-4000-8000-0000000000a6', 'b0080000-0000-4000-8000-00000000000a', '+85290000016', 'Member A6');
INSERT INTO booking_requests (id, restaurant_id, member_id, phone, name, party_size, booking_date, booking_time, status, source, decided_at, cancelled_at, cancelled_by, replaces_booking_id)
VALUES
  -- a4: changed then confirmed: o1 cancelled by 'change', c1 its confirmed change
  ('b0080000-0000-4000-8000-000000000041', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a4', '+85290000014', 'Diner', 2, '2026-11-10', '19:30', 'cancelled', 'agent', now(), now(), 'change', NULL),
  ('b0080000-0000-4000-8000-000000000042', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a4', '+85290000014', 'Diner', 2, '2026-11-12', '19:30', 'confirmed', 'agent', now(), NULL, NULL, 'b0080000-0000-4000-8000-000000000041'),
  -- a5: declined-only history (+ a diner cancellation and a past pending): no lastBookingDate
  ('b0080000-0000-4000-8000-000000000051', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a5', '+85290000015', 'Diner', 2, '2026-11-01', '19:30', 'declined', 'chat', now(), NULL, NULL, NULL),
  ('b0080000-0000-4000-8000-000000000052', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a5', '+85290000015', 'Diner', 2, '2026-11-02', '19:30', 'cancelled', 'agent', NULL, now(), 'diner_ai', NULL),
  ('b0080000-0000-4000-8000-000000000053', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a5', '+85290000015', 'Diner', 2, '2026-11-03', '19:30', 'pending', 'chat', NULL, NULL, NULL, NULL),
  -- a6: a booking with an open and a declined change, and a diner cancellation
  ('b0080000-0000-4000-8000-000000000061', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a6', '+85290000016', 'Diner', 2, '2026-11-25', '19:30', 'confirmed', 'agent', now(), NULL, NULL, NULL),
  ('b0080000-0000-4000-8000-000000000062', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a6', '+85290000016', 'Diner', 2, '2026-11-26', '19:30', 'pending', 'agent', NULL, NULL, NULL, 'b0080000-0000-4000-8000-000000000061'),
  ('b0080000-0000-4000-8000-000000000063', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a6', '+85290000016', 'Diner', 2, '2026-11-27', '19:30', 'declined', 'agent', now(), NULL, NULL, 'b0080000-0000-4000-8000-000000000061'),
  ('b0080000-0000-4000-8000-000000000064', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a6', '+85290000016', 'Diner', 2, '2026-11-05', '19:30', 'cancelled', 'agent', NULL, now(), 'diner_ai', NULL);
\echo '-- a4 changed-then-confirmed: expect total 1, confirmed 1, cancelled 0, last 2026-11-12, next NULL'
SELECT * FROM member_booking_stats('b0080000-0000-4000-8000-0000000000a4', 'b0080000-0000-4000-8000-00000000000a', '2026-11-20', '11:00');
\echo '-- a5 declined-only (+ diner cancel + past pending): expect total 3, declined 1, cancelled 1, pending 1, last NULL, next NULL'
SELECT * FROM member_booking_stats('b0080000-0000-4000-8000-0000000000a5', 'b0080000-0000-4000-8000-00000000000a', '2026-11-20', '11:00');
\echo '-- a6 open + declined change: expect total 2, confirmed 1, cancelled 1, declined 0, pending 0, last NULL, next 2026-11-25'
SELECT * FROM member_booking_stats('b0080000-0000-4000-8000-0000000000a6', 'b0080000-0000-4000-8000-00000000000a', '2026-11-20', '11:00');
\echo '-- the list still shows every row: a4 2 rows, a6 4 rows'
SELECT right(member_id::text, 2) AS member, count(*) AS listed FROM booking_requests
 WHERE restaurant_id = 'b0080000-0000-4000-8000-00000000000a' AND member_id IN ('b0080000-0000-4000-8000-0000000000a4', 'b0080000-0000-4000-8000-0000000000a6') AND status <> 'unverified'
 GROUP BY member_id ORDER BY member_id;

\echo '== r1 F3: a member created later links its member-less bookings (trigger trg_members_link_bookings)'
-- t1 pending A ...007 no member; t2 unverified A ...007; t3 pending B ...007; t4 confirmed A ...007 already a3 (staff); t5 pending A ...008
INSERT INTO booking_requests (id, restaurant_id, member_id, phone, name, party_size, booking_date, booking_time, status, source, decided_at, confirm_code, verify_expires_at)
VALUES
  ('b0080000-0000-4000-8000-000000000071', 'b0080000-0000-4000-8000-00000000000a', NULL, '+85290000007', 'Diner', 2, '2026-11-25', '19:30', 'pending', 'chat', NULL, NULL, NULL),
  ('b0080000-0000-4000-8000-000000000072', 'b0080000-0000-4000-8000-00000000000a', NULL, '+85290000007', 'Diner', 2, '2026-11-26', '19:30', 'unverified', 'agent', NULL, 'T7RG3R', now() + interval '30 minutes'),
  ('b0080000-0000-4000-8000-000000000073', 'b0080000-0000-4000-8000-00000000000b', NULL, '+85290000007', 'Diner', 2, '2026-11-25', '19:30', 'pending', 'chat', NULL, NULL, NULL),
  ('b0080000-0000-4000-8000-000000000074', 'b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-0000000000a3', '+85290000007', 'Diner', 2, '2026-11-18', '19:30', 'confirmed', 'chat', now(), NULL, NULL),
  ('b0080000-0000-4000-8000-000000000075', 'b0080000-0000-4000-8000-00000000000a', NULL, '+85290000008', 'Diner', 2, '2026-11-25', '19:30', 'pending', 'chat', NULL, NULL, NULL);
SELECT count(*) AS members_before FROM members WHERE restaurant_id IN ('b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-00000000000b');
SELECT count(*) AS consent_before FROM consent_records WHERE restaurant_id IN ('b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-00000000000b');
\echo '-- insert member a7 (A, ...007)'
INSERT INTO members (id, restaurant_id, phone, name) VALUES
  ('b0080000-0000-4000-8000-0000000000a7', 'b0080000-0000-4000-8000-00000000000a', '+85290000007', 'Member A7');
\echo '-- expect 71 a7 (linked), 72 NULL (unverified), 73 NULL (other restaurant), 74 a3 (already linked), 75 NULL (other phone)'
SELECT right(id::text, 2) AS booking, status, right(member_id::text, 2) AS member
  FROM booking_requests WHERE id::text BETWEEN 'b0080000-0000-4000-8000-000000000071' AND 'b0080000-0000-4000-8000-000000000075' ORDER BY id;
\echo '-- the trigger creates nothing: members +1 (the insert itself), consent rows unchanged, no events row (relink events stay 6: the 5 above + the e15 unlink)'
SELECT count(*) AS members_after FROM members WHERE restaurant_id IN ('b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-00000000000b');
SELECT count(*) AS consent_after FROM consent_records WHERE restaurant_id IN ('b0080000-0000-4000-8000-00000000000a', 'b0080000-0000-4000-8000-00000000000b');
SELECT count(*) AS relink_events_total FROM events WHERE type = 'booking.member_relinked';
\echo '-- insert member b7 (B, ...007): only B''s booking 73 links, 71 stays a7'
INSERT INTO members (id, restaurant_id, phone, name) VALUES
  ('b0080000-0000-4000-8000-0000000000b7', 'b0080000-0000-4000-8000-00000000000b', '+85290000007', 'Member B7');
SELECT right(id::text, 2) AS booking, right(member_id::text, 2) AS member
  FROM booking_requests WHERE id IN ('b0080000-0000-4000-8000-000000000071', 'b0080000-0000-4000-8000-000000000073') ORDER BY id;
\echo '-- a duplicate member insert (ON CONFLICT DO NOTHING on the unique (restaurant_id, phone) index) inserts nothing: still 1 member with that phone'
INSERT INTO members (restaurant_id, phone, name) VALUES ('b0080000-0000-4000-8000-00000000000a', '+85290000007', 'Dup') ON CONFLICT DO NOTHING;
SELECT count(*) AS a7_phone_members FROM members WHERE restaurant_id = 'b0080000-0000-4000-8000-00000000000a' AND phone = '+85290000007';
\echo '-- the unverified booking 72, once promoted to pending by the confirm code, is linked by the app (linkExistingMember), not by the trigger'

\echo '== apply 088 twice more (the release re-run): the second changes 0 rows, one trigger, no error'
\echo '-- (the first may link rows: the R8 section above unlinked a1''s bookings by hand)'
\i supabase/migrations/088_booking_member_backfill.sql
CREATE TEMP TABLE before_third AS SELECT id, member_id FROM booking_requests WHERE id::text LIKE 'b0080000-%';
\i supabase/migrations/088_booking_member_backfill.sql
SELECT count(*) AS changed_on_last_run
  FROM booking_requests b JOIN before_third f ON f.id = b.id
 WHERE b.member_id IS DISTINCT FROM f.member_id;
SELECT count(*) AS triggers FROM pg_trigger WHERE tgname = 'trg_members_link_bookings' AND NOT tgisinternal;

\echo '== grants: anon and authenticated may execute none of the three; service_role all (link_member_bookings is a trigger function: it cannot be called directly)'
SELECT p.proname, r.rolname, has_function_privilege(r.rolname, p.oid, 'EXECUTE') AS can_execute
  FROM pg_proc p CROSS JOIN (VALUES ('anon'), ('authenticated'), ('service_role')) AS r(rolname)
 WHERE p.proname IN ('relink_booking_member', 'member_booking_stats', 'link_member_bookings')
 ORDER BY p.proname, r.rolname;

\echo '== events_type_check still accepts the 081 types and the new one, refuses others'
SAVEPOINT s1;
INSERT INTO events (restaurant_id, type) VALUES ('b0080000-0000-4000-8000-00000000000a', 'reachability_restored');
\echo '-- reachability_restored accepted'
ROLLBACK TO SAVEPOINT s1;
\set ON_ERROR_STOP off
INSERT INTO events (restaurant_id, type) VALUES ('b0080000-0000-4000-8000-00000000000a', 'booking.unknown');
\set ON_ERROR_STOP on
ROLLBACK;
\echo '== ROLLBACK done'
