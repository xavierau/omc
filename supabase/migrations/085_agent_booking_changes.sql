-- AGENT-003: the WhatsApp AI agent hands failures to staff (R19) and lets a
-- diner change or cancel a booking by chat (R20-R24).
-- Plan: .claude-workspace/plans/2026-11-19-agent-003-agent-booking.md;
-- threats: threats/2026-11-19-agent-003-agent-booking.md.
-- Additive: no existing row changes. Apply BEFORE deploying the code that
-- writes 'handoff' / 'cancelled' (the old code never writes either).

-- ---------------------------------------------------------------------------
-- 1. agent_messages: outcome 'handoff' (R19). The agent failed and the diner
-- got the handoff reply; the dashboard flags the thread "needs staff". It is a
-- reply claim like sent/shadow_draft/fallback (one answer per user row).
ALTER TABLE agent_messages DROP CONSTRAINT IF EXISTS agent_messages_outcome_check;
ALTER TABLE agent_messages
  ADD CONSTRAINT agent_messages_outcome_check
  CHECK (outcome IN ('shadow_draft', 'sent', 'fallback', 'handoff', 'error', 'rate_limited', 'skipped'));

DROP INDEX IF EXISTS agent_messages_one_reply_key;
CREATE UNIQUE INDEX agent_messages_one_reply_key
  ON agent_messages (reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL AND outcome IN ('sent', 'shadow_draft', 'fallback', 'handoff');

-- ---------------------------------------------------------------------------
-- 2. booking_requests: status 'cancelled' (R24) and change requests (R23).
--
-- cancelled_by: 'diner_ai' = the diner cancelled through the AI agent;
-- 'change' = staff confirmed a change request that replaced it.
-- replaces_booking_id: a change request (a pending row) points at the booking
-- it would replace; staff confirm swaps them in one transaction (section 3).
-- One statement per column (the schema-contract parser reads each ADD COLUMN).
ALTER TABLE booking_requests DROP CONSTRAINT IF EXISTS booking_requests_status_check;
ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_status_check
  CHECK (status IN ('unverified', 'pending', 'confirmed', 'declined', 'cancelled'));

ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS replaces_booking_id UUID
  REFERENCES booking_requests(id) ON DELETE SET NULL;
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS cancelled_by TEXT
  CHECK (cancelled_by IS NULL OR cancelled_by IN ('diner_ai', 'change'));
ALTER TABLE booking_requests ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ;

-- Undecided rows have no decided_at; decided ones have it; a cancelled row
-- keeps whatever decided_at it had (a confirmed booking's stays) and always
-- has its cancel time and marker.
ALTER TABLE booking_requests DROP CONSTRAINT booking_requests_decision_consistent;
ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_decision_consistent
  CHECK (
    (status IN ('unverified', 'pending') AND decided_at IS NULL)
    OR (status IN ('confirmed', 'declined') AND decided_at IS NOT NULL)
    OR (status = 'cancelled' AND cancelled_at IS NOT NULL)
  );
ALTER TABLE booking_requests
  ADD CONSTRAINT booking_requests_cancel_marker
  CHECK ((status = 'cancelled') = (cancelled_by IS NOT NULL));

-- R23: at most one open change request per booking.
CREATE UNIQUE INDEX booking_requests_one_pending_change_idx
  ON booking_requests (replaces_booking_id)
  WHERE replaces_booking_id IS NOT NULL AND status = 'pending';

-- ---------------------------------------------------------------------------
-- 3. R23: staff confirm a change request. One transaction: the change
-- request pending -> confirmed, and the booking it replaces (if still pending
-- or confirmed) -> cancelled by 'change'. Scoped by restaurant. Returns the
-- confirmed change request, or no row when p_id is not a pending change
-- request of this restaurant (then nothing changed).
CREATE OR REPLACE FUNCTION public.confirm_booking_change(
  p_id uuid,
  p_restaurant_id uuid,
  p_decided_by uuid,
  p_decided_at timestamptz
) RETURNS SETOF booking_requests AS $$
DECLARE
  v_change booking_requests;
BEGIN
  UPDATE booking_requests
     SET status = 'confirmed', decided_by = p_decided_by, decided_at = p_decided_at, decline_reason = NULL
   WHERE id = p_id
     AND restaurant_id = p_restaurant_id
     AND status = 'pending'
     AND replaces_booking_id IS NOT NULL
  RETURNING * INTO v_change;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE booking_requests
     SET status = 'cancelled', cancelled_by = 'change', cancelled_at = p_decided_at
   WHERE id = v_change.replaces_booking_id
     AND restaurant_id = p_restaurant_id
     AND status IN ('pending', 'confirmed');

  RETURN NEXT v_change;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION public.confirm_booking_change(uuid, uuid, uuid, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_booking_change(uuid, uuid, uuid, timestamptz) TO service_role;
