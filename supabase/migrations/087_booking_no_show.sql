-- BOOK-007: staff mark a past confirmed booking as a no-show, and can undo it.
-- Plan: .claude-workspace/plans/2026-11-20-book-007-008-member-bookings.md;
-- threats: threats/2026-11-20-book-007-008-member-bookings.md (R5, R6).
-- Additive: no existing row changes. Apply BEFORE deploying the code that
-- writes 'no_show' (the old code never writes it).
--
-- The mark is the RPC mark_booking_no_show below (r1 F1): confirmed + booking
-- date/time (Asia/Hong_Kong) in the past + no open change request -> no_show.
-- The undo is a conditional UPDATE in booking-request-repository.ts:
-- no_show -> confirmed. A no_show row keeps the decided_at it got when it was
-- confirmed.

ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_status_check;
ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_status_check
  CHECK (status IN ('unverified', 'pending', 'confirmed', 'declined', 'cancelled', 'no_show'));

-- R6: who marked it and when; both cleared on undo.
-- One statement per column (the schema-contract parser reads each ADD COLUMN).
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS no_show_marked_by UUID;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS no_show_marked_at TIMESTAMPTZ;

-- 085's rule plus no_show: it was confirmed, so it keeps its decided_at.
ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_decision_consistent;
ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_decision_consistent
  CHECK (
    (status IN ('unverified', 'pending') AND decided_at IS NULL)
    OR (status IN ('confirmed', 'declined', 'no_show') AND decided_at IS NOT NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
  );

-- R5/R6: a no_show row always has its mark time, and only a no_show row has one.
ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_no_show_marker;
ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_no_show_marker
  CHECK ((status = 'no_show') = (no_show_marked_at IS NOT NULL));

-- r1 F1: mark only a confirmed, past booking that no pending change request
-- replaces. Otherwise confirm_booking_change (085) would later confirm the
-- change and leave the original no_show (it cancels only pending/confirmed),
-- and an undo would bring back a second confirmed booking. The check sits in
-- the UPDATE's own WHERE, one statement, so no read-then-write race. "Before"
-- is the app's Hong Kong now (HH:MM), the same rule as the dashboard's
-- canMarkNoShow. Returns the changed row, or nothing.
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
     AND (b.booking_date < p_before_date OR (b.booking_date = p_before_date AND b.booking_time < p_before_time))
     AND NOT EXISTS (
       SELECT 1 FROM booking_requests c
        WHERE c.replaces_booking_id = b.id AND c.restaurant_id = p_restaurant_id AND c.status = 'pending'
     )
  RETURNING b.*;
$$ LANGUAGE sql;

REVOKE ALL ON FUNCTION public.mark_booking_no_show(uuid, uuid, uuid, timestamptz, date, time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_booking_no_show(uuid, uuid, uuid, timestamptz, date, time) TO service_role;
