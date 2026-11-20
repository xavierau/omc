-- BOOK-007: staff mark a past confirmed booking as a no-show, and can undo it.
-- Plan: .claude-workspace/plans/2026-11-20-book-007-008-member-bookings.md;
-- threats: threats/2026-11-20-book-007-008-member-bookings.md (R5, R6).
-- Additive: no existing row changes. Apply BEFORE deploying the code that
-- writes 'no_show' (the old code never writes it).
--
-- The move itself is a conditional UPDATE in booking-request-repository.ts:
-- confirmed + booking date/time (Asia/Hong_Kong) in the past -> no_show, and
-- no_show -> confirmed on undo. A no_show row keeps the decided_at it got when
-- it was confirmed.

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
