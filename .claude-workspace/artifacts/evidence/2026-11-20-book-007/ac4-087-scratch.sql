-- BOOK-007 AC-4: migration 087 on a scratch DB built from 001..086, inside a
-- rolled-back transaction. Fake ids and data only (repo is public).
\set ON_ERROR_STOP on
\echo '== BEGIN (everything below is rolled back)'
BEGIN;
\i supabase/migrations/087_booking_no_show.sql
\echo '== 087 applied; re-applying it (idempotent)'
\i supabase/migrations/087_booking_no_show.sql

INSERT INTO restaurants (id, name, slug, whatsapp_number)
  VALUES ('b0070000-0000-4000-8000-00000000000a', 'Scratch A', 'scratch-a-087', '+85230000001');

-- c1: confirmed and past; c2: confirmed and past (for rejects); c3: confirmed, due for a reminder.
INSERT INTO booking_requests (id, restaurant_id, phone, name, notes, party_size, booking_date, booking_time, status, source, decided_at)
VALUES
  ('b0070000-0000-4000-8000-0000000000c1', 'b0070000-0000-4000-8000-00000000000a', '+85290000001', 'Diner One', 'n', 2, current_date - 1, '19:30', 'confirmed', 'chat', now() - interval '3 days'),
  ('b0070000-0000-4000-8000-0000000000c2', 'b0070000-0000-4000-8000-00000000000a', '+85290000002', 'Diner Two', 'n', 3, current_date - 1, '20:00', 'confirmed', 'chat', now() - interval '3 days');

\echo '== accept: confirmed -> no_show with both marker columns (the repository mark UPDATE)'
UPDATE booking_requests
   SET status = 'no_show', no_show_marked_by = 'b0070000-0000-4000-8000-0000000000aa', no_show_marked_at = now()
 WHERE id = 'b0070000-0000-4000-8000-0000000000c1' AND restaurant_id = 'b0070000-0000-4000-8000-00000000000a' AND status = 'confirmed'
RETURNING id, status, no_show_marked_by IS NOT NULL AS has_by, no_show_marked_at IS NOT NULL AS has_at, decided_at IS NOT NULL AS keeps_decided_at;

\echo '== reject cases (each must raise check_violation)'
DO $$
DECLARE
  cases text[] := ARRAY[
    $q$UPDATE booking_requests SET status = 'no_show' WHERE id = 'b0070000-0000-4000-8000-0000000000c2'$q$,
    $q$UPDATE booking_requests SET status = 'no_show', no_show_marked_by = 'b0070000-0000-4000-8000-0000000000aa' WHERE id = 'b0070000-0000-4000-8000-0000000000c2'$q$,
    $q$UPDATE booking_requests SET no_show_marked_at = now() WHERE id = 'b0070000-0000-4000-8000-0000000000c2'$q$,
    $q$UPDATE booking_requests SET status = 'no_show', no_show_marked_at = now(), decided_at = NULL WHERE id = 'b0070000-0000-4000-8000-0000000000c2'$q$,
    $q$UPDATE booking_requests SET status = 'confirmed' WHERE id = 'b0070000-0000-4000-8000-0000000000c1'$q$,
    $q$UPDATE booking_requests SET status = 'noshow', no_show_marked_at = now() WHERE id = 'b0070000-0000-4000-8000-0000000000c2'$q$
  ];
  labels text[] := ARRAY[
    'no_show without no_show_marked_at',
    'no_show with marked_by only',
    'marked_at on a confirmed row',
    'no_show without decided_at',
    'undo to confirmed that keeps marked_at',
    'unknown status'
  ];
  i int;
BEGIN
  FOR i IN 1 .. array_length(cases, 1) LOOP
    BEGIN
      EXECUTE cases[i];
      RAISE EXCEPTION 'NOT REJECTED: %', labels[i];
    EXCEPTION WHEN check_violation THEN
      RAISE NOTICE 'rejected OK (%): %', labels[i], SQLERRM;
    END;
  END LOOP;
END $$;

\echo '== the older statuses still pass the new CHECKs'
INSERT INTO booking_requests (restaurant_id, phone, party_size, booking_date, booking_time, status, source, decided_at, cancelled_by, cancelled_at)
VALUES
  ('b0070000-0000-4000-8000-00000000000a', '+85290000003', 2, current_date + 2, '19:00', 'pending', 'chat', NULL, NULL, NULL),
  ('b0070000-0000-4000-8000-00000000000a', '+85290000003', 2, current_date + 3, '19:00', 'declined', 'chat', now(), NULL, NULL),
  ('b0070000-0000-4000-8000-00000000000a', '+85290000003', 2, current_date + 4, '19:00', 'cancelled', 'agent', now(), 'diner_ai', now())
RETURNING status;

\echo '== reminders never select no_show: a no_show row inside the reminder window is not a candidate'
INSERT INTO booking_requests (id, restaurant_id, phone, party_size, booking_date, booking_time, status, source, decided_at, created_at, no_show_marked_at)
VALUES ('b0070000-0000-4000-8000-0000000000c3', 'b0070000-0000-4000-8000-00000000000a', '+85290000004', 2,
        ((now() + interval '2 hours') AT TIME ZONE 'Asia/Hong_Kong')::date,
        ((now() + interval '2 hours') AT TIME ZONE 'Asia/Hong_Kong')::time(0),
        'no_show', 'chat', now() - interval '2 days', now() - interval '2 days', now());
SELECT count(*) AS no_show_reminder_candidates
  FROM booking_reminder_candidates(now(), 3, 500) WHERE id = 'b0070000-0000-4000-8000-0000000000c3';
UPDATE booking_requests SET status = 'confirmed', no_show_marked_at = NULL WHERE id = 'b0070000-0000-4000-8000-0000000000c3';
SELECT count(*) AS same_row_confirmed_candidates
  FROM booking_reminder_candidates(now(), 3, 500) WHERE id = 'b0070000-0000-4000-8000-0000000000c3';

\echo '== retention purge clears name/notes on a no_show row (the repository purge UPDATE)'
UPDATE booking_requests SET name = NULL, notes = NULL, pii_purged_at = now()
 WHERE booking_date < current_date AND pii_purged_at IS NULL AND id = 'b0070000-0000-4000-8000-0000000000c1'
RETURNING status, name IS NULL AS name_cleared, notes IS NULL AS notes_cleared;

\echo '== accept: undo no_show -> confirmed clearing both marker columns (the repository undo UPDATE)'
UPDATE booking_requests
   SET status = 'confirmed', no_show_marked_by = NULL, no_show_marked_at = NULL
 WHERE id = 'b0070000-0000-4000-8000-0000000000c1' AND restaurant_id = 'b0070000-0000-4000-8000-00000000000a' AND status = 'no_show'
RETURNING id, status, no_show_marked_by IS NULL AS by_cleared, no_show_marked_at IS NULL AS at_cleared;

ROLLBACK;
\echo '== ROLLBACK done; 087 left nothing behind:'
SELECT count(*) AS no_show_columns_after_rollback FROM information_schema.columns
 WHERE table_name = 'booking_requests' AND column_name LIKE 'no_show%';
