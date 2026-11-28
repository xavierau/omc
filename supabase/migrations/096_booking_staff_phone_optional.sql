-- BOOK-013 decision 9 (owner 2026-11-27): name required, phone optional for
-- staff bookings. A walk-in or a caller who won't give a number still lands
-- in the one book; a booking without a phone is never messaged.
-- Spec: .claude-workspace/specs/2026-11-26-book-013-staff-booking-crud.md S8
-- (AC-26..AC-29); threats: threats/2026-11-26-book-013-staff-booking-crud.md
-- R19, R20; plan: plans/2026-11-26-book-013-staff-booking-crud.md.
--
-- Apply AFTER 095 and BEFORE restarting on the code that sends a null phone
-- (the old code never does). Every existing row has a phone, so both checks
-- hold at once and no row changes. 095 is not edited.

-- ---------------------------------------------------------------------------
-- 1. The column, and the two rules the database keeps whatever the app does.
ALTER TABLE booking_requests ALTER COLUMN phone DROP NOT NULL;

-- AC-29: only a staff booking may lack a phone; every diner channel
-- (booking page, WhatsApp AI, personal agent) still requires one.
ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_phone_staff_only;
ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_phone_staff_only
  CHECK (phone IS NOT NULL OR source = 'staff');

-- R19: no phone, no diner message. notify_diner false also keeps the row out
-- of booking_reminder_candidates (095 section 9).
ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_no_phone_no_notify;
ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_no_phone_no_notify
  CHECK (phone IS NOT NULL OR notify_diner = false);

-- ---------------------------------------------------------------------------
-- 2. Staff create (095 section 5) with one change: Notify is stored off when
-- there is no phone, whatever p_notify says (AC-26, R19). The row is always
-- source 'staff', so a null phone passes the check above.
CREATE OR REPLACE FUNCTION public.staff_create_booking(
  p_restaurant_id uuid,
  p_member_id uuid,
  p_phone text,
  p_name text,
  p_party int,
  p_date date,
  p_time time,
  p_notes text,
  p_notify boolean,
  p_actor uuid,
  p_at timestamptz,
  p_broken_rules jsonb
) RETURNS SETOF booking_requests AS $$
  WITH created AS (
    INSERT INTO booking_requests (
      restaurant_id, member_id, phone, name, party_size, booking_date, booking_time, notes,
      status, decided_by, decided_at, source, created_by, updated_by, notify_diner
    ) VALUES (
      p_restaurant_id, p_member_id, p_phone, p_name, p_party, p_date, p_time, p_notes,
      'confirmed', p_actor, p_at, 'staff', p_actor, p_actor, p_notify AND p_phone IS NOT NULL
    )
    RETURNING *
  ), audit AS (
    INSERT INTO events (restaurant_id, member_id, type, actor_user_id, data_json)
    SELECT p_restaurant_id, NULL, 'booking.staff_created', p_actor,
           jsonb_build_object('bookingId', c.id)
           || CASE WHEN jsonb_array_length(coalesce(p_broken_rules, '[]'::jsonb)) > 0
                   THEN jsonb_build_object('brokenRules', p_broken_rules) ELSE '{}'::jsonb END
      FROM created c
    RETURNING id
  )
  SELECT c.* FROM created c;
$$ LANGUAGE sql SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.staff_create_booking(uuid, uuid, text, text, int, date, time, text, boolean, uuid, timestamptz, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_create_booking(uuid, uuid, text, text, int, date, time, text, boolean, uuid, timestamptz, jsonb) TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Staff edit (095 section 6) with two changes (AC-28, R20):
--   - a null p_phone matches only a source 'staff' row, so clearing the phone
--     of any other booking changes nothing (the app answers phone_required
--     first; this keeps it true for any caller);
--   - Notify is stored off when there is no phone.
-- The app clears member_id with the phone (p_member_id null).
CREATE OR REPLACE FUNCTION public.staff_update_booking(
  p_id uuid,
  p_restaurant_id uuid,
  p_expected_status text,
  p_expected_version int,
  p_member_id uuid,
  p_phone text,
  p_name text,
  p_party int,
  p_date date,
  p_time time,
  p_notes text,
  p_notify boolean,
  p_clear_reminder boolean,
  p_actor uuid,
  p_changed jsonb,
  p_broken_rules jsonb
) RETURNS SETOF booking_requests AS $$
  WITH changed AS (
    UPDATE booking_requests b
       SET member_id = p_member_id, phone = p_phone, name = p_name, party_size = p_party,
           booking_date = p_date, booking_time = p_time, notes = p_notes,
           notify_diner = p_notify AND p_phone IS NOT NULL,
           reminder_sent_at = CASE WHEN p_clear_reminder THEN NULL ELSE b.reminder_sent_at END,
           updated_by = p_actor
     WHERE b.id = p_id AND b.restaurant_id = p_restaurant_id
       AND b.status = p_expected_status AND b.status IN ('pending', 'confirmed')
       AND b.edit_version = p_expected_version
       AND (p_phone IS NOT NULL OR b.source = 'staff')
       AND NOT EXISTS (
         SELECT 1 FROM booking_requests c
          WHERE c.replaces_booking_id = b.id AND c.restaurant_id = p_restaurant_id AND c.status = 'pending'
       )
    RETURNING b.*
  ), audit AS (
    INSERT INTO events (restaurant_id, member_id, type, actor_user_id, data_json)
    SELECT p_restaurant_id, NULL, 'booking.staff_edited', p_actor,
           jsonb_build_object('bookingId', c.id, 'changed', coalesce(p_changed, '[]'::jsonb))
           || CASE WHEN jsonb_array_length(coalesce(p_broken_rules, '[]'::jsonb)) > 0
                   THEN jsonb_build_object('brokenRules', p_broken_rules) ELSE '{}'::jsonb END
      FROM changed c
    RETURNING id
  )
  SELECT c.* FROM changed c;
$$ LANGUAGE sql SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.staff_update_booking(uuid, uuid, text, int, uuid, text, text, int, date, time, text, boolean, boolean, uuid, jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_update_booking(uuid, uuid, text, int, uuid, text, text, int, date, time, text, boolean, boolean, uuid, jsonb, jsonb) TO service_role;
