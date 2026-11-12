-- INT-001 WI-14 (I-8): atomic outbound-breaker failure-streak increment.
-- 069-074 are frozen; this is a NEW migration.
--
-- Bug (review 2026-09-10-int-001-analyzer, I-8): `deliverOutboundWebhook`'s
-- transient branch used to read `outbound_failure_streak` from an
-- already-loaded settings snapshot, add 1 in application code, and write
-- the result back with a plain `.update()` -- a classic read-modify-write.
-- With `INT001_OUTBOUND_CONCURRENCY` 2-4, several deliveries to the SAME
-- integration can fail concurrently: two attempts both read streak N and
-- both write N+1, so the breaker trips later than the documented "10
-- consecutive failures" (a lost update), and a success racing a failure
-- can reset a streak that should have tripped.
--
-- Fix: the increment happens INSIDE Postgres, in one statement, so
-- concurrent callers serialize on the row's own lock instead of racing in
-- application code -- each caller gets back the streak value AS OF its
-- own increment, never a value another concurrent increment already
-- overwrote. The threshold-trip (outbound_status -> paused_auto) is
-- decided from that same atomic value, not a second read.

CREATE OR REPLACE FUNCTION increment_outbound_failure_streak(
  p_integration_id UUID,
  p_threshold INTEGER,
  p_now TIMESTAMPTZ
) RETURNS INTEGER AS $$
DECLARE
  v_streak INTEGER;
BEGIN
  UPDATE integration_settings
  SET outbound_failure_streak = outbound_failure_streak + 1,
      updated_at = p_now
  WHERE integration_id = p_integration_id
  RETURNING outbound_failure_streak INTO v_streak;

  -- No row for this integration -- nothing to trip, nothing to return.
  IF v_streak IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_streak >= p_threshold THEN
    UPDATE integration_settings
    SET outbound_status = 'paused_auto',
        outbound_paused_at = p_now
    WHERE integration_id = p_integration_id;
  END IF;

  RETURN v_streak;
END;
$$ LANGUAGE plpgsql;

-- Same lock-down convention as every other partner-job-only RPC in this
-- feature (069-074): the service-role client is the sole intended caller.
REVOKE EXECUTE ON FUNCTION increment_outbound_failure_streak(UUID, INTEGER, TIMESTAMPTZ) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION increment_outbound_failure_streak(UUID, INTEGER, TIMESTAMPTZ) FROM anon;
REVOKE EXECUTE ON FUNCTION increment_outbound_failure_streak(UUID, INTEGER, TIMESTAMPTZ) FROM authenticated;
GRANT EXECUTE ON FUNCTION increment_outbound_failure_streak(UUID, INTEGER, TIMESTAMPTZ) TO service_role;
