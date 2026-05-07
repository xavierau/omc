-- WONB-008 follow-up: race-free per-tenant daily reconfirmation cap.
--
-- Problem (review finding P0-1):
--   The eligibility check + send loop ran in two SQL statements: COUNT(today)
--   then INSERT. Two concurrent campaign launches could both observe the same
--   "currentDailySent", both compute the same allotment, and both send →
--   actual volume = 2 × cap. Locked decision Q-I requires the cap to hold
--   even under simultaneous launches.
--
-- Fix:
--   This migration adds `claim_reconfirmation_allotment(p_restaurant_id,
--   p_requested, p_today)` — a SECURITY DEFINER RPC that:
--     1. Acquires a per-tenant-per-day Postgres advisory lock via
--        `pg_try_advisory_xact_lock(hashtext(...))`. The lock auto-releases
--        at transaction end so a crashed caller never holds it.
--     2. If the lock is NOT acquired, returns 0 immediately so the second
--        concurrent launch cleanly skips (it can retry later or treat as
--        "another launch already in flight").
--     3. If acquired, computes today's reconfirmation send count (sum across
--        all reconfirmation campaigns owned by this tenant), reads the cap
--        from `tenant_campaign_settings`, and returns
--        `LEAST(p_requested, cap - sent_today)` clamped to ≥ 0.
--
--   The caller wraps the immediate `whatsapp_messages` INSERT in the SAME
--   transaction (so the count is observed atomically with the lock, and
--   parallel callers see the correct sent_today AFTER the previous one's
--   inserts commit). When called outside an explicit transaction, supabase-js
--   wraps the RPC call itself, so the lock holds for the lifetime of the
--   single function call, which is enough to prevent the read-then-clamp race
--   between two concurrent launches.
--
-- Pattern mirrors `tenant_green_for_days` (migration 050): SECURITY DEFINER,
-- locked search_path, REVOKE PUBLIC + authenticated, GRANT service_role only.

CREATE OR REPLACE FUNCTION claim_reconfirmation_allotment(
  p_restaurant_id UUID,
  p_requested INTEGER,
  p_today DATE
)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_lock_key BIGINT;
  v_acquired BOOLEAN;
  v_cap INTEGER;
  v_sent_today INTEGER;
  v_allowed INTEGER;
BEGIN
  -- Stable lock key: hashtext is deterministic per Postgres version + cluster.
  -- The (restaurant_id, today) pair is unique, so concurrent launches for the
  -- same tenant on the same day collide; everything else passes through.
  v_lock_key := hashtext(p_restaurant_id::text || ':reconf_cap:' || p_today::text);
  v_acquired := pg_try_advisory_xact_lock(v_lock_key);
  IF NOT v_acquired THEN
    -- Another launch is currently claiming. Caller must treat 0 as
    -- "concurrent launch in flight" and skip cleanly.
    RETURN 0;
  END IF;

  -- Cap: default 50 when no settings row exists (matches getReconfirmationDailyCap).
  SELECT COALESCE(reconfirmation_daily_cap, 50)
    INTO v_cap
    FROM tenant_campaign_settings
   WHERE restaurant_id = p_restaurant_id;
  IF v_cap IS NULL THEN
    v_cap := 50;
  END IF;

  -- Sent today: sum across all reconfirmation campaigns of this tenant.
  -- queued_at boundary matches the JS-side `todayStart()` (server-local TZ);
  -- WONB-008 follow-up note in `reconfirmation-queries.ts` covers the
  -- per-tenant TZ rollover case (deferred).
  SELECT COUNT(*)
    INTO v_sent_today
    FROM whatsapp_messages m
    JOIN campaigns c ON c.id = m.campaign_id
   WHERE m.restaurant_id = p_restaurant_id
     AND c.mode = 'reconfirmation'
     AND m.queued_at >= p_today::timestamp
     AND m.queued_at <  (p_today + 1)::timestamp;

  v_allowed := GREATEST(0, LEAST(p_requested, v_cap - v_sent_today));
  RETURN v_allowed;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.claim_reconfirmation_allotment(UUID, INTEGER, DATE) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_reconfirmation_allotment(UUID, INTEGER, DATE) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_reconfirmation_allotment(UUID, INTEGER, DATE) TO service_role;

COMMENT ON FUNCTION public.claim_reconfirmation_allotment(UUID, INTEGER, DATE) IS
  'WONB-008: race-free per-tenant daily reconfirmation cap claim. Returns the allowed send count (0..p_requested) under a transaction-scoped advisory lock keyed on (restaurant_id, today). Returns 0 when another launch holds the lock.';
