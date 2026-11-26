-- BOOK-013: staff create, edit and cancel bookings; Today view check-in
-- (Arrived / Undo). No check-in code or QR (spec decision 8).
-- Spec: .claude-workspace/specs/2026-11-26-book-013-staff-booking-crud.md;
-- threats: threats/2026-11-26-book-013-staff-booking-crud.md (R1-R18);
-- plan: plans/2026-11-26-book-013-staff-booking-crud.md.
--
-- Additive: no existing row changes (new columns are NULL or a constant default).
-- Apply BEFORE deploying the code that writes 'staff' (the old code never
-- writes it).
-- One statement per column (the schema-contract parser reads each ADD COLUMN).

-- ---------------------------------------------------------------------------
-- 1. Vocabulary: source 'staff' (spec S1), cancelled_by 'staff' (S3).
ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_source_check;
ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_source_check
  CHECK (source IN ('chat', 'campaign', 'agent', 'staff'));

ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_cancelled_by_check;
ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_cancelled_by_check
  CHECK (cancelled_by IS NULL OR cancelled_by IN ('diner_ai', 'change', 'staff'));

-- ---------------------------------------------------------------------------
-- 2. Audit columns (R9): who created, last edited, cancelled, checked in.
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS created_by UUID;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS updated_by UUID;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS cancelled_by_user UUID;

-- Spec AC-2/AC-7 (owner decision 2): false = no diner message from staff
-- actions and no 3h reminder for this booking. Every existing row keeps true.
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS notify_diner BOOLEAN NOT NULL DEFAULT true;

-- R11: when the last staff-triggered diner message went out (<= 1 per 5 min).
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS last_staff_message_at TIMESTAMPTZ;

-- R3 (review R1): the version a staff edit form / cancel dialog loads and
-- sends back. Owned by the trigger in section 2b: it moves only when what
-- staff edit or see changes, never on the background writes that bump
-- updated_at (082's trigger): reminder claim, decision message status,
-- staff message claim, check-in, member relink.
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS edit_version INT NOT NULL DEFAULT 0;

-- ---------------------------------------------------------------------------
-- 2b. Any writer (staff, diner AI, agent, decide, no-show, purge) that changes
-- status, slot, party size, name, phone, notes or notify moves edit_version
-- by one; every other UPDATE keeps it (a writer cannot set it directly).
CREATE OR REPLACE FUNCTION public.bump_booking_edit_version() RETURNS trigger AS $$
BEGIN
  IF (NEW.status, NEW.booking_date, NEW.booking_time, NEW.party_size, NEW.name, NEW.phone, NEW.notes, NEW.notify_diner)
     IS DISTINCT FROM
     (OLD.status, OLD.booking_date, OLD.booking_time, OLD.party_size, OLD.name, OLD.phone, OLD.notes, OLD.notify_diner)
  THEN
    NEW.edit_version := OLD.edit_version + 1;
  ELSE
    NEW.edit_version := OLD.edit_version;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public, pg_temp;

DROP TRIGGER IF EXISTS booking_requests_edit_version ON booking_requests;
CREATE TRIGGER booking_requests_edit_version
  BEFORE UPDATE ON booking_requests
  FOR EACH ROW EXECUTE FUNCTION public.bump_booking_edit_version();

-- ---------------------------------------------------------------------------
-- 3. Check-in (spec S7, R14): status stays 'confirmed'; arrived and no_show
-- exclude each other.
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS checked_in_at TIMESTAMPTZ;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS checked_in_by UUID;

ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_checked_in_not_no_show;
ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_checked_in_not_no_show
  CHECK (status <> 'no_show' OR checked_in_at IS NULL);

-- ---------------------------------------------------------------------------
-- 4. Audit rows (R9): events types for staff actions. 088's list plus five.
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_type_check;
ALTER TABLE events ADD CONSTRAINT events_type_check
  CHECK (type IN (
    'join','redeem','receipt','campaign','points',
    'unsubscribe','reward_redeem',
    'pos_transaction','pos_refund','pos_customer_link',
    'integration_error','whatsapp_error',
    'onboarding_phase_advanced',
    'consent_imported','consent_granted',
    'consent_revoked','consent_expired',
    'stamp','stamp_reversal',
    'reachability_restored',
    'booking.member_relinked',
    'booking.staff_created', 'booking.staff_edited', 'booking.staff_cancelled',   -- NEW (095)
    'booking.checked_in', 'booking.check_in_undone'                                -- NEW (095)
  ));

-- ---------------------------------------------------------------------------
-- 5. Staff create (spec S1; R4, R9, R17). One statement: the confirmed row
-- (source 'staff', decided and created by the actor) and its events row (ids
-- and broken rule codes only). The app parsed every value (R7) and resolved
-- the member (same restaurant, by phone, never created: R17).
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
      'confirmed', p_actor, p_at, 'staff', p_actor, p_actor, p_notify
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
-- 6. Staff edit (spec S2; R3, R5, R9). One conditional UPDATE: scoped by id
-- AND restaurant, only while the row is still p_expected_status (pending or
-- confirmed) with the edit_version the form loaded (review R1: not
-- updated_at, which background writes move), and no open (pending) change
-- request replaces it. Status and source never change here.
-- p_clear_reminder: the date or time moved, so the reminder is due again
-- (spec AC-7). The events row names the changed fields, never their values.
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
           booking_date = p_date, booking_time = p_time, notes = p_notes, notify_diner = p_notify,
           reminder_sent_at = CASE WHEN p_clear_reminder THEN NULL ELSE b.reminder_sent_at END,
           updated_by = p_actor
     WHERE b.id = p_id AND b.restaurant_id = p_restaurant_id
       AND b.status = p_expected_status AND b.status IN ('pending', 'confirmed')
       AND b.edit_version = p_expected_version
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

-- ---------------------------------------------------------------------------
-- 7. Staff cancel (spec S3; R3, R5, R9). Confirmed only (a pending one is
-- declined instead), same scope and edit_version check as the edit.
CREATE OR REPLACE FUNCTION public.staff_cancel_booking(
  p_id uuid,
  p_restaurant_id uuid,
  p_expected_version int,
  p_actor uuid,
  p_at timestamptz
) RETURNS SETOF booking_requests AS $$
  WITH changed AS (
    UPDATE booking_requests b
       SET status = 'cancelled', cancelled_by = 'staff', cancelled_by_user = p_actor, cancelled_at = p_at,
           updated_by = p_actor
     WHERE b.id = p_id AND b.restaurant_id = p_restaurant_id
       AND b.status = 'confirmed'
       AND b.edit_version = p_expected_version
       AND NOT EXISTS (
         SELECT 1 FROM booking_requests c
          WHERE c.replaces_booking_id = b.id AND c.restaurant_id = p_restaurant_id AND c.status = 'pending'
       )
    RETURNING b.*
  ), audit AS (
    INSERT INTO events (restaurant_id, member_id, type, actor_user_id, data_json)
    SELECT p_restaurant_id, NULL, 'booking.staff_cancelled', p_actor, jsonb_build_object('bookingId', c.id)
      FROM changed c
    RETURNING id
  )
  SELECT c.* FROM changed c;
$$ LANGUAGE sql SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.staff_cancel_booking(uuid, uuid, int, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.staff_cancel_booking(uuid, uuid, int, uuid, timestamptz) TO service_role;

-- ---------------------------------------------------------------------------
-- 8. Check-in and undo (spec AC-21, AC-22; R14, R9). Arrived only on a
-- confirmed booking dated p_today (the app's Hong Kong date), not yet checked
-- in, with no open change request; no_show rows are excluded by the status.
-- Undo clears checked_in_* only. Each writes its events row.
CREATE OR REPLACE FUNCTION public.booking_check_in(
  p_id uuid,
  p_restaurant_id uuid,
  p_today date,
  p_actor uuid,
  p_at timestamptz
) RETURNS SETOF booking_requests AS $$
  WITH changed AS (
    UPDATE booking_requests b
       SET checked_in_at = p_at, checked_in_by = p_actor
     WHERE b.id = p_id AND b.restaurant_id = p_restaurant_id
       AND b.status = 'confirmed' AND b.booking_date = p_today AND b.checked_in_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM booking_requests c
          WHERE c.replaces_booking_id = b.id AND c.restaurant_id = p_restaurant_id AND c.status = 'pending'
       )
    RETURNING b.*
  ), audit AS (
    INSERT INTO events (restaurant_id, member_id, type, actor_user_id, data_json)
    SELECT p_restaurant_id, NULL, 'booking.checked_in', p_actor, jsonb_build_object('bookingId', c.id)
      FROM changed c
    RETURNING id
  )
  SELECT c.* FROM changed c;
$$ LANGUAGE sql SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.booking_check_in(uuid, uuid, date, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_check_in(uuid, uuid, date, uuid, timestamptz) TO service_role;

CREATE OR REPLACE FUNCTION public.booking_check_in_undo(
  p_id uuid,
  p_restaurant_id uuid,
  p_actor uuid
) RETURNS SETOF booking_requests AS $$
  WITH changed AS (
    UPDATE booking_requests b
       SET checked_in_at = NULL, checked_in_by = NULL
     WHERE b.id = p_id AND b.restaurant_id = p_restaurant_id AND b.checked_in_at IS NOT NULL
    RETURNING b.*
  ), audit AS (
    INSERT INTO events (restaurant_id, member_id, type, actor_user_id, data_json)
    SELECT p_restaurant_id, NULL, 'booking.check_in_undone', p_actor, jsonb_build_object('bookingId', c.id)
      FROM changed c
    RETURNING id
  )
  SELECT c.* FROM changed c;
$$ LANGUAGE sql SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION public.booking_check_in_undo(uuid, uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.booking_check_in_undo(uuid, uuid, uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- 9. No reminder for a booking whose staff unticked Notify (spec AC-2, AC-7).
-- 082's function plus `AND b.notify_diner`.
CREATE OR REPLACE FUNCTION public.booking_reminder_candidates(
  p_now timestamptz,
  p_lead_hours int,
  p_limit int
) RETURNS SETOF booking_requests AS $$
  SELECT b.*
  FROM booking_requests b
  WHERE b.status = 'confirmed'
    AND b.reminder_sent_at IS NULL
    AND b.notify_diner
    AND b.booking_date BETWEEN (p_now AT TIME ZONE 'Asia/Hong_Kong')::date
                           AND ((p_now + make_interval(hours => p_lead_hours)) AT TIME ZONE 'Asia/Hong_Kong')::date
    AND (b.booking_date + b.booking_time) AT TIME ZONE 'Asia/Hong_Kong' > p_now
    AND (b.booking_date + b.booking_time) AT TIME ZONE 'Asia/Hong_Kong' <= p_now + make_interval(hours => p_lead_hours)
    AND b.created_at <= (b.booking_date + b.booking_time) AT TIME ZONE 'Asia/Hong_Kong' - make_interval(hours => p_lead_hours)
  ORDER BY b.booking_date, b.booking_time, b.id
  LIMIT p_limit
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------------
-- 10. A checked-in booking is never marked no-show (R14). 087's function
-- plus `AND b.checked_in_at IS NULL`.
CREATE OR REPLACE FUNCTION public.mark_booking_no_show(
  p_id uuid,
  p_restaurant_id uuid,
  p_marked_by uuid,
  p_marked_at timestamptz,
  p_before_date date,
  p_before_time time
) RETURNS SETOF booking_requests AS $$
  UPDATE booking_requests b
     SET status = 'no_show', no_show_marked_by = p_marked_by, no_show_marked_at = p_marked_at
   WHERE b.id = p_id AND b.restaurant_id = p_restaurant_id
     AND b.status = 'confirmed'
     AND b.checked_in_at IS NULL
     AND (b.booking_date < p_before_date OR (b.booking_date = p_before_date AND b.booking_time < p_before_time))
     AND NOT EXISTS (
       SELECT 1 FROM booking_requests c
        WHERE c.replaces_booking_id = b.id AND c.restaurant_id = p_restaurant_id AND c.status = 'pending'
     )
  RETURNING b.*;
$$ LANGUAGE sql;

-- ---------------------------------------------------------------------------
-- 11. Member panel stats count arrivals (spec AC-23). 088's function plus
-- `arrived`; the return type changes, so DROP + CREATE (grants re-applied).
DROP FUNCTION IF EXISTS public.member_booking_stats(uuid, uuid, date, time);
CREATE FUNCTION public.member_booking_stats(
  p_member_id uuid,
  p_restaurant_id uuid,
  p_now_date date,
  p_now_time time
) RETURNS TABLE (
  total int,
  confirmed int,
  cancelled int,
  declined int,
  no_show int,
  pending int,
  last_booking_date date,
  next_booking_date date,
  arrived int
) AS $$
  SELECT
    count(*) FILTER (WHERE r.counted)::int,
    count(*) FILTER (WHERE r.counted AND b.status = 'confirmed')::int,
    count(*) FILTER (WHERE r.counted AND b.status = 'cancelled')::int,
    count(*) FILTER (WHERE r.counted AND b.status = 'declined')::int,
    count(*) FILTER (WHERE r.counted AND b.status = 'no_show')::int,
    count(*) FILTER (WHERE r.counted AND b.status = 'pending')::int,
    max(b.booking_date) FILTER (
      WHERE b.status IN ('confirmed', 'no_show')
        AND (b.booking_date < p_now_date OR (b.booking_date = p_now_date AND b.booking_time < p_now_time))
    ),
    min(b.booking_date) FILTER (
      WHERE b.status IN ('pending', 'confirmed')
        AND (b.booking_date > p_now_date OR (b.booking_date = p_now_date AND b.booking_time >= p_now_time))
    ),
    count(*) FILTER (WHERE r.counted AND b.checked_in_at IS NOT NULL)::int
  FROM booking_requests b
  CROSS JOIN LATERAL (
    SELECT b.cancelled_by IS DISTINCT FROM 'change'
       AND NOT (b.replaces_booking_id IS NOT NULL AND b.status IN ('pending', 'declined')) AS counted
  ) r
  WHERE b.restaurant_id = p_restaurant_id AND b.member_id = p_member_id AND b.status <> 'unverified';
$$ LANGUAGE sql STABLE;

REVOKE ALL ON FUNCTION public.member_booking_stats(uuid, uuid, date, time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.member_booking_stats(uuid, uuid, date, time) TO service_role;
